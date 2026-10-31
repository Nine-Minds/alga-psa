// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountManagement from '../../../components/settings/account/AccountManagement';
import { interpolate } from './spTestHarness';

const mocks = vi.hoisted(() => ({
  tier: { value: 'pro' as string },
  spUsage: vi.fn(),
  cancelSubscriptionAction: vi.fn(),
  checkAccountManagementPermission: vi.fn(),
  sendCancellationFeedbackAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@ee/lib/actions/license-actions', () => {
  const emptyResult = vi.fn(async () => ({ success: false }));

  return {
    cancelAddOnAction: emptyResult,
    cancelIapTransitionAction: emptyResult,
    cancelSubscriptionAction: mocks.cancelSubscriptionAction,
    confirmPremiumTrialAction: emptyResult,
    createCustomerPortalSessionAction: emptyResult,
    downgradeTierAction: emptyResult,
    getIapBillingContextAction: emptyResult,
    getIntervalSwitchPreviewAction: emptyResult,
    getLicensePricingAction: emptyResult,
    getLicenseUsageAction: emptyResult,
    getPaymentMethodInfoAction: emptyResult,
    getRecentInvoicesAction: emptyResult,
    getScheduledLicenseChangesAction: emptyResult,
    getSubscriptionInfoAction: emptyResult,
    getUpgradePreviewAction: emptyResult,
    purchaseAddOnAction: emptyResult,
    revertPremiumTrialAction: emptyResult,
    sendCancellationFeedbackAction: mocks.sendCancellationFeedbackAction,
    sendPremiumTrialRequestAction: emptyResult,
    startIapUpgradeAction: emptyResult,
    startSelfServicePremiumTrialAction: emptyResult,
    startSoloProTrialAction: emptyResult,
    switchBillingIntervalAction: emptyResult,
    upgradeTierAction: emptyResult,
  };
});

vi.mock('@ee/lib/actions/product-upgrade-actions', () => ({
  getProductUpgradeStatusAction: vi.fn(),
  previewProductUpgradeAction: vi.fn(),
  startProductUpgradeAction: vi.fn(),
}));

vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementPermission: mocks.checkAccountManagementPermission,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ update: vi.fn() }),
}));

vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({
    tier: mocks.tier.value,
    isMisconfigured: false,
    isSolo: false,
    isPro: true,
    isPremium: false,
    hasAddOn: () => false,
    refreshTier: vi.fn(),
    isTrialing: false,
    trialDaysLeft: 0,
    trialEndDate: null,
    isSoloProTrial: false,
    soloProTrialEndDate: null,
    soloProTrialDaysLeft: 0,
    isPaymentFailed: false,
    subscriptionStatus: 'active',
    isPremiumTrial: false,
    premiumTrialEndDate: null,
    premiumTrialDaysLeft: 0,
    isPremiumTrialConfirmed: false,
    premiumTrialEffectiveDate: null,
  }),
}));

vi.mock('server/src/context/ProductContext', () => ({
  useProduct: () => ({ isAlgaDesk: true }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => false }));
vi.mock('@alga-psa/ui/hooks/useAddOnEnumOptions', () => ({
  useFormatAddOnDescription: () => () => '',
}));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
vi.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckout: () => null,
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@ee/components/licensing/ReduceLicensesModal', () => ({ default: () => null }));
vi.mock('../../../components/settings/account/AiUsageSection', () => ({ default: () => null }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string } & Record<string, unknown>) =>
      options?.defaultValue ? interpolate(options.defaultValue, options) : key,
  }),
}));
vi.mock('../../../lib/actions/service-principal-actions', () => ({
  getServicePrincipalUsage: mocks.spUsage,
}));

vi.mock('react-hot-toast', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    children,
    footer,
    isOpen,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
    isOpen: boolean;
  }) => isOpen ? <div>{children}{footer}</div> : null,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ label, wrapperClassName: _wrapperClassName, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; wrapperClassName?: string }) => (
    <label>{label}<textarea {...props} /></label>
  ),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    label,
    options,
    onValueChange,
    allowClear: _allowClear,
    ...props
  }: {
    label: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    allowClear?: boolean;
  } & React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <label>
      {label}
      <select {...props} onChange={(event) => onValueChange(event.target.value)}>
        <option value="">Select a reason</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  ),
}));

describe('T032 / T036 AccountManagement service principal usage row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAccountManagementPermission.mockResolvedValue(true);
    mocks.spUsage.mockResolvedValue({ limit: 10, used: 3, remaining: 7 });
  });

  async function openLicenseDetails() {
    render(<AccountManagement />);
    const row = await screen.findByTestId('service-principal-usage-row');
    return row;
  }

  it('renders "N of M" on Pro', async () => {
    mocks.tier.value = 'pro';
    const row = await openLicenseDetails();
    await waitFor(() => expect(row.textContent).toContain('3 of 10'));
  });

  it('reads "Available on Pro" below Pro', async () => {
    mocks.tier.value = 'essentials';
    const row = await openLicenseDetails();
    expect(row.textContent).toContain('Available on Pro');
    expect(mocks.spUsage).not.toHaveBeenCalled();
  });
});
