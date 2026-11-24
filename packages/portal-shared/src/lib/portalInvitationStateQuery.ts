import type {
  InvitationUseTimeRefusal,
  PortalInvitationState,
  PortalInvitationStateTarget,
} from '../types';

/**
 * One rule for a contact's invitation standing, shared by the state the MSP
 * reads on the client's contact list and by the set a batch is aimed at.
 *
 * The state of a contact is the state of its LATEST invitation, never a mix of
 * every row it ever had: lapsed rows are now retained for 90 days, so a contact
 * can easily hold an old expired invitation under a newer one that was revoked
 * or used. Aggregating over "any unused row" would report such a contact as
 * expired and sweep them into "resend expired" — re-inviting someone the MSP
 * deliberately revoked.
 *
 * `used_at` carries both "the invitation was accepted" and "it was revoked"
 * (PortalInvitationService.revokeInvitation stamps it), so a latest row with
 * `used_at` set means there is nothing outstanding for this contact.
 *
 * The expiry is compared in database time, like it is written.
 */
const LATEST_INVITATION_ORDER = 'order by pi.created_at desc, pi.invitation_id desc';

/** The latest invitation's value for one column, or NULL when there is none. */
function latestInvitation(column: string): string {
  return `(array_agg(${column} ${LATEST_INVITATION_ORDER}))[1]`;
}

/**
 * One address, as the comparison sees it: case and surrounding space are the
 * same mailbox, and an empty address is no address at all. The JS twin
 * `normalizePortalInvitationAddress` does exactly this, so a legacy row with a
 * blank address cannot be called pending by the SQL and refused by the page.
 *
 * Exported because the verify path narrows its address join with the very same
 * expression (`PortalInvitationService.verifyToken`): one spelling of "the same
 * mailbox" for the column, the batch and the setup page.
 */
export function normalizedInvitationAddressSql(expression: string): string {
  return `nullif(btrim(lower(${expression})), '')`;
}

/** When the latest invitation lapses — only meaningful while it is pending. */
export const LATEST_INVITATION_EXPIRES_AT_SQL = latestInvitation('pi.expires_at');

/** The address the latest invitation was mailed to. */
const LATEST_INVITATION_ADDRESS_SQL = normalizedInvitationAddressSql(latestInvitation('pi.email'));

/**
 * Every address the contact can receive at: its primary plus each row of
 * `contact_additional_email_addresses` (alias `cea`, left-joined by the caller).
 *
 * "Is this address this contact's?" is answered product-wide by primary ∪
 * additional — `ContactModel.getContactByEmail`, inbound email→contact matching
 * and comment recipients all accept an additional address — so an invitation
 * mailed to an address the MSP later kept as an additional one is still a link
 * this contact can open, and must not be reported as dead.
 *
 * Aggregated (`array_agg`/`min`) rather than compared row by row so the whole
 * expression stands on its own in a HAVING clause, whatever the caller grouped
 * by. `array_remove(..., null)` drops the NULL a contact with no additional
 * addresses contributes through the left join.
 */
const CONTACT_ADDRESSES_SQL = `array_remove(
      array_agg(${normalizedInvitationAddressSql('cea.email_address')}) || min(${normalizedInvitationAddressSql('c.email')}),
      null
    )`;

/**
 * `none` | `pending` | `expired` for the contact's latest invitation.
 *
 * An invitation whose stored address is none of the contact's own counts as
 * expired, not pending: the link in that old mailbox is refused at use time
 * (PortalInvitationService.verifyToken), so calling it "pending until <date>"
 * would promise a link that cannot be opened. Expired is also the state that
 * repairs it — a resend to such a contact issues a fresh link.
 *
 * The address comparison is the one `verifyToken` and `invitationRefusedAtUseTime`
 * apply, down to the normalization, so the column, the batch and the setup page
 * cannot reach three different verdicts for one row.
 */
export const LATEST_INVITATION_STATE_SQL = `case
    when count(pi.invitation_id) = 0 then 'none'
    when ${latestInvitation('pi.used_at')} is not null then 'none'
    when ${LATEST_INVITATION_EXPIRES_AT_SQL} <= now() then 'expired'
    when ${LATEST_INVITATION_ADDRESS_SQL} is null then 'expired'
    when not (${LATEST_INVITATION_ADDRESS_SQL} = any (${CONTACT_ADDRESSES_SQL})) then 'expired'
    else 'pending'
  end`;

/**
 * The HAVING predicate that selects the asked-for invitation states, built from
 * the same expression the column is read from — so a batch can never act on a
 * wider set than the one the MSP sees.
 */
export function invitationStateHaving(
  states: readonly PortalInvitationStateTarget[]
): { sql: string; bindings: string[] } {
  const wanted = Array.from(new Set(states));
  return {
    sql: `(${LATEST_INVITATION_STATE_SQL}) in (${wanted.map(() => '?').join(', ')})`,
    bindings: wanted,
  };
}

/**
 * One address, normalized the way every comparison here normalizes it: case and
 * surrounding space are the same mailbox, and a blank address is `null` — no
 * address at all, which can never match.
 */
export function normalizePortalInvitationAddress(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * Is the address an invitation was mailed to still one of this contact's own?
 *
 * `contactEmails` is the contact's primary address together with its additional
 * ones, because that is how the product decides whose address an address is
 * (`ContactModel.getContactByEmail`). A link mailed to an address the MSP later
 * demoted to "additional" still reaches this contact and still belongs to them;
 * a link mailed to an address that was removed outright does not.
 */
export function invitationAddressBelongsToContact(
  invitationEmail: string | null | undefined,
  contactEmails: ReadonlyArray<string | null | undefined>
): boolean {
  const mailedTo = normalizePortalInvitationAddress(invitationEmail);
  if (!mailedTo) {
    return false;
  }
  return contactEmails.some((address) => normalizePortalInvitationAddress(address) === mailedTo);
}

/**
 * Why an unused, unexpired invitation would still be refused the moment its
 * link is opened. `PortalInvitationService.verifyToken` applies exactly these
 * two rules (a deactivated contact, and a stored address that is none of the
 * contact's), and `LATEST_INVITATION_STATE_SQL` above says the same thing in
 * SQL for a whole client at once. This is the single-row twin, for the
 * per-contact history: without it the contact's Portal tab would count down the
 * expiry of a link the setup page refuses, and the MSP would read "nothing to
 * do".
 */
export function invitationRefusedAtUseTime(row: {
  contactInactive?: boolean | null;
  contactEmails?: ReadonlyArray<string | null | undefined>;
  invitationEmail?: string | null;
}): InvitationUseTimeRefusal | null {
  if (row.contactInactive) {
    return 'contact_inactive';
  }
  if (!invitationAddressBelongsToContact(row.invitationEmail, row.contactEmails ?? [])) {
    return 'email_changed';
  }
  return null;
}

/**
 * A row of the state query turned into the state the UI shows. A live portal
 * user outranks any invitation; a portal user that was deactivated says so
 * rather than passing for an active one.
 */
export function classifyPortalInvitationState(row: {
  has_portal_user?: boolean | null;
  has_active_portal_user?: boolean | null;
  invitation_state?: string | null;
}): PortalInvitationState {
  if (row.has_active_portal_user) {
    return 'active_user';
  }
  if (row.has_portal_user) {
    return 'inactive_user';
  }
  return row.invitation_state === 'pending' || row.invitation_state === 'expired'
    ? row.invitation_state
    : 'none';
}
