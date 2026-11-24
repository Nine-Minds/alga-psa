/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const getPricingSchedulesByContractMock = vi.hoisted(() => vi.fn());
const getPricingScheduleLineScopesMock = vi.hoisted(() => vi.fn());
const deletePricingScheduleMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/billing/actions/contractPricingScheduleActions', () => ({
  getPricingSchedulesByContract: async (...args: unknown[]) => getPricingSchedulesByContractMock(...args),
  getPricingScheduleLineScopes: async (...args: unknown[]) => getPricingScheduleLineScopesMock(...args),
  deletePricingSchedule: async (...args: unknown[]) => deletePricingScheduleMock(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
  useFormatters: () => ({ locale: 'en-US' }),
}));

vi.mock('./PricingScheduleDialog', () => ({
  PricingScheduleDialog: ({ currentLineName, eligibleLines }: any) => (
    <div role="dialog">
      <span>{currentLineName}</span>
      <select aria-label="eligible lines">
        {eligibleLines.map((line: any) => (
          <option key={line.contract_line_id}>{line.contract_line_name}</option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns, onRowClick }: any) => (
    <table>
      <tbody>
        {data.map((row: any, rowIndex: number) => (
          <tr key={rowIndex} onClick={() => onRowClick(row)}>
            {columns.map((column: any, columnIndex: number) => (
              <td key={columnIndex}>
                {column.render ? column.render(row[column.dataIndex], row) : row[column.dataIndex]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div data-testid="custom-rate-skeleton" />,
}));

import type { IContractPricingSchedule } from '@alga-psa/types';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import PricingSchedules from './PricingSchedules';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function schedule(overrides: Partial<IContractPricingSchedule> = {}): IContractPricingSchedule {
  return {
    tenant: 'tenant-1',
    schedule_id: 'schedule-1',
    contract_id: 'contract-1',
    contract_line_id: 'line-1',
    effective_date: '2026-01-01',
    custom_rate: 12345,
    ...overrides,
  };
}

const fixedLine = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  contract_line_id: id,
  contract_line_name: name,
  is_active: true,
  has_bundle_fee: true,
  has_unit_priced_members: false,
  ...overrides,
});

function renderList(props: { currencyCode?: string } = {}) {
  const tree = () => (
    <CurrencyFormatProvider currencyCode="USD">
      <PricingSchedules contractId="contract-1" currencyCode={props.currencyCode} />
    </CurrencyFormatProvider>
  );
  return render(tree());
}

describe('PricingSchedules contract-currency custom rate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPricingScheduleLineScopesMock.mockResolvedValue([fixedLine('line-1', 'Managed Services')]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the custom rate in a two-decimal non-default contract currency (EUR)', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([schedule({ custom_rate: 12345 })]);

    renderList({ currencyCode: 'EUR' });

    // Rate appears in both the timeline and the table.
    expect((await screen.findAllByText('€123.45')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('$123.45')).not.toBeInTheDocument();
  });

  it('renders a zero-decimal currency (JPY) from minor units without dividing by 100', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([schedule({ custom_rate: 5000 })]);

    renderList({ currencyCode: 'JPY' });

    expect((await screen.findAllByText('¥5,000')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('¥50')).not.toBeInTheDocument();
  });

  it('names the line a scoped schedule applies to', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([schedule({ contract_line_id: 'line-2' })]);
    getPricingScheduleLineScopesMock.mockResolvedValue([
      fixedLine('line-1', 'Managed Services'),
      fixedLine('line-2', 'Backup'),
    ]);

    renderList();

    expect((await screen.findAllByText('Backup')).length).toBeGreaterThanOrEqual(1);
  });

  it('calls a null-scope schedule "Whole contract" and states what it bills', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([
      schedule({ contract_line_id: null, custom_rate: 90000 }),
    ]);
    getPricingScheduleLineScopesMock.mockResolvedValue([
      fixedLine('line-1', 'Managed Services'),
      fixedLine('line-2', 'Backup'),
    ]);

    renderList();

    // Both the column and timeline flag the legacy row and state its effect.
    expect(await screen.findAllByText(
      'Whole contract — fallback fee of $900.00 per active fixed-fee line (2 lines). Line-specific schedules take precedence.'
    )).toHaveLength(2);
  });

  it('describes legacy rates as fallback when an overlapping line schedule takes precedence', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([
      schedule({ contract_line_id: null, custom_rate: 90000 }),
      schedule({ schedule_id: 'line-schedule', contract_line_id: 'line-1', custom_rate: 70000 }),
    ]);
    getPricingScheduleLineScopesMock.mockResolvedValue([
      fixedLine('line-1', 'Managed Services'), fixedLine('line-2', 'Backup'),
    ]);

    renderList();

    expect(await screen.findAllByText(
      'Whole contract — fallback fee of $900.00 per active fixed-fee line (2 lines). Line-specific schedules take precedence.'
    )).toHaveLength(2);
    expect(screen.getAllByText('$700.00')).toHaveLength(2);
    expect(screen.queryByText(/each of the.*bills/)).not.toBeInTheDocument();
  });

  it.each([1, 2])('counts only the %i active bundle lines while preserving inactive bindings', async (activeCount) => {
    getPricingSchedulesByContractMock.mockResolvedValue([
      schedule({ contract_line_id: null, custom_rate: 90000 }),
      schedule({ schedule_id: 'inactive-schedule', contract_line_id: 'inactive', custom_rate: 70000 }),
    ]);
    getPricingScheduleLineScopesMock.mockResolvedValue([
      ...Array.from({ length: activeCount }, (_, i) => fixedLine(`active-${i}`, `Active ${i}`)),
      fixedLine('inactive', 'Paused support', { is_active: false }),
    ]);

    renderList();

    await screen.findByRole('cell', { name: 'Paused support' });
    if (activeCount > 1) {
      expect(screen.getAllByText(/fallback fee of.*\(2 lines\)/)).toHaveLength(2);
    } else {
      expect(screen.queryByText(/fallback fee of/)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/3 lines|each of the.*bills/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('cell', { name: 'Paused support' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Paused support');
  });

  it('passes the current ineligible line name to the editor without offering it as eligible', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([schedule()]);
    getPricingScheduleLineScopesMock.mockResolvedValue([
      fixedLine('line-1', 'Seats', { has_bundle_fee: false, has_unit_priced_members: true }),
      fixedLine('line-2', 'Backup'),
    ]);

    renderList();
    const cell = await screen.findByRole('cell', { name: 'Seats' });
    fireEvent.click(cell);

    expect(screen.getByRole('dialog')).toHaveTextContent('Seats');
    expect(screen.getByRole('option', { name: 'Backup' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Seats' })).not.toBeInTheDocument();
  });

  it('does not count unit-priced or product-only lines in the whole-contract effect', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([
      schedule({ contract_line_id: null, custom_rate: 90000 }),
    ]);
    getPricingScheduleLineScopesMock.mockResolvedValue([
      fixedLine('line-1', 'Managed Services'),
      fixedLine('line-2', 'Seats', { has_bundle_fee: false, has_unit_priced_members: true }),
      fixedLine('line-3', 'Products', { has_bundle_fee: false, has_unit_priced_members: false }),
    ]);

    renderList();

    // One bundle-fee line left: there is no "each of the N lines" effect to state.
    expect((await screen.findAllByText('Whole contract')).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/each of the/)).not.toBeInTheDocument();
  });

  it('surfaces a failed line read instead of claiming the contract has no fixed line', async () => {
    getPricingSchedulesByContractMock.mockResolvedValue([schedule()]);
    getPricingScheduleLineScopesMock.mockResolvedValue({
      actionError: 'Permission denied: billing read required',
    });

    renderList();

    expect(
      await screen.findByText('Permission denied: billing read required')
    ).toBeInTheDocument();
  });

});
