import { describe, expect, it } from 'vitest';
import {
  classifyPortalInvitationState,
  invitationAddressBelongsToContact,
  invitationRefusedAtUseTime,
  invitationStateHaving,
  LATEST_INVITATION_EXPIRES_AT_SQL,
  LATEST_INVITATION_STATE_SQL,
} from './portalInvitationStateQuery';

/**
 * The invitation state of a contact is the state of its LATEST invitation, and
 * the set a batch acts on is selected by the very same expression the column is
 * read from.
 */
describe('classifyPortalInvitationState', () => {
  it('lets a live portal user outrank any invitation', () => {
    expect(classifyPortalInvitationState({
      has_portal_user: true,
      has_active_portal_user: true,
      invitation_state: 'pending',
    })).toBe('active_user');
  });

  it('does not pass a deactivated portal user off as an active one', () => {
    expect(classifyPortalInvitationState({
      has_portal_user: true,
      has_active_portal_user: false,
      invitation_state: 'none',
    })).toBe('inactive_user');
  });

  it('reports the latest invitation\'s own state', () => {
    expect(classifyPortalInvitationState({ invitation_state: 'pending' })).toBe('pending');
    expect(classifyPortalInvitationState({ invitation_state: 'expired' })).toBe('expired');
    expect(classifyPortalInvitationState({ invitation_state: 'none' })).toBe('none');
  });

  it('treats a used or revoked latest invitation as nothing outstanding', () => {
    // The SQL answers 'none' for a latest row with used_at set, which covers
    // both an accepted and a revoked invitation: older lapsed rows underneath
    // it must not resurrect the contact as "expired".
    expect(classifyPortalInvitationState({ invitation_state: null })).toBe('none');
    expect(classifyPortalInvitationState({})).toBe('none');
  });
});

describe('invitationStateHaving', () => {
  it('selects with the same expression the column is read from', () => {
    const having = invitationStateHaving(['expired']);

    expect(having.bindings).toEqual(['expired']);
    expect(having.sql).toBe(`(${LATEST_INVITATION_STATE_SQL}) in (?)`);
  });

  it('binds each asked-for state once', () => {
    const having = invitationStateHaving(['expired', 'pending', 'expired']);

    expect(having.bindings).toEqual(['expired', 'pending']);
    expect(having.sql.endsWith('in (?, ?)')).toBe(true);
  });

  it('classifies the latest row only, in database time', () => {
    // Ordering by created_at desc is what makes it the latest row; `now()` is
    // what keeps the comparison in the database's clock, like the write.
    expect(LATEST_INVITATION_STATE_SQL).toContain('order by pi.created_at desc');
    expect(LATEST_INVITATION_STATE_SQL).toContain(`${LATEST_INVITATION_EXPIRES_AT_SQL} <= now()`);
    expect(LATEST_INVITATION_STATE_SQL).toContain('pi.used_at');
    expect(LATEST_INVITATION_STATE_SQL).not.toContain('bool_or');
  });

  it('counts an invitation sent to an address the contact no longer has as expired', () => {
    // verifyToken refuses a link whose stored address is none of the contact's,
    // so such an invitation must not read as "pending until <date>". Expired is
    // both honest and the state that repairs it: a resend to such a contact
    // issues a fresh link.
    const latestAddress = "nullif(btrim(lower((array_agg(pi.email "
      + 'order by pi.created_at desc, pi.invitation_id desc))[1])), \'\')';
    expect(LATEST_INVITATION_STATE_SQL).toContain(`when ${latestAddress} is null then 'expired'`);
    expect(LATEST_INVITATION_STATE_SQL).toContain(`when not (${latestAddress} = any (`);
    // And the mismatch is decided before anything is called pending.
    expect(LATEST_INVITATION_STATE_SQL.indexOf('= any ('))
      .toBeLessThan(LATEST_INVITATION_STATE_SQL.indexOf("else 'pending'"));
  });

  it('accepts any address the contact can receive at, as the product does', () => {
    // An MSP that corrects a contact's primary address and keeps the old one as
    // an additional address has not taken the mailbox away: the link in it still
    // reaches the contact, and ContactModel.getContactByEmail would still call
    // that address theirs. Calling it expired would chase up a contact whose
    // invitation is live and dead-link nothing.
    expect(LATEST_INVITATION_STATE_SQL).toContain("array_agg(nullif(btrim(lower(cea.email_address)), ''))");
    expect(LATEST_INVITATION_STATE_SQL).toContain("min(nullif(btrim(lower(c.email)), ''))");
    expect(LATEST_INVITATION_STATE_SQL).toContain('array_remove(');

    expect(invitationRefusedAtUseTime({
      contactEmails: ['john@acme.test', 'jon@acme.test'],
      invitationEmail: 'jon@acme.test',
    })).toBeNull();
  });

  it('compares the address the way the single-row twin does', () => {
    // invitationRefusedAtUseTime lowercases and trims both sides, and so does
    // verifyToken. If the column's SQL compared them untrimmed, a stray space in
    // one of the two stored addresses would read as "pending until <date>" on the
    // contact's Portal tab and as "expired" on the client's contact list — the
    // same split this rule exists to close. An empty address is no address at
    // all on both sides, so neither surface can call a blank legacy row pending.
    expect(invitationRefusedAtUseTime({
      contactEmails: [' ada@acme.test '],
      invitationEmail: 'ada@acme.test',
    })).toBeNull();
    expect(invitationRefusedAtUseTime({ contactEmails: ['   '], invitationEmail: '  ' }))
      .toBe('email_changed');
    expect(LATEST_INVITATION_STATE_SQL).toContain("min(nullif(btrim(lower(c.email)), ''))");
  });
});

/**
 * The single-row twin of the state SQL: the two refusals verifyToken applies to
 * a link that is neither used nor past its expiry. The per-contact history is
 * read one row at a time, and it has to reach the same verdict the client's
 * contact list reaches for the same contact.
 */
describe('invitationRefusedAtUseTime', () => {
  it('passes a live invitation whose address is still the contact\'s own', () => {
    expect(invitationRefusedAtUseTime({
      contactInactive: false,
      contactEmails: ['ada@acme.test'],
      invitationEmail: 'ada@acme.test',
    })).toBeNull();
  });

  it('ignores case and surrounding space, like the verify query does', () => {
    expect(invitationRefusedAtUseTime({
      contactEmails: [' Ada@Acme.test '],
      invitationEmail: 'ada@acme.TEST',
    })).toBeNull();
  });

  it('passes a link mailed to one of the contact\'s additional addresses', () => {
    // The MSP corrected the primary address and kept the old one on the contact,
    // so the mailbox the link is sitting in is still the contact's own.
    expect(invitationRefusedAtUseTime({
      contactEmails: ['ada@acme.test', 'ada@old.test'],
      invitationEmail: 'ada@old.test',
    })).toBeNull();
  });

  it('refuses a link mailed to an address the contact no longer has', () => {
    expect(invitationRefusedAtUseTime({
      contactEmails: ['ada@acme.test'],
      invitationEmail: 'ada@old.test',
    })).toBe('email_changed');
  });

  it('refuses a deactivated contact before anything else', () => {
    // The contact cannot sign in at all, so the address is beside the point.
    expect(invitationRefusedAtUseTime({
      contactInactive: true,
      contactEmails: ['ada@acme.test'],
      invitationEmail: 'ada@acme.test',
    })).toBe('contact_inactive');
  });

  it('refuses an invitation with no address on either side', () => {
    // A blank address is no address: the SQL normalizes both sides to NULL and
    // refuses them, and so does this.
    expect(invitationRefusedAtUseTime({ contactEmails: [null], invitationEmail: 'ada@acme.test' }))
      .toBe('email_changed');
    expect(invitationRefusedAtUseTime({ contactEmails: ['ada@acme.test'], invitationEmail: null }))
      .toBe('email_changed');
    expect(invitationRefusedAtUseTime({ contactEmails: [], invitationEmail: 'ada@acme.test' }))
      .toBe('email_changed');
    expect(invitationRefusedAtUseTime({})).toBe('email_changed');
  });
});

describe('invitationAddressBelongsToContact', () => {
  it('matches the primary and every additional address', () => {
    expect(invitationAddressBelongsToContact('JON@acme.test', ['john@acme.test', ' jon@acme.test ']))
      .toBe(true);
    expect(invitationAddressBelongsToContact('john@acme.test', ['john@acme.test']))
      .toBe(true);
  });

  it('does not match an address that was taken off the contact', () => {
    // This is what makes a resend reissue instead of renewing: the mailbox the
    // original link went to is not the contact's any more.
    expect(invitationAddressBelongsToContact('jon@acme.test', ['john@acme.test', 'j.doe@acme.test']))
      .toBe(false);
  });

  it('never matches on a missing address', () => {
    expect(invitationAddressBelongsToContact(null, ['john@acme.test'])).toBe(false);
    expect(invitationAddressBelongsToContact('  ', [null, '  '])).toBe(false);
    expect(invitationAddressBelongsToContact('john@acme.test', [])).toBe(false);
  });
});
