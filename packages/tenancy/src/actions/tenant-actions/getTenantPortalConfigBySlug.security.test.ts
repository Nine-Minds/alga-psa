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
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
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
});
