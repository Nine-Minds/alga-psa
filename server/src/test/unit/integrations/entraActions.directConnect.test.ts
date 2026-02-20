import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();
const featureFlagIsEnabledMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const clearEntraCippCredentialsMock = vi.fn();
const saveEntraCippCredentialsMock = vi.fn();
const clearEntraDirectTokenSetMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn();
const createTenantKnexMock = vi.fn();
const discoveryRoutePostMock = vi.fn();
const confirmMappingsRoutePostMock = vi.fn();
const startEntraInitialSyncWorkflowMock = vi.fn();
const startEntraAllTenantsSyncWorkflowMock = vi.fn();
const statusRouteGetMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: {
    isEnabled: featureFlagIsEnabledMock,
  },
}));

vi.mock('@enterprise/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@enterprise/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  clearEntraCippCredentials: clearEntraCippCredentialsMock,
  saveEntraCippCredentials: saveEntraCippCredentialsMock,
}));

vi.mock('@enterprise/lib/integrations/entra/auth/tokenStore', () => ({
  clearEntraDirectTokenSet: clearEntraDirectTokenSetMock,
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core/secrets')>();
  return {
    ...actual,
    getSecretProviderInstance: getSecretProviderInstanceMock,
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@enterprise/app/api/integrations/entra/discovery/route', () => ({
  POST: discoveryRoutePostMock,
}));

vi.mock('@enterprise/app/api/integrations/entra/mappings/confirm/route', () => ({
  POST: confirmMappingsRoutePostMock,
}));

vi.mock('@enterprise/app/api/integrations/entra/status/route', () => ({
  GET: statusRouteGetMock,
}));

vi.mock('@enterprise/lib/integrations/entra/entraWorkflowClient', () => ({
  startEntraInitialSyncWorkflow: startEntraInitialSyncWorkflowMock,
  startEntraAllTenantsSyncWorkflow: startEntraAllTenantsSyncWorkflowMock,
}));

describe('Entra direct connect action permissions', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    featureFlagIsEnabledMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    clearEntraCippCredentialsMock.mockReset();
    saveEntraCippCredentialsMock.mockReset();
    clearEntraDirectTokenSetMock.mockReset();
    getSecretProviderInstanceMock.mockReset();
    createTenantKnexMock.mockReset();
    discoveryRoutePostMock.mockReset();
    confirmMappingsRoutePostMock.mockReset();
    startEntraInitialSyncWorkflowMock.mockReset();
    startEntraAllTenantsSyncWorkflowMock.mockReset();
    statusRouteGetMock.mockReset();
  });

  it('T031: direct connect initiation rejects users lacking update permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { initiateEntraDirectOAuth } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await initiateEntraDirectOAuth(
      { user_id: 'user-1', user_type: 'internal' } as any,
      { tenant: 'tenant-1' }
    );

    expect(result).toEqual({
      success: false,
      error: 'Forbidden: insufficient permissions to configure Entra integration',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'system_settings',
      'update'
    );
  });

  it('T130: client-portal users cannot access Entra settings actions', async () => {
    const { getEntraIntegrationStatus } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await getEntraIntegrationStatus(
      { user_id: 'user-130', user_type: 'client' } as any,
      { tenant: 'tenant-130' }
    );

    expect(result).toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('T132: internal users without read permission cannot access Entra status or mapping preview reads', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { getEntraIntegrationStatus, getEntraMappingPreview } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const statusResult = await getEntraIntegrationStatus(
      { user_id: 'user-132', user_type: 'internal' } as any,
      { tenant: 'tenant-132' }
    );
    const mappingResult = await getEntraMappingPreview(
      { user_id: 'user-132', user_type: 'internal' } as any,
      { tenant: 'tenant-132' }
    );

    expect(statusResult).toEqual({
      success: false,
      error: 'Forbidden: insufficient permissions to view Entra integration',
    });
    expect(mappingResult).toEqual({
      success: false,
      error: 'Forbidden: insufficient permissions to view Entra integration',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-132' }),
      'system_settings',
      'read'
    );
  });

  it('T133: internal users without update permission cannot confirm Entra mappings', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { confirmEntraMappings } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );
    const result = await confirmEntraMappings(
      { user_id: 'user-133-map', user_type: 'internal' } as any,
      { tenant: 'tenant-133' },
      {
        mappings: [{ managedTenantId: 'managed-133', clientId: 'client-133' }],
      }
    );

    expect(result).toEqual({
      success: false,
      error: 'Forbidden: insufficient permissions to configure Entra integration',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-133-map' }),
      'system_settings',
      'update'
    );
  });

  it('T139: disabling entra-integration-ui hides settings reads without touching persisted Entra data paths', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(false);

    const { getEntraIntegrationStatus } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );
    const result = await getEntraIntegrationStatus(
      { user_id: 'user-139', user_type: 'internal' } as any,
      { tenant: 'tenant-139' }
    );

    expect(result).toEqual({
      success: false,
      error: 'Microsoft Entra integration is disabled for this tenant.',
    });
    expect(statusRouteGetMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('T032: direct connect initiation returns OAuth URL with encoded nonce/state', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-1',
      clientSecret: 'client-secret-1',
      tenantId: null,
      source: 'tenant-secret',
    });
    clearEntraCippCredentialsMock.mockResolvedValue(undefined);
    getSecretProviderInstanceMock.mockResolvedValue({
      getAppSecret: vi.fn(async () => null),
    });

    const { initiateEntraDirectOAuth } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await initiateEntraDirectOAuth(
      { user_id: 'user-7', user_type: 'internal' } as any,
      { tenant: 'tenant-7' }
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success, got ${result.error}`);
    }

    const authUrl = new URL(result.data.authUrl);
    const encodedState = result.data.state;
    const stateFromAuthUrl = authUrl.searchParams.get('state');
    const decodedState = JSON.parse(Buffer.from(encodedState, 'base64').toString('utf8'));

    expect(authUrl.origin).toBe('https://login.microsoftonline.com');
    expect(authUrl.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(authUrl.searchParams.get('client_id')).toBe('client-id-1');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('scope')).toContain('offline_access');
    expect(stateFromAuthUrl).toBe(encodedState);

    expect(decodedState).toMatchObject({
      tenant: 'tenant-7',
      userId: 'user-7',
      provider: 'microsoft',
      integration: 'entra',
      connectionType: 'direct',
    });
    expect(typeof decodedState.timestamp).toBe('number');
    expect(typeof decodedState.nonce).toBe('string');
    expect(decodedState.nonce.length).toBeGreaterThan(0);
    expect(typeof decodedState.redirectUri).toBe('string');
    expect(decodedState.redirectUri).toContain('/api/auth/microsoft/entra/callback');
  });

  it('T036: CIPP connect validates base URL format and rejects invalid values', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-36', user_type: 'internal' } as any,
      { tenant: 'tenant-36' },
      { baseUrl: 'not a valid url', apiToken: 'token-36' }
    );

    expect(result).toEqual({
      success: false,
      error: 'CIPP base URL must be a valid http(s) URL.',
    });
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
  });

  it('T037: CIPP connect stores API token via secret provider without plaintext DB token', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);
    clearEntraDirectTokenSetMock.mockResolvedValue(undefined);
    saveEntraCippCredentialsMock.mockResolvedValue(undefined);

    const whereMock = vi.fn().mockReturnThis();
    const updateMock = vi.fn(async () => 1);
    const insertMock = vi.fn(async () => [1]);
    const knexMock = vi.fn(() => ({
      where: whereMock,
      update: updateMock,
      insert: insertMock,
    })) as any;
    knexMock.fn = { now: vi.fn(() => 'db-now') };
    knexMock.raw = vi.fn((value: string) => `RAW(${value})`);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-37', user_type: 'internal' } as any,
      { tenant: 'tenant-37' },
      { baseUrl: 'cipp.example.com/base', apiToken: 'cipp-token-37' }
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success, got ${result.error}`);
    }
    expect(result.data.baseUrl).toBe('https://cipp.example.com/base');

    expect(saveEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-37', {
      baseUrl: 'https://cipp.example.com/base',
      apiToken: 'cipp-token-37',
    });

    const insertedRow = insertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow).toMatchObject({
      tenant: 'tenant-37',
      connection_type: 'cipp',
      status: 'connected',
      is_active: true,
      cipp_base_url: 'https://cipp.example.com/base',
      token_secret_ref: 'entra_cipp',
    });
    expect(insertedRow).not.toHaveProperty('apiToken');
    expect(Object.values(insertedRow)).not.toContain('cipp-token-37');
  });

  it('T041: switching direct<->CIPP clears stale credentials from the previous mode', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);

    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-41',
      clientSecret: 'client-secret-41',
      tenantId: null,
      source: 'tenant-secret',
    });
    getSecretProviderInstanceMock.mockResolvedValue({
      getAppSecret: vi.fn(async () => null),
    });

    const { initiateEntraDirectOAuth, connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    await initiateEntraDirectOAuth(
      { user_id: 'user-41a', user_type: 'internal' } as any,
      { tenant: 'tenant-41a' }
    );
    expect(clearEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-41a');

    clearEntraDirectTokenSetMock.mockResolvedValue(undefined);
    saveEntraCippCredentialsMock.mockResolvedValue(undefined);

    const whereMock = vi.fn().mockReturnThis();
    const updateMock = vi.fn(async () => 1);
    const insertMock = vi.fn(async () => [1]);
    const knexMock = vi.fn(() => ({
      where: whereMock,
      update: updateMock,
      insert: insertMock,
    })) as any;
    knexMock.fn = { now: vi.fn(() => 'db-now') };
    knexMock.raw = vi.fn((value: string) => `RAW(${value})`);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    await connectEntraCipp(
      { user_id: 'user-41b', user_type: 'internal' } as any,
      { tenant: 'tenant-41b' },
      { baseUrl: 'https://cipp.example.com', apiToken: 'token-41b' }
    );

    expect(clearEntraDirectTokenSetMock).toHaveBeenCalledWith('tenant-41b');
  });

  it('T134: internal user with required permissions can complete connect -> discover -> map -> sync flow', async () => {
    const previousEdition = process.env.NEXT_PUBLIC_EDITION;
    const previousServerEdition = process.env.EDITION;
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.EDITION = 'ee';
    vi.resetModules();

    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-134',
      clientSecret: 'client-secret-134',
      tenantId: null,
      source: 'tenant-secret',
    });
    clearEntraCippCredentialsMock.mockResolvedValue(undefined);
    getSecretProviderInstanceMock.mockResolvedValue({
      getAppSecret: vi.fn(async () => null),
    });

    discoveryRoutePostMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            discoveredTenantCount: 1,
            discoveredTenants: [{ managedTenantId: 'managed-134', displayName: 'Managed 134' }],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    confirmMappingsRoutePostMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            confirmedMappings: 1,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    startEntraInitialSyncWorkflowMock.mockResolvedValue({
      available: true,
      workflowId: 'wf-134-initial',
      runId: 'run-134-initial',
      error: null,
    });
    startEntraAllTenantsSyncWorkflowMock.mockResolvedValue({
      available: true,
      workflowId: 'wf-134-all',
      runId: 'run-134-all',
      error: null,
    });

    try {
      const {
        initiateEntraDirectOAuth,
        discoverEntraManagedTenants,
        confirmEntraMappings,
        startEntraSync,
      } = await import('@alga-psa/integrations/actions/integrations/entraActions');

      const connectResult = await initiateEntraDirectOAuth(
        { user_id: 'user-134', user_type: 'internal' } as any,
        { tenant: 'tenant-134' }
      );
      expect(connectResult.success).toBe(true);

      const discoveryResult = await discoverEntraManagedTenants(
        { user_id: 'user-134', user_type: 'internal' } as any,
        { tenant: 'tenant-134' }
      );
      expect(discoveryResult).toEqual({
        success: true,
        data: {
          discoveredTenantCount: 1,
          discoveredTenants: [{ managedTenantId: 'managed-134', displayName: 'Managed 134' }],
        },
      });

      const confirmResult = await confirmEntraMappings(
        { user_id: 'user-134', user_type: 'internal' } as any,
        { tenant: 'tenant-134' },
        {
          mappings: [{ managedTenantId: 'managed-134', clientId: 'client-134' }],
          startInitialSync: true,
        }
      );
      expect(confirmResult).toEqual({
        success: true,
        data: {
          confirmedMappings: 1,
          initialSync: {
            started: true,
            workflowId: 'wf-134-initial',
            runId: 'run-134-initial',
            error: null,
          },
        },
      });

      const syncResult = await startEntraSync(
        { user_id: 'user-134', user_type: 'internal' } as any,
        { tenant: 'tenant-134' },
        { scope: 'all-tenants' }
      );
      expect(syncResult).toEqual({
        success: true,
        data: {
          accepted: true,
          scope: 'all-tenants',
          runId: 'run-134-all',
          workflowId: 'wf-134-all',
          error: null,
        },
      });
    } finally {
      process.env.NEXT_PUBLIC_EDITION = previousEdition;
      process.env.EDITION = previousServerEdition;
    }
  });

  it('T060: skip control marks tenant mapping as skipped without creating an active client mapping', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);

    const whereMock = vi.fn().mockReturnThis();
    const updateMock = vi.fn(async () => 1);
    const insertMock = vi.fn(async () => [1]);
    const trxMock = vi.fn(() => ({
      where: whereMock,
      update: updateMock,
      insert: insertMock,
    }));

    const nowValue = 'db-now';
    const transactionMock = vi.fn(async (cb: (trx: typeof trxMock) => Promise<void>) => cb(trxMock));
    const knexMock = {
      fn: { now: vi.fn(() => nowValue) },
      transaction: transactionMock,
    };
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { skipEntraTenantMapping } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await skipEntraTenantMapping(
      { user_id: 'user-60', user_type: 'internal' } as any,
      { tenant: 'tenant-60' },
      { managedTenantId: 'managed-60' }
    );

    expect(result).toEqual({
      success: true,
      data: {
        managedTenantId: 'managed-60',
        mappingState: 'skip_for_now',
      },
    });

    expect(whereMock).toHaveBeenCalledWith({
      tenant: 'tenant-60',
      managed_tenant_id: 'managed-60',
      is_active: true,
    });
    expect(updateMock).toHaveBeenCalledWith({
      is_active: false,
      updated_at: nowValue,
    });

    const insertedRow = insertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow).toMatchObject({
      tenant: 'tenant-60',
      managed_tenant_id: 'managed-60',
      client_id: null,
      mapping_state: 'skip_for_now',
      is_active: true,
      decided_by: 'user-60',
      decided_at: nowValue,
    });
  });
});
