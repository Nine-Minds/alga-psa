import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Creating and resending one contact's invitation. The expiry is always the
 * tenant's own validity computed by the database, and a resend renews the link
 * the contact already holds instead of handing back a nearly dead one.
 */

const state: {
  existingInvitation: { invitation_id: string; token: string } | undefined;
  updates: Array<{ where: Record<string, unknown>; values: Record<string, unknown> }>;
  inserts: Array<Record<string, unknown>>;
} = { existingInvitation: undefined, updates: [], inserts: [] };

const trxStub = {
  raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }),
  fn: { now: () => ({ sql: 'now()' }) },
};

function portalInvitationsBuilder() {
  let whereFilters: Record<string, unknown> = {};
  const builder: any = {
    where(filters: Record<string, unknown> | string) {
      if (typeof filters === 'object') whereFilters = { ...whereFilters, ...filters };
      return builder;
    },
    first: () => Promise.resolve(state.existingInvitation),
    update(values: Record<string, unknown>) {
      state.updates.push({ where: whereFilters, values });
      return Promise.resolve(1);
    },
    insert(values: Record<string, unknown>) {
      state.inserts.push(values);
      return {
        returning: () => Promise.resolve([{ invitation_id: 'new-invitation', token: values.token }]),
      };
    },
  };
  return builder;
}

const scopedDb = {
  table: (table: string) => {
    if (table === 'contacts') {
      return {
        where: () => ({
          first: () => Promise.resolve({
            contact_name_id: 'contact-1',
            email: 'casey@acme.test',
            full_name: 'Casey Client',
          }),
        }),
      } as any;
    }
    if (table === 'portal_invitations') return portalInvitationsBuilder();
    throw new Error(`Unexpected table: ${table}`);
  },
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
  tenantDb: () => scopedDb,
  requireTenantId: async () => 'tenant-1',
  withTransaction: (_db: unknown, fn: (trx: any) => unknown) => fn(trxStub),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: async () => ({ user_id: 'user-1' }),
}));

vi.mock('@alga-psa/auth', () => ({
  checkPortalInvitationLimit: async () => ({ success: true }),
  formatRateLimitError: async () => 'rate limited',
}));

const { PortalInvitationService } = await import('./PortalInvitationService');

beforeEach(() => {
  state.existingInvitation = undefined;
  state.updates = [];
  state.inserts = [];
});

describe('PortalInvitationService.createInvitationWithTransaction', () => {
  it('stores an expiry of the tenant\'s validity, computed by the database', async () => {
    const result = await PortalInvitationService.createInvitationWithTransaction(
      'contact-1',
      trxStub as never,
      14
    );

    expect(result).toMatchObject({ success: true, invitationId: 'new-invitation' });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.expires_at).toEqual({
      sql: 'now() + make_interval(days => ?)',
      bindings: [14],
    });
    expect(state.updates).toHaveLength(0);
  });

  it('renews the active invitation on a resend, keeping the token it already mailed', async () => {
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1' };

    const result = await PortalInvitationService.createInvitationWithTransaction(
      'contact-1',
      trxStub as never,
      7
    );

    // Same link, full period again: the email and the stored expiry agree even
    // when the resend lands on the invitation's last day.
    expect(result).toMatchObject({ success: true, invitationId: 'invitation-1', token: 'token-1' });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toEqual([{
      where: { invitation_id: 'invitation-1', used_at: null },
      values: { expires_at: { sql: 'now() + make_interval(days => ?)', bindings: [7] } },
    }]);
  });
});
