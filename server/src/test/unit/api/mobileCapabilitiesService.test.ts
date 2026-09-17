import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTenantProduct: vi.fn(),
  hasPermission: vi.fn(),
  getTenantThemeByTenantId: vi.fn(),
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: mocks.getTenantProduct,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions', () => ({
  getTenantThemeByTenantId: mocks.getTenantThemeByTenantId,
}));

import { CUSTOM_THEME_PRESETS, CUSTOM_THEME_TOKEN_KEYS } from '@alga-psa/tenancy/lib/customTheme';
import { PREDEFINED_THEME_PAIR_IDS, getThemePairMeta } from '@alga-psa/tenancy/lib/themePairs';
import { MobileCapabilitiesService } from '../../../lib/api/services/MobileCapabilitiesService';

const db = {} as any;
const user = {
  user_id: 'user-1',
  user_type: 'internal' as const,
  tenant: 'tenant-1',
};
const context = {
  tenant: 'tenant-1',
  userId: 'user-1',
  user,
  db,
};

const customTokens = (overrides: Record<string, string> = {}) => ({
  ...CUSTOM_THEME_PRESETS.forest.light,
  primary: '#123456',
  ...overrides,
});

describe('MobileCapabilitiesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTenantProduct.mockResolvedValue('psa');
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getTenantThemeByTenantId.mockResolvedValue({ pairId: 'alga' });
  });

  it('T050 enables inventory and opportunities for a PSA user with both read permissions', async () => {
    const service = new MobileCapabilitiesService();

    const result = await service.getMyCapabilities(context);
    expect(result.features).toEqual({
      inventory: true,
      opportunities: true,
      opportunitiesCreate: true,
    });
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'inventory', 'read', db);
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'opportunities', 'read', db);
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'opportunities', 'create', db);
  });

  it('T050 disables both features for an AlgaDesk tenant regardless of RBAC', async () => {
    mocks.getTenantProduct.mockResolvedValue('algadesk');
    const service = new MobileCapabilitiesService();

    const result = await service.getMyCapabilities(context);
    expect(result.features).toEqual({
      inventory: false,
      opportunities: false,
      opportunitiesCreate: false,
    });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it.each([
    ['inventory', false, true],
    ['opportunities', true, false],
  ] as const)('T050 disables only %s when that read permission is missing', async (
    missingResource,
    expectedInventory,
    expectedOpportunities,
  ) => {
    mocks.hasPermission.mockImplementation(async (_user, resource) => resource !== missingResource);
    const service = new MobileCapabilitiesService();

    const result = await service.getMyCapabilities(context);
    expect(result.features).toEqual({
      inventory: expectedInventory,
      opportunities: expectedOpportunities,
      opportunitiesCreate: expectedOpportunities,
    });
  });

  it('exposes opportunity create permission separately from read access', async () => {
    mocks.hasPermission.mockImplementation(async (_user, resource, action) => (
      resource !== 'opportunities' || action !== 'create'
    ));
    const service = new MobileCapabilitiesService();

    const result = await service.getMyCapabilities(context);
    expect(result.features).toEqual({
      inventory: true,
      opportunities: true,
      opportunitiesCreate: false,
    });
  });

  describe('theme block', () => {
    it('T001 returns the Forest preset and label for a tenant on the forest pair', async () => {
      mocks.getTenantThemeByTenantId.mockResolvedValue({ pairId: 'forest' });
      const service = new MobileCapabilitiesService();

      const { theme } = await service.getMyCapabilities(context);
      expect(theme.pairId).toBe('forest');
      expect(theme.label).toBe('Forest');
      expect(theme.light).toEqual(CUSTOM_THEME_PRESETS.forest.light);
      expect(theme.dark).toEqual(CUSTOM_THEME_PRESETS.forest.dark);
    });

    it.each(PREDEFINED_THEME_PAIR_IDS)('T060 pins the %s pair to CUSTOM_THEME_PRESETS', async (pairId) => {
      mocks.getTenantThemeByTenantId.mockResolvedValue({ pairId });
      const service = new MobileCapabilitiesService();

      const { theme } = await service.getMyCapabilities(context);
      expect(theme.pairId).toBe(pairId);
      expect(theme.label).toBe(getThemePairMeta(pairId)?.label);
      expect(theme.light).toEqual(CUSTOM_THEME_PRESETS[pairId].light);
      expect(theme.dark).toEqual(CUSTOM_THEME_PRESETS[pairId].dark);
      expect(Object.keys(theme.light)).toEqual([...CUSTOM_THEME_TOKEN_KEYS]);
    });

    it('T002 falls back to the Alga pair when the tenant has no saved theme', async () => {
      mocks.getTenantThemeByTenantId.mockResolvedValue({ pairId: 'alga' });
      const service = new MobileCapabilitiesService();

      const { theme } = await service.getMyCapabilities(context);
      expect(theme.pairId).toBe('alga');
      expect(theme.label).toBe('Alga');
      expect(theme.light).toEqual(CUSTOM_THEME_PRESETS.alga.light);
    });

    it('T003 returns the saved custom tokens for a custom pair', async () => {
      const light = customTokens();
      const dark = customTokens({ background: '#010203' });
      mocks.getTenantThemeByTenantId.mockResolvedValue({
        pairId: 'custom',
        customTheme: { light, dark },
      });
      const service = new MobileCapabilitiesService();

      const { theme } = await service.getMyCapabilities(context);
      expect(theme.pairId).toBe('custom');
      expect(theme.label).toBe('Custom');
      expect(theme.light).toEqual(light);
      expect(theme.dark).toEqual(dark);
    });

    it('T004 falls back to Alga when a custom token is not a valid hex', async () => {
      mocks.getTenantThemeByTenantId.mockResolvedValue({
        pairId: 'custom',
        customTheme: { light: customTokens({ border: 'rebeccapurple' }), dark: customTokens() },
      });
      const service = new MobileCapabilitiesService();

      const { theme } = await service.getMyCapabilities(context);
      expect(theme.pairId).toBe('alga');
      expect(theme.light).toEqual(CUSTOM_THEME_PRESETS.alga.light);
    });

    it('T005 keeps the version stable for unchanged tokens and changes it on edit', async () => {
      const service = new MobileCapabilitiesService();
      mocks.getTenantThemeByTenantId.mockResolvedValue({ pairId: 'vice' });

      const first = await service.getMyCapabilities(context);
      const second = await service.getMyCapabilities(context);
      expect(first.theme.version).toBe(second.theme.version);

      mocks.getTenantThemeByTenantId.mockResolvedValue({
        pairId: 'custom',
        customTheme: { light: customTokens(), dark: customTokens() },
      });
      const custom = await service.getMyCapabilities(context);
      mocks.getTenantThemeByTenantId.mockResolvedValue({
        pairId: 'custom',
        customTheme: { light: customTokens({ primary: '#123457' }), dark: customTokens() },
      });
      const edited = await service.getMyCapabilities(context);
      expect(edited.theme.version).not.toBe(custom.theme.version);
    });

    it('T006 leaves the features block untouched when the theme is added', async () => {
      mocks.getTenantThemeByTenantId.mockResolvedValue({ pairId: 'sunset' });
      const service = new MobileCapabilitiesService();

      const result = await service.getMyCapabilities(context);
      expect(Object.keys(result).sort()).toEqual(['features', 'theme']);
      expect(result.features).toEqual({
        inventory: true,
        opportunities: true,
        opportunitiesCreate: true,
      });
    });

    it('T008 still answers with features and the Alga pair when the theme lookup throws', async () => {
      mocks.getTenantThemeByTenantId.mockRejectedValue(new Error('tenant_settings unreachable'));
      const service = new MobileCapabilitiesService();

      const result = await service.getMyCapabilities(context);
      expect(result.features.inventory).toBe(true);
      expect(result.theme.pairId).toBe('alga');
      expect(result.theme.light).toEqual(CUSTOM_THEME_PRESETS.alga.light);
    });
  });
});
