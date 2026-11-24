import { describe, expect, it } from 'vitest';
import {
  classifyPortalInvitationState,
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
    // verifyToken refuses a link whose stored address is not the contact's
    // current one, so such an invitation must not read as "pending until
    // <date>". Expired is both honest and the state that repairs it: a resend
    // re-points the stored address.
    expect(LATEST_INVITATION_STATE_SQL).toContain(
      `lower((array_agg(pi.email ${'order by pi.created_at desc, pi.invitation_id desc'}))[1]) is distinct from lower(min(c.email)) then 'expired'`
    );
    // And the mismatch is decided before anything is called pending.
    expect(LATEST_INVITATION_STATE_SQL.indexOf('is distinct from'))
      .toBeLessThan(LATEST_INVITATION_STATE_SQL.indexOf("else 'pending'"));
  });
});
