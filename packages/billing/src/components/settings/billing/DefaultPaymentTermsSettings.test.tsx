/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getDefaultBillingSettings = vi.fn();
const updateDefaultBillingSettings = vi.fn();
const handleError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../../../actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => getDefaultBillingSettings(...(args as [])),
  updateDefaultBillingSettings: (...args: unknown[]) => updateDefaultBillingSettings(...(args as [])),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: (...args: unknown[]) => handleError(...args),
  getErrorMessage: () => 'error',
  isActionPermissionError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'permissionError' in value,
  isActionMessageError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'actionError' in value,
}));

vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() },
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange, disabled }: any) => (
    <select data-testid={id} value={value} disabled={!!disabled} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

import DefaultPaymentTermsSettings from './DefaultPaymentTermsSettings';

describe('DefaultPaymentTermsSettings', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows Net 30 when the tenant has no default', async () => {
    getDefaultBillingSettings.mockResolvedValue({ defaultPaymentTerms: null });
    render(<DefaultPaymentTermsSettings />);
    await waitFor(() => expect(getDefaultBillingSettings).toHaveBeenCalled());
    expect((screen.getByTestId('default-payment-terms-select') as HTMLSelectElement).value).toBe('net_30');
  });

  it('ignores a load that resolves after unmount', async () => {
    let resolveLoad!: (value: unknown) => void;
    getDefaultBillingSettings.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    const { unmount } = render(<DefaultPaymentTermsSettings />);
    await waitFor(() => expect(getDefaultBillingSettings).toHaveBeenCalled());
    unmount();

    resolveLoad({ permissionError: 'denied' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleError).not.toHaveBeenCalled();
  });

  it('ignores a load that rejects after unmount', async () => {
    let rejectLoad!: (reason: unknown) => void;
    getDefaultBillingSettings.mockReturnValue(new Promise((_, reject) => { rejectLoad = reject; }));
    const { unmount } = render(<DefaultPaymentTermsSettings />);
    await waitFor(() => expect(getDefaultBillingSettings).toHaveBeenCalled());
    unmount();

    rejectLoad(new Error('late failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleError).not.toHaveBeenCalled();
  });

  it('saves only defaultPaymentTerms', async () => {
    getDefaultBillingSettings.mockResolvedValue({ defaultPaymentTerms: 'net_7', defaultCurrencyCode: 'USD' });
    updateDefaultBillingSettings.mockResolvedValue({ success: true });
    render(<DefaultPaymentTermsSettings />);
    await waitFor(() =>
      expect((screen.getByTestId('default-payment-terms-select') as HTMLSelectElement).value).toBe('net_7'),
    );

    await userEvent.selectOptions(screen.getByTestId('default-payment-terms-select'), 'net_14');
    await userEvent.click(document.querySelector('[data-automation-id="save-default-payment-terms"]') as HTMLElement);

    await waitFor(() => expect(updateDefaultBillingSettings).toHaveBeenCalledTimes(1));
    expect(updateDefaultBillingSettings).toHaveBeenCalledWith({ defaultPaymentTerms: 'net_14' });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('reports an action error without a success toast', async () => {
    getDefaultBillingSettings.mockResolvedValue({ defaultPaymentTerms: null });
    updateDefaultBillingSettings.mockResolvedValue({ actionError: 'invalid' });
    render(<DefaultPaymentTermsSettings />);
    await waitFor(() => expect(getDefaultBillingSettings).toHaveBeenCalled());
    await userEvent.click(document.querySelector('[data-automation-id="save-default-payment-terms"]') as HTMLElement);
    await waitFor(() => expect(handleError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
