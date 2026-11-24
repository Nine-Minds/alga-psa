import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The per-contact invitation history the MSP reads in the contact's Portal tab.
 *
 * An invitation is dead before its expiry when the contact was deactivated or
 * its address moved on — `PortalInvitationService.verifyToken` refuses both, and
 * the client's contact list already calls them expired. The history has to agree:
 * "Pending • Expires <future date>" next to a link the setup page refuses tells
 * the MSP there is nothing to do.
 */

const hasPermissionMock = vi.fn();
const getInvitationHistoryMock = vi.fn();

const CONTACT_ID = 'contact-1';
const CONTACT_EMAIL = 'ada@acme.test';

type HistoryRow = {
  invitation_id: string;
  email: string;
  created_at: Date;
  expires_at: Date;
  used_at?: Date;
  metadata?: Record<string, unknown>;
  contact_email: string | null;
  /** Every address the contact can receive at, its primary one first. */
  contact_emails: Array<string | null>;
  contact_inactive: boolean | null;
};

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    invitation_id: 'invitation-1',
    email: CONTACT_EMAIL,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    expires_at: FUTURE,
    metadata: {},
    contact_email: CONTACT_EMAIL,
    contact_emails: [CONTACT_EMAIL],
    contact_inactive: false,
    ...overrides,
  };
}

const scopedDb = {
  table: () => ({
    select: () => ({
      where: () => ({
        first: async () => ({ contact_name_id: CONTACT_ID, client_id: 'client-a', is_client_admin: false }),
      }),
    }),
  }),
  tenantJoin: () => undefined,
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
  tenantDb: () => scopedDb,
  withTransaction: (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
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
    narrowing: async () => ({ narrowed: false, apply: (query: unknown) => query }),
    permits: async () => true,
  }),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true, getInitializationError: async () => null }) },
  getSystemEmailService: async () => ({ isConfigured: async () => true }),
  sendPortalInvitationEmail: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  getTenantPortalBaseUrl: async () => 'https://portal.nine.test',
  resolveTenantAppBase: async () => ({ source: 'tenant', baseUrl: 'https://portal.nine.test' }),
}));

vi.mock('@alga-psa/core', () => ({
  isValidEmail: (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  isSharedMailboxContact: vi.fn(),
  assertContactIsNotSharedMailbox: vi.fn(),
}));

vi.mock('@alga-psa/shared/lib/contacts/contactEvents', () => ({
  queueContactCreated: vi.fn(),
}));

vi.mock('../services/PortalInvitationService', () => ({
  PortalInvitationService: {
    getInvitationHistory: (...args: any[]) => getInvitationHistoryMock(...args),
  },
}));

const { getPortalInvitations } = await import('./portalInvitationActions');

describe('getPortalInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
  });

  it('reports a live invitation as pending', async () => {
    getInvitationHistoryMock.mockResolvedValue([row()]);

    const [item] = await getPortalInvitations(CONTACT_ID);

    expect(item.status).toBe('pending');
    expect(item.unusable_reason).toBeUndefined();
  });

  it('calls an invitation sent to an address the contact no longer has expired', async () => {
    // The MSP corrected the contact's email after inviting them and dropped the
    // old address: verifyToken refuses the link in that mailbox, so the row must
    // not promise an expiry that is still in the future. A resend replaces it.
    getInvitationHistoryMock.mockResolvedValue([row({ email: 'old@acme.test' })]);

    const [item] = await getPortalInvitations(CONTACT_ID);

    expect(item.status).toBe('expired');
    expect(item.unusable_reason).toBe('email_changed');
  });

  it('leaves an invitation sent to an address the contact kept pending', async () => {
    // The old address is still on the contact, so the link in it still reaches
    // them and still opens — the same verdict verifyToken reaches.
    getInvitationHistoryMock.mockResolvedValue([
      row({ email: 'old@acme.test', contact_emails: [CONTACT_EMAIL, 'old@acme.test'] }),
    ]);

    const [item] = await getPortalInvitations(CONTACT_ID);

    expect(item.status).toBe('pending');
    expect(item.unusable_reason).toBeUndefined();
  });

  it('matches the stored address case-insensitively, like the verify query', async () => {
    getInvitationHistoryMock.mockResolvedValue([row({ email: 'Ada@Acme.Test' })]);

    const [item] = await getPortalInvitations(CONTACT_ID);

    expect(item.status).toBe('pending');
  });

  it('calls an invitation on a deactivated contact unusable rather than pending', async () => {
    getInvitationHistoryMock.mockResolvedValue([row({ contact_inactive: true })]);

    const [item] = await getPortalInvitations(CONTACT_ID);

    expect(item.status).toBe('expired');
    expect(item.unusable_reason).toBe('contact_inactive');
  });

  it('leaves used and revoked invitations alone', async () => {
    // Nothing is outstanding on these, so the use-time refusals never apply:
    // a contact deactivated after accepting its invitation still shows "Used".
    getInvitationHistoryMock.mockResolvedValue([
      row({ invitation_id: 'used', used_at: PAST, contact_inactive: true }),
      row({ invitation_id: 'revoked', used_at: PAST, metadata: { revoked: true }, email: 'old@acme.test' }),
    ]);

    const [used, revoked] = await getPortalInvitations(CONTACT_ID);

    expect(used.status).toBe('used');
    expect(used.unusable_reason).toBeUndefined();
    expect(revoked.status).toBe('revoked');
    expect(revoked.unusable_reason).toBeUndefined();
  });

  it('reports an invitation past its expiry as expired without a refusal reason', async () => {
    getInvitationHistoryMock.mockResolvedValue([row({ expires_at: PAST })]);

    const [item] = await getPortalInvitations(CONTACT_ID);

    expect(item.status).toBe('expired');
    expect(item.unusable_reason).toBeUndefined();
  });
});

it('does not show a superseded live link as pending below a revoked latest row', async () => {
  getInvitationHistoryMock.mockResolvedValue([
    row({ invitation_id: 'newer', used_at: new Date(), metadata: { revoked: true } }),
    row({ invitation_id: 'older' }),
  ]);
  const history = await getPortalInvitations(CONTACT_ID);
  expect(history.map((invitation) => invitation.status)).toEqual(['revoked', 'revoked']);
});
