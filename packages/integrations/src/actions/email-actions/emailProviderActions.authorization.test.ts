import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  hasPermission: vi.fn(),
  sessionUser: { user_id: 'user-1', user_type: 'internal' as 'internal' | 'client' },
  tableCalls: [] as string[],
  providerRows: null as Array<Record<string, any>> | null,
  providerConfigs: {} as Record<string, Record<string, any>>,
  secretLookup: vi.fn(),
  httpPost: vi.fn(),
  imapConnect: vi.fn(),
  providerDelete: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: (name: string) => {
      mocks.tableCalls.push(name);
      if (!mocks.providerRows) throw new Error(`unexpected provider data access: ${name}`);
      let selectedColumns: string[] = [];
      const query: any = {
        orderBy: () => query,
        where: () => query,
        select: (...columns: any[]) => {
          if (name === 'email_providers') {
            const requested = Array.isArray(columns[0]) ? columns[0] : columns;
            return Promise.resolve(mocks.providerRows!.map((row) => Object.fromEntries(requested.flatMap((column: string) => {
              const field = column.includes(' as ') ? column.split(' as ')[1] : column;
              return field in row ? [[field, row[field]]] : [];
            }))));
          }
          selectedColumns = columns as string[];
          return query;
        },
        first: async () => {
          const row = mocks.providerConfigs[name];
          return row ? Object.fromEntries(selectedColumns.filter((column) => column in row).map((column) => [column, row[column]])) : null;
        },
      };
      return query;
    },
  }),
  auditLog: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: any[]) =>
    fn({ ...mocks.sessionUser }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getTenantSecret: mocks.secretLookup }),
}));
vi.mock('axios', () => ({ default: { post: mocks.httpPost } }));
vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(function (this: any) {
    this.connect = (...args: unknown[]) => mocks.imapConnect(...args);
  }),
}));
vi.mock('../../services/email/EmailProviderService', () => ({
  EmailProviderService: vi.fn(function () { return { deleteProvider: mocks.providerDelete }; }),
}));

const providerData = {
  tenant: 'tenant-1', providerType: 'imap', providerName: 'Mailbox', mailbox: 'a@example.test', isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tableCalls.length = 0;
  mocks.sessionUser.user_type = 'internal';
  mocks.providerRows = null;
  mocks.providerConfigs = {};
  mocks.createTenantKnex.mockResolvedValue({ knex: {} });
  mocks.hasPermission.mockResolvedValue(false);
});

describe('email provider action authorization', () => {
  it('rejects clients before permission lookup or any provider data access across all ten actions', async () => {
    mocks.sessionUser.user_type = 'client';
    const actions = await import('./emailProviderActions');
    const calls: Array<Promise<unknown>> = [
      actions.getEmailProviders(),
      actions.upsertEmailProvider(providerData as any, true),
      actions.createEmailProvider(providerData as any, true),
      actions.updateEmailProvider('provider-1', providerData as any, true),
      actions.deleteEmailProvider('provider-1'),
      actions.resyncImapProvider('provider-1'),
      actions.testEmailProviderConnection('provider-1'),
      actions.retryMicrosoftSubscriptionRenewal('provider-1'),
      actions.runGmailDiagnostics('provider-1'),
      actions.runMicrosoft365Diagnostics('provider-1'),
    ];
    const results = await Promise.all(calls);

    expect(results[0]).toEqual({ providers: [] });
    expect(results.slice(1, 5)).toEqual(Array.from({ length: 4 }, () =>
      expect.objectContaining({ actionError: expect.any(String), messageKey: 'errors.permissionDenied' })
    ));
    expect(results[5]).toEqual({ success: false, error: 'Permission denied', errorCode: 'unexpected' });
    expect(results[6]).toEqual({ success: false, error: 'Permission denied', errorCode: 'unexpected' });
    expect(results[7]).toEqual({ success: false, message: 'Permission denied' });
    expect(results[8]).toEqual({ success: false, error: 'Permission denied' });
    expect(results[9]).toEqual({ success: false, error: 'Permission denied' });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.tableCalls).toEqual([]);
    expect(mocks.secretLookup).not.toHaveBeenCalled();
    expect(mocks.httpPost).not.toHaveBeenCalled();
    expect(mocks.imapConnect).not.toHaveBeenCalled();
    expect(mocks.providerDelete).not.toHaveBeenCalled();
  });

  it('rejects MSP users without ticket_settings:update before provider data access', async () => {
    const actions = await import('./emailProviderActions');
    const results = await Promise.all([
      actions.getEmailProviders(),
      actions.upsertEmailProvider(providerData as any, true),
      actions.createEmailProvider(providerData as any, true),
      actions.updateEmailProvider('provider-1', providerData as any, true),
      actions.deleteEmailProvider('provider-1'),
      actions.resyncImapProvider('provider-1'),
      actions.testEmailProviderConnection('provider-1'),
      actions.retryMicrosoftSubscriptionRenewal('provider-1'),
      actions.runGmailDiagnostics('provider-1'),
      actions.runMicrosoft365Diagnostics('provider-1'),
    ]);

    expect(results[0]).toEqual({ providers: [] });
    expect(results.slice(1, 5).every((result: any) => result.messageKey === 'errors.permissionDenied')).toBe(true);
    expect(results.slice(5, 7).every((result: any) => result.errorCode === 'unexpected')).toBe(true);
    expect(results[7]).toEqual({ success: false, message: 'Permission denied: Cannot manage outbound email' });
    expect(results[8]).toEqual({ success: false, error: 'Permission denied: Cannot manage outbound email' });
    expect(results[9]).toEqual({ success: false, error: 'Permission denied: Cannot manage outbound email' });
    expect(mocks.hasPermission).toHaveBeenCalledTimes(10);
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.tableCalls).toEqual([]);
    expect(mocks.secretLookup).not.toHaveBeenCalled();
    expect(mocks.httpPost).not.toHaveBeenCalled();
    expect(mocks.imapConnect).not.toHaveBeenCalled();
    expect(mocks.providerDelete).not.toHaveBeenCalled();
  });

  it('lets an authorized MSP caller reach provider data access', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    const actions = await import('./emailProviderActions');

    await expect(actions.resyncImapProvider('provider-1')).rejects.toThrow('unexpected provider data access');
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.tableCalls).toEqual(['email_providers']);
  });

  it('returns provider settings without any stored credential values', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.providerRows = [{ id: 'provider-1', providerType: 'imap', tenant: 'tenant-1' }];
    mocks.providerConfigs.imap_email_provider_config = {
      email_provider_id: 'provider-1',
      oauth_token_url: 'https://issuer.example.test/token',
      oauth_credentials_token_url: 'https://issuer.example.test/token',
      oauth_credentials_secret_version: 1,
      oauth_client_id: 'client-id',
      oauth_client_secret: 'secret-value',
      access_token: 'access-value',
      refresh_token: 'refresh-value',
    };
    mocks.secretLookup.mockResolvedValue('refresh-value');
    const actions = await import('./emailProviderActions');

    const result = await actions.getEmailProviders();

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].imapConfig).toMatchObject({ email_provider_id: 'provider-1', oauth_client_id: 'client-id' });
    expect(result.providers[0].imapConfig).not.toHaveProperty('oauth_client_secret');
    expect(result.providers[0].imapConfig).not.toHaveProperty('access_token');
    expect(result.providers[0].imapConfig).not.toHaveProperty('refresh_token');
    expect(result.providers[0].imapConfig).toHaveProperty('oauth_authorization_status', 'connected');
    expect(JSON.stringify(result)).not.toContain('refresh-value');
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('reports reauthorization when a saved issuer no longer matches the token endpoint', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.providerRows = [{ id: 'provider-1', providerType: 'imap', tenant: 'tenant-1' }];
    mocks.providerConfigs.imap_email_provider_config = {
      email_provider_id: 'provider-1',
      oauth_token_url: 'https://new-issuer.example.test/token',
      oauth_credentials_token_url: 'https://old-issuer.example.test/token',
      oauth_credentials_secret_version: 1,
      oauth_client_id: 'client-id',
      refresh_token: 'old-refresh-value',
    };
    const actions = await import('./emailProviderActions');

    const result = await actions.getEmailProviders();

    expect(result.providers[0].imapConfig).toHaveProperty('oauth_authorization_status', 'reauthorization_required');
    expect(result.providers[0].imapConfig).not.toHaveProperty('refresh_token');
    expect(mocks.secretLookup).not.toHaveBeenCalled();
  });
});
