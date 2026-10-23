/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDefaultBillingSettingsMock = vi.hoisted(() => vi.fn());
const updateDefaultBillingSettingsMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const handleErrorMock = vi.hoisted(() => vi.fn());

const tMock = vi.hoisted(() => (
  (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
    let value = options?.defaultValue ?? _key;
    for (const [token, replacement] of Object.entries(options ?? {})) {
      if (token !== 'defaultValue') {
        value = value.split(`{{${token}}}`).join(String(replacement));
      }
    }
    return value;
  }
));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: tMock }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: (...args: unknown[]) => handleErrorMock(...args),
  isActionPermissionError: (value: unknown) => Boolean(value && (value as any).permissionError),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: toastSuccessMock },
}));

vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({
  default: ({ id, value, onValueChange }: any) =>
    React.createElement(
      'select',
      { id, value: value ?? '', onChange: (event: any) => onValueChange(event.target.value) },
      React.createElement('option', { key: 'USD', value: 'USD' }, 'USD'),
      React.createElement('option', { key: 'AUD', value: 'AUD' }, 'AUD'),
    ),
}));

vi.mock('../src/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => getDefaultBillingSettingsMock(...args),
  updateDefaultBillingSettings: (...args: unknown[]) => updateDefaultBillingSettingsMock(...args),
}));

import DefaultCurrencySettings from '../src/components/settings/billing/DefaultCurrencySettings';

describe('DefaultCurrencySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDefaultBillingSettingsMock.mockResolvedValue({
      zeroDollarInvoiceHandling: 'normal',
      suppressZeroDollarInvoices: false,
      defaultCurrencyCode: 'USD',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('explains the client propagation rule near the picker', async () => {
    render(<DefaultCurrencySettings />);

    const note = await screen.findByText(/updates clients currently using the previous default currency/i);
    expect(note).toBeTruthy();
    expect(note.textContent).toMatch(/Clients with a different currency are preserved/i);
  });

  it('reports propagated and preserved client counts after a currency change', async () => {
    updateDefaultBillingSettingsMock.mockResolvedValue({
      success: true,
      previousCurrencyCode: 'USD',
      currencyCode: 'AUD',
      propagatedClientCount: 18,
      preservedClientCount: 3,
    });

    render(<DefaultCurrencySettings />);
    await waitFor(() => expect(getDefaultBillingSettingsMock).toHaveBeenCalled());

    fireEvent.change(document.getElementById('default-currency-code') as HTMLSelectElement, {
      target: { value: 'AUD' },
    });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Default currency changed to AUD. 18 client defaults updated; 3 client overrides preserved.'
    );
  });

  it('uses the generic success message when no propagation counts are returned', async () => {
    updateDefaultBillingSettingsMock.mockResolvedValue({ success: true, previousCurrencyCode: 'USD', currencyCode: 'USD' });

    render(<DefaultCurrencySettings />);
    await waitFor(() => expect(getDefaultBillingSettingsMock).toHaveBeenCalled());

    fireEvent.change(document.getElementById('default-currency-code') as HTMLSelectElement, {
      target: { value: 'AUD' },
    });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Default currency has been updated.'));
  });
});
