// @vitest-environment jsdom

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listHourBlocks: vi.fn() }));

vi.mock('@alga-psa/billing/actions/hourBlockActions', () => ({ listHourBlocks: mocks.listHourBlocks }));
vi.mock('../src/components/hour-blocks/SellHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/GrantHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/AdjustHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/EditExpirationDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/VoidHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/ManuallyExpireHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/HourBlockDetailDrawer', () => ({ default: () => null }));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <div>
      {data.map((record: any) => (
        <div key={record.block_id}>
          {columns.map((col: any, i: number) => (
            <span key={i}>{col.render ? col.render(record[col.dataIndex], record) : null}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

const translate = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }), useFormatters: () => ({ locale: 'en' }) }));

import HourBlocksSection from '../src/components/hour-blocks/HourBlocksSection';

const block = (id: string, coverage?: any[]) => ({
  block_id: id,
  client_id: 'client-1',
  service_id: 'svc-1',
  total_minutes: 600,
  remaining_minutes: 300,
  hourly_rate: 10000,
  currency_code: 'USD',
  status: 'active',
  expiration_date: null,
  scope_service_ids: [],
  scope_services: [],
  remaining_value: 50000,
  contract_coverage: coverage,
});

describe('hour block coverage badge', () => {
  beforeEach(() => mocks.listHourBlocks.mockReset());

  it('renders only on the block that has contract coverage', async () => {
    mocks.listHourBlocks.mockResolvedValue([
      block('covered', [{
        service_id: 'svc-1', service_name: 'Support', assignment: 'automatic',
        lines: [{ contract_id: 'c', contract_name: 'C', client_contract_id: 'cc', contract_line_id: 'l', contract_line_name: 'L', start_date: '2026-01-01', end_date: null }],
      }]),
      block('plain', []),
    ]);
    const { container } = render(<HourBlocksSection clientId="client-1" currencyCode="USD" />);
    await waitFor(() => expect(container.querySelector('#hb-coverage-badge-covered')).not.toBeNull());
    expect(container.querySelector('#hb-coverage-badge-plain')).toBeNull();
  });
});
