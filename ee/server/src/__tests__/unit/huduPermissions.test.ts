/**
 * T090/T091/T093 (Phase 1) + T249/F238 (Phase 2) — permissions sweep: every
 * Hudu server action enforces its guard chain (RBAC, EE tier + add-on,
 * `hudu-integration` flag) at the correct level. Phase 1 modules gate on
 * system_settings (update = connect/disconnect/test/sync/map, read = status/
 * mappings/data/reveal/context); Phase 2 layout-map actions reuse
 * system_settings, while the Technician flows gate on asset (read = view
 * mappings, update = set/clear/sync, create = import) and client read
 * (global articles) per FR16. The entry lists are asserted EXHAUSTIVE
 * against the modules' runtime exports, so a future action that isn't added
 * to a list (and therefore isn't permission-tested) fails the completeness
 * case. Every entry is also exercised unauthenticated (withAuth applied).
 *
 * The EE route-guard path (requireHuduUiFlagEnabled — the only Hudu route)
 * is covered in huduFlagGuard.test.ts (T001) and the CE 501 delegation in
 * server/src/test/unit/api/huduRouteDelegator.test.ts; not duplicated here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';
const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

// Mutable so the unauthenticated sweep can drop the session user entirely.
let authenticatedUser: typeof internalUser | null = internalUser;

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();
const assertAddOnAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();

const getTenantSecretMock = vi.fn();
const setTenantSecretMock = vi.fn();
const deleteTenantSecretMock = vi.fn();

const getHuduIntegrationMock = vi.fn();
const upsertHuduIntegrationMock = vi.fn();
const setHuduIntegrationActiveMock = vi.fn();
const touchHuduIntegrationLastSyncedMock = vi.fn();

const revealAuditMock = vi.fn();

const createAssetMock = vi.fn();
const updateAssetMock = vi.fn();
const deleteAssetMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      if (!authenticatedUser) {
        // Real withAuth: AuthenticationError when getCurrentUser() is null.
        throw new Error('User not authenticated');
      }
      return handler(authenticatedUser, { tenant: TENANT }, ...args);
    },
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: { isEnabled: isEnabledMock },
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('server/src/lib/tier-gating/assertAddOnAccess', () => ({
  assertAddOnAccess: assertAddOnAccessMock,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    deleteTenantSecret: deleteTenantSecretMock,
  })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
  upsertHuduIntegration: upsertHuduIntegrationMock,
  setHuduIntegrationActive: setHuduIntegrationActiveMock,
  touchHuduIntegrationLastSynced: touchHuduIntegrationLastSyncedMock,
}));

vi.mock('@ee/lib/integrations/hudu/revealAudit', () => ({
  writeHuduPasswordRevealAudit: revealAuditMock,
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  createAsset: createAssetMock,
  updateAsset: updateAssetMock,
  deleteAsset: deleteAssetMock,
}));

// Dynamic imports: static imports would evaluate the modules before the mock
// consts above are initialized (TDZ — huduDataActions.test.ts idiom).
const huduActions = await import('@ee/lib/actions/integrations/huduActions');
const huduMappingActions = await import('@ee/lib/actions/integrations/huduMappingActions');
const huduDataActions = await import('@ee/lib/actions/integrations/huduDataActions');
const huduLayoutMapActions = await import('@ee/lib/actions/integrations/huduLayoutMapActions');
const huduAssetMappingActions = await import('@ee/lib/actions/integrations/huduAssetMappingActions');
const huduAssetImportActions = await import('@ee/lib/actions/integrations/huduAssetImportActions');
const huduAssetSyncActions = await import('@ee/lib/actions/integrations/huduAssetSyncActions');
const huduGlobalDocsActions = await import('@ee/lib/actions/integrations/huduGlobalDocsActions');

interface GateEntry {
  name: string;
  run: () => Promise<unknown>;
}

/** Phase 2 Technician-flow actions gate on asset/client instead of system_settings. */
interface ResourceGateEntry extends GateEntry {
  resource: 'asset' | 'client';
  permission: 'read' | 'update' | 'create';
}

/** Everything requiring system_settings UPDATE (connect/disconnect/manage). */
const manageEntries: GateEntry[] = [
  { name: 'connectHudu', run: () => huduActions.connectHudu({ baseUrl: 'https://docs.example.com', apiKey: 'k' }) },
  { name: 'testHuduConnection', run: () => huduActions.testHuduConnection({ baseUrl: 'https://docs.example.com', apiKey: 'k' }) },
  { name: 'disconnectHudu', run: () => huduActions.disconnectHudu() },
  { name: 'syncHuduCompanies', run: () => huduMappingActions.syncHuduCompanies() },
  { name: 'setHuduCompanyMapping', run: () => huduMappingActions.setHuduCompanyMapping({ clientId: CLIENT_ID, huduCompanyId: 1 }) },
  { name: 'clearHuduCompanyMapping', run: () => huduMappingActions.clearHuduCompanyMapping({ mappingId: 'mapping-1' }) },
  { name: 'setHuduAssetLayoutMap', run: () => huduLayoutMapActions.setHuduAssetLayoutMap({ '7': 'workstation' }) },
];

/** Everything requiring system_settings READ (view surfaced data). */
const viewEntries: GateEntry[] = [
  { name: 'getHuduConnectionStatus', run: () => huduActions.getHuduConnectionStatus() },
  { name: 'getHuduCompanyMappings', run: () => huduMappingActions.getHuduCompanyMappings() },
  { name: 'resolveHuduCompanyIdForClient', run: () => huduMappingActions.resolveHuduCompanyIdForClient(CLIENT_ID) },
  { name: 'resolveClientIdForHuduCompany', run: () => huduMappingActions.resolveClientIdForHuduCompany(1) },
  { name: 'getHuduClientContext', run: () => huduDataActions.getHuduClientContext(CLIENT_ID) },
  { name: 'getHuduCompanyAssets', run: () => huduDataActions.getHuduCompanyAssets(CLIENT_ID) },
  { name: 'getHuduCompanyArticles', run: () => huduDataActions.getHuduCompanyArticles(CLIENT_ID) },
  { name: 'getHuduCompanyPasswords', run: () => huduDataActions.getHuduCompanyPasswords(CLIENT_ID) },
  { name: 'revealHuduPassword', run: () => huduDataActions.revealHuduPassword(CLIENT_ID, 7) },
  { name: 'getHuduAssetLayoutMap', run: () => huduLayoutMapActions.getHuduAssetLayoutMap() },
];

/** Phase 2 actions with their FR16 resource+permission matrix. */
const resourceEntries: ResourceGateEntry[] = [
  { name: 'getHuduAssetMappings', resource: 'asset', permission: 'read', run: () => huduAssetMappingActions.getHuduAssetMappings(CLIENT_ID) },
  { name: 'setHuduAssetMapping', resource: 'asset', permission: 'update', run: () => huduAssetMappingActions.setHuduAssetMapping({ clientId: CLIENT_ID, assetId: 'asset-1', huduAssetId: 1 }) },
  { name: 'clearHuduAssetMapping', resource: 'asset', permission: 'update', run: () => huduAssetMappingActions.clearHuduAssetMapping({ mappingId: 'mapping-1' }) },
  { name: 'importHuduAsset', resource: 'asset', permission: 'create', run: () => huduAssetImportActions.importHuduAsset({ clientId: CLIENT_ID, huduAssetId: 1 }) },
  { name: 'importAllUnmatchedHuduAssets', resource: 'asset', permission: 'create', run: () => huduAssetImportActions.importAllUnmatchedHuduAssets({ clientId: CLIENT_ID }) },
  { name: 'syncHuduClientAssets', resource: 'asset', permission: 'update', run: () => huduAssetSyncActions.syncHuduClientAssets({ clientId: CLIENT_ID }) },
  { name: 'listHuduArticlesAcrossCompanies', resource: 'client', permission: 'read', run: () => huduGlobalDocsActions.listHuduArticlesAcrossCompanies() },
];

const allEntries: GateEntry[] = [...manageEntries, ...viewEntries, ...resourceEntries];

function exportedActionNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((name) => typeof mod[name] === 'function');
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticatedUser = internalUser;

  // Happy-path defaults; each describe flips exactly one gate input.
  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  assertAddOnAccessMock.mockResolvedValue(undefined);
  createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: TENANT });
});

describe('T093/T249: gate coverage is exhaustive', () => {
  it('every exported Hudu action is covered by exactly one of the entry lists', () => {
    const exported = [
      ...exportedActionNames(huduActions),
      ...exportedActionNames(huduMappingActions),
      ...exportedActionNames(huduDataActions),
      ...exportedActionNames(huduLayoutMapActions),
      ...exportedActionNames(huduAssetMappingActions),
      ...exportedActionNames(huduAssetImportActions),
      ...exportedActionNames(huduAssetSyncActions),
      ...exportedActionNames(huduGlobalDocsActions),
    ].sort();
    const covered = allEntries.map((entry) => entry.name).sort();

    // New action exported but not permission-tested here ⇒ this fails.
    expect(covered).toEqual(exported);
    expect(new Set(covered).size).toBe(covered.length);
  });
});

describe('T090: manage actions are denied without system_settings.update', () => {
  it.each(manageEntries)('$name rejects when only read is granted', async ({ run }) => {
    // Read granted, update denied — an action mis-gated at read would slip through.
    hasPermissionMock.mockImplementation(
      async (_user: unknown, _resource: unknown, permission: string) => permission !== 'update'
    );

    await expect(run()).rejects.toThrow(/insufficient permissions \(update\)/);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'update');

    // Denial happens before any work: no DB handle, no secret writes/deletes.
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(setTenantSecretMock).not.toHaveBeenCalled();
    expect(deleteTenantSecretMock).not.toHaveBeenCalled();
  });
});

describe('T091: view entry points are denied without system_settings.read', () => {
  it.each(viewEntries)('$name rejects when only update is granted', async ({ run }) => {
    // Update granted, read denied — an action mis-gated at update would slip through.
    hasPermissionMock.mockImplementation(
      async (_user: unknown, _resource: unknown, permission: string) => permission !== 'read'
    );

    await expect(run()).rejects.toThrow(/insufficient permissions \(read\)/);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'read');
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});

describe('T249: Phase 2 actions are denied without their specific resource permission', () => {
  it.each(resourceEntries)('$name rejects without $resource.$permission', async ({ resource, permission, run }) => {
    // Every OTHER (resource, permission) pair is granted — an action mis-gated
    // on a different resource (e.g. system_settings) or level would slip through.
    hasPermissionMock.mockImplementation(
      async (_user: unknown, res: string, perm: string) => !(res === resource && perm === permission)
    );

    await expect(run()).rejects.toThrow(`insufficient permissions (${permission})`);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, resource, permission);

    // Denial happens before any work: no DB handle, no asset writes.
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(createAssetMock).not.toHaveBeenCalled();
    expect(updateAssetMock).not.toHaveBeenCalled();
    expect(deleteAssetMock).not.toHaveBeenCalled();
  });
});

describe('T249/F238: every action rejects when unauthenticated', () => {
  it.each(allEntries)('$name rejects with no session user', async ({ run }) => {
    authenticatedUser = null;

    // A bare (un-wrapped) export would resolve here instead of throwing.
    await expect(run()).rejects.toThrow('User not authenticated');
    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});

describe('T093/T249: every action rejects when the hudu-integration flag is off', () => {
  it.each(allEntries)('$name rejects with permission granted but the flag off', async ({ run }) => {
    isEnabledMock.mockResolvedValue(false);

    await expect(run()).rejects.toThrow(/disabled for this tenant/);
    expect(isEnabledMock).toHaveBeenCalledWith('hudu-integration', {
      userId: 'user-1',
      tenantId: TENANT,
    });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});

describe('T093/T249: every action rejects when EE access is denied', () => {
  it.each(allEntries)('$name rejects when the Enterprise add-on is missing', async ({ run }) => {
    assertAddOnAccessMock.mockRejectedValue(new Error('Enterprise add-on required'));

    await expect(run()).rejects.toThrow(/Enterprise add-on required/);
    // EE access is checked before the flag is even consulted.
    expect(isEnabledMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});
