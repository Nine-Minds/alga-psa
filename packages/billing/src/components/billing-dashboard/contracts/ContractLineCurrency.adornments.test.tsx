/**
 * @vitest-environment jsdom
 *
 * alga0002089: the live contract-line UI (preset picker and bucket overlay)
 * called symbol()/money() with no currency, so a EUR contract in a USD tenant
 * showed the tenant default. Both must follow the contract currency.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as RadixTooltip from '@radix-ui/react-tooltip';

const SYMBOLS: Record<string, string> = { USD: '$', CAD: 'CA$', EUR: '€' };

// Override is honoured; no argument yields a distinct tenant-default marker so
// a regression to symbol()/money(x) is visible.
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    symbol: (currency?: string) => (currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'),
    fractionDigits: () => 2,
    money: (minor: number, currency?: string) =>
      `${currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'}${(minor / 100).toFixed(2)}`,
  }),
}));

const stableTranslation = {
  // Interpolates {{vars}} like i18next so rate strings are observable.
  t: (key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_m, k) => String(options?.[k] ?? '')),
};
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableTranslation,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useContractLineTypeOptions: () => [],
  useFormatBillingFrequency: () => (v: string) => v,
  useFormatContractLineType: () => (v: string) => v,
}));

import { BucketOverlayFields } from './BucketOverlayFields';
import { ContractLinePresetPicker } from './ContractLinePresetPicker';

// The symbol must be the Input wrapper's own adornment: a child of the same
// div.relative as the <input>. A sibling span outside that wrapper is painted
// over by the input background (the original alga0002089 defect).
const adornments = (container: HTMLElement) =>
  [...container.querySelectorAll('div.relative > span[aria-hidden="true"] + input')].map((input) => {
    const span = input.previousElementSibling as HTMLElement;
    expect(span.parentElement).toBe(input.parentElement);
    return span.textContent;
  });

describe('BucketOverlayFields currency', () => {
  afterEach(() => cleanup());

  it.each([
    ['EUR', '€'],
    ['CAD', 'CA$'],
  ])('shows the %s symbol on the overage rate', (code, expected) => {
    const { container } = render(
      <RadixTooltip.Provider>
        <BucketOverlayFields mode="hours" value={{}} onChange={vi.fn()} currencyCode={code} />
      </RadixTooltip.Provider>,
    );
    expect(adornments(container)).toContain(expected);
    expect(container.textContent).not.toContain('TENANT-DEFAULT');
  });

  it('falls back to the tenant default when no currency is given', () => {
    const { container } = render(
      <RadixTooltip.Provider>
        <BucketOverlayFields mode="hours" value={{}} onChange={vi.fn()} />
      </RadixTooltip.Provider>,
    );
    expect(adornments(container)).toContain('TENANT-DEFAULT');
  });
});

describe('ContractLinePresetPicker currency', () => {
  afterEach(() => cleanup());

  const makeSelection = (type: 'Fixed' | 'Hourly' | 'Usage') => {
    const service = { service_id: 's1', service_name: 'Svc', default_rate: 5000, unit_of_measure: 'unit' };
    return {
      availablePresets: [{ preset_id: 'p1', preset_name: 'P', contract_line_type: type, billing_frequency: 'monthly' }],
      isLoading: false,
      searchTerm: '',
      setSearchTerm: vi.fn(),
      typeFilter: 'all',
      setTypeFilter: vi.fn(),
      filteredPresets: [{ preset_id: 'p1', preset_name: 'P', contract_line_type: type, billing_frequency: 'monthly' }],
      resetFilters: vi.fn(),
      selectedPresetIds: new Set<string>(),
      toggleSelect: vi.fn(),
      expandedPresets: { p1: true },
      toggleExpand: vi.fn(),
      presetServices: { p1: [service] },
      presetFixedConfigs: { p1: { base_rate: 12345 } },
      presetServiceCounts: { p1: 1 },
      getRateInput: () => '',
      handleRateInputChange: vi.fn(),
      handleRateInputBlur: vi.fn(),
      getServiceRateInput: () => '',
      handleServiceRateChange: vi.fn(),
      handleServiceRateBlur: vi.fn(),
      getHourlyInput: () => '',
      handleHourlyInputChange: vi.fn(),
      handleHourlyInputBlur: vi.fn(),
    } as any;
  };

  const renderPicker = (type: 'Fixed' | 'Hourly' | 'Usage', currencyCode: string) =>
    render(
      <RadixTooltip.Provider>
        <ContractLinePresetPicker
          selection={makeSelection(type)}
          labels={{ searchPlaceholder: 's', noneAvailable: 'n', noMatches: 'm' }}
          typeFilterId="t"
          resetFiltersId="r"
          currencyCode={currencyCode}
        />
      </RadixTooltip.Provider>,
    );

  it('formats the Fixed default base rate and override adornment in the contract currency', () => {
    const { container } = renderPicker('Fixed', 'EUR');
    expect(container.textContent).toContain('€123.45');
    const placeholders = [...container.querySelectorAll('input')].map((el) => el.getAttribute('placeholder'));
    expect(placeholders).toContain('Default: €123.45');
    expect(placeholders.join('|')).not.toContain('$');
    expect(adornments(container)).toContain('€');
    expect(container.textContent).not.toContain('TENANT-DEFAULT');
  });

  it.each(['Hourly', 'Usage'] as const)('uses the contract currency for %s rate adornments', (type) => {
    const { container } = renderPicker(type, 'CAD');
    const found = adornments(container).filter((a) => a === 'CA$');
    expect(found.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('Default: CA$50.00');
    // No bare '$' (one not part of the 'CA$' symbol).
    expect(container.textContent).not.toMatch(/(?<!CA)\$/);
    expect(container.textContent).not.toContain('TENANT-DEFAULT');
  });
});
