import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-ninjaone-authz';
const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };
const serviceUser = { user_id: 'service-1', tenant: TENANT, user_type: 'service' };
const currentUserRef: { value: Record<string, unknown> | null } = { value: internalUser };

const hasPermissionMock = vi.fn();
const assertTierAccessMock = vi.fn();
const createTenantKnexMock = vi.fn();
const tenantDbMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn();
const setTenantSecretMock = vi.fn();
const getTenantSecretMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      if (!currentUserRef.value) throw new Error('User not authenticated');
      return handler(currentUserRef.value, { tenant: TENANT }, ...args);
    },
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('@/lib/db', () => ({ createTenantKnex: createTenantKnexMock }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: tenantDbMock,
  withTransaction: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { getNinjaOneConnectUrl, getNinjaOneOrganizationMappings, saveNinjaOneCredentials } =
  await import('@ee/lib/actions/integrations/ninjaoneActions');

function makeQueryBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  builder.where = vi.fn(() => builder);
  builder.first = vi.fn(async () => result);
  builder.select = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

let integrationQuery: ReturnType<typeof makeQueryBuilder>;
let mappingQuery: ReturnType<typeof makeQueryBuilder>;
let database: { table: ReturnType<typeof vi.fn>; tenantJoin: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  currentUserRef.value = internalUser;
  hasPermissionMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: TENANT });

  integrationQuery = makeQueryBuilder({ integration_id: 'integration-1' });
  mappingQuery = makeQueryBuilder([
    {
      mapping_id: 'mapping-1',
      external_organization_name: 'Acme Division',
      company_name: 'Acme Services',
      metadata: { source: 'ninjaone' },
    },
  ]);
  database = {
    table: vi.fn((table: string) =>
      table === 'rmm_integrations' ? integrationQuery : mappingQuery
    ),
    tenantJoin: vi.fn(),
  };
  tenantDbMock.mockReturnValue(database);

  setTenantSecretMock.mockResolvedValue(undefined);
  getTenantSecretMock.mockImplementation(async (_tenant: string, secretName: string) =>
    secretName === 'ninjaone_client_id' ? 'configured-client-id' : null
  );
  getSecretProviderInstanceMock.mockResolvedValue({
    setTenantSecret: setTenantSecretMock,
    getTenantSecret: getTenantSecretMock,
  });
});

describe('withAdvancedAssetsAccess principal authorization', () => {
  it('rejects a client before tier checks, OAuth state writes, credential writes, or mapping reads', async () => {
    currentUserRef.value = { user_id: 'client-1', tenant: TENANT, user_type: 'client' };

    const outcomes = await Promise.allSettled([
      getNinjaOneConnectUrl(),
      saveNinjaOneCredentials('attacker-client-id', 'attacker-secret'),
      getNinjaOneOrganizationMappings(),
    ]);

    expect(outcomes).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({
            message: 'NinjaOne integration actions are restricted to MSP users.',
          }),
        })
      )
    );

    // These would succeed and persist/read prohibited data if the shared gate were absent.
    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(assertTierAccessMock).not.toHaveBeenCalled();
    expect(setTenantSecretMock).not.toHaveBeenCalled();
    expect(getSecretProviderInstanceMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'unknown'])('fails closed for user_type=%s', async (userType) => {
    currentUserRef.value = { user_id: 'unexpected-user', tenant: TENANT, user_type: userType };

    await expect(getNinjaOneConnectUrl()).rejects.toThrow(
      'NinjaOne integration actions are restricted to MSP users.'
    );
    expect(assertTierAccessMock).not.toHaveBeenCalled();
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('allows an internal MSP principal through tier, permission, and each protected action', async () => {
    const connectResult = await getNinjaOneConnectUrl();
    const credentialResult = await saveNinjaOneCredentials('msp-client-id', 'msp-secret');
    const mappingsResult = await getNinjaOneOrganizationMappings();

    expect(connectResult).toMatchObject({ success: true, url: expect.stringContaining('/oauth/authorize?') });
    expect(credentialResult).toEqual({ success: true });
    expect(mappingsResult).toEqual([
      {
        mapping_id: 'mapping-1',
        external_organization_name: 'Acme Division',
        company_name: 'Acme Services',
        metadata: { source: 'ninjaone' },
      },
    ]);
    expect(assertTierAccessMock).toHaveBeenCalledTimes(3);
    expect(hasPermissionMock).toHaveBeenNthCalledWith(1, internalUser, 'settings', 'read');
    expect(hasPermissionMock).toHaveBeenNthCalledWith(2, internalUser, 'settings', 'update');
    expect(hasPermissionMock).toHaveBeenNthCalledWith(3, internalUser, 'settings', 'read');
    expect(setTenantSecretMock).toHaveBeenCalledWith(TENANT, 'ninjaone_oauth_state', expect.any(String));
    expect(setTenantSecretMock).toHaveBeenCalledWith(TENANT, 'ninjaone_client_id', 'msp-client-id');
    expect(createTenantKnexMock).toHaveBeenCalledTimes(1);
  });

  it('allows the service principal when its existing permission and tier checks pass', async () => {
    currentUserRef.value = serviceUser;

    await expect(saveNinjaOneCredentials('service-client-id', 'service-secret')).resolves.toEqual({
      success: true,
    });

    expect(assertTierAccessMock).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).toHaveBeenCalledWith(serviceUser, 'settings', 'update');
    expect(setTenantSecretMock).toHaveBeenCalledWith(TENANT, 'ninjaone_client_id', 'service-client-id');
  });

  it('still requires the existing permission and tier checks for MSP principals', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await expect(saveNinjaOneCredentials('msp-client-id', 'msp-secret')).resolves.toMatchObject({
      success: false,
    });
    expect(assertTierAccessMock).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'settings', 'update');
    expect(setTenantSecretMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    currentUserRef.value = internalUser;
    assertTierAccessMock.mockRejectedValue(new Error('Advanced Assets tier required'));
    await expect(getNinjaOneConnectUrl()).rejects.toThrow('Advanced Assets tier required');
    expect(assertTierAccessMock).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  it('allows service principals through the principal gate but still requires their permission', async () => {
    currentUserRef.value = serviceUser;
    hasPermissionMock.mockResolvedValue(false);

    await expect(saveNinjaOneCredentials('service-client-id', 'service-secret')).resolves.toMatchObject({
      success: false,
    });
    expect(assertTierAccessMock).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).toHaveBeenCalledWith(serviceUser, 'settings', 'update');
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });
});
