/**
 * @vitest-environment jsdom
 *
 * Prepaid Block config editor, cadence ("every billing period") mode: stable ids on the new
 * controls, the consumption-only fields hidden, the price entered in the contract currency's
 * minor units (no x100), and the price / hours rate.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom';

const t = (key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_m, k) => String(options?.[k] ?? ''));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t }),
  useFormatters: () => ({ locale: 'en' }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ symbol: () => '', money: (m: number) => String(m) }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { PrepaidBlockConfigFields } from '../src/components/billing-dashboard/contracts/PrepaidBlockConfigFields';
import { emptyPrepaidBlockDraft, withIssueMode } from '../src/components/billing-dashboard/contracts/prepaidBlockConfigDraft';

const services = [{ service_id: 'svc-a', service_name: 'Support', hourly_rate: 12000 }];
const cadenceDraft = (patch = {}) => ({
  ...withIssueMode({ ...emptyPrepaidBlockDraft(), hours: '40', priceMinor: 400000, priceManual: true }, 'cadence'),
  ...patch,
});
const renderFields = (value = cadenceDraft(), currencyCode = 'USD', onChange = vi.fn(), neutralPrice = false) => {
  render(
    <PrepaidBlockConfigFields
      idPrefix="pb" value={value} onChange={onChange} currencyCode={currencyCode}
      coveredServices={services} neutralPrice={neutralPrice}
    />,
  );
  return onChange;
};
const byId = (id: string) => document.getElementById(id);

describe('PrepaidBlockConfigFields cadence mode', () => {
  afterEach(() => cleanup());

  it('shows the cadence controls with ids and hides the consumption-only fields', () => {
    renderFields(cadenceDraft({ rolloverPeriods: '2' }));
    for (const id of ['pb-issue-mode', 'pb-rollover-periods', 'pb-cadence-note', 'pb-rate-per-hour', 'pb-hours', 'pb-price']) {
      expect(byId(id)).not.toBeNull();
    }
    for (const id of ['pb-expiry-months', 'pb-threshold-percent', 'pb-trigger-exhaustion', 'pb-trigger-expiry', 'pb-trigger-renewal', 'pb-tier']) {
      expect(byId(id)).toBeNull();
    }
    expect(byId('pb-rollover-periods')).toHaveValue('2');
  });

  it('shows the consumption fields, not the cadence ones, in consumption mode', () => {
    renderFields(emptyPrepaidBlockDraft());
    expect(byId('pb-issue-mode')).toHaveValue('consumption');
    expect(byId('pb-expiry-months')).not.toBeNull();
    expect(byId('pb-rollover-periods')).toBeNull();
    expect(byId('pb-cadence-note')).toBeNull();
  });

  it('switches mode through withIssueMode', () => {
    const onChange = renderFields(emptyPrepaidBlockDraft());
    fireEvent.change(byId('pb-issue-mode') as HTMLSelectElement, { target: { value: 'cadence' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ issueMode: 'cadence', expiryMonths: '', triggerOnExhaustion: false }));
  });

  it('shows price / hours in the contract currency', () => {
    renderFields(cadenceDraft(), 'USD');
    expect(byId('pb-rate-per-hour')).toHaveTextContent('Works out to $100.00 per hour of the block.');
  });

  it('uses the currency exponent for a zero-decimal currency (no x100)', () => {
    renderFields(cadenceDraft({ priceMinor: 400000 }), 'JPY');
    expect(byId('pb-rate-per-hour')).toHaveTextContent('10,000');
    expect(byId('pb-rate-per-hour')).not.toHaveTextContent('1,000,000');
    expect((byId('pb-price') as HTMLInputElement).value.replace(/[^0-9]/g, '')).toBe('400000');
  });

  it('omits the currency symbol from the rate on currency-neutral templates', () => {
    renderFields(cadenceDraft(), 'USD', vi.fn(), true);
    expect(byId('pb-rate-per-hour')).toHaveTextContent('Works out to 100 per hour of the block.');
  });
});
