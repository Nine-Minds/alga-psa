import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The contact's Portal access tile.
 *
 * Lapsed invitations are retained now (the MSP's "who never used theirs?" view
 * is made of them), so "a row exists" stopped meaning "an invitation is
 * outstanding": the tile has to tell a live invitation from a dead one, by the
 * same rule the client's contact list and the Portal tab use. It also dates the
 * invitation by its last send, because a resend renews the row it reuses.
 */

const assertMspPermissionMock = vi.fn();

type Row = Record<string, unknown> | undefined;

const state: {
  portalUser: Row;
  invitation: Row;
  contact: Row;
} = { portalUser: undefined, invitation: undefined, contact: undefined };

function builderFor(table: string) {
  const row = table === 'users'
    ? state.portalUser
    : table === 'portal_invitations'
      ? state.invitation
      : state.contact;
  const builder: any = {
    where: () => builder,
    orderBy: () => builder,
    select: () => builder,
    first: async () => row,
  };
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
  tenantDb: () => ({ table: (table: string) => builderFor(table) }),
  withTransaction: (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../../lib/authHelpers', () => ({
  assertMspPermission: (...args: any[]) => assertMspPermissionMock(...args),
}));

vi.mock('@alga-psa/authorization/ticketScopeAuthorization', () => ({
  createTicketReadScope: vi.fn(),
}));

const { getContactPortalSummary } = await import('./contactBentoActions');

const CONTACT_EMAIL = 'ada@acme.test';
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  state.portalUser = undefined;
  state.contact = { email: CONTACT_EMAIL, is_inactive: false };
  state.invitation = undefined;
});

describe('getContactPortalSummary', () => {
  it('reports no invitation when the contact never had one', async () => {
    const summary = await getContactPortalSummary('contact-1');

    expect(summary.invitationState).toBe('none');
    expect(summary.invitedAt).toBeNull();
  });

  it('reports a live invitation as pending', async () => {
    state.invitation = { created_at: PAST, expires_at: FUTURE, email: CONTACT_EMAIL, metadata: {} };

    const summary = await getContactPortalSummary('contact-1');

    expect(summary.invitationState).toBe('pending');
    expect(summary.invitedAt).toBe(PAST.toISOString());
  });

  it('reports a lapsed invitation as expired instead of "invitation sent" for ever', async () => {
    state.invitation = { created_at: PAST, expires_at: PAST, email: CONTACT_EMAIL, metadata: {} };

    expect((await getContactPortalSummary('contact-1')).invitationState).toBe('expired');
  });

  it('reports a link the setup page would refuse as expired', async () => {
    // Same two refusals verifyToken applies: a deactivated contact, and an
    // address the contact no longer has.
    state.invitation = { created_at: PAST, expires_at: FUTURE, email: 'old@acme.test', metadata: {} };
    expect((await getContactPortalSummary('contact-1')).invitationState).toBe('expired');

    state.invitation = { created_at: PAST, expires_at: FUTURE, email: CONTACT_EMAIL, metadata: {} };
    state.contact = { email: CONTACT_EMAIL, is_inactive: true };
    expect((await getContactPortalSummary('contact-1')).invitationState).toBe('expired');
  });

  it('treats a used or revoked invitation as nothing outstanding', async () => {
    // Revoking stamps used_at, exactly as accepting one does.
    state.invitation = { created_at: PAST, expires_at: FUTURE, used_at: PAST, email: CONTACT_EMAIL, metadata: {} };

    expect((await getContactPortalSummary('contact-1')).invitationState).toBe('none');
  });

  it('dates the invitation by its last send, not by the row it renewed', async () => {
    const lastSentAt = '2026-06-01T10:00:00.000Z';
    state.invitation = {
      created_at: PAST,
      expires_at: FUTURE,
      email: CONTACT_EMAIL,
      metadata: { last_sent_at: lastSentAt },
    };

    expect((await getContactPortalSummary('contact-1')).invitedAt).toBe(lastSentAt);
  });

  it('lets a portal account outrank the invitation it came from', async () => {
    state.portalUser = { is_inactive: false, last_login_at: PAST };
    state.invitation = { created_at: PAST, expires_at: PAST, email: CONTACT_EMAIL, metadata: {} };

    const summary = await getContactPortalSummary('contact-1');

    expect(summary.hasAccount).toBe(true);
    expect(summary.accountInactive).toBe(false);
  });
});
