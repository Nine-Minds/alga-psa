// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => null }));
vi.mock('@alga-psa/ui/components/GenericDialog', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: any) => children }));
vi.mock('@alga-psa/ui/lib', () => ({ useCurrencyFormat: () => ({ money: (cents: number) => `$${(cents / 100).toFixed(2)}` }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, values: any) => values.defaultValue.replace(/{{(\w+)}}/g, (_: string, key: string) => values[key]) }) }));
vi.mock('../../../actions/taxSettingsActions', () => ({
  getTaxComponentsByTaxRate: vi.fn(async () => [
    { tax_component_id: 'c3', name: 'Independent', rate: 3, sequence: 3, is_compound: false },
    { tax_component_id: 'c2', name: 'City', rate: 2, sequence: 2, is_compound: true },
    { tax_component_id: 'c1', name: 'State', rate: 5, sequence: 1, is_compound: false },
  ]), createTaxComponent: vi.fn(), updateTaxComponent: vi.fn(), deleteTaxComponent: vi.fn(),
}));
import { TaxComponentEditor } from './TaxComponentEditor';
afterEach(cleanup);
it('previews compound taxes on prior taxes and independent taxes on the original base in sequence order', async () => {
  render(<TaxComponentEditor taxRateId="rate-c" isReadOnly />);
  const state = await screen.findByText('State (5%):');
  expect(state.parentElement?.textContent).toContain('$5.00');
  expect(screen.getByText('City (2%, compound):').parentElement?.textContent).toContain('$2.10');
  expect(screen.getByText('Independent (3%):').parentElement?.textContent).toContain('$3.00');
  expect(screen.getByText('Total Tax:').parentElement?.textContent).toContain('$10.10');
  expect(screen.getByText('Total Tax:').parentElement?.textContent).toContain('10.10%');
});
