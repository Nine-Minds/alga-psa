/**
 * @vitest-environment jsdom
 *
 * alga0002089: the hourly-rate and user-type-rate fields showed the tenant
 * default symbol (symbol() with no argument) and the labels hardcoded "$".
 * The adornments must follow the contract currency passed in `currencyCode`,
 * and no label may carry a currency glyph.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const SYMBOLS: Record<string, string> = { USD: '$', CAD: 'CA$', EUR: '€' };

// The real hook's symbol(override) honours the override; with no argument it
// returns the tenant default. Model the tenant default as a distinct marker so
// a regression to symbol() is visible.
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    symbol: (currency?: string) => (currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'),
  }),
}));

const stableT = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
const stableTranslation = { t: stableT };
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableTranslation,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));

import { ServiceHourlyConfigForm } from './ServiceHourlyConfigForm';

const renderForm = (currencyCode: string) =>
  render(
    <ServiceHourlyConfigForm
      configId="cfg-1"
      config={{ hourly_rate: 10000, minimum_billable_time: 15, round_up_to_nearest: 15 }}
      userTypeRates={[]}
      onHourlyFieldChange={vi.fn()}
      onUserTypeRatesChange={vi.fn()}
      currencyCode={currencyCode}
    />,
  );

describe('ServiceHourlyConfigForm currency', () => {
  afterEach(() => cleanup());

  it.each([
    ['USD', '$'],
    ['CAD', 'CA$'],
    ['EUR', '€'],
  ])('shows the %s symbol in the hourly-rate and new user-type-rate fields', (code, expected) => {
    const { container } = renderForm(code);
    const adornments = [...container.querySelectorAll('span.absolute')].map((el) => el.textContent);
    expect(adornments).toHaveLength(2);
    expect(adornments).toEqual([expected, expected]);
    expect(container.textContent).not.toContain('TENANT-DEFAULT');
  });

  it('labels carry the period but no currency glyph', () => {
    renderForm('EUR');
    const hourly = screen.getByText('Hourly Rate (per hour)');
    const userType = screen.getByText('Rate (per hour)');
    for (const label of [hourly, userType]) {
      expect(label.textContent).not.toMatch(/[$€£¥]/);
    }
  });
});
