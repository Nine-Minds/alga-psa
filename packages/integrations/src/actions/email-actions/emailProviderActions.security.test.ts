import { beforeEach, describe, expect, it, vi } from 'vitest';

type TableSeed = { rows?: any[]; first?: any; returned?: any };

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  tables: {} as Record<string, { rows?: any[]; first?: any; returned?: any }>,
  tableCalls: [] as string[],
  updates: [] as Array<[string, any]>,
  merges: [] as Array<[string, any]>,
  transaction: vi.fn(),
  deleteProvider: vi.fn(),
  initializeProviderWebhook: vi.fn(),
  renewWebhooks: vi.fn(),
  recoverAuthPaused: vi.fn(),
  failImapMerge: false,
  staleCredentialUpdate: false,
  axiosPost: vi.fn(),
  imapConnect: vi.fn(),
  lookup: vi.fn(),
  secrets: {
    getTenantSecret: vi.fn(),
    setTenantSecret: vi.fn(),
    deleteTenantSecret: vi.fn(),
  },
  secretValues: {} as Record<string, string>,
  secretProviderOverride: null as any,
  sessionUser: { user_id: 'user-1', user_type: 'internal' as 'internal' | 'client', tenant: 'tenant-123' },
}));

function makeTable(name: string) {
  mocks.tableCalls.push(name);
  const filters: Record<string, unknown> = {};
  const seed = () => mocks.tables[name] ?? {};
  const thenable = (value: () => unknown, extra: Record<string, unknown> = {}) => {
    const p: any = Promise.resolve().then(value);
    Object.assign(p, extra);
    return p;
  };
  const chain: any = {
    where: (values: any) => {
      if (values && typeof values === 'object') Object.assign(filters, values);
      return chain;
    },
    orderBy: () => chain,
    select: () => thenable(() => seed().rows ?? [], { first: async () => seed().first }),
    first: async () => seed().first,
    update: (values: any) => {
      mocks.updates.push([name, values]);
      return thenable(() => {
        if (name === 'imap_email_provider_config' && mocks.staleCredentialUpdate && 'access_token' in values) return 0;
        if (name === 'imap_email_provider_config' && 'credential_generation' in filters) {
          const actual = seed().first?.credential_generation ?? null;
          if (actual !== (filters.credential_generation ?? null)) return 0;
        }
        return 1;
      }, { returning: async () => [seed().returned] });
    },
    insert: () => ({
      onConflict: () => ({
        merge: (values: any) => {
          mocks.merges.push([name, values]);
          return {
            returning: async () => {
              if (name === 'imap_email_provider_config' && mocks.failImapMerge) {
                throw new Error('database write failed');
              }
              return [seed().returned];
            },
          };
        },
      }),
      returning: async () => [seed().returned],
    }),
  };
  return chain;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({
    knex: {
      transaction: async (fn: any) => {
        mocks.transaction();
        return fn({ fn: { now: () => 'NOW' }, raw: (sql: string) => ({ raw: sql }) });
      },
      fn: { now: () => 'NOW' },
    },
  }),
  tenantDb: () => ({ table: (name: string) => makeTable(name) }),
  auditLog: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ ...mocks.sessionUser }, { tenant: mocks.sessionUser.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => mocks.secretProviderOverride ?? mocks.secrets }));
vi.mock('axios', () => ({ default: { post: mocks.axiosPost } }));
vi.mock('imapflow', () => ({
  ImapFlow: class {
    commands = new Map();
    connect = mocks.imapConnect;
    logout = vi.fn();
  },
}));
vi.mock('node:dns/promises', () => ({ default: { lookup: mocks.lookup } }));
vi.mock('./setupPubSub', () => ({ setupPubSub: vi.fn() }));
vi.mock('./configureGmailProvider', () => ({ configureGmailProvider: vi.fn() }));
vi.mock('../../services/email/EmailProviderService', () => ({
  EmailProviderService: class {
    deleteProvider = mocks.deleteProvider;
    initializeProviderWebhook = mocks.initializeProviderWebhook;
  },
}));
vi.mock('@alga-psa/shared/services/email/EmailWebhookMaintenanceService', () => ({
  EmailWebhookMaintenanceService: class {
    renewMicrosoftWebhooks = mocks.renewWebhooks;
  },
}));
vi.mock('@alga-psa/shared/services/email/EmailProviderLifecycleService', () => ({
  EmailProviderLifecycleService: class {
    recoverAuthPausedProvider = mocks.recoverAuthPaused;
  },
}));
vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({ MicrosoftGraphAdapter: class {} }));
vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', () => ({ buildMicrosoftEmailProviderConfig: vi.fn() }));
vi.mock('../../lib/microsoft365DiagnosticsResult', () => ({ resolveMicrosoft365DiagnosticsResult: vi.fn(), resolveMicrosoft365DiagnosticsReport: vi.fn() }));
vi.mock('../../lib/microsoftEmailIssuerSelection', () => ({
  MicrosoftEmailIssuerError: class extends Error { code = 'x'; },
  MICROSOFT_EMAIL_ISSUER_ERRORS: {},
  isSameMicrosoftClientId: vi.fn(),
  resolveMicrosoftEmailIssuerChoice: vi.fn(),
}));
vi.mock('./microsoftSenderDeleteGuard', () => ({ getMicrosoftSenderDeleteBlockMessage: () => null }));
vi.mock('../integrations/microsoftActions', () => ({ getMicrosoftEmailSetupMetadataInternal: vi.fn() }));
vi.mock('../../utils/email/webhookHelpers', () => ({ getWebhookBaseUrl: () => 'https://app.example.test' }));
vi.mock('../../utils/email/gmailPubSub', () => ({ gmailSubscriptionName: () => 's', gmailTopicName: () => 't' }));
vi.mock('../../services/email/GmailDiagnosticsService', () => ({ runGmailDeliveryDiagnostics: vi.fn() }));

// Grants exactly the listed "resource:action" permissions.
function grant(...perms: string[]) {
  mocks.hasPermission.mockImplementation(async (_u: any, resource: string, action: string) =>
    perms.includes(`${resource}:${action}`));
}

function seed(tables: Record<string, TableSeed>) {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  Object.assign(mocks.tables, tables);
}

const imapPayload = (overrides: Record<string, unknown> = {}) => ({
  tenant: 'tenant-123',
  providerType: 'imap',
  providerName: 'Support',
  mailbox: 'support@example.test',
  isActive: true,
  imapConfig: {
    host: 'imap.example.test',
    port: 993,
    secure: true,
    allow_starttls: false,
    auth_type: 'oauth2' as const,
    username: 'support@example.test',
    oauth_authorize_url: 'https://idp.example.test/authorize',
    oauth_token_url: 'https://idp.example.test/token',
    oauth_client_id: 'client-1',
    folder_filters: ['INBOX'],
    auto_process_emails: true,
    max_emails_per_sync: 5,
    ...overrides,
  },
});

const storedImapRow = {
  host: 'imap.example.test',
  port: 993,
  secure: true,
  allow_starttls: false,
  auth_type: 'oauth2',
  username: 'support@example.test',
  oauth_authorize_url: 'https://idp.example.test/authorize',
  oauth_token_url: 'https://idp.example.test/token',
  oauth_client_id: 'client-1',
  oauth_client_secret: 'stored-client-secret',
};

const providerRow = { id: 'prov-1', tenant: 'tenant-123', provider_type: 'imap', providerType: 'imap', providerName: 'Support' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tableCalls.length = 0;
  mocks.updates.length = 0;
  mocks.merges.length = 0;
  seed({});
  mocks.sessionUser.user_type = 'internal';
  grant('ticket_settings:read', 'ticket_settings:update');
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mocks.secrets.getTenantSecret.mockResolvedValue(undefined);
  for (const key of Object.keys(mocks.secretValues)) delete mocks.secretValues[key];
  mocks.secrets.getTenantSecret.mockImplementation(async (_tenant: string, key: string) => mocks.secretValues[key]);
  mocks.secrets.setTenantSecret.mockImplementation(async (_tenant: string, key: string, value: string) => {
    mocks.secretValues[key] = value;
  });
  mocks.secrets.deleteTenantSecret.mockImplementation(async (_tenant: string, key: string) => {
    delete mocks.secretValues[key];
  });
  mocks.failImapMerge = false;
  mocks.staleCredentialUpdate = false;
  mocks.secretProviderOverride = null;
  mocks.axiosPost.mockResolvedValue({ data: { access_token: 'at', expires_in: 3600 } });
  mocks.imapConnect.mockResolvedValue(undefined);
  mocks.renewWebhooks.mockResolvedValue([]);
});

type Actor = 'client user' | 'MSP user without ticket_settings:update';

function actAs(actor: Actor) {
  if (actor === 'client user') {
    mocks.sessionUser.user_type = 'client';
    grant('ticket_settings:read', 'ticket_settings:update');
  } else {
    grant('ticket_settings:read');
  }
}

describe.each<Actor>(['client user', 'MSP user without ticket_settings:update'])(
  'provider mutations deny a %s before any work',
  (actor) => {
    beforeEach(() => {
      actAs(actor);
      seed({
        email_providers: { first: { id: 'prov-1', provider_type: 'imap' }, returned: providerRow },
        imap_email_provider_config: { first: { auth_type: 'oauth2', oauth_token_url: 'https://idp.example.test/token', oauth_client_id: 'c', refresh_token: 'r' } },
      });
    });

    const expectUntouched = () => {
      expect(mocks.tableCalls).toEqual([]);
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.deleteProvider).not.toHaveBeenCalled();
      expect(mocks.initializeProviderWebhook).not.toHaveBeenCalled();
      expect(mocks.renewWebhooks).not.toHaveBeenCalled();
      expect(mocks.recoverAuthPaused).not.toHaveBeenCalled();
      expect(mocks.axiosPost).not.toHaveBeenCalled();
      expect(mocks.secrets.setTenantSecret).not.toHaveBeenCalled();
      expect(mocks.secrets.deleteTenantSecret).not.toHaveBeenCalled();
      expect(mocks.updates).toEqual([]);
    };

    it('updateEmailProvider', async () => {
      const { updateEmailProvider } = await import('./emailProviderActions');
      const result: any = await updateEmailProvider('prov-1', imapPayload());
      expect(result).toMatchObject({ actionError: expect.any(String), messageKey: 'errors.permissionDenied' });
      expectUntouched();
    });

    it('upsertEmailProvider', async () => {
      const { upsertEmailProvider } = await import('./emailProviderActions');
      const result: any = await upsertEmailProvider(imapPayload());
      expect(result).toMatchObject({ actionError: expect.any(String) });
      expectUntouched();
    });

    it('createEmailProvider', async () => {
      const { createEmailProvider } = await import('./emailProviderActions');
      const result: any = await createEmailProvider(imapPayload());
      expect(result).toMatchObject({ actionError: expect.any(String) });
      expectUntouched();
    });

    it('deleteEmailProvider', async () => {
      const { deleteEmailProvider } = await import('./emailProviderActions');
      const result: any = await deleteEmailProvider('prov-1');
      expect(result).toMatchObject({ actionError: expect.any(String) });
      expectUntouched();
    });

    it('resyncImapProvider', async () => {
      const { resyncImapProvider } = await import('./emailProviderActions');
      const result = await resyncImapProvider('prov-1');
      expect(result).toMatchObject({ success: false, errorCode: 'permission_denied' });
      expectUntouched();
    });

    it('testEmailProviderConnection', async () => {
      const { testEmailProviderConnection } = await import('./emailProviderActions');
      const result = await testEmailProviderConnection('prov-1');
      expect(result).toMatchObject({ success: false, errorCode: 'permission_denied' });
      expectUntouched();
    });

    it('retryMicrosoftSubscriptionRenewal', async () => {
      const { retryMicrosoftSubscriptionRenewal } = await import('./emailProviderActions');
      const result = await retryMicrosoftSubscriptionRenewal('prov-1');
      expect(result.success).toBe(false);
      expectUntouched();
    });
  }
);

const SECRET_KEYS = ['client_secret', 'access_token', 'refresh_token', 'webhook_verification_token', 'oauth_client_secret', 'password'];
const SEEDS = {
  msClientSecret: 'SEED-ms-client-secret',
  msAccess: 'SEED-ms-access-token',
  msRefresh: 'SEED-ms-refresh-token',
  msWebhook: 'SEED-ms-webhook-token',
  gRefresh: 'SEED-google-refresh-token',
  gClientSecret: 'SEED-google-client-secret',
  imapOauthSecret: 'SEED-imap-oauth-client-secret',
  imapAccess: 'SEED-imap-access-token',
  imapRefresh: 'SEED-imap-refresh-token',
  imapPassword: 'SEED-imap-password',
};

function collectKeys(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => collectKeys(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe('getEmailProviders', () => {
  const seedProviders = () =>
    seed({
      email_providers: {
        rows: [
          { id: 'ms', tenant: 'tenant-123', providerType: 'microsoft', providerName: 'MS', mailbox: 'a@x.test' },
          { id: 'g', tenant: 'tenant-123', providerType: 'google', providerName: 'G', mailbox: 'b@x.test' },
          { id: 'imap', tenant: 'tenant-123', providerType: 'imap', providerName: 'I', mailbox: 'c@x.test' },
        ],
      },
      microsoft_email_provider_config: {
        first: {
          email_provider_id: 'ms', tenant: 'tenant-123', client_id: 'ms-client', client_secret: SEEDS.msClientSecret,
          client_secret_ref: 'ref-1', tenant_id: 'common', redirect_uri: 'https://x.test/cb',
          folder_filters: ['Inbox'], access_token: SEEDS.msAccess, refresh_token: SEEDS.msRefresh,
          token_expires_at: '2030-01-01', webhook_verification_token: SEEDS.msWebhook,
        },
      },
      google_email_provider_config: {
        first: {
          email_provider_id: 'g', tenant: 'tenant-123', client_id: 'g-client', client_secret: SEEDS.gClientSecret,
          label_filters: [], access_token: null, refresh_token: SEEDS.gRefresh,
        },
      },
      imap_email_provider_config: {
        first: {
          email_provider_id: 'imap', tenant: 'tenant-123', host: 'imap.x.test', port: 993, auth_type: 'oauth2',
          username: 'c@x.test', folder_filters: [], oauth_token_url: 'https://idp.x.test/token',
          oauth_client_id: 'imap-client', oauth_client_secret: SEEDS.imapOauthSecret,
          access_token: SEEDS.imapAccess, refresh_token: SEEDS.imapRefresh, password: SEEDS.imapPassword,
        },
      },
    });

  it('denies a client user', async () => {
    mocks.sessionUser.user_type = 'client';
    seedProviders();
    const { getEmailProviders } = await import('./emailProviderActions');
    const result = await getEmailProviders();
    expect(result.providers).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(mocks.tableCalls).toEqual([]);
  });

  it('denies an MSP user without ticket_settings:read', async () => {
    grant();
    seedProviders();
    const { getEmailProviders } = await import('./emailProviderActions');
    const result = await getEmailProviders();
    expect(result.providers).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(mocks.tableCalls).toEqual([]);
  });

  it('allows a reader without update permission', async () => {
    grant('ticket_settings:read');
    seedProviders();
    const { getEmailProviders } = await import('./emailProviderActions');
    const result = await getEmailProviders();
    expect(result.providers).toHaveLength(3);
  });

  it('never serializes a secret key or a secret value anywhere in the tree', async () => {
    seedProviders();
    const { getEmailProviders } = await import('./emailProviderActions');
    const result = await getEmailProviders();
    expect(result.providers).toHaveLength(3);

    const serialized = JSON.stringify(result);
    const keys = collectKeys(JSON.parse(serialized));
    for (const key of SECRET_KEYS) expect(keys.has(key)).toBe(false);
    for (const value of Object.values(SEEDS)) expect(serialized).not.toContain(value);
  });

  it('reports has_* booleans and keeps non-secret references', async () => {
    seedProviders();
    const { getEmailProviders } = await import('./emailProviderActions');
    const { providers } = await getEmailProviders();
    const [ms, g, imap] = providers;

    expect(ms.microsoftConfig).toMatchObject({
      has_client_secret: true, has_access_token: true, has_refresh_token: true, has_webhook_verification_token: true,
      client_secret_ref: 'ref-1', token_expires_at: '2030-01-01', client_id: 'ms-client',
    });
    expect(g.googleConfig).toMatchObject({ has_client_secret: true, has_access_token: false, has_refresh_token: true });
    expect(imap.imapConfig).toMatchObject({
      has_client_secret: true, has_access_token: true, has_refresh_token: true,
      oauth_token_url: 'https://idp.x.test/token', oauth_client_id: 'imap-client',
    });
  });

  it('reports false for absent secrets', async () => {
    seed({
      email_providers: { rows: [{ id: 'imap', tenant: 'tenant-123', providerType: 'imap', providerName: 'I', mailbox: 'c@x.test' }] },
      imap_email_provider_config: { first: { email_provider_id: 'imap', host: 'h', port: 993, auth_type: 'password', username: 'u', folder_filters: [], oauth_client_secret: null, access_token: null, refresh_token: '' } },
    });
    const { getEmailProviders } = await import('./emailProviderActions');
    const { providers } = await getEmailProviders();
    expect(providers[0].imapConfig).toMatchObject({ has_client_secret: false, has_access_token: false, has_refresh_token: false });
  });
});

describe('save results are secret-free', () => {
  it('returns a sanitized provider from updateEmailProvider', async () => {
    seed({
      email_providers: { first: providerRow, returned: providerRow },
      imap_email_provider_config: {
        first: storedImapRow,
        returned: { ...storedImapRow, host: 'imap.example.test', port: 993, auth_type: 'oauth2', username: 'u', folder_filters: [], access_token: SEEDS.imapAccess, refresh_token: SEEDS.imapRefresh },
      },
    });
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload());
    const serialized = JSON.stringify(result);
    expect(result.provider.imapConfig.has_refresh_token).toBe(true);
    for (const key of SECRET_KEYS) expect(collectKeys(JSON.parse(serialized)).has(key)).toBe(false);
    expect(serialized).not.toContain(SEEDS.imapAccess);
    expect(serialized).not.toContain(SEEDS.imapRefresh);
  });
});

describe('IMAP OAuth credentials are bound to their issuer', () => {
  const seedStored = () =>
    seed({
      email_providers: { first: providerRow, returned: providerRow },
      imap_email_provider_config: { first: storedImapRow, returned: { ...storedImapRow, folder_filters: [] } },
    });

  it.each([
    ['oauth_token_url', 'https://other-idp.example.test/token'],
    ['oauth_authorize_url', 'https://other-idp.example.test/authorize'],
    ['oauth_client_id', 'attacker-client'],
    ['oauth_client_secret', 'a-new-client-secret'],
  ])('changing %s nulls tokens and clears tenant secrets', async (field, value) => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ [field]: value }));

    expect(result.reconnectRequired).toBe(true);
    expect(result.setupWarnings.join(' ')).toMatch(/Reconnect the mailbox/);
    const [, merge] = mocks.merges.find(([t]) => t === 'imap_email_provider_config')!;
    expect(merge.access_token).toBeNull();
    expect(merge.refresh_token).toBeNull();
    expect(merge.token_expires_at).toBeNull();
    expect(mocks.secrets.deleteTenantSecret).toHaveBeenCalledWith('tenant-123', 'imap_refresh_token_prov-1');
    expect(mocks.secrets.deleteTenantSecret).toHaveBeenCalledWith('tenant-123', 'imap_oauth_client_secret_prov-1');
    if (field === 'oauth_client_secret') {
      expect(merge.oauth_client_secret).toBe(value);
    } else {
      expect(merge.oauth_client_secret).toBeNull();
    }
  });

  it('keeps tokens, secrets and the stored client secret when the issuer is unchanged', async () => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    // oauth_client_secret omitted == "leave blank to keep existing"
    const result: any = await updateEmailProvider('prov-1', imapPayload());

    expect(result.reconnectRequired).toBeUndefined();
    const [, merge] = mocks.merges.find(([t]) => t === 'imap_email_provider_config')!;
    expect(merge.access_token.raw).toContain('COALESCE');
    expect(merge.refresh_token.raw).toContain('COALESCE');
    expect(merge.token_expires_at.raw).toContain('COALESCE');
    expect(merge.oauth_client_secret.raw).toContain('COALESCE(EXCLUDED.oauth_client_secret');
    expect(mocks.secrets.deleteTenantSecret).not.toHaveBeenCalled();
  });

  it.each([
    ['host', { host: 'mail.attacker.test' }],
    ['port', { port: 143 }],
    ['secure', { secure: false }],
    ['STARTTLS mode', { allow_starttls: true }],
    ['username', { username: 'other@example.test' }],
    ['authentication type', { auth_type: 'password' }],
  ])('clears all stored credentials when %s changes', async (_label, change) => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload(change));

    expect(result.reconnectRequired).toBe(true);
    const [, merge] = mocks.merges.find(([table]) => table === 'imap_email_provider_config')!;
    expect(merge.access_token).toBeNull();
    expect(merge.refresh_token).toBeNull();
    expect(merge.token_expires_at).toBeNull();
    for (const key of [
      'imap_password_prov-1',
      'imap_refresh_token_prov-1',
      'imap_oauth_client_secret_prov-1',
      'imap_access_token_prov-1',
    ]) {
      expect(mocks.secrets.deleteTenantSecret).toHaveBeenCalledWith('tenant-123', key);
    }
  });

  it('associates an explicitly supplied password and client secret with the changed scope after commit', async () => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({
      host: 'mail.new.example.test',
      password: 'replacement-password',
      oauth_client_secret: 'replacement-client-secret',
      refresh_token: 'must-not-carry-refresh-token',
    }));

    expect(result.reconnectRequired).toBe(true);
    const generation = mocks.merges.find(([table]) => table === 'imap_email_provider_config')![1].credential_generation;
    expect(mocks.secrets.setTenantSecret).toHaveBeenCalledWith('tenant-123', `imap_password_prov-1_${generation}`, 'replacement-password');
    expect(mocks.secrets.setTenantSecret).toHaveBeenCalledWith('tenant-123', `imap_oauth_client_secret_prov-1_${generation}`, 'replacement-client-secret');
    expect(mocks.secrets.setTenantSecret).not.toHaveBeenCalledWith('tenant-123', 'imap_refresh_token_prov-1', expect.any(String));
  });

  it('keeps a delayed password write from an older save unreachable after a concurrent scope change', async () => {
    let resolvePasswordWrite!: () => void;
    let passwordWriteStarted!: () => void;
    const started = new Promise<void>((resolve) => { passwordWriteStarted = resolve; });
    const delayedWrite = new Promise<void>((resolve) => { resolvePasswordWrite = resolve; });
    const row = {
      ...storedImapRow,
      auth_type: 'password',
      credential_generation: 'generation-old',
      oauth_client_secret: null,
    };
    seed({ email_providers: { first: providerRow, returned: providerRow }, imap_email_provider_config: { first: row, returned: { ...row } } });
    mocks.secrets.setTenantSecret.mockImplementation(async (_tenant: string, key: string, value: string) => {
      if (key.endsWith('_generation-old')) {
        passwordWriteStarted();
        await delayedWrite;
      }
      mocks.secretValues[key] = value;
    });

    const { updateEmailProvider, testEmailProviderConnection } = await import('./emailProviderActions');
    const firstSave = updateEmailProvider('prov-1', imapPayload({
      auth_type: 'password',
      password: 'delayed-old-password',
    }));
    await started;

    const secondSave: any = await updateEmailProvider('prov-1', imapPayload({
      host: 'imap.new-scope.example.test',
      auth_type: 'password',
      password: undefined,
    }));
    expect(secondSave.reconnectRequired).toBe(true);
    const generation = mocks.merges[mocks.merges.length - 1]![1].credential_generation;
    mocks.tables.imap_email_provider_config.first = {
      ...row,
      host: 'imap.new-scope.example.test',
      credential_generation: generation,
    };
    resolvePasswordWrite();
    await firstSave;

    const tested = await testEmailProviderConnection('prov-1');
    expect(tested).toMatchObject({ success: false, errorCode: 'missing_credentials' });
    expect(mocks.secretValues['imap_password_prov-1_generation-old']).toBe('delayed-old-password');
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });

  it('cannot use a password or OAuth token from the old scope after saving a changed destination', async () => {
    for (const key of [
      'imap_password_prov-1',
      'imap_refresh_token_prov-1',
      'imap_oauth_client_secret_prov-1',
      'imap_access_token_prov-1',
    ]) mocks.secretValues[key] = `old-${key}`;
    seedStored();
    const { updateEmailProvider, testEmailProviderConnection } = await import('./emailProviderActions');
    const saved: any = await updateEmailProvider('prov-1', imapPayload({ host: 'mail.new.example.test' }));
    expect(saved.reconnectRequired).toBe(true);

    mocks.tables.imap_email_provider_config.first = {
      ...storedImapRow,
      host: 'mail.new.example.test',
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
    };
    const tested = await testEmailProviderConnection('prov-1');
    expect(tested).toMatchObject({ success: false, errorCode: 'missing_credentials' });
    expect(Object.keys(mocks.secretValues)).toEqual([]);
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });

  it('cannot reuse a stored password after a host change with the password field omitted', async () => {
    const previousRow = { ...storedImapRow, auth_type: 'password' };
    for (const key of ['imap_password_prov-1', 'imap_refresh_token_prov-1', 'imap_oauth_client_secret_prov-1']) {
      mocks.secretValues[key] = `old-${key}`;
    }
    seed({ email_providers: { first: providerRow, returned: providerRow }, imap_email_provider_config: { first: previousRow, returned: { ...previousRow } } });
    const { updateEmailProvider, testEmailProviderConnection } = await import('./emailProviderActions');
    const saved: any = await updateEmailProvider('prov-1', imapPayload({
      host: 'mail.new.example.test', auth_type: 'password', password: undefined,
    }));
    expect(saved.reconnectRequired).toBe(true);
    mocks.tables.imap_email_provider_config.first = {
      ...previousRow, host: 'mail.new.example.test', auth_type: 'password', access_token: null, refresh_token: null,
    };

    const tested = await testEmailProviderConnection('prov-1');
    expect(tested).toMatchObject({ success: false, errorCode: 'missing_credentials' });
    expect(Object.keys(mocks.secretValues)).toEqual([]);
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });

  it('fails before changing the row if any secret invalidation fails', async () => {
    seedStored();
    mocks.secrets.deleteTenantSecret.mockImplementation(async (_tenant: string, key: string) => {
      if (key === 'imap_refresh_token_prov-1') throw new Error('secret store unavailable');
    });
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ host: 'mail.new.example.test' }));

    expect(result.actionError).toBeTruthy();
    expect(mocks.merges).toEqual([]);
    expect(mocks.secrets.setTenantSecret).not.toHaveBeenCalled();
  });

  it('fails closed when the database write fails after secrets were invalidated', async () => {
    seedStored();
    mocks.failImapMerge = true;
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ host: 'mail.new.example.test' }));

    expect(result.actionError).toBeTruthy();
    expect(mocks.secrets.deleteTenantSecret).toHaveBeenCalledWith('tenant-123', 'imap_password_prov-1');
    expect(mocks.secrets.setTenantSecret).not.toHaveBeenCalled();
    expect(mocks.merges).toHaveLength(1);
  });

  it('keeps tokens when the same client secret is resubmitted', async () => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    await updateEmailProvider('prov-1', imapPayload({ oauth_client_secret: 'stored-client-secret' }));
    const [, merge] = mocks.merges.find(([t]) => t === 'imap_email_provider_config')!;
    expect(merge.refresh_token.raw).toContain('COALESCE');
    expect(mocks.secrets.deleteTenantSecret).not.toHaveBeenCalled();
  });

  it('treats case and a trailing DNS root dot as the same host identity', async () => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ host: 'IMAP.EXAMPLE.TEST.' }));
    expect(result.reconnectRequired).toBeUndefined();
    expect(mocks.secrets.deleteTenantSecret).not.toHaveBeenCalled();
  });

  it.each([
    ['http scheme', 'http://idp.example.test/token'],
    ['cloud metadata IP', 'https://169.254.169.254/latest/meta-data'],
    ['localhost', 'https://localhost/token'],
    ['private IPv4', 'https://10.0.0.5/token'],
    ['IPv4-mapped loopback', 'https://[::ffff:127.0.0.1]/token'],
  ])('refuses to store a token URL with %s', async (_label, url) => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ oauth_token_url: url }));
    expect(result.actionError).toMatch(/not allowed/);
    expect(mocks.merges).toEqual([]);
  });

  it('refuses to store an authorize URL that fails the policy', async () => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ oauth_authorize_url: 'http://idp.example.test/a' }));
    expect(result.actionError).toMatch(/not allowed/);
    expect(mocks.merges).toEqual([]);
  });

  it('refuses a hostname that resolves to a private address', async () => {
    seedStored();
    mocks.lookup.mockResolvedValue([{ address: '192.168.1.10', family: 4 }]);
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ oauth_token_url: 'https://rebind.example.test/token' }));
    expect(result.actionError).toMatch(/not allowed/);
    expect(mocks.merges).toEqual([]);
  });

  it('refuses an IMAP destination that resolves to a private address before any write', async () => {
    seedStored();
    const { updateEmailProvider } = await import('./emailProviderActions');
    const result: any = await updateEmailProvider('prov-1', imapPayload({ host: '10.2.3.4' }));
    expect(result.actionError).toMatch(/IMAP destination is not allowed/);
    expect(mocks.merges).toEqual([]);
    expect(mocks.secrets.deleteTenantSecret).not.toHaveBeenCalled();
  });

  it('refuses an IMAP hostname resolving to a private address before credentials are read', async () => {
    mocks.lookup.mockResolvedValue([{ address: '10.10.0.8', family: 4 }]);
    seed({
      email_providers: { first: { id: 'prov-1', provider_type: 'imap' } },
      imap_email_provider_config: {
        first: { auth_type: 'password', username: 'u', host: 'imap.rebind.example.test', port: 993, secure: true },
      },
    });
    const { testEmailProviderConnection } = await import('./emailProviderActions');
    const result = await testEmailProviderConnection('prov-1');
    expect(result.success).toBe(false);
    expect(mocks.secrets.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });

  it('does not let a composite fallback provider serve a legacy password after the scope rotates', async () => {
    const { CompositeSecretProvider } = await import('../../../../core/src/lib/secrets/CompositeSecretProvider');
    const primary = {
      getAppSecret: vi.fn(async () => undefined),
      getTenantSecret: vi.fn(async () => undefined),
      setTenantSecret: vi.fn(async () => undefined),
      deleteTenantSecret: vi.fn(async () => undefined),
    };
    const fallback = {
      getAppSecret: vi.fn(async () => undefined),
      getTenantSecret: vi.fn(async (_tenant: string, key: string) =>
        key === 'imap_password_prov-1' ? 'old-fallback-password' : undefined),
      setTenantSecret: vi.fn(async () => undefined),
      deleteTenantSecret: vi.fn(async () => undefined),
    };
    mocks.secretProviderOverride = new CompositeSecretProvider([primary, fallback], primary as any);
    seed({
      email_providers: { first: { id: 'prov-1', provider_type: 'imap' } },
      imap_email_provider_config: {
        first: {
          auth_type: 'password', username: 'u', host: 'imap.example.test', port: 993, secure: true,
          credential_generation: 'new-generation',
        },
      },
    });

    const { testEmailProviderConnection } = await import('./emailProviderActions');
    const result = await testEmailProviderConnection('prov-1');
    expect(result).toMatchObject({ success: false, errorCode: 'missing_credentials' });
    expect(fallback.getTenantSecret).toHaveBeenCalledWith('tenant-123', 'imap_password_prov-1_new-generation');
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });
});

describe('testEmailProviderConnection re-validates stored token URLs', () => {
  const seedOauthImap = (tokenUrl: string) =>
    seed({
      email_providers: { first: { id: 'prov-1', provider_type: 'imap' } },
      imap_email_provider_config: {
        first: {
          auth_type: 'oauth2', username: 'u', host: 'imap.example.test', port: 993, secure: true,
          access_token: null, oauth_token_url: tokenUrl, oauth_client_id: 'client-1',
        },
      },
    });

  beforeEach(() => {
    mocks.secrets.getTenantSecret.mockImplementation(async (_t: string, name: string) =>
      name.startsWith('imap_refresh_token_') ? 'stored-refresh-token' : 'stored-client-secret');
  });

  it.each([
    'https://169.254.169.254/token',
    'http://idp.example.test/token',
    'https://localhost/token',
    'https://10.1.2.3/token',
  ])('refuses %s and never posts credentials', async (url) => {
    seedOauthImap(url);
    const { testEmailProviderConnection } = await import('./emailProviderActions');
    const result = await testEmailProviderConnection('prov-1');
    expect(result.success).toBe(false);
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });

  it('still refreshes against a policy-compliant URL', async () => {
    seedOauthImap('https://idp.example.test/token');
    const { testEmailProviderConnection } = await import('./emailProviderActions');
    const result = await testEmailProviderConnection('prov-1');
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1);
    expect(mocks.axiosPost.mock.calls[0][0]).toBe('https://idp.example.test/token');
    expect(mocks.axiosPost.mock.calls[0][2]).toMatchObject({ maxRedirects: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects a prohibited IMAP destination before reading credentials or connecting', async () => {
    seed({
      email_providers: { first: { id: 'prov-1', provider_type: 'imap' } },
      imap_email_provider_config: {
        first: { auth_type: 'password', username: 'u', host: '192.168.1.2', port: 993, secure: true },
      },
    });
    const { testEmailProviderConnection } = await import('./emailProviderActions');
    const result = await testEmailProviderConnection('prov-1');
    expect(result.success).toBe(false);
    expect(mocks.secrets.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });

  it('fails closed when changed-scope database tokens and tenant secrets are absent', async () => {
    seed({
      email_providers: { first: { id: 'prov-1', provider_type: 'imap' } },
      imap_email_provider_config: {
        first: {
          auth_type: 'oauth2', username: 'u', host: 'imap.new.example.test', port: 993, secure: true,
          access_token: null, refresh_token: null, token_expires_at: null,
          oauth_token_url: 'https://idp.example.test/token', oauth_client_id: 'client-1',
        },
      },
    });
    mocks.secrets.getTenantSecret.mockResolvedValue(undefined);
    const { testEmailProviderConnection } = await import('./emailProviderActions');
    const result = await testEmailProviderConnection('prov-1');
    expect(result).toMatchObject({ success: false, errorCode: 'missing_credentials' });
    expect(result.error).toMatch(/credentials were cleared/i);
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.imapConnect).not.toHaveBeenCalled();
  });

  it('rejects an OAuth refresh response that arrives after the destination generation changes', async () => {
    let resolveRefresh!: (value: any) => void;
    mocks.axiosPost.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const oldConfig = {
      ...storedImapRow,
      credential_generation: 'generation-old',
      access_token: null,
      refresh_token: null,
      token_expires_at: '2000-01-01T00:00:00.000Z',
    };
    seed({
      email_providers: { first: { id: 'prov-1', tenant: 'tenant-123', provider_type: 'imap' }, returned: providerRow },
      imap_email_provider_config: { first: oldConfig, returned: { ...oldConfig } },
    });
    mocks.secretValues[`${'imap_refresh_token_prov-1_generation-old'}`] = 'old-refresh-token';
    mocks.secretValues[`${'imap_oauth_client_secret_prov-1_generation-old'}`] = 'old-client-secret';

    const { testEmailProviderConnection, updateEmailProvider } = await import('./emailProviderActions');
    const connection = testEmailProviderConnection('prov-1');
    await vi.waitFor(() => expect(mocks.axiosPost).toHaveBeenCalledTimes(1));

    const saved: any = await updateEmailProvider('prov-1', imapPayload({ host: 'attacker.example.test' }));
    expect(saved.reconnectRequired).toBe(true);
    const newGeneration = mocks.merges.find(([table]) => table === 'imap_email_provider_config')![1].credential_generation;
    mocks.tables.imap_email_provider_config.first = {
      ...oldConfig,
      host: 'attacker.example.test',
      credential_generation: newGeneration,
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
    };
    resolveRefresh({ data: { access_token: 'old-scope-access-token', expires_in: 3600 } });

    const result = await connection;
    expect(result).toMatchObject({ success: false, errorCode: 'missing_config' });
    mocks.secrets.getTenantSecret.mockImplementation(async (_tenant: string, key: string) => mocks.secretValues[key]);
    const nextConnection = await testEmailProviderConnection('prov-1');
    expect(nextConnection).toMatchObject({ success: false, errorCode: 'missing_credentials' });
    expect(mocks.imapConnect).not.toHaveBeenCalled();
    expect(mocks.updates.some(([table, values]) => table === 'imap_email_provider_config' && values.access_token === 'old-scope-access-token')).toBe(true);
  });
});
