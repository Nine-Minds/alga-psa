import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Creating and resending one contact's invitation. The expiry is always the
 * tenant's own validity computed by the database, and a resend renews the link
 * the contact already holds instead of handing back a nearly dead one.
 */

const state: {
  existingInvitation:
    | { invitation_id: string; token: string; metadata?: Record<string, unknown> }
    | undefined;
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
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.where).toEqual({ invitation_id: 'invitation-1', used_at: null });
    expect(state.updates[0]?.values.expires_at).toEqual({
      sql: 'now() + make_interval(days => ?)',
      bindings: [7],
    });
  });

  it('records the resend on the invitation it renews', async () => {
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1' };

    await PortalInvitationService.createInvitationWithTransaction('contact-1', trxStub as never, 7);

    // Without this the Portal tab's history would still show only the day the
    // invitation was first created, however often it was mailed again.
    const metadata = state.updates[0]?.values.metadata as { sql: string; bindings: string[] };
    expect(metadata.sql).toBe("coalesce(metadata, '{}'::jsonb) || ?::jsonb");
    const written = JSON.parse(metadata.bindings[0]);
    expect(written).toMatchObject({ last_sent_by: 'user-1', resend_count: 1 });
    expect(Date.parse(written.last_sent_at)).not.toBeNaN();
  });

  it('counts each resend of the same invitation', async () => {
    state.existingInvitation = {
      invitation_id: 'invitation-1',
      token: 'token-1',
      metadata: { resend_count: 2 },
    };

    await PortalInvitationService.createInvitationWithTransaction('contact-1', trxStub as never, 7);

    const metadata = state.updates[0]?.values.metadata as { bindings: string[] };
    expect(JSON.parse(metadata.bindings[0]).resend_count).toBe(3);
  });

  it('re-points the stored address at where the resend is actually going', async () => {
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1' };

    await PortalInvitationService.createInvitationWithTransaction('contact-1', trxStub as never, 7);

    // The invitation is mailed to the contact's current address, and the token
    // is refused at use time when the two disagree — so a contact whose email
    // changed gets a link their own address can use.
    expect(state.updates[0]?.values.email).toBe('casey@acme.test');
  });
});
