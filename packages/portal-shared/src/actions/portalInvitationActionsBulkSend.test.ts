import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bulk portal invitations: the batch is sequential and each contact owns its
 * own transaction, so a contact that cannot be invited (already a portal user,
 * a bad address) is reported and the rest of the batch still goes out.
 */

const hasPermissionMock = vi.fn();
const sendPortalInvitationEmailMock = vi.fn();
const createInvitationMock = vi.fn();
const sharedMailboxMock = vi.fn();

type ContactRow = {
  contact_name_id: string;
  client_id: string | null;
  full_name: string;
  email: string | null;
  is_inactive?: boolean;
};

const state: {
  contacts: ContactRow[];
  portalUserContactIds: Set<string>;
  /** `null` means no bundle narrows this caller; otherwise the contacts they may read. */
  scopedContactIds: string[] | null;
  /** `null` means every client is in scope. */
  scopedClientIds: string[] | null;
  /** The tenant_settings row the batch context reads. */
  tenantSettings: Record<string, unknown>;
} = {
  contacts: [],
  portalUserContactIds: new Set(),
  scopedContactIds: null,
  scopedClientIds: null,
  tenantSettings: {},
};

function contactsBuilder() {
  let selectedIds: string[] | null = null;
  let filterClientId: string | undefined;
  let singleId: string | undefined;
  let scopeIds: string[] | null = null;

  const builder: any = {
    where(filters: Record<string, unknown>) {
      if (filters && typeof filters === 'object' && 'contact_name_id' in filters) {
        singleId = filters.contact_name_id as string;
      }
      return builder;
    },
    whereIn(_column: string, values: string[]) {
      selectedIds = values;
      return builder;
    },
    andWhere(column: string, value: unknown) {
      if (column === 'client_id' || column === 'c.client_id') filterClientId = value as string;
      // Stands in for the compiled bundle predicate the real narrowing ANDs on.
      if (column === 'scope.visible_contacts') scopeIds = value as string[];
      return builder;
    },
    whereNull() {
      return builder;
    },
    orderBy() {
      return builder;
    },
    modify(fn: (qb: any) => void) {
      fn(builder);
      return builder;
    },
    select() {
      return builder;
    },
    first() {
      return Promise.resolve(state.contacts.find((contact) => contact.contact_name_id === singleId));
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const rows = state.contacts
        .filter(
          (contact) =>
            (!selectedIds || selectedIds.includes(contact.contact_name_id)) &&
            (filterClientId === undefined || contact.client_id === filterClientId) &&
            (scopeIds === null || scopeIds.includes(contact.contact_name_id)),
        )
        .map((contact) => ({ contact_name_id: contact.contact_name_id }));
      return Promise.resolve(rows).then(resolve, reject);
    },
  };

  return builder;
}

function usersBuilder() {
  let contactId: string | undefined;
  let byContactId = false;
  const builder: any = {
    where(filters: Record<string, unknown>) {
      contactId = filters.contact_id as string;
      byContactId = true;
      return builder;
    },
    // findPortalEmailOwner's email-ownership lookup; none of these fixtures
    // have a pre-existing (orphaned or otherwise) owner for the email.
    whereRaw() {
      return builder;
    },
    select() {
      return builder;
    },
    first() {
      if (!byContactId) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(
        contactId && state.portalUserContactIds.has(contactId) ? { user_id: `user-${contactId}` } : undefined,
      );
    },
  };
  return builder;
}

function tableBuilder(table: string) {
  if (table === 'contacts' || table === 'contacts as c') return contactsBuilder();
  if (table === 'users' || table === 'users as u') return usersBuilder();
  if (table === 'tenant_companies') {
    return {
      where: () => ({
        select: () => ({ first: () => Promise.resolve({ client_id: 'msp-client', client_name: 'Nine Minds' }) }),
      }),
    } as any;
  }
  if (table === 'client_locations') {
    return { where: () => ({ first: () => Promise.resolve({ email: 'support@nine.test', phone: '555' }) }) } as any;
  }
  if (table === 'tenant_settings') {
    return { first: () => Promise.resolve({ settings: state.tenantSettings }) } as any;
  }
  if (table === 'clients') {
    return { where: () => ({ first: () => Promise.resolve({ client_id: 'client-a', client_name: 'Acme' }) }) } as any;
  }
  throw new Error(`Unexpected table: ${table}`);
}

const scopedDb = {
  table: (table: string) => tableBuilder(table),
  tenantJoin: () => undefined,
};

const knexStub: any = Object.assign(
  (table: string) => tableBuilder(table),
  {
    transaction: (fn: (trx: any) => Promise<unknown>) => fn(knexStub),
    raw: (sql: string) => sql,
  },
);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: knexStub, tenant: 'tenant-1' }),
  tenantDb: () => scopedDb,
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
  withTransaction: (_db: unknown, fn: (trx: any) => unknown) => fn(knexStub),
  getTenantSlugForTenant: async () => 'nine',
  UserPreferences: { upsert: vi.fn() },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({
    narrowing: async () => ({
      narrowed: state.scopedContactIds !== null,
      apply: (query: any) => {
        if (state.scopedContactIds !== null) query.andWhere('scope.visible_contacts', state.scopedContactIds);
        return query;
      },
    }),
    permits: async (resource: string, id: string) =>
      resource !== 'client' || state.scopedClientIds === null || state.scopedClientIds.includes(id),
  }),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true, getInitializationError: async () => null }) },
  getSystemEmailService: async () => ({ isConfigured: async () => true }),
  sendPortalInvitationEmail: (...args: any[]) => sendPortalInvitationEmailMock(...args),
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  getTenantPortalBaseUrl: async () => 'https://portal.nine.test',
  resolveTenantAppBase: async () => ({ source: 'tenant', baseUrl: 'https://portal.nine.test' }),
}));

vi.mock('@alga-psa/core', () => ({
  isValidEmail: (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  isSharedMailboxContact: (...args: any[]) => sharedMailboxMock(...args),
  assertContactIsNotSharedMailbox: vi.fn(),
}));

vi.mock('@alga-psa/shared/lib/contacts/contactEvents', () => ({
  queueContactCreated: vi.fn(),
}));

vi.mock('../services/PortalInvitationService', () => ({
  PortalInvitationService: {
    createInvitationWithTransaction: (...args: any[]) => createInvitationMock(...args),
  },
}));

describe('sendBulkPortalInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    sharedMailboxMock.mockResolvedValue(false);
    sendPortalInvitationEmailMock.mockResolvedValue(true);
    createInvitationMock.mockImplementation(async () => ({
      success: true,
      invitationId: 'invitation-1',
      token: 'token-1',
    }));
    state.contacts = [
      { contact_name_id: 'contact-ok', client_id: 'client-a', full_name: 'Ok Person', email: 'ok@acme.test' },
      { contact_name_id: 'contact-has-user', client_id: 'client-a', full_name: 'Has User', email: 'used@acme.test' },
      { contact_name_id: 'contact-bad-email', client_id: 'client-a', full_name: 'Bad Email', email: 'not-an-email' },
      { contact_name_id: 'contact-send-fails', client_id: 'client-a', full_name: 'Send Fails', email: 'boom@acme.test' },
    ];
    state.portalUserContactIds = new Set(['contact-has-user']);
    state.scopedContactIds = null;
    state.scopedClientIds = null;
    state.tenantSettings = {};
  });

  it('sends every invitation of the batch with the tenant\'s own validity', async () => {
    state.tenantSettings = { clientPortal: { invitationValidityDays: 14 } };

    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    await sendBulkPortalInvitations({ clientId: 'client-a', contactIds: ['contact-ok'] });

    // The number the invitation was stored with is the number the email states.
    expect(createInvitationMock).toHaveBeenCalledWith('contact-ok', expect.anything(), 14);
    expect(sendPortalInvitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ validityDays: 14 }),
    );
  });

  it('falls back to the default validity when the tenant has not configured one', async () => {
    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    await sendBulkPortalInvitations({ clientId: 'client-a', contactIds: ['contact-ok'] });

    expect(createInvitationMock).toHaveBeenCalledWith('contact-ok', expect.anything(), 7);
    expect(sendPortalInvitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ validityDays: 7 }),
    );
  });

  it('reports a per-contact status for a mixed batch and never aborts on one failure', async () => {
    sendPortalInvitationEmailMock.mockImplementation(async ({ email }: { email: string }) => {
      if (email === 'boom@acme.test') throw new Error('smtp exploded');
      return true;
    });

    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    const result = await sendBulkPortalInvitations({
      clientId: 'client-a',
      contactIds: ['contact-ok', 'contact-has-user', 'contact-bad-email', 'contact-send-fails'],
    });

    expect(result.success).toBe(true);
    expect(result.total).toBe(4);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(1);

    const byContact = new Map(result.results.map((item) => [item.contactId, item]));
    expect(byContact.get('contact-ok')).toMatchObject({ status: 'sent', invitationId: 'invitation-1' });
    expect(byContact.get('contact-has-user')).toMatchObject({ status: 'skipped', errorCode: 'USER_EXISTS_FOR_CONTACT' });
    expect(byContact.get('contact-bad-email')).toMatchObject({ status: 'skipped', errorCode: 'CONTACT_INVALID_EMAIL' });
    expect(byContact.get('contact-send-fails')).toMatchObject({ status: 'failed', errorCode: 'INVITATION_FAILED' });

    // The failing contact did not cost the healthy one its invitation.
    expect(sendPortalInvitationEmailMock).toHaveBeenCalledTimes(2);
  });

  it('skips contacts that do not belong to the requested client', async () => {
    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    state.contacts.push({
      contact_name_id: 'contact-other-client',
      client_id: 'client-b',
      full_name: 'Elsewhere',
      email: 'elsewhere@other.test',
    });

    const result = await sendBulkPortalInvitations({
      clientId: 'client-a',
      contactIds: ['contact-ok', 'contact-other-client'],
    });

    expect(result.total).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.results).toContainEqual(
      expect.objectContaining({ contactId: 'contact-other-client', status: 'skipped', errorCode: 'CONTACT_NOT_FOUND' }),
    );
  });

  it('refuses the whole batch when the caller cannot invite for the client', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    const result = await sendBulkPortalInvitations({ clientId: 'client-a', contactIds: ['contact-ok'] });

    expect(result).toMatchObject({ success: false, errorCode: 'PERMISSION_DENIED_INVITE', total: 0, sent: 0 });
    expect(sendPortalInvitationEmailMock).not.toHaveBeenCalled();
  });

  it('refuses a request larger than the batch cap before touching the database', async () => {
    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    const result = await sendBulkPortalInvitations({
      clientId: 'client-a',
      contactIds: Array.from({ length: 501 }, (_, index) => `contact-${index}`),
    });

    expect(result).toMatchObject({ success: false, errorCode: 'BATCH_LIMIT_EXCEEDED', total: 0 });
    expect(sendPortalInvitationEmailMock).not.toHaveBeenCalled();
  });

  it('invites every eligible contact of the client when no explicit list is given', async () => {
    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    const result = await sendBulkPortalInvitations({ clientId: 'client-a', allEligible: true });

    expect(result.total).toBe(4);
    expect(result.sent + result.skipped + result.failed).toBe(4);
    expect(result.sent).toBe(2);
  });

  it('applies bundle narrowing to an explicit list of ids, not only to "all eligible"', async () => {
    // A bundle-narrowed MSP user names four ids but may only read one of them.
    state.scopedContactIds = ['contact-ok'];

    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    const result = await sendBulkPortalInvitations({
      contactIds: ['contact-ok', 'contact-has-user', 'contact-bad-email', 'contact-send-fails'],
    });

    expect(result.sent).toBe(1);
    expect(result.results.filter((item) => item.errorCode === 'CONTACT_NOT_FOUND')).toHaveLength(3);
    expect(sendPortalInvitationEmailMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a client-scoped batch for a client outside the caller\'s scope', async () => {
    state.scopedClientIds = ['client-b'];

    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    const result = await sendBulkPortalInvitations({ clientId: 'client-a', allEligible: true });

    expect(result).toMatchObject({ success: false, errorCode: 'PERMISSION_DENIED_INVITE', total: 0 });
    expect(sendPortalInvitationEmailMock).not.toHaveBeenCalled();
  });

  it('refuses an empty request rather than inviting the whole tenant', async () => {
    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    const result = await sendBulkPortalInvitations({ clientId: 'client-a' });

    expect(result).toMatchObject({ success: false, errorCode: 'NO_TARGETS_SELECTED' });
    expect(sendPortalInvitationEmailMock).not.toHaveBeenCalled();
  });
});
