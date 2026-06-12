/**
 * T205/T206/T207/T209 — layout-type-config group: the asset_layout_type_map
 * contract (parse/normalize), the layout-name heuristic, the resolver, and the
 * get/set server actions. Action mocks mirror huduMappingActions.test.ts
 * (auth/flag/tiers/knex/repository/client mocked; the lib module stays REAL).
 * The jsonb round-trip against the real hudu_integrations table lives in
 * integration/hudu-asset-layout-map.integration.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();
const assertAddOnAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
const knexCallableMock = vi.fn();

const getHuduIntegrationMock = vi.fn();
const upsertHuduIntegrationMock = vi.fn();

const listAssetLayoutsMock = vi.fn();
const createHuduClientMock = vi.fn(async () => ({ listAssetLayouts: listAssetLayoutsMock }));

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

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
  upsertHuduIntegration: upsertHuduIntegrationMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduClient', () => ({
  createHuduClient: createHuduClientMock,
}));

// Dynamic import: a static import would evaluate the hoisted mock factories
// before the mock consts above are initialized (TDZ — huduPermissions idiom).
const {
  normalizeAssetLayoutTypeMap,
  parseAssetLayoutTypeMap,
  resolveAssetTypeForLayout,
  suggestAssetTypeForLayout,
} = await import('@ee/lib/integrations/hudu/assetLayoutMap');

async function importActions() {
  return import('@ee/lib/actions/integrations/huduLayoutMapActions');
}

beforeEach(() => {
  vi.clearAllMocks();

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  assertAddOnAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduIntegrationMock.mockResolvedValue(null);
  upsertHuduIntegrationMock.mockResolvedValue({});

  listAssetLayoutsMock.mockResolvedValue([
    { id: 7, name: 'Computer Assets' },
    { id: 9, name: 'Printers' },
  ]);
});

describe('T207: suggestAssetTypeForLayout heuristic', () => {
  it.each([
    ['Servers', 'server'],
    ['Workstations', 'workstation'],
    ['Desktop Machines', 'workstation'],
    ['Laptops', 'workstation'],
    ['Computer Assets', 'workstation'],
    ['Printers', 'printer'],
    ['Phones', 'mobile_device'],
    ['Mobile Devices', 'mobile_device'],
    ['Tablets', 'mobile_device'],
    ['Network Gear', 'network_device'],
    ['Switches', 'network_device'],
    ['Routers', 'network_device'],
    ['Firewalls', 'network_device'],
    ['Access Points', 'network_device'],
    ['WiFi Equipment', 'network_device'],
    ['Wireless Bridges', 'network_device'],
  ] as const)('%s -> %s', (name, expected) => {
    expect(suggestAssetTypeForLayout(name)).toBe(expected);
  });

  it('is case-insensitive substring matching', () => {
    expect(suggestAssetTypeForLayout('SERVERS')).toBe('server');
    expect(suggestAssetTypeForLayout('client lAPtops (managed)')).toBe('workstation');
  });

  it('precedence: server wins over computer for "Computer Server Assets"', () => {
    expect(suggestAssetTypeForLayout('Computer Server Assets')).toBe('server');
  });

  it('unmatched names (and empty input) fall back to unknown', () => {
    expect(suggestAssetTypeForLayout('Databases')).toBe('unknown');
    expect(suggestAssetTypeForLayout('Applications')).toBe('unknown');
    expect(suggestAssetTypeForLayout('')).toBe('unknown');
  });
});

describe('T209: resolveAssetTypeForLayout', () => {
  const map = { '7': 'workstation', '9': 'printer' } as const;

  it('returns the configured type for a configured layout (string or numeric id)', () => {
    expect(resolveAssetTypeForLayout(map, 7)).toBe('workstation');
    expect(resolveAssetTypeForLayout(map, '9')).toBe('printer');
  });

  it("returns 'unknown' for unconfigured layout ids and missing maps", () => {
    expect(resolveAssetTypeForLayout(map, 999)).toBe('unknown');
    expect(resolveAssetTypeForLayout({}, 7)).toBe('unknown');
    expect(resolveAssetTypeForLayout(null, 7)).toBe('unknown');
    expect(resolveAssetTypeForLayout(undefined, 7)).toBe('unknown');
  });
});

describe('F204: asset_layout_type_map contract (parse/normalize)', () => {
  it('parses a valid map out of a settings blob', () => {
    const settings = {
      password_access: true,
      asset_layout_type_map: { '7': 'workstation', '9': 'server' },
    };
    expect(parseAssetLayoutTypeMap(settings)).toEqual({ '7': 'workstation', '9': 'server' });
  });

  it("coerces unknown asset types to 'unknown'", () => {
    expect(normalizeAssetLayoutTypeMap({ '7': 'mainframe', '9': 'printer', '11': 42 })).toEqual({
      '7': 'unknown',
      '9': 'printer',
      '11': 'unknown',
    });
  });

  it('non-object values normalize to an empty map', () => {
    expect(normalizeAssetLayoutTypeMap(null)).toEqual({});
    expect(normalizeAssetLayoutTypeMap(undefined)).toEqual({});
    expect(normalizeAssetLayoutTypeMap('workstation')).toEqual({});
    expect(normalizeAssetLayoutTypeMap(['workstation'])).toEqual({});
    expect(parseAssetLayoutTypeMap(null)).toEqual({});
    expect(parseAssetLayoutTypeMap({ asset_layout_type_map: 'bogus' })).toEqual({});
  });
});

describe('F205: getHuduAssetLayoutMap', () => {
  it('joins live layouts with the stored map and heuristic suggestions', async () => {
    getHuduIntegrationMock.mockResolvedValue({
      tenant: TENANT,
      settings: { asset_layout_type_map: { '9': 'printer' } },
    });
    listAssetLayoutsMock.mockResolvedValue([
      { id: 7, name: 'Computer Assets' },
      { id: 9, name: 'Print Stations' },
      { id: 11, name: 'Databases' },
    ]);
    const { getHuduAssetLayoutMap } = await importActions();

    const result = await getHuduAssetLayoutMap();

    expect(createHuduClientMock).toHaveBeenCalledWith(TENANT);
    expect(result).toEqual({
      success: true,
      data: {
        layouts: [
          { id: 7, name: 'Computer Assets', suggestedType: 'workstation', configuredType: null },
          { id: 9, name: 'Print Stations', suggestedType: 'unknown', configuredType: 'printer' },
          { id: 11, name: 'Databases', suggestedType: 'unknown', configuredType: null },
        ],
        map: { '9': 'printer' },
      },
    });
  });

  it('is read-gated', async () => {
    const { getHuduAssetLayoutMap } = await importActions();

    await getHuduAssetLayoutMap();

    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'read');
  });

  it('returns a failure envelope when the Hudu fetch fails', async () => {
    listAssetLayoutsMock.mockRejectedValue(new Error('Hudu rate limit exceeded (429).'));
    const { getHuduAssetLayoutMap } = await importActions();

    const result = await getHuduAssetLayoutMap();

    expect(result).toEqual({ success: false, error: 'Hudu rate limit exceeded (429).' });
  });
});

describe('T205/F205: setHuduAssetLayoutMap persists without clobbering sibling settings', () => {
  it('merges the map into existing settings keys', async () => {
    getHuduIntegrationMock.mockResolvedValue({
      tenant: TENANT,
      settings: {
        password_access: true,
        companies_cache: { companies: [], fetched_at: '2026-06-10T00:00:00.000Z' },
      },
    });
    const { setHuduAssetLayoutMap } = await importActions();

    const result = await setHuduAssetLayoutMap({ '7': 'workstation', '9': 'server' });

    expect(result).toEqual({ success: true, data: { map: { '7': 'workstation', '9': 'server' } } });
    expect(upsertHuduIntegrationMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      settings: {
        password_access: true,
        companies_cache: { companies: [], fetched_at: '2026-06-10T00:00:00.000Z' },
        asset_layout_type_map: { '7': 'workstation', '9': 'server' },
      },
    });
  });

  it("coerces invalid asset types to 'unknown' before persisting", async () => {
    const { setHuduAssetLayoutMap } = await importActions();

    const result = await setHuduAssetLayoutMap({ '7': 'mainframe' } as never);

    expect(result).toEqual({ success: true, data: { map: { '7': 'unknown' } } });
    expect(upsertHuduIntegrationMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      settings: { asset_layout_type_map: { '7': 'unknown' } },
    });
  });

  it('rejects non-object input with a failure envelope (no write)', async () => {
    const { setHuduAssetLayoutMap } = await importActions();

    expect(await setHuduAssetLayoutMap(null as never)).toEqual({
      success: false,
      error: 'A layout map object is required.',
    });
    expect(await setHuduAssetLayoutMap(['workstation'] as never)).toEqual({
      success: false,
      error: 'A layout map object is required.',
    });
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });
});

describe('T206: setHuduAssetLayoutMap guard', () => {
  it('rejects without system_settings update', async () => {
    hasPermissionMock.mockImplementation(
      async (_user: unknown, _resource: unknown, permission: string) => permission !== 'update'
    );
    const { setHuduAssetLayoutMap } = await importActions();

    await expect(setHuduAssetLayoutMap({ '7': 'workstation' })).rejects.toThrow(
      /insufficient permissions \(update\)/
    );
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'update');
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('rejects when the hudu-integration flag is off', async () => {
    isEnabledMock.mockResolvedValue(false);
    const { setHuduAssetLayoutMap, getHuduAssetLayoutMap } = await importActions();

    await expect(setHuduAssetLayoutMap({ '7': 'workstation' })).rejects.toThrow(/disabled for this tenant/);
    await expect(getHuduAssetLayoutMap()).rejects.toThrow(/disabled for this tenant/);
    expect(isEnabledMock).toHaveBeenCalledWith('hudu-integration', {
      userId: 'user-1',
      tenantId: TENANT,
    });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});
