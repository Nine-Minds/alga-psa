// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listHourBlocksMock = vi.fn();

vi.mock('@alga-psa/billing/actions/hourBlockActions', () => ({
  listHourBlocks: (...args: unknown[]) => listHourBlocksMock(...args),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ locale: 'en' }),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, any>) => {
      const template: string = opts?.defaultValue ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(opts?.[name] ?? ''));
    },
  }),
}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: any) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Skeleton', () => ({ Skeleton: () => <div /> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, id }: any) => <button id={id}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ columns, data }: any) => (
    <div>
      {data.map((record: any) => (
        <div key={record.block_id} data-row={record.block_id}>
          {columns.map((col: any, i: number) => (
            <div key={i}>{col.render ? col.render(record[col.dataIndex], record, 0) : String(record[col.dataIndex] ?? '')}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));
vi.mock('../src/components/hour-blocks/SellHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/GrantHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/AdjustHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/EditExpirationDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/VoidHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/ManuallyExpireHourBlockDialog', () => ({ default: () => null }));
vi.mock('../src/components/hour-blocks/HourBlockDetailDrawer', () => ({ default: () => null }));

import HourBlocksSection, { isContractBlock } from '../src/components/hour-blocks/HourBlocksSection';

const base = {
  tenant: 't', client_id: 'c', service_id: 'svc', service_name: 'Support', total_minutes: 600,
  remaining_minutes: 300, hourly_rate: 15000, purchase_amount: 150000, currency_code: 'EUR',
  status: 'active', expiration_date: null, remaining_value: 75000, has_allocations: false,
  created_at: '2026-01-01',
};

afterEach(() => {
  cleanup();
  listHourBlocksMock.mockReset();
});

describe('HourBlocksSection contract blocks', () => {
  it('classifies contract-issued blocks', () => {
    expect(isContractBlock({ source_type: 'contract', contract_line_id: null })).toBe(true);
    expect(isContractBlock({ source_type: 'purchase', contract_line_id: 'L' })).toBe(true);
    expect(isContractBlock({ source_type: 'purchase', contract_line_id: null })).toBe(false);
  });

  it('shows "Contract: <name>" and hides Void for contract blocks while keeping Adjust and Edit expiration', async () => {
    listHourBlocksMock.mockResolvedValue([
      { ...base, block_id: 'contract-1', source_type: 'contract', contract_line_id: 'L', contract_name: 'Acme MSP', contract_line_name: 'Block line' },
      { ...base, block_id: 'adhoc-1', source_type: 'purchase', contract_line_id: null, invoice_number: 'INV-9' },
    ]);
    render(<HourBlocksSection clientId="c" currencyCode="EUR" />);
    await waitFor(() => expect(document.getElementById('hb-source-contract-contract-1')).not.toBeNull());

    expect(screen.getByText('Contract: Acme MSP')).toBeTruthy();
    expect(document.getElementById('hb-view-contract-1')).not.toBeNull();
    expect(document.getElementById('hb-adjust-contract-1')).not.toBeNull();
    expect(document.getElementById('hb-expiration-contract-1')).not.toBeNull();
    expect(document.getElementById('hb-void-contract-1')).toBeNull();

    // Ad-hoc block keeps the Void action.
    expect(document.getElementById('hb-void-adhoc-1')).not.toBeNull();
    expect(document.getElementById('hb-source-contract-adhoc-1')).toBeNull();
  });

  it('shows a valid-from line only for blocks that have a lower bound', async () => {
    listHourBlocksMock.mockResolvedValue([
      { ...base, block_id: 'cad-1', source_type: 'contract', contract_line_id: 'L', contract_name: 'Acme MSP', valid_from: '2026-11-01' },
      { ...base, block_id: 'plain-1', source_type: 'purchase', contract_line_id: null, valid_from: null },
    ]);
    render(<HourBlocksSection clientId="c" currencyCode="EUR" />);
    await waitFor(() => expect(document.getElementById('hb-valid-from-cad-1')).not.toBeNull());
    expect(document.getElementById('hb-valid-from-plain-1')).toBeNull();
  });
});
