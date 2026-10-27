import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The MSP layout only sends an administrator to workspace setup: the gate is
// needsOnboarding && getWorkspaceSetupAccess().canRun, passed to the client shell.

const mocks = vi.hoisted(() => ({
  canRun: true as boolean | 'throw',
  onboardingCompleted: false,
  redirect: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(), cache: (fn: unknown) => fn }));
vi.mock('next/headers.js', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(),
  getSessionWithRevocationCheck: vi.fn(async () => ({ user: { user_type: 'internal', tenant: 'tenant-1' } })),
}));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  getTenantSettings: vi.fn(async () => ({ onboarding_completed: mocks.onboardingCompleted, onboarding_skipped: false })),
}));
vi.mock('@alga-psa/onboarding/actions', () => ({
  getWorkspaceSetupAccess: vi.fn(async () => {
    if (mocks.canRun === 'throw') throw new Error('boom');
    return { canRun: mocks.canRun };
  }),
}));
vi.mock('@alga-psa/tenancy/actions/locale-actions/getHierarchicalLocale', () => ({ getHierarchicalLocaleAction: vi.fn(async () => 'en') }));
vi.mock('server/src/app/msp/MspLayoutClient', () => ({ MspLayoutClient: () => null }));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: vi.fn(async () => 'psa') }));
vi.mock('@alga-psa/billing/actions/billingCurrencyActions', () => ({ getTenantDefaultCurrencyCode: vi.fn(async () => 'USD') }));
vi.mock('@alga-psa/clients/actions/countryActions', () => ({ getDateFormatPreference: vi.fn(async () => 'ymd') }));
vi.mock('@alga-psa/core/i18n/countryDateFormat', () => ({ SYSTEM_DATE_FORMAT: 'ymd' }));
vi.mock('@/lib/i18n/preloadLocaleResources', () => ({ preloadLocaleResources: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({ isSelfHostLicensing: vi.fn(async () => false) }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain', () => ({ getTenantBrandingByTenantId: vi.fn() }));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions', () => ({ getTenantThemeByTenantId: vi.fn() }));
vi.mock('@/components/layout/mspBranding', () => ({ resolveMspBranding: vi.fn(() => ({})) }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: vi.fn(async () => ({ t: (_k: string, o?: any) => o?.defaultValue })) }));

const { default: MspLayout } = await import('../../../../../app/msp/layout');

async function layoutProps() {
  const element: any = await MspLayout({ children: null, modal: null });
  return element.props as { needsOnboarding: boolean; canRunOnboarding: boolean };
}

beforeEach(() => {
  mocks.canRun = true;
  mocks.onboardingCompleted = false;
  mocks.redirect.mockReset();
});

describe('MSP layout onboarding gate', () => {
  it('sends an administrator of an unfinished tenant to setup', async () => {
    expect(await layoutProps()).toMatchObject({ needsOnboarding: true, canRunOnboarding: true });
  });

  it('never forces setup on a user who cannot run it', async () => {
    mocks.canRun = false;
    expect(await layoutProps()).toMatchObject({ needsOnboarding: false, canRunOnboarding: false });
  });

  it('treats a failed access lookup as no access', async () => {
    mocks.canRun = 'throw';
    expect(await layoutProps()).toMatchObject({ needsOnboarding: false, canRunOnboarding: false });
  });

  it('does not force setup on a finished tenant, even for an administrator', async () => {
    mocks.onboardingCompleted = true;
    expect(await layoutProps()).toMatchObject({ needsOnboarding: false, canRunOnboarding: true });
  });
});
