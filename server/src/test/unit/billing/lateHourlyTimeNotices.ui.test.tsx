/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ILateHourlyTimeNotice } from '@alga-psa/types';
import { LateHourlyTimeNotices } from '../../../../../packages/billing/src/components/billing-dashboard/LateHourlyTimeNotices';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
  useFormatters: () => ({
    formatDate: (value: string) => value,
  }),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: any) => (
    <table data-automation-id={id}>
      <tbody>
        {data.map((row: any) => (
          <tr key={row.entryId}>
            {columns.map((col: any, idx: number) => (
              <td key={idx}>{col.render ? col.render(row[col.dataIndex], row) : String(row[col.dataIndex] ?? '')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const notice = (overrides: Partial<ILateHourlyTimeNotice>): ILateHourlyTimeNotice => ({
  entryId: 'entry-1',
  clientId: 'client-1',
  clientName: 'Acme Corp',
  contractLineId: 'line-1',
  contractLineName: 'Hourly Support',
  serviceName: 'Remote Support',
  workItemLabel: '#T-100 Printer down',
  technicianName: 'Ada Lovelace',
  workDate: '2024-12-20',
  billableMinutes: 90,
  closedPeriodStart: '2024-12-01',
  closedPeriodEnd: '2024-12-31',
  closedByInvoiceNumber: 'INV-1',
  closedByInvoiceStatus: 'sent',
  disposition: 'next_invoice',
  ...overrides,
});

describe('LateHourlyTimeNotices', () => {
  it('renders nothing when there is no late time', () => {
    const { container } = render(<LateHourlyTimeNotices notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the waiting entry with its closed period, and an outside-lookback row', () => {
    render(
      <LateHourlyTimeNotices
        notices={[
          notice({}),
          notice({ entryId: 'entry-2', workDate: '2024-09-15', closedPeriodStart: '2024-09-01', closedPeriodEnd: '2024-09-30', disposition: 'outside_lookback' }),
        ]}
      />,
    );

    expect(screen.getAllByText('Acme Corp')).toHaveLength(2);
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(2);
    expect(screen.getByText('2024-12-01 – 2024-12-31')).toBeTruthy();
    expect(screen.getAllByText('1.50')).toHaveLength(2);
    expect(screen.getByText('Bills on next invoice')).toBeTruthy();
    expect(screen.getByText('2024-09-01 – 2024-09-30')).toBeTruthy();
    expect(screen.getByText('Outside lookback — not billed')).toBeTruthy();
    // never raw ids
    expect(screen.queryByText('entry-1')).toBeNull();
    expect(screen.queryByText('client-1')).toBeNull();
  });
});
