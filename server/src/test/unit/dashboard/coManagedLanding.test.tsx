import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ product: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }), mobile: vi.fn() }));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: mocks.product }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/dashboard/DashboardContainer', () => ({ default: () => null }));
vi.mock('@/components/dashboard/AlgaDeskDashboard', () => ({ default: () => null }));
vi.mock('@/lib/actions/dashboardMobileAppActions', () => ({ getDashboardMobileAppCardDismissedAction: mocks.mobile }));
vi.mock('@/lib/actions/algadeskDashboardActions', () => ({ getAlgaDeskDashboardSummary: vi.fn() }));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/dashboardWelcomeActions', () => ({ getDashboardWelcomeSettingsAction: vi.fn() }));
vi.mock('@alga-psa/licensing', () => ({ isSelfHostLicensing: vi.fn() }));
vi.mock('@alga-psa/onboarding/components', () => ({ DashboardOnboardingSkeleton: () => null, DashboardOnboardingSlot: () => null }));
vi.mock('@/lib/features', () => ({ isEnterprise: true }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: vi.fn() }));

import DashboardPage from '@/app/msp/dashboard/page';

it('sends a freshly signed-in co-managed customer to tickets before loading the PSA dashboard', async () => {
  mocks.product.mockResolvedValue('co_managed');
  await expect(DashboardPage()).rejects.toThrow('redirect:/msp/tickets');
  expect(mocks.mobile).not.toHaveBeenCalled();
});
