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
  /** The address the stored invitation was mailed to. */
  invitationEmail: string | null;
  /** The addresses the MSP kept on the contact besides its primary one. */
  additionalEmails: string[];
  deletes: number;
  /** Every tenant-scoped join the verify query asked for, in order. */
  joins: Array<{ table: string; on: string[] }>;
} = {
  contact: { is_inactive: false, email: 'casey@acme.test', full_name: 'Casey Client' },
  invitationEmail: invitation.email,
  additionalEmails: [],
  deletes: 0,
  joins: [],
};

const trxStub = {
  raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }),
  fn: { now: () => ({ sql: 'now()' }) },
};

/** `nullif(btrim(lower(x)), '')`, as the joins and the JS rule both read it. */
function normalized(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * The joined invitation + contact row. The address and the contact's standing
 * are judged in code, by the one rule the MSP's screens are judged by, so the
 * row comes back whole and the refusal happens after it.
 *
 * `matched_additional_email` stands for the left join on
 * `contact_additional_email_addresses`, whose ON clause already narrows the
 * contact's additional addresses to the one that is the same mailbox as the
 * address the invitation was mailed to — so the row carries that address or
 * NULL, never the whole set.
 */
function invitationQueryBuilder() {
  const builder: any = {
    where(_column: unknown, _operator?: unknown, _value?: unknown) {
      return builder;
    },
    select() {
      return builder;
    },
    first() {
      const mailedTo = normalized(state.invitationEmail);
      return Promise.resolve({
        ...invitation,
        email: state.invitationEmail,
        tenant: 'tenant-1',
        full_name: state.contact.full_name,
        contact_email: state.contact.email,
        // coalesce(c.is_inactive, false): a NULL row is an active contact.
        contact_inactive: state.contact.is_inactive ?? false,
        matched_additional_email: state.additionalEmails.find(
          (email) => mailedTo !== null && normalized(email) === mailedTo
        ) ?? null,
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
  tenantJoin: (
    _builder: unknown,
    table: string,
    _left: string,
    _right: string,
    options?: { on?: (join: { andOn: (raw: { sql: string }) => void }) => void }
  ) => {
    const on: string[] = [];
    options?.on?.({ andOn: (raw) => on.push(raw.sql) });
    state.joins.push({ table, on });
    return undefined;
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
  state.contact = { is_inactive: false, email: 'casey@acme.test', full_name: 'Casey Client' };
  state.invitationEmail = invitation.email;
  state.additionalEmails = [];
  state.deletes = 0;
  state.joins = [];
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

  it('does not refuse a link over surrounding whitespace', async () => {
    // Both sides are trimmed, as invitationRefusedAtUseTime and the contact
    // list's state SQL trim them: a stray space is the same mailbox, and the
    // three surfaces must not disagree about whether the link still works.
    state.contact.email = ' casey@acme.test ';

    await expect(PortalInvitationService.verifyToken('token-1')).resolves.toMatchObject({ valid: true });
  });

  it('accepts a link mailed to one of the contact\'s additional addresses', async () => {
    // The MSP changed the primary address and kept the old one on the contact.
    // That mailbox is still the contact's — it is the address inbound email and
    // ContactModel.getContactByEmail match them by — so the link in it opens.
    state.contact.email = 'casey@newplace.test';
    state.additionalEmails = ['casey@acme.test'];

    await expect(PortalInvitationService.verifyToken('token-1')).resolves.toMatchObject({
      valid: true,
      contact: { contact_name_id: 'contact-1' },
    });
  });

  it('refuses a link whose address was taken off the contact altogether', async () => {
    state.contact.email = 'casey@newplace.test';
    state.additionalEmails = ['casey.client@newplace.test'];

    await expect(PortalInvitationService.verifyToken('token-1')).resolves.toMatchObject({
      valid: false,
      errorCode: 'INVALID_OR_EXPIRED_TOKEN',
    });
  });

  it('reads the contact\'s additional addresses through the invitation row\'s join', async () => {
    // Verifying a token is unauthenticated, so this path may not grow a
    // standalone read of a client-owned table (the read-authorization contract
    // in server/src/test/unit/product refuses it, and there is no entry point
    // to put in front of a token). Everything about the contact hangs off the
    // invitation row instead, tenant-scoped through tenantJoin — and the ON
    // clause does the address narrowing, so no address set is hauled back.
    // A regression to a second query also trips the `table()` stub above.
    await PortalInvitationService.verifyToken('token-1');

    const addressJoin = state.joins.find(
      (join) => join.table === 'contact_additional_email_addresses as cea'
    );
    expect(addressJoin).toBeDefined();
    expect(addressJoin?.on).toEqual([
      "nullif(btrim(lower(cea.email_address)), '') = nullif(btrim(lower(pi.email)), '')",
    ]);
  });

  it('refuses a stored invitation with no address at all', async () => {
    // A legacy row with a blank address matches nothing, exactly as the
    // contact list's state SQL and the Portal tab's history judge it.
    state.invitationEmail = '   ';

    await expect(PortalInvitationService.verifyToken('token-1')).resolves.toMatchObject({
      valid: false,
      errorCode: 'INVALID_OR_EXPIRED_TOKEN',
    });
  });
});
