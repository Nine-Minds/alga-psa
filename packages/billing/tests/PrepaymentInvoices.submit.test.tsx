/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { createPrepaymentInvoice, getClientByIdForBilling } = vi.hoisted(() => ({ createPrepaymentInvoice: vi.fn(), getClientByIdForBilling: vi.fn() }));

vi.mock('@alga-psa/billing/actions/creditActions', () => ({ createPrepaymentInvoice }));
vi.mock('../src/actions/billingClientsActions', () => ({ getClientByIdForBilling }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key, i18n: { language: 'ja-JP' } }),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ onSelect }: { onSelect: (id: string) => void }) => <button type="button" onClick={() => onSelect('client-jpy')}>Choose client</button>,
}));
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({
  CurrencyInput: ({ onChange }: { onChange: (value: number) => void }) => <input aria-label="Amount" onChange={(event) => onChange(Number(event.target.value))} />,
}));

import PrepaymentInvoices from '../src/components/billing-dashboard/PrepaymentInvoices';

describe('PrepaymentInvoices submission', () => {
  beforeEach(() => {
    createPrepaymentInvoice.mockReset();
    createPrepaymentInvoice.mockResolvedValue({ invoice_id: 'invoice-1' });
    getClientByIdForBilling.mockResolvedValue({ client_id: 'client-jpy', client_name: 'JPY client', default_currency_code: 'JPY' });
  });

  it('converts the selected currency major units to minor units before submitting', async () => {
    render(<PrepaymentInvoices onGenerateSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose client' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    const generate = screen.getByRole('button', { name: 'Generate Prepayment Invoice' }) as HTMLButtonElement;
    // Generating waits for the by-id client lookup that supplies the currency.
    await waitFor(() => expect(generate.disabled).toBe(false));
    fireEvent.click(generate);

    await waitFor(() => expect(createPrepaymentInvoice).toHaveBeenCalledWith('client-jpy', 500, undefined, undefined, undefined));
  });
});
