/**
 * @vitest-environment jsdom
 *
 * alga0002089: live rate inputs must render the contract-currency symbol via
 * Input's leadingAdornment (a span[aria-hidden] inside the Input wrapper), not
 * a sibling absolute span that the Input background paints over.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€' };

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    symbol: (currency?: string) => (currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'),
    money: (minor: number, currency?: string) =>
      `${currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'}${(minor / 100).toFixed(2)}`,
  }),
}));

const stableTranslation = {
  t: (key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_m, k) => String(options?.[k] ?? '')),
};
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => stableTranslation }));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({ SwitchWithLabel: () => null }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: () => '',
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));
vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({ createCustomContractLine: vi.fn() }));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
  useContractLineTypeOptions: () => [],
  useFormatBillingFrequency: () => (v: string) => v,
  useFormatContractLineType: () => (v: string) => v,
}));
vi.mock('./ServiceCatalogPicker', () => ({ ServiceCatalogPicker: () => null }));
vi.mock('./BillingTimingField', () => ({ BillingTimingField: () => null }));
vi.mock('./BucketOverlayFields', () => ({ BucketOverlayFields: () => null }));
vi.mock('./PrepaidBlockConfigFields', () => ({ PrepaidBlockConfigFields: () => null }));
vi.mock('../service-configurations/UsageServiceConfigPanel', () => ({ UsageServiceConfigPanel: () => null }));
vi.mock('../service-configurations/FixedServiceConfigPanel', () => ({ FixedServiceConfigPanel: () => null }));

import { CreateCustomContractLineDialog } from './CreateCustomContractLineDialog';

// The symbol must be a span[aria-hidden] sharing the <input>'s parent, and no
// sibling span.absolute.left-3 may sit beside it.
const expectAdornment = (container: HTMLElement, inputId: string, symbol: string) => {
  const input = container.querySelector(`#${inputId}`) as HTMLInputElement;
  expect(input).not.toBeNull();
  const parent = input.parentElement!;
  const span = parent.querySelector(':scope > span[aria-hidden="true"]') as HTMLElement;
  expect(span).not.toBeNull();
  expect(span.textContent).toBe(symbol);
  expect(parent.querySelector('span.absolute.left-3')).toBeNull();
  expect(parent.parentElement?.querySelector(':scope > span.absolute.left-3')).toBeNull();
  expect(input.className).not.toMatch(/\bpl-(7|10)\b/);
  expect(container.textContent).not.toContain('TENANT-DEFAULT');
};

describe('CreateCustomContractLineDialog rate input adornments', () => {
  afterEach(() => cleanup());

  const mount = (currencyCode: string) =>
    render(
      <CreateCustomContractLineDialog
        isOpen
        onClose={vi.fn()}
        contractId="c1"
        currencyCode={currencyCode}
        onCreated={async () => {}}
      />,
    );

  it.each([
    ['EUR', '€'],
    ['USD', '$'],
  ])('%s: hourly-rate, unit-rate and base-rate use leadingAdornment', (code, sym) => {
    const { container } = mount(code);

    fireEvent.click(container.querySelector('#custom-line-model-Fixed')!);
    fireEvent.click(container.querySelector('#add-fixed-service-button')!);
    expectAdornment(container, 'base-rate', sym);

    fireEvent.click(container.querySelector('#custom-line-model-Hourly')!);
    fireEvent.click(container.querySelector('#add-hourly-service-button')!);
    expectAdornment(container, 'hourly-rate-0', sym);

    fireEvent.click(container.querySelector('#custom-line-model-Usage')!);
    fireEvent.click(container.querySelector('#add-usage-service-button')!);
    expectAdornment(container, 'unit-rate-0', sym);
  });
});
