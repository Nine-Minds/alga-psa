/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const state = vi.hoisted(() => ({
  rows: [] as any[], permissions: { canCreate: true, canUpdate: true, canDelete: true },
  get: vi.fn(), add: vi.fn(), update: vi.fn(), getPermissions: vi.fn(),
  t: (key: string, options?: any) => options?.defaultValue ?? key,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: state.t, i18n: { language: 'en' } }) }));
vi.mock('@alga-psa/core', async () => ({
  ...await import('../../../../../packages/core/src/lib/formatters'),
  toPlainDate: (value: string) => ({ toString: () => value.slice(0, 10), toLocaleString: () => value.slice(0, 10) }),
}));
vi.mock('@alga-psa/billing/actions/taxRateActions', () => ({
  getTaxRatePermissions: () => state.getPermissions(),
  getTaxRates: (...args: any[]) => state.get(...args),
  addTaxRate: (...args: any[]) => state.add(...args),
  updateTaxRate: (...args: any[]) => state.update(...args), deleteTaxRate: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/taxSettingsActions', () => ({ getActiveTaxRegions: async () => [{ region_code: 'CAP', region_name: 'Cap region' }] }));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: vi.fn() }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionMessageError: (value: any) => Boolean(value?.actionError),
  isActionPermissionError: (value: any) => Boolean(value?.permissionError),
  getErrorMessage: (value: any) => value.message,
}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>, CardHeader: ({ children }: any) => <div>{children}</div>, CardContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ variant: _variant, ...props }: any) => <button {...props} /> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, onClose, title, children, footer }: any) => isOpen ? <div role="dialog" aria-label={title}>
    <button type="button" onClick={onClose} aria-label="Close dialog">Close</button>{children}{footer}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, value, onValueChange, options, disabled }: any) =>
  <select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}><option value="" />{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({ CurrencyPicker: ({ id, value, onValueChange, options, disabled }: any) =>
  <select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: ({ id, value, onChange }: any) =>
  <input id={id} type="date" value={value?.toISOString().slice(0, 10) ?? ''} onChange={event => onChange(new Date(`${event.target.value}T00:00:00Z`))} /> }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => <span>Loading</span> }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>, DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>, DropdownMenuItem: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: ({ data, columns, onRowClick }: any) => <div>
  {data.map((row: any) => <div key={row.tax_rate_id}><button type="button" onClick={() => onRowClick(row)}>Open {row.tax_rate_id}</button>
    {columns.filter((column: any) => ['cap_amount', 'tax_rate_id'].includes(column.dataIndex)).map((column: any) => <div key={column.dataIndex}>{column.render(row[column.dataIndex], row)}</div>)}
  </div>)}</div> }));
vi.mock('@alga-psa/ui', () => ({ DeleteEntityDialog: () => null }));
vi.mock('@alga-psa/billing/components/billing-dashboard/TaxRateDetailPanel', () => ({ TaxRateDetailPanel: ({ isReadOnly }: any) => <div>Detail read only: {String(isReadOnly)}</div> }));

import TaxRates from '@alga-psa/billing/components/billing-dashboard/TaxRates';
const byId = (id: string) => document.getElementById(id)!;
const change = (id: string, value: string) => fireEvent.change(byId(id), { target: { value } });
const save = () => fireEvent.click(byId('save-tax-rate-button'));
const row = (cap_amount: number | string | null = '500', currency_code: string | null = 'USD') => ({
  tax_rate_id: 'rate-1', region_code: 'CAP', tax_percentage: 10, start_date: '2026-01-01', description: 'Existing rate', cap_amount, currency_code,
});
async function open() {
  render(<TaxRates />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open rate-1' }));
  await screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks(); state.rows = [row()]; state.permissions = { canCreate: true, canUpdate: true, canDelete: true };
  state.get.mockImplementation(async () => [...state.rows]);
  state.getPermissions.mockImplementation(async () => state.permissions);
  state.add.mockImplementation(async (input: any) => { state.rows = [...state.rows, input]; return input; });
  state.update.mockImplementation(async (input: any) => { state.rows = state.rows.map(rate => rate.tax_rate_id === input.tax_rate_id ? { ...rate, ...input } : rate); return state.rows[0]; });
});
afterEach(cleanup);

describe('Tax Rates administrator cap flow', () => {
  it('waits for permissions before making rows interactive', async () => {
    let finish!: (value: typeof state.permissions) => void;
    state.getPermissions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<TaxRates />);
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Open rate-1' })).not.toBeInTheDocument();
    await act(async () => { finish(state.permissions); });
    fireEvent.click(await screen.findByRole('button', { name: 'Open rate-1' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it.each([
    ['-1', 'negative'], ['5.001', 'precision'], ['NaN', 'invalid'],
    ['Infinity', 'invalid'], ['5 dollars', 'invalid'], ['90071992547409.92', 'overflow'],
  ])('rejects %s with the localized %s message and focuses the amount', async (text, code) => {
    await open();
    change('tax-rate-cap-field', text); save();
    expect(byId('tax-rate-cap-error')).toHaveTextContent(`taxRates.cap.errors.${code}`);
    expect(byId('tax-rate-cap-field')).toHaveAttribute('aria-invalid', 'true');
    expect(byId('tax-rate-cap-field')).toHaveAttribute('aria-describedby', 'tax-rate-cap-hint tax-rate-cap-error');
    expect(byId('tax-rate-cap-field')).toHaveFocus();
    expect(state.update).not.toHaveBeenCalled();
  });
  it('focuses missing currency for a new zero cap and requires reentry after currency changes', async () => {
    state.rows = [row(null, null)]; await open();
    change('tax-rate-cap-field', '0'); save();
    expect(byId('tax-rate-cap-error')).toHaveTextContent('taxRates.cap.errors.currency');
    expect(byId('tax-rate-currency-field')).toHaveFocus();
    change('tax-rate-currency-field', 'JPY'); save();
    expect(byId('tax-rate-cap-error')).toHaveTextContent('taxRates.cap.errors.reenter');
    expect(byId('tax-rate-cap-field')).toHaveFocus();
    expect(state.update).not.toHaveBeenCalled();
  });
  it('restores focus to the stable row menu trigger after closing Edit', async () => {
    render(<TaxRates />);
    await screen.findByRole('button', { name: 'Open rate-1' });
    fireEvent.click(byId('edit-tax-rate-rate-1'));
    await screen.findByRole('dialog');
    byId('tax-rate-cap-field').focus();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(byId('tax-rate-actions-menu-rate-1')).toHaveFocus());
  });
  it.each([['0', 0], ['', null], ['3.00', 300]] as const)('saves entered %s as %s and rehydrates after reopening', async (text, expected) => {
    await open(); expect(byId('tax-rate-cap-field')).toHaveValue('5.00');
    change('tax-rate-cap-field', text); save();
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0][0]).toMatchObject({ cap_amount: expected });
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('currency_code');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Open rate-1' }));
    expect(byId('tax-rate-cap-field')).toHaveValue(expected === null ? '' : expected === 0 ? '0.00' : '3.00');
  });
  it('omits untouched cap/currency on unrelated edit and canonical unchanged amount', async () => {
    await open(); change('tax-rate-description-field', 'New description'); change('tax-rate-cap-field', '05.0'); save();
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0][0]).toMatchObject({ description: 'New description' });
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('cap_amount');
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('currency_code');
  });
  it('cancels a changed draft and resets values/errors on reopening', async () => {
    await open(); change('tax-rate-cap-field', '-5'); save();
    expect(byId('tax-rate-cap-field')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open rate-1' }));
    expect(byId('tax-rate-cap-field')).toHaveValue('5.00');
    expect(byId('tax-rate-cap-field')).toHaveAttribute('aria-invalid', 'false');
    expect(state.update).not.toHaveBeenCalled();
  });
  it('keeps failed-save text available for correction', async () => {
    state.update.mockResolvedValueOnce({ actionError: true, message: 'Could not save tax cap' });
    await open(); change('tax-rate-cap-field', '3.00'); save();
    await waitFor(() => expect(screen.getAllByText('Could not save tax cap').length).toBeGreaterThan(0));
    expect(byId('tax-rate-cap-field')).toHaveValue('3.00');
    expect(byId('save-tax-rate-button')).toBeEnabled();
  });
  it('blocks duplicate submissions while the server save is pending', async () => {
    let finish!: (value: any) => void;
    state.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await open(); change('tax-rate-cap-field', '0');
    fireEvent.submit(byId('tax-rate-form')); fireEvent.submit(byId('tax-rate-form'));
    expect(state.update).toHaveBeenCalledOnce(); expect(byId('save-tax-rate-button')).toBeDisabled();
    await act(async () => { finish(row(0)); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('preserves unresolved legacy zero during unrelated edit, and explicitly clears it', async () => {
    state.rows = [row('0', null)]; await open();
    expect(byId('tax-rate-cap-field')).toBeDisabled();
    change('tax-rate-description-field', 'Keep legacy'); save();
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('cap_amount');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Open rate-1' }));
    fireEvent.click(byId('clear-tax-rate-cap-button')); save();
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(2));
    expect(state.update.mock.calls[1][0]).toMatchObject({ cap_amount: null });
  });
  it('submits zero and explicit currency from the Add flow', async () => {
    render(<TaxRates />);
    await waitFor(() => expect(byId('add-tax-rate-button')).toBeEnabled());
    fireEvent.click(byId('add-tax-rate-button'));
    change('tax-rate-region-field', 'CAP'); change('tax-rate-percentage-field', '10');
    change('tax-rate-start-date-field', '2026-01-01'); change('tax-rate-currency-field', 'JPY'); change('tax-rate-cap-field', '0'); save();
    await waitFor(() => expect(state.add).toHaveBeenCalledOnce());
    expect(state.add.mock.calls[0][0]).toMatchObject({ cap_amount: 0, currency_code: 'JPY' });
  });
  it('allows billing-read-only inspection without enabled create/edit/save controls', async () => {
    state.permissions = { canCreate: false, canUpdate: false, canDelete: false };
    render(<TaxRates />); await screen.findByRole('button', { name: 'Open rate-1' });
    expect(byId('add-tax-rate-button')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open rate-1' }));
    expect(screen.getByText('Detail read only: true')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled(); expect(state.add).not.toHaveBeenCalled();
  });
});
