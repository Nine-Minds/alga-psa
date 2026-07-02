/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDefinition } from '@alga-psa/types';

const getProfitabilitySummaryMock = vi.hoisted(() => vi.fn());
const getClientProfitabilityMock = vi.hoisted(() => vi.fn());
const getAgreementProfitabilityMock = vi.hoisted(() => vi.fn());
const getTicketProfitabilityMock = vi.hoisted(() => vi.fn());
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
  useTranslation: () => ({ t: tMock }),
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  }),
}));

vi.mock('@alga-psa/billing/actions', () => ({
  getProfitabilitySummary: (...args: unknown[]) => getProfitabilitySummaryMock(...args),
  getClientProfitability: (...args: unknown[]) => getClientProfitabilityMock(...args),
  getAgreementProfitability: (...args: unknown[]) => getAgreementProfitabilityMock(...args),
  getTicketProfitability: (...args: unknown[]) => getTicketProfitabilityMock(...args),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns, onRowClick, initialSorting }: {
    id: string;
    data: any[];
    columns: ColumnDefinition<any>[];
    onRowClick?: (row: any) => void;
    initialSorting?: Array<{ id: string; desc: boolean }>;
  }) => (
    <div data-testid={id} data-initial-sorting={JSON.stringify(initialSorting ?? [])}>
      {data.map((row, rowIndex) => (
        <div
          key={row.ticketId ?? row.clientContractId ?? row.clientId ?? rowIndex}
          role="button"
          tabIndex={0}
          onClick={() => onRowClick?.(row)}
        >
          {columns.map((column, columnIndex) => {
            const value = Array.isArray(column.dataIndex)
              ? column.dataIndex.reduce((current, key) => current?.[key], row)
              : row[column.dataIndex as keyof typeof row];
            return (
              <span key={`${String(column.dataIndex)}-${columnIndex}`}>
                {column.render ? column.render(value, row, rowIndex) : String(value ?? '')}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => <div className={className}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, onClick, type = 'button' }: React.PropsWithChildren<{
    id: string;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    type?: 'button' | 'submit' | 'reset';
  }>) => <button id={id} type={type} onClick={onClick}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: React.PropsWithChildren<{ id?: string }>) => <div id={id}>{children}</div>,
  AlertDescription: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => <div className={className}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a>,
}));

const metricFields = {
  revenue: 100000,
  laborCost: 30000,
  materialCost: 10000,
  margin: 60000,
  marginPct: 60,
  totalMinutes: 600,
  effectiveHourlyRate: 10000,
  uncostedMinutes: 0,
  unattributedMinutes: 0,
  unapprovedMinutes: 0,
  zeroDurationEntryCount: 0,
  uncostedMaterialCount: 0,
  unconvertedRevenueCount: 0,
  materialCurrencyMismatchCount: 0,
};

const summary = {
  ...metricFields,
  costRatesConfigured: true,
};

const clients = [
  {
    ...metricFields,
    clientId: 'client-1',
    clientName: 'Acme Corp',
  },
];

const agreements = [
  {
    ...metricFields,
    clientId: 'client-1',
    clientName: 'Acme Corp',
    clientContractId: 'assignment-1',
    contractId: 'contract-1',
    contractName: 'Managed Services',
    rowType: 'agreement' as const,
    lines: [
      {
        ...metricFields,
        contractLineId: 'line-1',
        contractLineName: 'Fixed Support',
        rowType: 'contract_line' as const,
      },
    ],
  },
  {
    ...metricFields,
    revenue: 5000,
    laborCost: 0,
    materialCost: 0,
    margin: 5000,
    clientId: 'client-1',
    clientName: 'Acme Corp',
    clientContractId: null,
    contractId: null,
    contractName: 'Ad-hoc / manual',
    rowType: 'ad_hoc' as const,
    lines: [],
  },
];

const tickets = [
  {
    ...metricFields,
    ticketId: 'ticket-1',
    ticketNumber: '123',
    title: 'Server issue',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    clientContractId: 'assignment-1',
    attribution: 'exact' as const,
    billableMinutes: 120,
    uncosted: true,
  },
];

async function renderReport() {
  const { default: ProfitabilityReport } = await import('./ProfitabilityReport');
  render(<ProfitabilityReport />);
  await screen.findByText('Profitability Report');
}

describe('ProfitabilityReport', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-02T12:00:00Z'));
    vi.clearAllMocks();
    getProfitabilitySummaryMock.mockResolvedValue(summary);
    getClientProfitabilityMock.mockResolvedValue(clients);
    getAgreementProfitabilityMock.mockResolvedValue(agreements);
    getTicketProfitabilityMock.mockResolvedValue(tickets);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders summary cards and the timing-basis tooltip', async () => {
    await renderReport();

    expect(screen.getAllByText('$1000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0);
    expect(screen.getByTitle(/Revenue is filtered by invoice date/)).toBeInTheDocument();
  });

  it('defaults to the last complete month and refetches on date change', async () => {
    await renderReport();

    expect(screen.getByLabelText('Start Date')).toHaveValue('2026-06-01');
    expect(screen.getByLabelText('End Date')).toHaveValue('2026-06-30');
    expect(getProfitabilitySummaryMock).toHaveBeenCalledWith({ startDate: '2026-06-01', endDate: '2026-06-30' });

    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-05-31' } });
    fireEvent.click(document.getElementById('profitability-apply-date-range') as HTMLElement);

    await waitFor(() => {
      expect(getProfitabilitySummaryMock).toHaveBeenCalledWith({ startDate: '2026-05-01', endDate: '2026-05-31' });
    });
  });

  it('drills from client rows into agreements and ticket rows with attribution indicators', async () => {
    await renderReport();

    expect(screen.getByTestId('profitability-client-table')).toHaveAttribute('data-initial-sorting', '[{\"id\":\"marginPct\",\"desc\":false}]');

    fireEvent.click(screen.getByText('Acme Corp'));

    expect(await screen.findByText('Agreements for Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Managed Services')).toBeInTheDocument();
    expect(screen.getByText('Ad-hoc')).toBeInTheDocument();
    expect(screen.getByText('#123 Server issue')).toBeInTheDocument();
    expect(screen.getByText('Exact')).toBeInTheDocument();
    expect(screen.getByText('Uncosted')).toBeInTheDocument();
  });

  it('expands agreement rows to line-level details', async () => {
    await renderReport();
    fireEvent.click(screen.getByText('Acme Corp'));

    await screen.findByText('Managed Services');
    fireEvent.click(document.getElementById('profitability-toggle-lines-assignment-1') as HTMLElement);

    expect(await screen.findByText('Contract lines for Managed Services')).toBeInTheDocument();
    expect(screen.getByText('Fixed Support')).toBeInTheDocument();
  });

  it('shows cost-rate empty state and report warnings', async () => {
    getProfitabilitySummaryMock.mockResolvedValue({
      ...summary,
      costRatesConfigured: false,
      uncostedMinutes: 60,
      unapprovedMinutes: 30,
      zeroDurationEntryCount: 1,
      uncostedMaterialCount: 2,
      unconvertedRevenueCount: 3,
      materialCurrencyMismatchCount: 4,
    });

    await renderReport();

    expect(screen.getByText(/Cost rates are not configured/)).toBeInTheDocument();
    expect(document.getElementById('profitability-settings-link')).toBeInTheDocument();
    expect(screen.getByText(/1.0 uncosted hours/)).toBeInTheDocument();
    expect(screen.getByText(/0.5 unapproved hours included/)).toBeInTheDocument();
    expect(screen.getByText(/1 zero-duration entries/)).toBeInTheDocument();
    expect(screen.getByText(/2 uncosted materials/)).toBeInTheDocument();
    expect(screen.getByText(/3 unconverted revenue rows/)).toBeInTheDocument();
    expect(screen.getByText(/4 material currency mismatches/)).toBeInTheDocument();
  });

  it('renders an error state when an action fails', async () => {
    getProfitabilitySummaryMock.mockRejectedValue(new Error('boom'));

    const { default: ProfitabilityReport } = await import('./ProfitabilityReport');
    render(<ProfitabilityReport />);

    expect(await screen.findByText('Error Loading Profitability')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
