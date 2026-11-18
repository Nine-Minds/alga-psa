import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The MSP layout only sends an administrator to workspace setup: the gate is
// needsOnboarding && getWorkspaceSetupAccess().canRun, passed to the client shell.

const mocks = vi.hoisted(() => ({
  canRun: true as boolean | 'throw',
  onboardingCompleted: false,
  session: { user: { user_type: 'internal', tenant: 'tenant-1' } } as { user: { user_type: string; tenant: string } } | null,
  // Like Next's redirect, it never returns: the layout stops where it is called.
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
  productCode: 'psa' as string,
  surfaceKind: undefined as string | undefined,
  getCoManagedWorkspaceState: vi.fn(async (): Promise<any> => ({ kind: 'none' })),
  getDontNotifyCustomerDefault: vi.fn(async (): Promise<boolean> => false),
}));

vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(), cache: (fn: unknown) => fn }));
vi.mock('next/headers.js', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(async () => null),
  getSessionWithRevocationCheck: vi.fn(async () => mocks.session),
}));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  getTenantSettings: vi.fn(async () => ({ onboarding_completed: mocks.onboardingCompleted, onboarding_skipped: false })),
}));
vi.mock('@alga-psa/onboarding/actions/onboarding-actions/onboardingActions', () => ({
  getWorkspaceSetupAccess: vi.fn(async () => {
    if (mocks.canRun === 'throw') throw new Error('boom');
    return { canRun: mocks.canRun };
  }),
}));
vi.mock('@alga-psa/tenancy/actions/locale-actions/getHierarchicalLocale', () => ({ getHierarchicalLocaleAction: vi.fn(async () => 'en') }));
vi.mock('server/src/app/msp/MspLayoutClient', () => ({ MspLayoutClient: () => null }));
vi.mock('@alga-psa/scheduling/context/TimeEntryModeContext', () => ({ TimeEntryModeProvider: () => null }));
vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: vi.fn(async () => mocks.productCode),
  getCurrentProductPrincipal: vi.fn(async () => ({ productCode: mocks.productCode, surfaceKind: mocks.surfaceKind })),
}));
vi.mock('@/lib/actions/coManagedWorkspaceActions', () => ({ getCoManagedWorkspaceState: mocks.getCoManagedWorkspaceState }));
vi.mock('@alga-psa/billing/actions/billingCurrencyActions', () => ({ getTenantDefaultCurrencyCode: vi.fn(async () => 'USD') }));
vi.mock('@alga-psa/clients/actions/countryActions', () => ({ getDateFormatPreference: vi.fn(async () => 'ymd') }));
vi.mock('@alga-psa/core/i18n/countryDateFormat', () => ({ SYSTEM_DATE_FORMAT: 'ymd' }));
vi.mock('@/lib/i18n/preloadLocaleResources', () => ({ preloadLocaleResources: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({ isSelfHostLicensing: vi.fn(async () => false) }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain', () => ({ getTenantBrandingByTenantId: vi.fn() }));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions', () => ({ getTenantThemeByTenantId: vi.fn() }));
vi.mock('@/components/layout/mspBranding', () => ({ resolveMspBranding: vi.fn(() => ({})) }));
vi.mock('@alga-psa/notifications/actions/notification-actions/notificationActions', () => ({
  getDontNotifyCustomerDefaultAction: mocks.getDontNotifyCustomerDefault,
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: vi.fn(async () => ({ t: (_k: string, o?: any) => o?.defaultValue })) }));

const { default: MspLayout } = await import('../../../../../app/msp/layout');

const { MspLayoutClient } = await import('server/src/app/msp/MspLayoutClient');
const { TimeEntryModeProvider } = await import('@alga-psa/scheduling/context/TimeEntryModeContext');

// Walks the rendered tree (without rendering it) to the first element of the given component type.
function findElement(node: any, type: unknown): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (node.type === type) return node;
  return findElement(node.props?.children, type);
}

async function renderLayout() {
  return MspLayout({ children: null, modal: null });
}

async function layoutProps() {
  const shell = findElement(await renderLayout(), MspLayoutClient);
  if (!shell) throw new Error('MspLayoutClient was not rendered');
  return shell.props as { needsOnboarding: boolean; canRunOnboarding: boolean; workspaceNotice: unknown };
}

async function timeEntryMode() {
  const provider = findElement(await renderLayout(), TimeEntryModeProvider);
  if (!provider) throw new Error('TimeEntryModeProvider was not rendered');
  expect(findElement(provider.props.children, MspLayoutClient)).not.toBeNull();
  return provider.props.mode as string;
}

beforeEach(() => {
  mocks.canRun = true;
  mocks.onboardingCompleted = false;
  mocks.session = { user: { user_type: 'internal', tenant: 'tenant-1' } };
  mocks.redirect.mockClear();
  mocks.productCode = 'psa';
  mocks.surfaceKind = undefined;
  mocks.getCoManagedWorkspaceState.mockReset();
  mocks.getCoManagedWorkspaceState.mockResolvedValue({ kind: 'none' });
  mocks.getDontNotifyCustomerDefault.mockReset();
  mocks.getDontNotifyCustomerDefault.mockResolvedValue(false);
});

describe('MSP layout sign-in redirects', () => {
  it('sends a request without a session to MSP sign-in', async () => {
    mocks.session = null;
    await expect(layoutProps()).rejects.toThrow('NEXT_REDIRECT /auth/msp/signin');
    expect(mocks.redirect).toHaveBeenCalledWith('/auth/msp/signin');
  });

  it('sends a client-portal session to MSP sign-in instead of rendering the MSP shell', async () => {
    mocks.session = { user: { user_type: 'client', tenant: 'tenant-1' } };
    await expect(layoutProps()).rejects.toThrow('NEXT_REDIRECT /auth/msp/signin');
    expect(mocks.redirect).toHaveBeenCalledWith('/auth/msp/signin');
  });

  it('renders the shell for an internal session without redirecting', async () => {
    await layoutProps();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
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

describe('MSP layout co-managed workspace notice', () => {
  it('never reads relationship state outside a customer workspace', async () => {
    expect(await layoutProps()).toMatchObject({ workspaceNotice: null });
    expect(mocks.getCoManagedWorkspaceState).not.toHaveBeenCalled();
  });

  it('shows an ended notice in a customer workspace whose relationship ended', async () => {
    mocks.productCode = 'co_managed';
    mocks.getCoManagedWorkspaceState.mockResolvedValue({ kind: 'ended', endedAt: '2026-10-01T00:00:00Z', sponsorName: 'Acme MSP' });
    expect(await layoutProps()).toMatchObject({
      workspaceNotice: { kind: 'ended', endedAt: '2026-10-01T00:00:00Z', sponsorName: 'Acme MSP' },
    });
  });

  it('renders the shell without a notice when the relationship read fails', async () => {
    mocks.productCode = 'co_managed';
    mocks.getCoManagedWorkspaceState.mockRejectedValue(new Error('gated'));
    expect(await layoutProps()).toMatchObject({ workspaceNotice: null });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('MSP layout notification defaults', () => {
  it('hands the tenant dont-notify-customer policy to the shell', async () => {
    mocks.getDontNotifyCustomerDefault.mockResolvedValue(true);
    expect(await layoutProps()).toMatchObject({ dontNotifyCustomerDefault: true });
  });

  it('falls back to unticked when the policy read fails', async () => {
    mocks.getDontNotifyCustomerDefault.mockRejectedValue(new Error('denied'));
    expect(await layoutProps()).toMatchObject({ dontNotifyCustomerDefault: false });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('MSP layout time-entry mode', () => {
  it('wraps the shell in commercial mode for an ordinary MSP user', async () => {
    expect(await timeEntryMode()).toBe('commercial');
  });

  it('wraps the shell in operational mode for a co-managed seat technician', async () => {
    mocks.productCode = 'co_managed';
    mocks.surfaceKind = 'co_managed_seat';
    expect(await timeEntryMode()).toBe('operational');
  });

  it('keeps commercial mode for any other surface kind', async () => {
    mocks.surfaceKind = 'some_other_surface';
    expect(await timeEntryMode()).toBe('commercial');
  });
});
