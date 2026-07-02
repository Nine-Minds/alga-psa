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

const defaultData = {
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

  it('renders the default banner, internal user list, current rates, and history', async () => {
    const { default: CostRatesSettings } = await import('./CostRatesSettings');
    render(<CostRatesSettings />);

    expect(await screen.findByText('Tenant default cost rate')).toBeInTheDocument();
    expect(screen.getByText('Current default: $50.00/hr from 2026-01-01')).toBeInTheDocument();
    expect(screen.getByText('Alice A')).toBeInTheDocument();
    expect(screen.getByText('$62.50/hr')).toBeInTheDocument();

    fireEvent.click(document.getElementById('toggle-cost-rate-history-user-1') as HTMLElement);

    expect(screen.getAllByText('2026-01-01 - open')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('shows the tenant-default empty state when no rates exist', async () => {
    listCostRatesMock.mockResolvedValue({ default_rate_history: [], users: [] });

    const { default: CostRatesSettings } = await import('./CostRatesSettings');
    render(<CostRatesSettings />);

    expect(await screen.findByText('Cost rates are not configured')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Set Default' })).toHaveLength(2);
  });

  it('stores currency input as integer cents when saving a user rate', async () => {
    const { default: CostRatesSettings } = await import('./CostRatesSettings');
    render(<CostRatesSettings />);

    await screen.findByText('Alice A');
    fireEvent.click(screen.getByRole('button', { name: 'Add user rate' }));
    fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '62.50' } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(upsertCostRateMock).toHaveBeenCalledWith({
        user_id: 'user-1',
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

    await screen.findByText('Alice A');
    fireEvent.click(document.getElementById('toggle-cost-rate-history-user-1') as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
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
