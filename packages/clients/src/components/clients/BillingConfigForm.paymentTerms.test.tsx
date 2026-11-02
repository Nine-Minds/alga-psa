/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getTenantDefaultPaymentTerms = vi.fn();

vi.mock('../../actions/clientBillingProfileActions', () => ({
  getTenantDefaultPaymentTerms: (...args: unknown[]) => getTenantDefaultPaymentTerms(...(args as [])),
}));

vi.mock('../../lib/billingHelpers', () => ({
  getInvoiceTemplatesAsync: async () => [],
  getDefaultTemplateAsync: async () => null,
  getActiveTaxRegionsAsync: async () => [],
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; value?: string }) =>
      (opts?.defaultValue ?? key).replace('{{value}}', opts?.value ?? ''),
  }),
}));

vi.mock('@radix-ui/themes', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('../contacts/QuickAddContact', () => ({ default: () => null }));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select data-testid={id ?? 'select'} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: { value: string; label: unknown }, index: number) => (
        <option key={`${option.value}-${index}`} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  ),
}));

import BillingConfigForm from './BillingConfigForm';

const baseConfig = {
  payment_terms: '',
  preferred_payment_method: '',
  invoice_delivery_method: '',
};

describe('BillingConfigForm payment terms', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows "Tenant default (Net 14)" for a client with no term and does not submit net_30', async () => {
    getTenantDefaultPaymentTerms.mockResolvedValue('net_14');
    const onChange = vi.fn();
    render(
      <BillingConfigForm
        billingConfig={baseConfig}
        handleSelectChange={(name) => (value) => onChange(name, value)}
        clientId="client-1"
        contacts={[]}
      />,
    );

    const select = screen.getByTestId('client-payment-terms-select') as HTMLSelectElement;
    await waitFor(() =>
      expect(Array.from(select.options).map((o) => o.textContent)).toContain('Tenant default (Net 14)'),
    );
    // The unset option is first and is the selected one.
    expect(select.options[0].value).toBe('');
    expect(select.options[0].textContent).toBe('Tenant default (Net 14)');
    expect(select.value).toBe('');
    // Rendering alone submits nothing, and certainly not 'net_30'.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports "" when the tenant-default option is chosen, never the resolved term', async () => {
    getTenantDefaultPaymentTerms.mockResolvedValue('net_14');
    const onChange = vi.fn();
    render(
      <BillingConfigForm
        billingConfig={{ ...baseConfig, payment_terms: 'net_7' }}
        handleSelectChange={(name) => (value) => onChange(name, value)}
        clientId="client-1"
        contacts={[]}
      />,
    );
    const select = screen.getByTestId('client-payment-terms-select') as HTMLSelectElement;
    expect(select.value).toBe('net_7');
    await userEvent.selectOptions(select, '');
    expect(onChange).toHaveBeenCalledWith('payment_terms', '');
  });

  it('labels the option Net 30 when the tenant has no default or the lookup fails', async () => {
    getTenantDefaultPaymentTerms.mockResolvedValue({ permissionError: 'denied' });
    render(
      <BillingConfigForm
        billingConfig={baseConfig}
        handleSelectChange={() => () => undefined}
        clientId="client-1"
        contacts={[]}
      />,
    );
    await waitFor(() => expect(getTenantDefaultPaymentTerms).toHaveBeenCalled());
    const select = screen.getByTestId('client-payment-terms-select') as HTMLSelectElement;
    expect(select.options[0].textContent).toBe('Tenant default (Net 30)');
  });
});
