import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Creating and resending one contact's invitation. The expiry is always the
 * tenant's own validity computed by the database, and a resend renews the link
 * the contact already holds instead of handing back a nearly dead one — unless
 * the address that link went to is not the contact's any more, in which case it
 * is revoked and replaced rather than re-armed.
 */

const CONTACT_EMAIL = 'casey@acme.test';

type StoredInvitation = {
  invitation_id: string;
  token: string;
  email?: string | null;
  metadata?: Record<string, unknown>;
  used_at?: Date;
  is_active?: boolean;
  created_at?: number;
};

const state: {
  existingInvitation: StoredInvitation | undefined;
  olderInvitations: StoredInvitation[];
  additionalEmails: string[];
  updates: Array<{ where: Record<string, unknown>; values: Record<string, unknown> }>;
  inserts: Array<Record<string, unknown>>;
} = { existingInvitation: undefined, olderInvitations: [], additionalEmails: [], updates: [], inserts: [] };

const trxStub = {
  raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }),
  fn: { now: () => ({ sql: 'now()' }) },
};

function portalInvitationsBuilder() {
  let whereFilters: Record<string, unknown> = {};
  let onlyUnexpired = false;
  let latestFirst = false;
  const builder: any = {
    where(filters: Record<string, unknown> | string) {
      if (filters === 'expires_at') onlyUnexpired = true;
      if (typeof filters === 'object') whereFilters = { ...whereFilters, ...filters };
      return builder;
    },
    select: () => builder,
    orderBy: () => { latestFirst = true; return builder; },
    first: () => {
      let rows = [...state.olderInvitations, ...(state.existingInvitation ? [state.existingInvitation] : [])];
      if (whereFilters.used_at === null) rows = rows.filter((row) => !row.used_at);
      if (onlyUnexpired) rows = rows.filter((row) => row.is_active !== false);
      if (latestFirst) rows.sort((a, b) => (b.created_at ?? 1) - (a.created_at ?? 1));
      const row = rows[0];
      return Promise.resolve(row && { ...row, is_active: row.is_active ?? !row.used_at });
    },
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
          forUpdate: () => ({ first: () => Promise.resolve({
            contact_name_id: 'contact-1',
            email: CONTACT_EMAIL,
            full_name: 'Casey Client',
          }) }),
          first: () => Promise.resolve({ email: CONTACT_EMAIL, full_name: 'Casey Client' }),
        }),
      } as any;
    }
    if (table === 'contact_additional_email_addresses') {
      return {
        where: () => ({
          select: () => Promise.resolve(
            state.additionalEmails.map((email_address) => ({ email_address }))
          ),
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
  state.olderInvitations = [];
  state.additionalEmails = [];
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
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1', email: CONTACT_EMAIL };

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
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1', email: CONTACT_EMAIL };

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
      email: CONTACT_EMAIL,
      metadata: { resend_count: 2 },
    };

    await PortalInvitationService.createInvitationWithTransaction('contact-1', trxStub as never, 7);

    const metadata = state.updates[0]?.values.metadata as { bindings: string[] };
    expect(JSON.parse(metadata.bindings[0]).resend_count).toBe(3);
  });

  it('rotates when delivery changes even if the previous mailbox remains additional', async () => {
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1', email: 'casey@old.test' };
    state.additionalEmails = ['casey@old.test'];
    const result = await PortalInvitationService.createInvitationWithTransaction('contact-1', trxStub as never, 7);
    expect(result.token).not.toBe('token-1');
    expect(state.updates[0]?.values.used_at).toEqual({ sql: 'now()' });
    expect(state.updates[0]?.values.email).toBeUndefined();
    expect(state.inserts[0]?.email).toBe(CONTACT_EMAIL);
  });

  it('keeps the token when delivery differs only in case or whitespace', async () => {
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1', email: ' Casey@Acme.test ' };
    const result = await PortalInvitationService.createInvitationWithTransaction('contact-1', trxStub as never, 7);
    expect(result.token).toBe('token-1');
  });

  it.each([true, false])('does not resurrect an older live invitation under a closed or expired latest row (closed=%s)', async (closed) => {
    state.olderInvitations = [{
      invitation_id: 'older', token: 'older-token', email: CONTACT_EMAIL, created_at: 0,
    }];
    state.existingInvitation = {
      invitation_id: 'latest', token: 'old-token', email: CONTACT_EMAIL,
      used_at: closed ? new Date() : undefined, is_active: false,
    };
    const result = await PortalInvitationService.createInvitationWithTransaction('contact-1', trxStub as never, 7);
    expect(result.token).not.toBe('old-token');
    expect(result.token).not.toBe('older-token');
    expect(state.inserts).toHaveLength(1);
  });

  it('revokes and replaces a link sent to an address the contact lost', async () => {
    // The contact was first entered as a mistyped address and corrected since.
    // Renewing that invitation would re-arm the token in the stranger's mailbox
    // for the tenant's whole validity, and whoever reads it could set the
    // password and own this contact's portal account.
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1', email: 'typo@acme.test' };

    const result = await PortalInvitationService.createInvitationWithTransaction(
      'contact-1',
      trxStub as never,
      7
    );

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.where).toEqual({ invitation_id: 'invitation-1', used_at: null });
    // Revoked, not renewed: used_at closes the old row for good.
    expect(state.updates[0]?.values.used_at).toEqual({ sql: 'now()' });
    expect(state.updates[0]?.values.expires_at).toBeUndefined();
    const revocation = JSON.parse(
      (state.updates[0]?.values.metadata as { bindings: string[] }).bindings[0]
    );
    expect(revocation).toMatchObject({ revoked: true, revoked_reason: 'email_changed' });

    // And the resend mails a token the lost mailbox has never seen.
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.email).toBe(CONTACT_EMAIL);
    expect(result).toMatchObject({ success: true, invitationId: 'new-invitation' });
    expect(result.token).not.toBe('token-1');
    expect(String(result.token)).toHaveLength(64);
  });

  it('revokes and replaces a link whose stored address went blank', async () => {
    state.existingInvitation = { invitation_id: 'invitation-1', token: 'token-1', email: null };

    const result = await PortalInvitationService.createInvitationWithTransaction(
      'contact-1',
      trxStub as never,
      7
    );

    // No address is not the contact's address: the three surfaces all refuse
    // such a row, so a resend has to replace it rather than renew it.
    expect(state.updates[0]?.values.used_at).toEqual({ sql: 'now()' });
    expect(result).toMatchObject({ invitationId: 'new-invitation' });
  });
});
