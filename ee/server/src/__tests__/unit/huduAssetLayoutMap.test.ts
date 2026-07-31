/**
 * T205/T206/T207/T209 — layout-type-config group: the asset_layout_type_map
 * contract (parse/normalize), the layout-name heuristic, the resolver, and the
 * get/set server actions. Action mocks mirror huduMappingActions.test.ts
 * (auth/tiers/knex/repository/client mocked; the lib module stays REAL).
 * T318/T319 — hudu-tie-in group: slug-shaped storage + registry-validated
 * resolve (F315) and createAssetTypeFromHuduLayout (F316) — the registry
 * module is mocked (knex-level); layoutFieldSchema stays REAL so the
 * field-kind mapping is exercised through the action.
 * The jsonb round-trip against the real hudu_integrations table lives in
 * integration/hudu-asset-layout-map.integration.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const assertTierAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
const knexCallableMock = vi.fn();

const getHuduIntegrationMock = vi.fn();
const upsertHuduIntegrationMock = vi.fn();

const listAssetTypesMock = vi.fn();
const createAssetTypeMock = vi.fn();

const listAssetLayoutsMock = vi.fn();
const getAssetLayoutMock = vi.fn();
const createHuduClientMock = vi.fn(async () => ({
  listAssetLayouts: listAssetLayoutsMock,
  getAssetLayout: getAssetLayoutMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
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

vi.mock('@alga-psa/assets/lib/assetTypeRegistry', () => ({
  listAssetTypes: listAssetTypesMock,
  createAssetType: createAssetTypeMock,
}));

// Dynamic import: a static import would evaluate the hoisted mock factories
// before the mock consts above are initialized (TDZ — huduPermissions idiom).
const {
  HUDU_LAYOUT_EXCLUDED,
  isLayoutExcluded,
  normalizeAssetLayoutTypeMap,
  parseAssetLayoutTypeMap,
  resolveAssetTypeForLayout,
  suggestAssetTypeForLayout,
} = await import('@ee/lib/integrations/hudu/assetLayoutMap');

async function importActions() {
  return import('@ee/lib/actions/integrations/huduLayoutMapActions');
}

// F315: registry fixture (built-ins + one custom) and its action projection.
const REGISTRY_FIXTURE = [
  { slug: 'workstation', name: 'Workstation', is_builtin: true, fields_schema: [] },
  { slug: 'printer', name: 'Printer', is_builtin: true, fields_schema: [] },
  { slug: 'unknown', name: 'Unknown', is_builtin: true, fields_schema: [] },
  {
    slug: 'firewall_rules',
    name: 'Firewall Rules',
    is_builtin: false,
    fields_schema: [{ key: 'hostname', label: 'Hostname', kind: 'text' }],
  },
];
const REGISTRY_TYPES = REGISTRY_FIXTURE.map(({ slug, name, is_builtin }) => ({
  slug,
  name,
  is_builtin,
}));

beforeEach(() => {
  vi.clearAllMocks();

  hasPermissionMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduIntegrationMock.mockResolvedValue(null);
  upsertHuduIntegrationMock.mockResolvedValue({});

  listAssetTypesMock.mockResolvedValue(REGISTRY_FIXTURE);
  createAssetTypeMock.mockImplementation(async (_knex, _tenant, input: { name: string; fields_schema: unknown[] }) => ({
    ok: true,
    value: {
      tenant: TENANT,
      type_id: 'type-new-1',
      slug: input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, ''),
      name: input.name,
      icon: null,
      fields_schema: input.fields_schema,
      is_builtin: false,
      display_order: 0,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    },
  }));

  listAssetLayoutsMock.mockResolvedValue([
    { id: 7, name: 'Computer Assets' },
    { id: 9, name: 'Printers' },
  ]);
  getAssetLayoutMock.mockResolvedValue({ id: 7, name: 'Computer Assets', fields: [] });
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

describe('T318: registry-validated resolve (F315)', () => {
  const registry = new Set(['workstation', 'printer', 'unknown', 'firewall_rules']);

  it('a configured custom slug resolves when it is in the registry set', () => {
    expect(resolveAssetTypeForLayout({ '7': 'firewall_rules' }, 7, registry)).toBe('firewall_rules');
  });

  it("a configured slug missing from the registry resolves to 'unknown' (stale assignment)", () => {
    expect(resolveAssetTypeForLayout({ '7': 'ghost_type' }, 7, registry)).toBe('unknown');
  });

  it("without a registry set a custom slug resolves to 'unknown' while built-ins still resolve", () => {
    expect(resolveAssetTypeForLayout({ '7': 'firewall_rules' }, 7)).toBe('unknown');
    expect(resolveAssetTypeForLayout({ '7': 'server' }, 7)).toBe('server');
    expect(resolveAssetTypeForLayout({ '7': 'server' }, 7, registry)).toBe('server');
  });

  it("'excluded' never resolves even if someone seeds it into the registry set", () => {
    expect(resolveAssetTypeForLayout({ '7': 'excluded' }, 7, new Set(['excluded']))).toBe('unknown');
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

  it('T318: keeps slug-shaped strings (custom registry slugs) at storage time', () => {
    expect(normalizeAssetLayoutTypeMap({ '7': 'firewall_rules', '9': 'printer', '11': 'rack_ups_2' })).toEqual({
      '7': 'firewall_rules',
      '9': 'printer',
      '11': 'rack_ups_2',
    });
  });

  it("T318: coerces non-slug junk to 'unknown'", () => {
    expect(
      normalizeAssetLayoutTypeMap({
        '7': 'Main Frame!',
        '9': 'printer',
        '11': 42,
        '13': 'UPPERCASE',
        '15': '9starts_with_digit',
        '17': '_leading_underscore',
        '19': '',
        '21': null,
      })
    ).toEqual({
      '7': 'unknown',
      '9': 'printer',
      '11': 'unknown',
      '13': 'unknown',
      '15': 'unknown',
      '17': 'unknown',
      '19': 'unknown',
      '21': 'unknown',
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

describe("T257: 'excluded' assignment (F256)", () => {
  it("normalize keeps 'excluded' intact while junk values still coerce to 'unknown'", () => {
    expect(normalizeAssetLayoutTypeMap({ '7': 'excluded', '9': 'Main Frame!', '11': 'printer' })).toEqual({
      '7': 'excluded',
      '9': 'unknown',
      '11': 'printer',
    });
    expect(parseAssetLayoutTypeMap({ asset_layout_type_map: { '7': 'excluded' } })).toEqual({
      '7': 'excluded',
    });
  });

  it("isLayoutExcluded flags only 'excluded' entries — excluded is distinct from unknown", () => {
    const map = { '7': HUDU_LAYOUT_EXCLUDED, '9': 'unknown', '11': 'printer' } as const;
    expect(isLayoutExcluded(map, 7)).toBe(true);
    expect(isLayoutExcluded(map, '7')).toBe(true);
    expect(isLayoutExcluded(map, 9)).toBe(false);
    expect(isLayoutExcluded(map, 11)).toBe(false);
    expect(isLayoutExcluded(map, 999)).toBe(false);
    expect(isLayoutExcluded({}, 7)).toBe(false);
    expect(isLayoutExcluded(null, 7)).toBe(false);
    expect(isLayoutExcluded(undefined, 7)).toBe(false);
  });

  it("resolveAssetTypeForLayout never returns 'excluded' — an excluded layout resolves to 'unknown'", () => {
    const map = { '7': HUDU_LAYOUT_EXCLUDED, '9': 'printer' } as const;
    expect(resolveAssetTypeForLayout(map, 7)).toBe('unknown');
    expect(resolveAssetTypeForLayout(map, 9)).toBe('printer');
  });

  it("set/get round-trips 'excluded' through the actions and surfaces it as configuredType", async () => {
    const { setHuduAssetLayoutMap, getHuduAssetLayoutMap } = await importActions();

    const saved = await setHuduAssetLayoutMap({ '7': 'excluded', '9': 'printer' });
    expect(saved).toEqual({ success: true, data: { map: { '7': 'excluded', '9': 'printer' } } });
    expect(upsertHuduIntegrationMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      settings: { asset_layout_type_map: { '7': 'excluded', '9': 'printer' } },
    });

    getHuduIntegrationMock.mockResolvedValue({
      tenant: TENANT,
      settings: { asset_layout_type_map: { '7': 'excluded' } },
    });
    const result = await getHuduAssetLayoutMap();
    expect(result).toMatchObject({
      success: true,
      data: {
        layouts: [
          { id: 7, name: 'Computer Assets', suggestedType: 'workstation', configuredType: 'excluded' },
          { id: 9, name: 'Printers', suggestedType: 'printer', configuredType: null },
        ],
        map: { '7': 'excluded' },
      },
    });
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
        types: REGISTRY_TYPES,
      },
    });
  });

  it('T318: the payload carries the tenant registry types (slug/name/is_builtin only)', async () => {
    const { getHuduAssetLayoutMap } = await importActions();

    const result = await getHuduAssetLayoutMap();

    expect(listAssetTypesMock).toHaveBeenCalledWith(knexCallableMock, TENANT);
    expect(result).toMatchObject({ success: true, data: { types: REGISTRY_TYPES } });
    // Customs are offered alongside built-ins.
    const types = (result as { data: { types: typeof REGISTRY_TYPES } }).data.types;
    expect(types).toContainEqual({ slug: 'firewall_rules', name: 'Firewall Rules', is_builtin: false });
    // The projection never leaks registry internals like fields_schema.
    expect(Object.keys(types[0]).sort()).toEqual(['is_builtin', 'name', 'slug']);
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

  it("T318: persists slug-shaped custom assignments and coerces junk to 'unknown'", async () => {
    const { setHuduAssetLayoutMap } = await importActions();

    const result = await setHuduAssetLayoutMap({ '7': 'Main Frame!', '9': 'firewall_rules' } as never);

    expect(result).toEqual({
      success: true,
      data: { map: { '7': 'unknown', '9': 'firewall_rules' } },
    });
    expect(upsertHuduIntegrationMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      settings: { asset_layout_type_map: { '7': 'unknown', '9': 'firewall_rules' } },
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
});

// ============================================================================
// T319 — createAssetTypeFromHuduLayout (F316)
// ============================================================================

describe('T319: createAssetTypeFromHuduLayout', () => {
  // Deliberately out of position order; covers every verified Hudu kind plus
  // an unknown one, required null/true/false, and messy ListSelect options.
  const LAYOUT_FIELDS = [
    { label: 'Notes', field_type: 'RichText', required: null, position: 3 },
    { label: 'Hostname', field_type: 'Text', required: true, position: 1 },
    { label: 'Port Count', field_type: 'Number', required: true, position: 2 },
    { label: 'Environment', field_type: 'ListSelect', required: null, position: 4, options: 'Prod\nStaging, Dev\n, ,Prod' },
    { label: 'Monitored?', field_type: 'CheckBox', required: null, position: 5 },
    { label: 'Portal URL', field_type: 'Website', required: null, position: 6 },
    { label: 'Renewal Date', field_type: 'Date', required: false, position: 7 },
    { label: 'Site Address', field_type: 'AddressData', required: null, position: 8 },
    { label: 'Embedded Thing', field_type: 'SomeFutureKind', required: null, position: 9 },
  ];

  const EXPECTED_SCHEMA = [
    { key: 'hostname', label: 'Hostname', kind: 'text', required: true },
    { key: 'port_count', label: 'Port Count', kind: 'number', required: true },
    { key: 'notes', label: 'Notes', kind: 'text' },
    { key: 'environment', label: 'Environment', kind: 'select', options: ['Prod', 'Staging', 'Dev'] },
    { key: 'monitored', label: 'Monitored?', kind: 'boolean' },
    { key: 'portal_url', label: 'Portal URL', kind: 'url' },
    { key: 'renewal_date', label: 'Renewal Date', kind: 'date' },
    { key: 'site_address', label: 'Site Address', kind: 'text' },
    { key: 'embedded_thing', label: 'Embedded Thing', kind: 'text' },
  ];

  it('maps the layout fields to a position-ordered fields_schema and creates the type', async () => {
    getAssetLayoutMock.mockResolvedValue({ id: 7, name: 'Firewall Devices', fields: LAYOUT_FIELDS });
    const { createAssetTypeFromHuduLayout } = await importActions();

    const result = await createAssetTypeFromHuduLayout({ layoutId: 7 });

    expect(getAssetLayoutMock).toHaveBeenCalledWith(7);
    expect(createAssetTypeMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      name: 'Firewall Devices',
      fields_schema: EXPECTED_SCHEMA,
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        type: { slug: 'firewall_devices', name: 'Firewall Devices', is_builtin: false },
      },
    });
    expect((result as { data: { type: { fields_schema: unknown } } }).data.type.fields_schema).toEqual(
      EXPECTED_SCHEMA
    );
  });

  it('persists the layoutId→new-slug assignment without clobbering sibling settings or other layouts', async () => {
    getHuduIntegrationMock.mockResolvedValue({
      tenant: TENANT,
      settings: { password_access: true, asset_layout_type_map: { '9': 'printer', '11': 'excluded' } },
    });
    getAssetLayoutMock.mockResolvedValue({ id: 7, name: 'Firewall Devices', fields: LAYOUT_FIELDS });
    const { createAssetTypeFromHuduLayout } = await importActions();

    const result = await createAssetTypeFromHuduLayout({ layoutId: 7 });

    expect(upsertHuduIntegrationMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      settings: {
        password_access: true,
        asset_layout_type_map: { '7': 'firewall_devices', '9': 'printer', '11': 'excluded' },
      },
    });
    expect(result).toMatchObject({
      success: true,
      data: { map: { '7': 'firewall_devices', '9': 'printer', '11': 'excluded' } },
    });
  });

  it('a ListSelect whose options parse empty falls back to a text field', async () => {
    getAssetLayoutMock.mockResolvedValue({
      id: 7,
      name: 'Choice Things',
      fields: [{ label: 'Choices', field_type: 'ListSelect', required: null, position: 1, options: ' ,\n , ' }],
    });
    const { createAssetTypeFromHuduLayout } = await importActions();

    await createAssetTypeFromHuduLayout({ layoutId: 7 });

    expect(createAssetTypeMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      name: 'Choice Things',
      fields_schema: [{ key: 'choices', label: 'Choices', kind: 'text' }],
    });
  });

  it('duplicate derived keys get numeric suffixes; blank labels are dropped', async () => {
    getAssetLayoutMock.mockResolvedValue({
      id: 7,
      name: 'Dup Layout',
      fields: [
        { label: 'Serial #', field_type: 'Text', required: null, position: 1 },
        { label: 'Serial!', field_type: 'Text', required: null, position: 2 },
        { label: '   ', field_type: 'Text', required: null, position: 3 },
        { label: 'Serial', field_type: 'Text', required: null, position: 4 },
      ],
    });
    const { createAssetTypeFromHuduLayout } = await importActions();

    await createAssetTypeFromHuduLayout({ layoutId: 7 });

    expect(createAssetTypeMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      name: 'Dup Layout',
      fields_schema: [
        { key: 'serial', label: 'Serial #', kind: 'text' },
        { key: 'serial_2', label: 'Serial!', kind: 'text' },
        { key: 'serial_3', label: 'Serial', kind: 'text' },
      ],
    });
  });

  it('a slug conflict surfaces typed and never writes an assignment', async () => {
    createAssetTypeMock.mockResolvedValue({
      ok: false,
      error: { code: 'slug_conflict', slug: 'computer_assets' },
    });
    const { createAssetTypeFromHuduLayout } = await importActions();

    const result = await createAssetTypeFromHuduLayout({ layoutId: 7 });

    expect(result).toEqual({
      success: false,
      error: 'An asset type already exists for slug "computer_assets".',
      code: 'slug_conflict',
      slug: 'computer_assets',
    });
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('a reserved slug (layout named like a built-in) surfaces typed too', async () => {
    createAssetTypeMock.mockResolvedValue({
      ok: false,
      error: { code: 'reserved_slug', slug: 'server' },
    });
    const { createAssetTypeFromHuduLayout } = await importActions();

    const result = await createAssetTypeFromHuduLayout({ layoutId: 7 });

    expect(result).toMatchObject({ success: false, code: 'reserved_slug', slug: 'server' });
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('a failed Hudu layout fetch returns a failure envelope without creating anything', async () => {
    getAssetLayoutMock.mockRejectedValue(new Error('Hudu resource not found (404). Verify the base URL or id.'));
    const { createAssetTypeFromHuduLayout } = await importActions();

    const result = await createAssetTypeFromHuduLayout({ layoutId: 999 });

    expect(result).toEqual({
      success: false,
      error: 'Hudu resource not found (404). Verify the base URL or id.',
    });
    expect(createAssetTypeMock).not.toHaveBeenCalled();
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('rejects a missing layoutId with a failure envelope (no fetch, no write)', async () => {
    const { createAssetTypeFromHuduLayout } = await importActions();

    expect(await createAssetTypeFromHuduLayout({} as never)).toEqual({
      success: false,
      error: 'layoutId is required.',
    });
    expect(getAssetLayoutMock).not.toHaveBeenCalled();
    expect(createAssetTypeMock).not.toHaveBeenCalled();
  });

  it('is update-gated like setHuduAssetLayoutMap', async () => {
    hasPermissionMock.mockImplementation(
      async (_user: unknown, _resource: unknown, permission: string) => permission !== 'update'
    );
    const { createAssetTypeFromHuduLayout } = await importActions();

    await expect(createAssetTypeFromHuduLayout({ layoutId: 7 })).rejects.toThrow(
      /insufficient permissions \(update\)/
    );
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'update');
    expect(getAssetLayoutMock).not.toHaveBeenCalled();
    expect(createAssetTypeMock).not.toHaveBeenCalled();
  });
});
