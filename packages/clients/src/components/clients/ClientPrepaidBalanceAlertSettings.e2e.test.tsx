/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let flagEnabled = true;
let flagLoading = false;
const flagMock = vi.fn((_flagKey: string, _opts?: { defaultValue?: boolean }) => ({
  enabled: flagEnabled,
  loading: flagLoading,
}));

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (flagKey: string, opts?: { defaultValue?: boolean }) => flagMock(flagKey, opts),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => null,
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), custom: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), custom: vi.fn() },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

const getTaxRatesMock = vi.fn(async (..._args: unknown[]) => []);
const setClientTemplateMock = vi.fn(async (..._args: unknown[]) => undefined);
const getContractLineSettingsMock = vi.fn(async (..._args: unknown[]) => null);
const updateContractLineSettingsMock = vi.fn(async (..._args: unknown[]) => ({ success: true }));

vi.mock('../../lib/billingHelpers', () => ({
  getTaxRatesAsync: (...args: unknown[]) => getTaxRatesMock(...args),
  setClientTemplateAsync: (...args: unknown[]) => setClientTemplateMock(...args),
  getClientContractLineSettingsAsync: (...args: unknown[]) => getContractLineSettingsMock(...args),
  updateClientContractLineSettingsAsync: (...args: unknown[]) => updateContractLineSettingsMock(...args),
  getPrepaidBalanceAlertSettingsAsync: (...args: unknown[]) => getPrepaidSettingsMock(...args),
  updatePrepaidBalanceAlertSettingsAsync: (...args: unknown[]) => updatePrepaidSettingsMock(...args),
  getPrepaidReplenishmentContractOverridesAsync: async () => [],
  updatePrepaidReplenishmentContractOverrideAsync: async () => ({ success: true }),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientTaxRates: async () => [],
  addClientTaxRate: async () => ({ success: true }),
  updateDefaultClientTaxRate: async () => ({ success: true }),
}));

const getPrepaidSettingsMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);
const updatePrepaidSettingsMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ success: true }));

vi.mock('@alga-psa/product-extension-actions', () => ({
  listAppMenuItemsForTenant: async () => [],
}));

vi.mock('@alga-psa/storage', () => ({
  StorageService: class {
    upload = async () => ({});
    delete = async () => {};
  },
}));

// Radix Tabs + React 19 dev triggers a compose-refs update loop in jsdom; the
// ordering/placement and save journey are what this suite asserts, so render
// the tab containers as plain divs.
vi.mock('@alga-psa/ui/components/Tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Contracts/tax tabs need providers this suite doesn't mount; the Billing >
// General journey is what matters here.
vi.mock('./ClientContractAssignment', () => ({
  default: () => null,
}));
vi.mock('./ClientTaxRates', () => ({
  default: () => null,
}));
vi.mock('./BillingConfigForm', () => ({
  default: () => null,
}));

import BillingConfiguration from './BillingConfiguration';

const client = {
  client_id: 'client-e2e',
  client_name: 'E2E Client',
  payment_terms: 'net_30',
  credit_limit: 0,
  preferred_payment_method: '',
  auto_invoice: false,
  invoice_delivery_method: '',
  invoice_template_id: '',
  billing_contact_id: '',
  billing_email: '',
  region_code: null,
  default_currency_code: 'USD',
  is_inactive: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('ClientPrepaidBalanceAlertSettings e2e journey (Billing > General)', () => {
  beforeEach(() => {
    flagEnabled = true;
    flagLoading = false;
    getPrepaidSettingsMock.mockReset();
    updatePrepaidSettingsMock.mockReset();
    getPrepaidSettingsMock.mockResolvedValue({
      prepaidCreditAlertThreshold: null,
      prepaidCreditAlertCurrencyCode: null,
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: false,
      defaultCurrencyCode: 'USD',
    });
    updatePrepaidSettingsMock.mockResolvedValue({ success: true });
  });

  it('renders the prepaid card after credit expiration and before external credit settings', async () => {
    render(<BillingConfiguration client={client as never} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Credit Expiration Settings')).toBeDefined());
    const prepaid = screen.getByText('Prepaid Balance Alerts');
    const external = screen.getByText('External Credit on File');
    const credit = screen.getByText('Credit Expiration Settings');

    expect(prepaid.compareDocumentPosition(external) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(credit.compareDocumentPosition(prepaid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it(
    'saves both alert types and the client opt-in without any immediate send',
    async () => {
      render(<BillingConfiguration client={client as never} onSave={vi.fn()} />);
      // Wait for the interactive card, not just the title: the title renders in
      // both the loading and loaded states, and a click before the settings load
      // settles races under slow CI runners.
      await screen.findByRole('switch', { name: /prepaid credit alerts/i });
      await userEvent.click(screen.getByRole('switch', { name: /prepaid credit alerts/i }));
      // Query the numeric inputs by placeholder rather than label: the server
      // unit suite globally mocks useAutomationIdAndRegister to return empty
      // automation props, which strips the `id` off @alga-psa/ui Input, so the
      // Label htmlFor association that getByLabelText relies on is absent there.
      await userEvent.type(screen.getByPlaceholderText('e.g. 500.00'), '250');
      await userEvent.click(screen.getByRole('switch', { name: /bucket usage alerts/i }));
      await userEvent.type(screen.getByPlaceholderText('e.g. 80'), '85');
      await userEvent.click(screen.getByRole('switch', { name: /client billing recipient/i }));
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() =>
        expect(updatePrepaidSettingsMock).toHaveBeenCalledWith({
          clientId: 'client-e2e',
          prepaidCreditAlertThreshold: 25000,
          prepaidCreditAlertCurrencyCode: 'USD',
          bucketUsageAlertPercent: 85,
          notifyClientOnPrepaidAlert: true,
        })
      );
      // No immediate send: the update action is the only side effect.
      expect(getContractLineSettingsMock).toHaveBeenCalled();
      expect(updateContractLineSettingsMock).not.toHaveBeenCalled();
      expect(getPrepaidSettingsMock).toHaveBeenCalledTimes(1);
    },
    15_000
  );

  it('is structurally absent while the feature flag is off', async () => {
    flagEnabled = false;
    flagLoading = false;
    render(<BillingConfiguration client={client as never} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Credit Expiration Settings')).toBeDefined());
    expect(screen.queryByText('Prepaid Balance Alerts')).toBeNull();
  });
});
