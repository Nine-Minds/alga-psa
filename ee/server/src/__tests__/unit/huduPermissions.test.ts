/**
 * T090/T091/T093 — permissions group: every Hudu server action enforces the
 * shared withHuduSettingsAccess gate (system_settings RBAC, EE tier + add-on,
 * `hudu-integration` flag) at the correct level: update = connect/disconnect/
 * test/sync/map, read = status/mappings/data/reveal/context (PRD Security /
 * Permissions). The manage/view lists are asserted EXHAUSTIVE against the
 * modules' runtime exports, so a future action that isn't added to a list
 * (and therefore isn't permission-tested) fails the completeness case.
 *
 * The EE route-guard path (requireHuduUiFlagEnabled — the only Hudu route)
 * is covered in huduFlagGuard.test.ts (T001) and the CE 501 delegation in
 * server/src/test/unit/api/huduRouteDelegator.test.ts; not duplicated here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';
const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

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

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
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

// Dynamic imports: static imports would evaluate the modules before the mock
// consts above are initialized (TDZ — huduDataActions.test.ts idiom).
const huduActions = await import('@ee/lib/actions/integrations/huduActions');
const huduMappingActions = await import('@ee/lib/actions/integrations/huduMappingActions');
const huduDataActions = await import('@ee/lib/actions/integrations/huduDataActions');

interface GateEntry {
  name: string;
  run: () => Promise<unknown>;
}

/** Everything requiring system_settings UPDATE (connect/disconnect/manage). */
const manageEntries: GateEntry[] = [
  { name: 'connectHudu', run: () => huduActions.connectHudu({ baseUrl: 'https://docs.example.com', apiKey: 'k' }) },
  { name: 'testHuduConnection', run: () => huduActions.testHuduConnection({ baseUrl: 'https://docs.example.com', apiKey: 'k' }) },
  { name: 'disconnectHudu', run: () => huduActions.disconnectHudu() },
  { name: 'syncHuduCompanies', run: () => huduMappingActions.syncHuduCompanies() },
  { name: 'setHuduCompanyMapping', run: () => huduMappingActions.setHuduCompanyMapping({ clientId: CLIENT_ID, huduCompanyId: 1 }) },
  { name: 'clearHuduCompanyMapping', run: () => huduMappingActions.clearHuduCompanyMapping({ mappingId: 'mapping-1' }) },
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
];

const allEntries: GateEntry[] = [...manageEntries, ...viewEntries];

function exportedActionNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((name) => typeof mod[name] === 'function');
}

beforeEach(() => {
  vi.clearAllMocks();

  // Happy-path defaults; each describe flips exactly one gate input.
  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  assertAddOnAccessMock.mockResolvedValue(undefined);
  createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: TENANT });
});

describe('T093: gate coverage is exhaustive', () => {
  it('every exported Hudu action is covered by exactly one of the manage/view lists', () => {
    const exported = [
      ...exportedActionNames(huduActions),
      ...exportedActionNames(huduMappingActions),
      ...exportedActionNames(huduDataActions),
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

describe('T093: every action rejects when the hudu-integration flag is off', () => {
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

describe('T093: every action rejects when EE access is denied', () => {
  it.each(allEntries)('$name rejects when the Enterprise add-on is missing', async ({ run }) => {
    assertAddOnAccessMock.mockRejectedValue(new Error('Enterprise add-on required'));

    await expect(run()).rejects.toThrow(/Enterprise add-on required/);
    // EE access is checked before the flag is even consulted.
    expect(isEnabledMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});
