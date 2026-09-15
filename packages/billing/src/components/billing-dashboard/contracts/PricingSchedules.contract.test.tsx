/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const getPricingSchedulesByContractMock = vi.hoisted(() => vi.fn());
const deletePricingScheduleMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/billing/actions/contractPricingScheduleActions', () => ({
  getPricingSchedulesByContract: async (...args: unknown[]) => getPricingSchedulesByContractMock(...args),
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
  PricingScheduleDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <table>
      <tbody>
        {data.map((row: any, rowIndex: number) => (
          <tr key={rowIndex}>
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
    effective_date: '2026-01-01T00:00:00.000Z',
    custom_rate: 12345,
    ...overrides,
  };
}

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

});
