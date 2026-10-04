/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import translations from '../../../../public/locales/en/msp/service-catalog.json';

const state = vi.hoisted(() => ({
  add: vi.fn(), update: vi.fn(),
  t: (key: string, vars: Record<string, unknown> = {}) => {
    const text = key.split('.').reduce((value: any, part) => value?.[part], translations as any) ?? key;
    return String(text).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars[name] ?? ''));
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: state.t, i18n: { language: 'en' } }),
}));
vi.mock('@alga-psa/core', async () => ({
  ...await import('../../../../../packages/core/src/lib/formatters'),
  toPlainDate: (value: string) => ({ toString: () => value.slice(0, 10) }),
}));
vi.mock('@alga-psa/ui/lib/dateInput', () => ({
  dateFromString: (value: string) => value,
  dateToString: (value: string | null) => value,
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionMessageError: (value: any) => Boolean(value?.actionError),
  isActionPermissionError: (value: any) => Boolean(value?.permissionError),
  getErrorMessage: (value: any) => value.message,
}));
vi.mock('@alga-psa/billing/actions/taxRateActions', () => ({
  addTaxRate: (...args: any[]) => state.add(...args),
  updateTaxRate: (...args: any[]) => state.update(...args),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ variant: _variant, ...props }: any) => <button {...props} /> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: ({ id, checked, onCheckedChange }: any) =>
  <input id={id} type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} /> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) => isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: ({ id, value, onChange }: any) =>
  <input id={id} type="date" value={value ?? ''} onChange={event => onChange(event.target.value)} /> }));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({ CurrencyPicker: ({ id, value, options, onValueChange, disabled }: any) =>
  <select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select> }));

import { TaxRateDialog } from '@alga-psa/billing/components/settings/tax/TaxRateDialog';

const region = { region_code: 'CAP', region_name: 'Cap region' };
const existingRate = {
  tax_rate_id: 'rate-1', region_code: 'CAP', tax_percentage: 10, start_date: '2026-01-01',
  description: 'Existing rate', cap_amount: 500, currency_code: 'USD', is_composite: false,
} as any;
const byId = (id: string) => document.getElementById(id)!;
const change = (id: string, value: string) => fireEvent.change(byId(id), { target: { value } });
const save = () => fireEvent.click(byId('save-tax-rate-button'));

function open(rate: any = existingRate) {
  const onSaved = vi.fn();
  render(<TaxRateDialog isOpen region={region} rate={rate} onClose={vi.fn()} onSaved={onSaved} />);
  return { onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.add.mockImplementation(async (input: any) => input);
  state.update.mockImplementation(async (input: any) => ({ ...existingRate, ...input }));
});
afterEach(cleanup);

describe('Tax rate dialog cap configuration', () => {
  it('hydrates an existing cap and submits an edited amount without re-sending currency', async () => {
    open();
    expect(byId('tax-rate-cap-field')).toHaveValue('5.00');
    change('tax-rate-cap-field', '3.00');
    save();
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0][0]).toMatchObject({ region_code: 'CAP', cap_amount: 300 });
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('currency_code');
  });

  it('omits both cap fields on an unrelated edit that leaves the amount untouched', async () => {
    open();
    change('tax-rate-description-field', 'New description');
    save();
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0][0]).toMatchObject({ description: 'New description' });
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('cap_amount');
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('currency_code');
  });

  it('persists zero as a real cap', async () => {
    open();
    change('tax-rate-cap-field', '0');
    save();
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0][0]).toMatchObject({ cap_amount: 0 });
  });

  it('clears an existing cap to null', async () => {
    open();
    fireEvent.click(screen.getByText('Clear tax cap'));
    save();
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0][0]).toMatchObject({ cap_amount: null });
  });

  it.each([
    ['5.001', 'more decimal places'], ['-1', 'zero or more'], ['5 dollars', 'decimal separator'],
  ])('rejects %s with the localized message and focuses the amount', async (text, expected) => {
    open();
    change('tax-rate-cap-field', text);
    save();
    expect(byId('tax-rate-cap-error')).toHaveTextContent(expected);
    expect(byId('tax-rate-cap-field')).toHaveAttribute('aria-invalid', 'true');
    expect(byId('tax-rate-cap-field')).toHaveFocus();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('requires a currency before setting a new cap and focuses the currency picker', async () => {
    open({ ...existingRate, cap_amount: null, currency_code: null });
    change('tax-rate-cap-field', '0');
    save();
    expect(byId('tax-rate-cap-error')).toHaveTextContent('Choose a supported rate currency');
    expect(byId('tax-rate-currency-field')).toHaveFocus();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('submits zero with an explicit currency from the add flow', async () => {
    open(null);
    change('tax-rate-percentage-field', '10');
    change('tax-rate-start-date-field', '2026-01-01');
    change('tax-rate-currency-field', 'JPY');
    change('tax-rate-cap-field', '0');
    save();
    await waitFor(() => expect(state.add).toHaveBeenCalledOnce());
    expect(state.add.mock.calls[0][0]).toMatchObject({ cap_amount: 0, currency_code: 'JPY' });
  });

  it('keeps a failed save editable and shows the returned message', async () => {
    state.update.mockResolvedValueOnce({ actionError: true, message: 'Could not save tax cap' });
    open();
    change('tax-rate-cap-field', '3.00');
    save();
    await waitFor(() => expect(screen.getByText('Could not save tax cap')).toBeInTheDocument());
    expect(byId('tax-rate-cap-field')).toHaveValue('3.00');
  });
});
