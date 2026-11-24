import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Verifying an invitation token. An unused link now lives for up to 30 days and
 * a resend keeps the same token, so the contact it was written for can change
 * underneath it: a deactivated contact and a contact that moved to another
 * address are both refused at use time, with the same generic message every
 * other bad token gets. completePortalSetup goes through this very check
 * before it creates anything, so refusing here refuses the setup.
 */

const invitation = {
  invitation_id: 'invitation-1',
  contact_id: 'contact-1',
  token: 'token-1',
  email: 'casey@acme.test',
  expires_at: new Date('2099-01-01T00:00:00.000Z'),
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  used_at: undefined,
  metadata: {},
};

const state: {
  contact: { is_inactive: boolean | null; email: string | null; full_name: string };
  deletes: number;
} = {
  contact: { is_inactive: false, email: 'casey@acme.test', full_name: 'Casey Client' },
  deletes: 0,
};

const trxStub = {
  raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }),
  fn: { now: () => ({ sql: 'now()' }) },
};

/** The joined invitation + contact row, filtered the way Postgres would. */
function invitationQueryBuilder() {
  let requireActiveContact = false;
  let requireMatchingEmail = false;

  const builder: any = {
    where(_column: unknown, _operator?: unknown, _value?: unknown) {
      return builder;
    },
    whereRaw(sql: string) {
      if (sql.includes('c.is_inactive')) requireActiveContact = true;
      if (sql.includes('lower(c.email) = lower(pi.email)')) requireMatchingEmail = true;
      return builder;
    },
    select() {
      return builder;
    },
    first() {
      // coalesce(c.is_inactive, false) = false: a NULL row is an active contact.
      if (requireActiveContact && state.contact.is_inactive === true) return Promise.resolve(undefined);
      if (
        requireMatchingEmail
        && String(state.contact.email ?? '').toLowerCase() !== invitation.email.toLowerCase()
      ) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        ...invitation,
        tenant: 'tenant-1',
        full_name: state.contact.full_name,
        contact_email: state.contact.email,
        client_name: 'Acme',
      });
    },
  };
  return builder;
}

const scopedDb = {
  table: (table: string) => {
    if (table === 'portal_invitations as pi') return invitationQueryBuilder();
    if (table === 'portal_invitations') {
      return {
        where: () => ({
          del: () => {
            state.deletes += 1;
            return Promise.resolve(0);
          },
        }),
      } as any;
    }
    throw new Error(`Unexpected table: ${table}`);
  },
  unscoped: () => ({
    where: () => ({
      where: () => ({
        select: () => ({
          first: () => Promise.resolve({ tenant: 'tenant-1', contact_id: 'contact-1' }),
        }),
      }),
    }),
  }),
  tenantJoin: () => undefined,
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
  state.contact = { is_inactive: false, email: 'casey@acme.test', full_name: 'Casey Client' };
  state.deletes = 0;
});

describe('PortalInvitationService.verifyToken', () => {
  it('accepts the token of an untouched contact', async () => {
    const result = await PortalInvitationService.verifyToken('token-1');

    expect(result).toMatchObject({
      valid: true,
      tenant: 'tenant-1',
      contact: { contact_name_id: 'contact-1', email: 'casey@acme.test' },
    });
  });

  it('accepts the token of a contact whose is_inactive was never written', async () => {
    // The column is nullable with a false default, so comparing it to false
    // would refuse a NULL row's invitation for ever.
    state.contact.is_inactive = null;

    const result = await PortalInvitationService.verifyToken('token-1');

    expect(result).toMatchObject({ valid: true, contact: { contact_name_id: 'contact-1' } });
  });

  it('refuses the token of a deactivated contact', async () => {
    state.contact.is_inactive = true;

    const result = await PortalInvitationService.verifyToken('token-1');

    // The same answer any other unusable token gets: no hint that the contact
    // exists but was switched off.
    expect(result).toMatchObject({
      valid: false,
      errorCode: 'INVALID_OR_EXPIRED_TOKEN',
      error: 'Invalid or expired invitation token',
    });
  });

  it('refuses a link mailed to an address the contact no longer has', async () => {
    state.contact.email = 'casey@newplace.test';

    await expect(PortalInvitationService.verifyToken('token-1')).resolves.toMatchObject({
      valid: false,
      errorCode: 'INVALID_OR_EXPIRED_TOKEN',
    });
  });

  it('is case-insensitive about the address, like the user table is', async () => {
    state.contact.email = 'Casey@Acme.test';

    await expect(PortalInvitationService.verifyToken('token-1')).resolves.toMatchObject({ valid: true });
  });
});
