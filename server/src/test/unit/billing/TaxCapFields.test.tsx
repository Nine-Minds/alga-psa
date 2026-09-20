// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import translations from '../../../../public/locales/en/msp/service-catalog.json';
vi.mock('@alga-psa/core', async () => await import('../../../../../packages/core/src/lib/formatters'));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ i18n: { language: 'en' },
  t: (key: string, vars: Record<string, unknown> = {}) => {
    const text = key.split('.').reduce((value: any, key) => value?.[key], translations) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => String(vars[key] ?? ''));
  },
}) }));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({ CurrencyPicker: ({ id, value, options, onValueChange, disabled }: any) =>
  <select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant: _variant, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (props: any) => <label {...props} /> }));
import { TaxCapFields, TaxCapReadout } from '@alga-psa/billing/components/billing-dashboard/TaxCapFields';
import { createTaxCapDraft, taxCapPayload, type TaxCapValue } from '@alga-psa/billing/components/billing-dashboard/taxCapForm';

function Form({ original, save, composite = false }: { original: TaxCapValue; save: (value: unknown) => void; composite?: boolean }) {
  const [draft, setDraft] = useState(() => createTaxCapDraft(original, 'en'));
  const [error, setError] = useState<string | null>(null);
  return <form onSubmit={event => { event.preventDefault(); try { save(taxCapPayload(draft, 'en', true)); } catch (error) { setError((error as Error).message); } }}>
    <TaxCapFields draft={draft} onChange={setDraft} error={error} composite={composite} />
    <button type="submit">Save</button>
  </form>;
}
afterEach(cleanup);

describe('rendered cap configuration controls', () => {
  it('hydrates exact saved values; editing, zero and clear submit different payloads', () => {
    const save = vi.fn();
    render(<Form original={{ cap_amount: '9007199254740991', currency_code: 'USD' }} save={save} />);
    const amount = screen.getByLabelText(/Tax cap \(USD\)/);
    expect(amount).toHaveValue('90071992547409.91');
    fireEvent.click(screen.getByText('Save'));
    expect(save).toHaveBeenLastCalledWith({});
    fireEvent.change(amount, { target: { value: '3.00' } });
    fireEvent.click(screen.getByText('Save'));
    expect(save).toHaveBeenLastCalledWith({ cap_amount: 300 });
    fireEvent.change(amount, { target: { value: '0' } });
    fireEvent.click(screen.getByText('Save'));
    expect(save).toHaveBeenLastCalledWith({ cap_amount: 0 });
    fireEvent.click(screen.getByText('Clear tax cap'));
    fireEvent.click(screen.getByText('Save'));
    expect(save).toHaveBeenLastCalledWith({ cap_amount: null });
  });
  it('retains text and blocks malformed input or currency reinterpretation', () => {
    const save = vi.fn();
    render(<Form original={{ cap_amount: 500, currency_code: 'USD' }} save={save} />);
    const amount = screen.getByLabelText(/Tax cap \(USD\)/);
    fireEvent.change(amount, { target: { value: '5.000' } });
    fireEvent.click(screen.getByText('Save'));
    expect(save).not.toHaveBeenCalled();
    expect(amount).toHaveValue('5.000');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Rate currency'), { target: { value: 'JPY' } });
    fireEvent.click(screen.getByText('Save'));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '5' } });
    fireEvent.click(screen.getByText('Save'));
    expect(save).toHaveBeenCalledWith({ cap_amount: 5, currency_code: 'JPY' });
  });
  it.each([0, 500])('keeps legacy cap %s distinct from no cap and requires explicit resolution', cap => {
    const save = vi.fn();
    render(<Form original={{ cap_amount: String(cap), currency_code: null }} save={save} composite />);
    expect(screen.getByText(new RegExp(`Currency not specified.*${cap} minor units`))).toBeVisible();
    expect(screen.queryByText('No cap')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Save'));
    expect(save).toHaveBeenLastCalledWith({});
    fireEvent.change(screen.getByLabelText('Rate currency'), { target: { value: 'BHD' } });
    fireEvent.click(screen.getByRole('button', { name: /Use stored minor amount in BHD/ }));
    expect(screen.getByLabelText(/Tax cap \(BHD\)/)).toHaveValue(cap === 0 ? '0.000' : '0.500');
    fireEvent.click(screen.getByText('Save'));
    expect(save).toHaveBeenLastCalledWith({ currency_code: 'BHD' });
    expect(screen.getByText(/component-based calculations do not/i)).toBeVisible();
  });
  it('keeps the composite limitation visible in both compact and detailed capped readouts', () => {
    const rate = { cap_amount: 0, currency_code: 'USD', is_composite: true };
    const { rerender } = render(<TaxCapReadout rate={rate} />);
    expect(screen.getByText(/component-based calculations do not/i)).toBeVisible();
    expect(screen.getByText(/USD.*0.00/)).toBeVisible();
    rerender(<TaxCapReadout rate={rate} compact />);
    expect(screen.getByText('Regional calculations only')).toBeVisible();
    expect(screen.getByText('Regional calculations only')).toHaveAttribute('title', expect.stringMatching(/component-based/i));
  });
  it('renders no cap, explicit zero and accessible contextual scope help', () => {
    const { rerender } = render(<TaxCapReadout rate={{ cap_amount: null }} />);
    expect(screen.getByText('No cap')).toBeVisible();
    rerender(<TaxCapReadout rate={{ cap_amount: 0, currency_code: 'JPY' }} />);
    expect(screen.getByText(/JPY.*0/)).toBeVisible();
    rerender(<Form original={{}} save={vi.fn()} />);
    const summary = screen.getByText('How tax caps apply');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.parentElement?.tagName).toBe('DETAILS');
  });
});
