import { beforeEach, describe, expect, it, vi } from 'vitest';

const storedSettings = vi.hoisted(() => ({
  row: {
    settings: {
      branding: {
        logoUrl: 'https://cdn.example.test/logo.svg',
        primaryColor: '#123456',
        secondaryColor: '#654321',
        clientName: 'Example Client',
        supportEmail: 'help@example.test',
        storedCredential: 'should-not-leak',
      },
      clientPortal: { defaultLocale: 'en' },
      theme: { arbitrarySecret: 'should-not-leak' },
      sso: { privateKey: 'should-not-leak' },
      onboarding_data: { clientEmail: 'private@example.test' },
    },
  } as any,
}));

vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('../../server/tenantSettingsStore', () => ({
  readTenantPortalSettings: async () => ({
    branding: storedSettings.row.settings.branding,
    defaultLocale: storedSettings.row.settings.defaultLocale,
    clientPortalDefaultLocale: storedSettings.row.settings.clientPortal?.defaultLocale,
    theme: storedSettings.row.settings.theme,
  }),
}));
vi.mock('@alga-psa/db', () => ({
  buildTenantPortalSlug: (tenant: string) => tenant,
  getConnection: async () => ({}),
  getTenantIdBySlug: async () => 'tenant-a',
  tenantDb: () => ({
    table: () => ({ first: async () => storedSettings.row }),
    unscoped: () => ({ where: () => ({ andWhere: () => ({ first: async () => null }) }) }),
  }),
}));

import { getTenantPortalConfigBySlug } from './getTenantBrandingByDomain';
import { DEFAULT_CUSTOM_THEME } from '../../lib/customTheme';

describe('public tenant portal configuration', () => {
  beforeEach(() => {
    storedSettings.row = {
      settings: {
        branding: {
          logoUrl: 'https://cdn.example.test/logo.svg',
          primaryColor: '#123456',
          secondaryColor: '#654321',
          clientName: 'Example Client',
          supportEmail: 'help@example.test',
          storedCredential: 'should-not-leak',
        },
        clientPortal: { defaultLocale: 'en' },
        theme: { arbitrarySecret: 'should-not-leak' },
        sso: { privateKey: 'should-not-leak' },
        onboarding_data: { clientEmail: 'private@example.test' },
      },
    };
  });

  it('returns approved branding and locale fields only when settings contain unexpected secrets', async () => {
    const config = await getTenantPortalConfigBySlug('tenant-a');
    expect(config.branding).toMatchObject({
      logoUrl: 'https://cdn.example.test/logo.svg',
      primaryColor: '#123456',
      secondaryColor: '#654321',
      clientName: 'Example Client',
      supportEmail: 'help@example.test',
    });
    expect(config.branding).not.toHaveProperty('storedCredential');
    expect(config).not.toHaveProperty('sso');
    expect(config).not.toHaveProperty('onboarding_data');
    expect(config.theme).not.toHaveProperty('arbitrarySecret');
    expect(config.locale).toBe('en');
  });

  it('keeps a logo-only branding record visible to portal readers', async () => {
    storedSettings.row.settings.branding = {
      logoUrl: 'https://cdn.example.test/logo-only.svg',
      logoDarkUrl: 'https://cdn.example.test/logo-only-dark.svg',
      documentId: 'must-not-leak',
    };

    const config = await getTenantPortalConfigBySlug('tenant-a');

    expect(config.branding).toMatchObject({
      logoUrl: 'https://cdn.example.test/logo-only.svg',
      logoDarkUrl: 'https://cdn.example.test/logo-only-dark.svg',
    });
    expect(config.branding).not.toHaveProperty('documentId');
  });

  it('keeps a partial palette while excluding unknown branding properties', async () => {
    storedSettings.row.settings.branding = {
      primaryColor: '#123456',
      clientName: 'Partial Brand',
      privateCredential: 'must-not-leak',
    };

    const config = await getTenantPortalConfigBySlug('tenant-a');

    expect(config.branding).toMatchObject({ primaryColor: '#123456', clientName: 'Partial Brand' });
    expect(config.branding).not.toHaveProperty('secondaryColor');
    expect(config.branding).not.toHaveProperty('privateCredential');
  });

  it('projects valid Enterprise custom theme tokens and drops unexpected nested fields', async () => {
    storedSettings.row.settings.theme = {
      pairId: 'custom',
      customTheme: {
        light: { ...DEFAULT_CUSTOM_THEME.light, credential: 'nested-secret' },
        dark: { ...DEFAULT_CUSTOM_THEME.dark, privateKey: 'nested-secret' },
        computedStyles: '<style>private()</style>',
        credential: 'nested-secret',
      },
      privateKey: 'secret',
    };

    const config = await getTenantPortalConfigBySlug('tenant-a');

    expect(config.theme.pairId).toBe('custom');
    expect(config.theme.customTheme?.light).toMatchObject(DEFAULT_CUSTOM_THEME.light);
    expect(config.theme.customTheme?.dark).toMatchObject(DEFAULT_CUSTOM_THEME.dark);
    expect(config.theme.customTheme?.light).not.toHaveProperty('credential');
    expect(config.theme.customTheme?.dark).not.toHaveProperty('privateKey');
    expect(config.theme.customTheme).not.toHaveProperty('credential');
    expect(config.theme).not.toHaveProperty('privateKey');
    expect(config.theme.customTheme?.computedStyles).not.toContain('private()');
    expect(config.theme.customTheme?.computedStyles).toContain('html.dark[data-theme-pair="custom"]');
  });
});
