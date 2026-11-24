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

/** One row of portal_invitations, as the state rule reads them. */
type InvitationRow = {
  created_at: string;
  expires_at: string;
  /** Set when the invitation was accepted or revoked. */
  used_at?: string | null;
  /** The address it was mailed to; defaults to the contact's current one. */
  email?: string;
};

type ContactRow = {
  contact_name_id: string;
  client_id: string | null;
  full_name: string;
  email: string | null;
  is_inactive?: boolean | null;
  /** Addresses the MSP kept on the contact besides its primary one. */
  additionalEmails?: string[];
  /** Every invitation the contact ever had, newest or oldest first — no matter. */
  invitations?: InvitationRow[];
};

const PENDING_EXPIRES_AT = '2099-01-02T03:04:05.000Z';
const LAPSED_EXPIRES_AT = '2020-01-02T03:04:05.000Z';

const pendingInvitation = (createdAt: string): InvitationRow =>
  ({ created_at: createdAt, expires_at: PENDING_EXPIRES_AT, used_at: null });
const lapsedInvitation = (createdAt: string): InvitationRow =>
  ({ created_at: createdAt, expires_at: LAPSED_EXPIRES_AT, used_at: null });
/** Revoking stamps used_at, exactly as accepting one does. */
const closedInvitation = (createdAt: string, expiresAt = PENDING_EXPIRES_AT): InvitationRow =>
  ({ created_at: createdAt, expires_at: expiresAt, used_at: '2024-06-01T00:00:00.000Z' });

const latestInvitationOf = (invitations: InvitationRow[] | undefined): InvitationRow | undefined =>
  [...(invitations ?? [])].sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

/**
 * What Postgres would answer for the state expression: the LATEST invitation
 * row decides, and a latest row that was used or revoked leaves nothing
 * outstanding however many lapsed rows sit under it. An invitation mailed to an
 * address that is none of the contact's — neither its primary nor one it kept
 * as an additional address — is expired, not pending: verifyToken refuses that
 * link, and a resend is what repairs it.
 */
function latestInvitationState(
  contact: Pick<ContactRow, 'email' | 'additionalEmails' | 'invitations'>
): 'none' | 'pending' | 'expired' {
  const latest = latestInvitationOf(contact.invitations);
  if (!latest) return 'none';
  if (latest.used_at) return 'none';
  if (new Date(latest.expires_at).getTime() <= Date.now()) return 'expired';
  const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() || null;
  const mailedTo = normalize(latest.email ?? contact.email);
  const contactAddresses = [contact.email, ...(contact.additionalEmails ?? [])].map(normalize);
  return mailedTo && contactAddresses.includes(mailedTo) ? 'pending' : 'expired';
}

function latestInvitationExpiresAt(invitations: InvitationRow[] | undefined): string | null {
  return latestInvitationOf(invitations)?.expires_at ?? null;
}

const state: {
  contacts: ContactRow[];
  portalUserContactIds: Set<string>;
  /** Portal users that exist but were deactivated. */
  inactivePortalUserContactIds: Set<string>;
  /** Users holding a contact's email that the send path would refuse. */
  emailOwners: Array<{ email: string; user_type: string; contact_id: string | null; linked: boolean }>;
  /** Address lists the email-conflict read asked the users table for. */
  emailConflictLookups: string[][];
  /** `null` means no bundle narrows this caller; otherwise the contacts they may read. */
  scopedContactIds: string[] | null;
  /** `null` means every client is in scope. */
  scopedClientIds: string[] | null;
  /** The tenant_settings row the batch context reads. */
  tenantSettings: Record<string, unknown>;
} = {
  contacts: [],
  portalUserContactIds: new Set(),
  inactivePortalUserContactIds: new Set(),
  emailOwners: [],
  emailConflictLookups: [],
  scopedContactIds: null,
  scopedClientIds: null,
  tenantSettings: {},
};

function contactsBuilder() {
  let selectedIds: string[] | null = null;
  let activeFilter: ((contact: ContactRow) => boolean) | null = null;
  let filterClientId: string | undefined;
  let singleId: string | undefined;
  let scopeIds: string[] | null = null;
  /** The states the HAVING predicate was bound to; null when there is none. */
  let havingStates: string[] | null = null;
  const selectedExpressions: string[] = [];

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
      if (column === 'c.is_inactive') activeFilter = (contact) => (contact.is_inactive === undefined ? false : contact.is_inactive) === value;
      if (column === 'client_id' || column === 'c.client_id') filterClientId = value as string;
      // Stands in for the compiled bundle predicate the real narrowing ANDs on.
      if (column === 'scope.visible_contacts') scopeIds = value as string[];
      return builder;
    },
    whereRaw(sql: string) {
      if (sql === 'coalesce(c.is_inactive, false) = false') activeFilter = (contact) => !contact.is_inactive;
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
    groupBy() {
      return builder;
    },
    // The predicate is built from the state expression with the asked-for
    // states as bindings, so the stub reads the selection off the bindings
    // instead of guessing at SQL text.
    havingRaw(_sql: string, bindings?: unknown[]) {
      havingStates = (bindings ?? []).map(String);
      return builder;
    },
    select(...expressions: unknown[]) {
      for (const expression of expressions) {
        if (typeof expression === 'string') selectedExpressions.push(expression);
      }
      return builder;
    },
    first() {
      return Promise.resolve(state.contacts.find((contact) => contact.contact_name_id === singleId));
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const visible = state.contacts.filter(
        (contact) =>
          (!activeFilter || activeFilter(contact)) &&
          (!selectedIds || selectedIds.includes(contact.contact_name_id)) &&
          (filterClientId === undefined || contact.client_id === filterClientId) &&
          (scopeIds === null || scopeIds.includes(contact.contact_name_id)) &&
          (havingStates === null
            || havingStates.includes(latestInvitationState(contact))),
      );
      // The invitation-state read selects aggregates; everything else selects ids.
      const rows = selectedExpressions.some((expression) => expression.includes('invitation_state'))
        ? visible.map((contact) => ({
          contact_name_id: contact.contact_name_id,
          email: contact.email,
          has_portal_user: state.portalUserContactIds.has(contact.contact_name_id)
            || state.inactivePortalUserContactIds.has(contact.contact_name_id),
          has_active_portal_user: state.portalUserContactIds.has(contact.contact_name_id),
          contact_inactive: Boolean(contact.is_inactive),
          invitation_state: latestInvitationState(contact),
          latest_expires_at: latestInvitationExpiresAt(contact.invitations),
        }))
        : visible.map((contact) => ({ contact_name_id: contact.contact_name_id }));
      return Promise.resolve(rows).then(resolve, reject);
    },
  };

  return builder;
}

function usersBuilder() {
  let contactId: string | undefined;
  let byContactId = false;
  let lookupEmail: string | undefined;
  let lookupEmails: string[] | null = null;
  const builder: any = {
    where(filters: Record<string, unknown>) {
      contactId = filters.contact_id as string;
      byContactId = true;
      return builder;
    },
    // findPortalEmailOwner's single-address lookup.
    whereRaw(_sql: string, bindings?: unknown[]) {
      lookupEmail = bindings?.[0] as string | undefined;
      return builder;
    },
    // The email-conflict read asks for a whole client's addresses at once.
    whereIn(_column: unknown, values: string[]) {
      lookupEmails = values;
      state.emailConflictLookups.push(values);
      return builder;
    },
    select() {
      return builder;
    },
    ownerRowsFor(emails: string[]) {
      return state.emailOwners
        .filter((owner) => emails.includes(owner.email.toLowerCase()))
        .map((owner) => ({
          user_id: `user-${owner.email}`,
          user_type: owner.user_type,
          contact_id: owner.contact_id,
          username: owner.email,
          owner_email: owner.email.toLowerCase(),
          linked_contact_id: owner.linked ? owner.contact_id : null,
        }));
    },
    first() {
      if (!byContactId) {
        return Promise.resolve(builder.ownerRowsFor(lookupEmail ? [lookupEmail] : [])[0]);
      }
      return Promise.resolve(
        contactId && state.portalUserContactIds.has(contactId) ? { user_id: `user-${contactId}` } : undefined,
      );
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(builder.ownerRowsFor(lookupEmails ?? [])).then(resolve, reject);
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
    state.inactivePortalUserContactIds = new Set();
    state.emailOwners = [];
    state.scopedContactIds = null;
    state.scopedClientIds = null;
    state.tenantSettings = {};
  });

  it('state-only selection includes legacy NULL active flags just like explicit selection', async () => {
    state.contacts = [{
      contact_name_id: 'legacy', client_id: 'client-a', full_name: 'Legacy',
      email: 'legacy@acme.test', is_inactive: null, invitations: [lapsedInvitation('2024-01-01')],
    }];
    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');
    const result = await sendBulkPortalInvitations({ clientId: 'client-a', invitationStates: ['expired'] });
    expect(result.sent).toBe(1);
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

  it('skips a deactivated contact instead of mailing a link it could never use', async () => {
    // verifyToken refuses an inactive contact's token, so reporting "Sent" for
    // one would promise an email the recipient can never act on. "All eligible"
    // never offers these; an explicit selection and the REST endpoint do.
    const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

    state.contacts.push({
      contact_name_id: 'contact-off',
      client_id: 'client-a',
      full_name: 'Switched Off',
      email: 'off@acme.test',
      is_inactive: true,
    });

    const result = await sendBulkPortalInvitations({
      clientId: 'client-a',
      contactIds: ['contact-ok', 'contact-off'],
    });

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results).toContainEqual(
      expect.objectContaining({ contactId: 'contact-off', status: 'skipped', errorCode: 'CONTACT_INACTIVE' }),
    );
    expect(sendPortalInvitationEmailMock).toHaveBeenCalledTimes(1);
    expect(sendPortalInvitationEmailMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: 'off@acme.test' }),
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

  describe('invitation-state targeting', () => {
    beforeEach(() => {
      state.contacts = [
        { contact_name_id: 'contact-expired', client_id: 'client-a', full_name: 'Lapsed', email: 'lapsed@acme.test', invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')] },
        { contact_name_id: 'contact-pending', client_id: 'client-a', full_name: 'Waiting', email: 'waiting@acme.test', invitations: [pendingInvitation('2026-01-01T00:00:00.000Z')] },
        { contact_name_id: 'contact-never', client_id: 'client-a', full_name: 'Never Invited', email: 'never@acme.test' },
      ];
      state.portalUserContactIds = new Set();
    });

    it('resends only to the contacts whose invitation expired', async () => {
      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        invitationStates: ['expired'],
      });

      expect(result.total).toBe(1);
      expect(result.sent).toBe(1);
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledTimes(1);
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'lapsed@acme.test' }),
      );
    });

    it('covers both open states when asked for expired and pending', async () => {
      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        invitationStates: ['expired', 'pending'],
      });

      expect(result.total).toBe(2);
      expect(result.sent).toBe(2);
    });

    it('narrows rather than widens when a caller also asks for all eligible', async () => {
      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        allEligible: true,
        invitationStates: ['pending'],
      });

      expect(result.total).toBe(1);
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'waiting@acme.test' }),
      );
    });

    it('leaves out a contact whose newest invitation was revoked, lapsed rows and all', async () => {
      // The chase-up case the retention floor created: an old lapsed row sits
      // under a newer invitation the MSP revoked on purpose. Re-inviting that
      // contact is exactly what "resend expired" must not do.
      state.contacts = [
        {
          contact_name_id: 'contact-revoked',
          client_id: 'client-a',
          full_name: 'Revoked',
          email: 'revoked@acme.test',
          invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z'), closedInvitation('2026-03-01T00:00:00.000Z')],
        },
        {
          contact_name_id: 'contact-expired',
          client_id: 'client-a',
          full_name: 'Lapsed',
          email: 'lapsed@acme.test',
          invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')],
        },
      ];

      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        invitationStates: ['expired'],
      });

      expect(result.total).toBe(1);
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledTimes(1);
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'lapsed@acme.test' }),
      );
    });

    it('treats a contact whose newest invitation is pending as pending, not expired', async () => {
      state.contacts = [{
        contact_name_id: 'contact-chased',
        client_id: 'client-a',
        full_name: 'Chased',
        email: 'chased@acme.test',
        invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z'), pendingInvitation('2026-03-01T00:00:00.000Z')],
      }];

      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      await expect(sendBulkPortalInvitations({ clientId: 'client-a', invitationStates: ['expired'] }))
        .resolves.toMatchObject({ total: 0, sent: 0 });
      await expect(sendBulkPortalInvitations({ clientId: 'client-a', invitationStates: ['pending'] }))
        .resolves.toMatchObject({ total: 1, sent: 1 });
    });

    it('leaves out a contact whose invitation was used, even with the portal user gone', async () => {
      // The account was created and later deleted: nothing is outstanding, so
      // the contact belongs to "invite", not to "resend".
      state.contacts = [{
        contact_name_id: 'contact-used',
        client_id: 'client-a',
        full_name: 'Signed Up',
        email: 'signed@acme.test',
        invitations: [closedInvitation('2026-03-01T00:00:00.000Z', LAPSED_EXPIRES_AT)],
      }];

      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        invitationStates: ['expired', 'pending'],
      });

      expect(result).toMatchObject({ total: 0, sent: 0 });
      expect(sendPortalInvitationEmailMock).not.toHaveBeenCalled();
    });

    it('re-checks an explicit list against the state it was chosen by', async () => {
      // The resend hands the server the rows the MSP had on screen; a contact
      // that moved on since is skipped rather than mailed.
      state.contacts = [
        { contact_name_id: 'contact-expired', client_id: 'client-a', full_name: 'Lapsed', email: 'lapsed@acme.test', invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')] },
        { contact_name_id: 'contact-pending', client_id: 'client-a', full_name: 'Waiting', email: 'waiting@acme.test', invitations: [pendingInvitation('2026-01-01T00:00:00.000Z')] },
      ];

      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        contactIds: ['contact-expired', 'contact-pending'],
        invitationStates: ['expired'],
      });

      expect(result.sent).toBe(1);
      expect(result.results).toContainEqual(expect.objectContaining({
        contactId: 'contact-pending',
        status: 'skipped',
        errorCode: 'INVITATION_STATE_MISMATCH',
      }));
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledTimes(1);
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'lapsed@acme.test' }),
      );
    });

    it('mails only the named contacts, never the client\'s whole expired backlog', async () => {
      state.contacts = [
        { contact_name_id: 'contact-expired', client_id: 'client-a', full_name: 'Lapsed', email: 'lapsed@acme.test', invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')] },
        { contact_name_id: 'contact-expired-2', client_id: 'client-a', full_name: 'Also Lapsed', email: 'also@acme.test', invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')] },
      ];

      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        contactIds: ['contact-expired'],
        invitationStates: ['expired'],
      });

      expect(result).toMatchObject({ total: 1, sent: 1 });
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledTimes(1);
      expect(sendPortalInvitationEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'lapsed@acme.test' }),
      );
    });

    it('ignores a state selection that names no state the batch understands', async () => {
      const { sendBulkPortalInvitations } = await import('./portalInvitationActions');

      const result = await sendBulkPortalInvitations({
        clientId: 'client-a',
        invitationStates: ['whenever' as never],
      });

      expect(result).toMatchObject({ success: false, errorCode: 'NO_TARGETS_SELECTED' });
      expect(sendPortalInvitationEmailMock).not.toHaveBeenCalled();
    });
  });
});

describe('getPortalInvitationStatesForClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    state.contacts = [
      { contact_name_id: 'contact-expired', client_id: 'client-a', full_name: 'Lapsed', email: 'lapsed@acme.test', invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')] },
      { contact_name_id: 'contact-pending', client_id: 'client-a', full_name: 'Waiting', email: 'waiting@acme.test', invitations: [pendingInvitation('2026-01-01T00:00:00.000Z')] },
      { contact_name_id: 'contact-never', client_id: 'client-a', full_name: 'Never Invited', email: 'never@acme.test' },
      { contact_name_id: 'contact-user', client_id: 'client-a', full_name: 'Has Portal', email: 'portal@acme.test' },
      { contact_name_id: 'contact-elsewhere', client_id: 'client-b', full_name: 'Elsewhere', email: 'else@other.test', invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')] },
    ];
    state.portalUserContactIds = new Set(['contact-user']);
    state.inactivePortalUserContactIds = new Set();
    state.emailOwners = [];
    state.emailConflictLookups = [];
    state.scopedContactIds = null;
    state.scopedClientIds = null;
    state.tenantSettings = {};
  });

  it('classifies every contact of the client and nobody else', async () => {
    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    const states = await getPortalInvitationStatesForClient('client-a');

    expect(states).toEqual([
      { contactId: 'contact-expired', state: 'expired', expiresAt: null, emailConflict: false, contactInactive: false },
      { contactId: 'contact-pending', state: 'pending', expiresAt: PENDING_EXPIRES_AT, emailConflict: false, contactInactive: false },
      { contactId: 'contact-never', state: 'none', expiresAt: null, emailConflict: false, contactInactive: false },
      { contactId: 'contact-user', state: 'active_user', expiresAt: null, emailConflict: false, contactInactive: false },
    ]);
  });

  it('respects the caller\'s bundle narrowing, like the eligible set does', async () => {
    state.scopedContactIds = ['contact-pending'];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    await expect(getPortalInvitationStatesForClient('client-a')).resolves.toEqual([
      { contactId: 'contact-pending', state: 'pending', expiresAt: PENDING_EXPIRES_AT, emailConflict: false, contactInactive: false },
    ]);
  });

  it('refuses a client outside the caller\'s scope instead of claiming nobody was invited', async () => {
    state.scopedClientIds = ['client-b'];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    // null, not []: "you may not see this" is a different answer from
    // "nobody here has an invitation", and the list hides the column for it.
    await expect(getPortalInvitationStatesForClient('client-a')).resolves.toBeNull();
  });

  it('refuses a caller without user:read', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    await expect(getPortalInvitationStatesForClient('client-a')).resolves.toBeNull();
  });

  it('reads the latest invitation, not any unused one', async () => {
    state.contacts = [
      {
        contact_name_id: 'contact-revoked',
        client_id: 'client-a',
        full_name: 'Revoked',
        email: 'revoked@acme.test',
        invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z'), closedInvitation('2026-03-01T00:00:00.000Z')],
      },
      {
        contact_name_id: 'contact-rechased',
        client_id: 'client-a',
        full_name: 'Rechased',
        email: 'rechased@acme.test',
        invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z'), pendingInvitation('2026-03-01T00:00:00.000Z')],
      },
      {
        contact_name_id: 'contact-expired',
        client_id: 'client-a',
        full_name: 'Lapsed',
        email: 'lapsed@acme.test',
        invitations: [lapsedInvitation('2026-01-01T00:00:00.000Z')],
      },
    ];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    await expect(getPortalInvitationStatesForClient('client-a')).resolves.toEqual([
      // A revoked newest invitation leaves nothing outstanding, whatever lapsed
      // rows the 90-day retention floor kept underneath it.
      { contactId: 'contact-revoked', state: 'none', expiresAt: null, emailConflict: false, contactInactive: false },
      { contactId: 'contact-rechased', state: 'pending', expiresAt: PENDING_EXPIRES_AT, emailConflict: false, contactInactive: false },
      { contactId: 'contact-expired', state: 'expired', expiresAt: null, emailConflict: false, contactInactive: false },
    ]);
  });

  it('says when a portal user was deactivated instead of calling it active', async () => {
    state.portalUserContactIds = new Set();
    state.inactivePortalUserContactIds = new Set(['contact-user']);

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    const states = await getPortalInvitationStatesForClient('client-a');

    expect(states).toContainEqual(
      { contactId: 'contact-user', state: 'inactive_user', expiresAt: null, emailConflict: false, contactInactive: false },
    );
  });

  it('counts an invitation mailed to an address the contact no longer has as expired', async () => {
    state.contacts = [
      {
        contact_name_id: 'contact-renamed',
        client_id: 'client-a',
        full_name: 'Renamed',
        email: 'new.address@acme.test',
        // Still unexpired, but the link in the old mailbox is refused at use
        // time, so "Pending until <date>" would promise a dead link.
        invitations: [{ ...pendingInvitation('2026-01-01T00:00:00.000Z'), email: 'old.address@acme.test' }],
      },
    ];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    await expect(getPortalInvitationStatesForClient('client-a')).resolves.toEqual([
      { contactId: 'contact-renamed', state: 'expired', expiresAt: null, emailConflict: false, contactInactive: false },
    ]);
  });

  it('leaves a link in an address the contact kept as pending', async () => {
    state.contacts = [
      {
        contact_name_id: 'contact-renamed',
        client_id: 'client-a',
        full_name: 'Renamed',
        email: 'new.address@acme.test',
        // The MSP corrected the primary address and kept the old one on the
        // contact. That mailbox is still theirs — it is how inbound email is
        // matched to them — so the link in it still opens and the rollout has
        // nothing to chase here.
        additionalEmails: ['old.address@acme.test'],
        invitations: [{ ...pendingInvitation('2026-01-01T00:00:00.000Z'), email: 'old.address@acme.test' }],
      },
    ];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    await expect(getPortalInvitationStatesForClient('client-a')).resolves.toEqual([
      {
        contactId: 'contact-renamed',
        state: 'pending',
        expiresAt: PENDING_EXPIRES_AT,
        emailConflict: false,
        contactInactive: false,
      },
    ]);
  });

  it('says an outstanding invitation on a deactivated contact cannot be used', async () => {
    state.contacts = [{
      contact_name_id: 'contact-off',
      client_id: 'client-a',
      full_name: 'Switched Off',
      email: 'off@acme.test',
      is_inactive: true,
      invitations: [pendingInvitation('2026-01-01T00:00:00.000Z')],
    }];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    const states = await getPortalInvitationStatesForClient('client-a');

    // The invitation row is still pending, but the contact cannot be invited
    // and cannot use the link: the flag is what the list labels it by.
    expect(states).toEqual([
      { contactId: 'contact-off', state: 'pending', expiresAt: PENDING_EXPIRES_AT, emailConflict: false, contactInactive: true },
    ]);
  });

  it('asks the users table only about contacts a batch could still be aimed at', async () => {
    // An unindexed lower(email) scan runs on every contacts-list load, and the
    // conflict is only read for invitable candidates, so a contact that already
    // has a portal user or is deactivated is not worth asking about.
    state.contacts = [
      ...state.contacts,
      { contact_name_id: 'contact-off', client_id: 'client-a', full_name: 'Off', email: 'off@acme.test', is_inactive: true },
    ];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    await getPortalInvitationStatesForClient('client-a');

    expect(state.emailConflictLookups).toHaveLength(1);
    expect([...state.emailConflictLookups[0]].sort()).toEqual([
      'lapsed@acme.test', 'never@acme.test', 'waiting@acme.test',
    ]);
  });

  it('flags a contact whose email another user owns, the way the send refuses it', async () => {
    state.emailOwners = [
      // Another contact's live portal user holds this address.
      { email: 'lapsed@acme.test', user_type: 'client', contact_id: 'contact-other', linked: true },
      // An account orphaned by a contact delete is adopted by the send, not refused.
      { email: 'waiting@acme.test', user_type: 'client', contact_id: null, linked: false },
    ];

    const { getPortalInvitationStatesForClient } = await import('./portalInvitationActions');

    const states = await getPortalInvitationStatesForClient('client-a');
    const byContact = new Map((states ?? []).map((entry) => [entry.contactId, entry]));

    expect(byContact.get('contact-expired')?.emailConflict).toBe(true);
    expect(byContact.get('contact-pending')?.emailConflict).toBe(false);
    expect(byContact.get('contact-never')?.emailConflict).toBe(false);
  });
});
