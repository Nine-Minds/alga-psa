/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listCostRatesMock = vi.hoisted(() => vi.fn());
const upsertCostRateMock = vi.hoisted(() => vi.fn());
const deleteCostRateMock = vi.hoisted(() => vi.fn());
const checkCostRateWorkedTimeImpactMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const tMock = vi.hoisted(() => (
  (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
    let value = options?.defaultValue ?? _key;
    for (const [token, replacement] of Object.entries(options ?? {})) {
      if (token !== 'defaultValue') {
        value = value.replace(`{{${token}}}`, String(replacement));
      }
    }
    return value;
  }
));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string = 'USD') => `${currency} ${value.toFixed(2)}`,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: toastSuccessMock },
}));

vi.mock('@alga-psa/billing/actions', () => ({
  listCostRates: (...args: unknown[]) => listCostRatesMock(...args),
  upsertCostRate: (...args: unknown[]) => upsertCostRateMock(...args),
  deleteCostRate: (...args: unknown[]) => deleteCostRateMock(...args),
  checkCostRateWorkedTimeImpact: (...args: unknown[]) => checkCostRateWorkedTimeImpactMock(...args),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: {
    id: string;
    data: Array<Record<string, unknown>>;
    columns: Array<{ dataIndex: string; render?: (value: unknown, row: unknown, index: number) => React.ReactNode }>;
  }) => (
    <div data-testid={id}>
      {data.map((row, rowIndex) => (
        <div key={rowIndex} role="row">
          {columns.map((column, columnIndex) => (
            <span key={columnIndex}>
              {column.render
                ? column.render(row[column.dataIndex], row, rowIndex)
                : String(row[column.dataIndex] ?? '')}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id, value, onChange }: {
    id?: string;
    value?: Date;
    onChange: (date: Date | undefined) => void;
  }) => (
    <input
      id={id}
      type="date"
      value={value
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
        : ''}
      onChange={(event) => onChange(event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined)}
    />
  ),
}));

const defaultData = {
  currency_code: 'EUR',
  default_rate_history: [
    {
      rate_id: 'default-rate-1',
      user_id: null,
      cost_rate: 5000,
      effective_from: '2026-01-01',
      effective_to: null,
    },
  ],
  users: [
    {
      user_id: 'user-1',
      username: 'alice',
      first_name: 'Alice',
      last_name: 'A',
      email: 'alice@example.com',
      is_inactive: false,
      current_rate: {
        rate_id: 'user-rate-1',
        user_id: 'user-1',
        cost_rate: 6250,
        effective_from: '2026-01-01',
        effective_to: null,
      },
      rate_history: [
        {
          rate_id: 'user-rate-1',
          user_id: 'user-1',
          cost_rate: 6250,
          effective_from: '2026-01-01',
          effective_to: null,
        },
        {
          rate_id: 'user-rate-0',
          user_id: 'user-1',
          cost_rate: 5500,
          effective_from: '2025-01-01',
          effective_to: '2025-12-31',
        },
      ],
    },
  ],
};

describe('CostRatesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCostRatesMock.mockResolvedValue(defaultData);
    upsertCostRateMock.mockResolvedValue({ rate: defaultData.users[0].current_rate, covers_worked_time: false });
    deleteCostRateMock.mockResolvedValue({ deleted_rate: defaultData.users[0].current_rate, covers_worked_time: false });
    checkCostRateWorkedTimeImpactMock.mockResolvedValue({ covers_worked_time: false });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders default and user rates as separate tables in the tenant currency', async () => {
    const { default: CostRatesSettings } = await import('./CostRatesSettings');
    render(<CostRatesSettings />);

    // Rates format in the tenant default currency returned by listCostRates.
    expect(await screen.findByText('Current default: EUR 50.00/hr from 2026-01-01')).toBeInTheDocument();
    // Tenant-default history lives in its own table, away from the users table.
    expect(screen.getByText('Tenant default cost rate')).toBeInTheDocument();
    expect(screen.getByTestId('cost-rates-default-table')).toBeInTheDocument();
    expect(screen.getByText('EUR 50.00/hr')).toBeInTheDocument();
    expect(screen.getByText('User rates')).toBeInTheDocument();
    expect(screen.getByTestId('cost-rates-users-table')).toBeInTheDocument();
    expect(screen.getAllByText('Alice A')).toHaveLength(2);
    expect(screen.getByText('EUR 62.50/hr')).toBeInTheDocument();
    // One edit/delete pair per rate, with a status chip separating current from history.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(3);
    expect(screen.getAllByText('Current')).toHaveLength(2);
    expect(screen.getAllByText('Ended')).toHaveLength(1);
  });

  it('shows a single Add Rate action and per-section empty states when no rates exist', async () => {
    listCostRatesMock.mockResolvedValue({ currency_code: 'EUR', default_rate_history: [], users: [] });

    const { default: CostRatesSettings } = await import('./CostRatesSettings');
    render(<CostRatesSettings />);

    expect(await screen.findByText('No default rates yet.')).toBeInTheDocument();
    expect(screen.getByText('No user-specific rates.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add Rate' })).toHaveLength(1);
    expect(screen.getByText('No tenant default is configured. Users without overrides will be uncosted.')).toBeInTheDocument();
  });

  it('stores currency input as integer cents when saving a new rate', async () => {
    const { default: CostRatesSettings } = await import('./CostRatesSettings');
    render(<CostRatesSettings />);

    await screen.findAllByText('Alice A');
    fireEvent.click(screen.getByRole('button', { name: 'Add Rate' }));
    fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '62.50' } });
    fireEvent.change(document.getElementById('cost-rate-effective-from') as HTMLInputElement, { target: { value: '2026-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(upsertCostRateMock).toHaveBeenCalledWith({
        rate_id: undefined,
        user_id: null,
        cost_rate: 6250,
        effective_from: '2026-02-01',
        effective_to: null,
      });
    });
  });

  it('warns before editing a rate that covers worked time', async () => {
    checkCostRateWorkedTimeImpactMock.mockResolvedValue({ covers_worked_time: true });

    const { default: CostRatesSettings } = await import('./CostRatesSettings');
    render(<CostRatesSettings />);

    await screen.findAllByText('Alice A');
    // Rows sort default-scope first, so the second Edit belongs to Alice's rate.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '70.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Worked time exists in this range')).toBeInTheDocument();
    expect(upsertCostRateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(upsertCostRateMock).toHaveBeenCalledWith({
        rate_id: 'user-rate-1',
        user_id: 'user-1',
        cost_rate: 7000,
        effective_from: '2026-01-01',
        effective_to: null,
      });
    });
  });
});
