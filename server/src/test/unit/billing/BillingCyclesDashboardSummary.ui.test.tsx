/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BillingCycles } from '@alga-psa/billing';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  )
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  DateRangePicker: () => null,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ asChild, children, ...props }: any) => {
    if (asChild) return <span {...props}>{children}</span>;
    return <button {...props}>{children}</button>;
  },
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: () => <div>Loading…</div>,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: any) => (
    <table data-automation-id={id}>
      <tbody>
        {data.map((row: any) => (
          <tr key={row.client_id}>
            {columns.map((col: any, idx: number) => {
              const value = row[col.dataIndex];
              const cell = col.render ? col.render(value, row) : String(value ?? '');
              return <td key={idx}>{cell}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('@alga-psa/billing/actions/billingCycleActions', () => ({
  getAllBillingCycles: vi.fn(async () => ({ 'client-1': 'monthly' })),
}));

vi.mock('@alga-psa/billing/actions/billingScheduleActions', () => ({
  getClientBillingScheduleSummaries: vi.fn(async () => ({
    'client-1': {
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null }
    }
  })),
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContracts: vi.fn(async () => []),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllClientsPaginated: vi.fn(async () => ({
    clients: [{ client_id: 'client-1', client_name: 'Acme Co' }],
    totalCount: 1
  })),
  getClientsWithBillingCycleRangePaginated: vi.fn(async () => ({
    clients: [{ client_id: 'client-1', client_name: 'Acme Co' }],
    totalCount: 1
  })),
  getActiveClientContractsByClientIds: vi.fn(async () => []),
}));

describe('Billing → Billing Cycles summary view', () => {
  it('renders a link to Client → Billing and does not render schedule editing controls', async () => {
    render(<BillingCycles />);

    await waitFor(() => {
      expect(screen.getByText('View Client Billing')).toBeTruthy();
    });

    expect(screen.queryByText('Edit Anchor')).toBeNull();
    expect(screen.queryByText('Create Next Cycle')).toBeNull();

    const link = screen.getByText('View Client Billing').closest('a');
    expect(link?.getAttribute('href')).toBe('/msp/clients/client-1?tab=Billing');
  });
});
