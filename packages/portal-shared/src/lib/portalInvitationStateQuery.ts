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

/** When the latest invitation lapses — only meaningful while it is pending. */
export const LATEST_INVITATION_EXPIRES_AT_SQL = latestInvitation('pi.expires_at');

/**
 * `none` | `pending` | `expired` for the contact's latest invitation.
 *
 * An invitation whose stored address is no longer the contact's own counts as
 * expired, not pending: the link in that old mailbox is refused at use time
 * (PortalInvitationService.verifyToken), so calling it "pending until <date>"
 * would promise a link that cannot be opened. Expired is also the state that
 * repairs it — a resend re-points the stored address and mails a usable link.
 *
 * `min(c.email)` rather than a bare `c.email` so the expression stands on its
 * own in a HAVING clause, whatever the caller grouped by.
 */
export const LATEST_INVITATION_STATE_SQL = `case
    when count(pi.invitation_id) = 0 then 'none'
    when ${latestInvitation('pi.used_at')} is not null then 'none'
    when ${LATEST_INVITATION_EXPIRES_AT_SQL} <= now() then 'expired'
    when lower(${latestInvitation('pi.email')}) is distinct from lower(min(c.email)) then 'expired'
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
 * Why an unused, unexpired invitation would still be refused the moment its
 * link is opened. `PortalInvitationService.verifyToken` applies exactly these
 * two rules (a deactivated contact, and a stored address the contact no longer
 * has), and `LATEST_INVITATION_STATE_SQL` above says the same thing in SQL for
 * a whole client at once. This is the single-row twin, for the per-contact
 * history: without it the contact's Portal tab would count down the expiry of a
 * link the setup page refuses, and the MSP would read "nothing to do".
 *
 * Addresses are compared case-insensitively, like the verify query does; an
 * address missing on either side cannot match, which is also how the SQL
 * equality in verifyToken behaves.
 */
export function invitationRefusedAtUseTime(row: {
  contactInactive?: boolean | null;
  contactEmail?: string | null;
  invitationEmail?: string | null;
}): InvitationUseTimeRefusal | null {
  if (row.contactInactive) {
    return 'contact_inactive';
  }
  const contactEmail = row.contactEmail?.trim().toLowerCase();
  const invitationEmail = row.invitationEmail?.trim().toLowerCase();
  if (!contactEmail || !invitationEmail || contactEmail !== invitationEmail) {
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
