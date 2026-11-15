/**
 * @vitest-environment jsdom
 *
 * Bucket Hours Utilization column visibility: Client and Contract are always
 * shown and not offered in the menu; the remaining columns are user-toggleable,
 * content-driven defaults (Overage only with bucket pools, block columns only
 * with prepaid blocks) apply only to columns the user has not set, and the
 * user's stored choice always wins.
 *
 * Also covers the block-status filter next to the Columns menu: pools count as
 * active, blocks filter on their own status, and both the on-screen table and
 * the printable table read the filtered rows.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

(globalThis as unknown as { React?: typeof React }).React = React;

const stableT = (key: string, options?: Record<string, unknown>) => {
  const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? `{{${name}}}`));
};

const prefs = vi.hoisted(() => ({ store: {} as Record<string, unknown>, writes: [] as Array<{ key: string; value: unknown }> }));

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: stableT, i18n: { language: 'en' } }),
}));

vi.mock('@alga-psa/user-composition/hooks', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react');
  return {
    useUserPreference: <T,>(key: string, options: { defaultValue: T }) => {
      const [value, setValueState] = ReactActual.useState<T>(
        (key in prefs.store ? prefs.store[key] : options.defaultValue) as T
      );
      const setValue = (next: T | ((previous: T) => T)) => {
        setValueState((previous) => {
          const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
          prefs.store[key] = resolved;
          prefs.writes.push({ key, value: resolved });
          return resolved;
        });
      };
      return { value, setValue, isLoading: false, error: null, isUserLoggedIn: true, hasLoadedInitial: true };
    },
  };
});

// Radix menus need pointer capture jsdom lacks; render the menu content inline.
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="columns-menu">{children}</div>,
}));

// Radix Select has the same pointer-capture problem; a plain select keeps the
// value/onValueChange contract the component relies on.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const reports = vi.hoisted(() => ({
  pools: [] as unknown[],
  blocks: [] as unknown[],
}));

vi.mock('@alga-psa/billing/actions/contractReportActions', () => ({
  getContractRevenueReport: vi.fn(async () => []),
  getContractExpirationReport: vi.fn(async () => []),
  getBucketUsageReport: vi.fn(async () => reports.pools),
  getHourBlockUsageReport: vi.fn(async () => reports.blocks),
  getContractReportSummary: vi.fn(async () => ({
    fixedMrrByCurrency: [],
    ytdRevenueByCurrency: [],
    activeContractCount: 1,
    atRiskDecisionCount: 0,
    variableUsageContractCount: 0,
  })),
}));

vi.mock('@alga-psa/billing/components/billing-dashboard/reports/ProfitabilityReport', () => ({
  default: () => null,
}));

import ContractReports from '@alga-psa/billing/components/billing-dashboard/reports/ContractReports';

const PREF_KEY = 'billing.reports.bucketUsage.columnVisibility';
const TOGGLEABLE_COLUMNS = [
  'service_name', 'total_hours', 'used_hours', 'remaining_hours',
  'utilization_percentage', 'overage_hours', 'hourly_rate', 'remaining_value', 'valid_from', 'expiration_date', 'status',
];
// Client and Contract anchor every row: always shown, never offered in the menu.
const ALWAYS_ON_COLUMNS = ['client_name', 'contract_name'];

const blockRow = {
  block_id: 'block-1',
  client_id: 'client-1',
  client_name: 'Acme Corp',
  service_name: 'Time Block - 40 Hours',
  contract_name: null,
  status: 'active',
  total_hours: 40,
  used_hours: 4,
  remaining_hours: 36,
  utilization_percentage: 10,
  hourly_rate: 11000,
  remaining_value: 396000,
  valid_from: '2026-10-15',
  currency_code: 'USD',
  purchased_at: '2026-10-15',
  expiration_date: '2027-10-15',
};
const expiredBlockRow = { ...blockRow, block_id: 'block-2', status: 'expired', service_name: 'Lapsed Block' };
const voidedBlockRow = { ...blockRow, block_id: 'block-3', status: 'voided', service_name: 'Cancelled Block' };
const poolRow = {
  contract_name: 'Managed Services',
  client_id: 'client-1',
  client_name: 'Acme Corp',
  total_hours: 10,
  used_hours: 2,
  remaining_hours: 8,
  utilization_percentage: 20,
  overage_hours: 0,
};

function toggle(id: string): HTMLInputElement {
  const element = document.getElementById(`bucket-usage-column-toggle-${id}`);
  if (!element) throw new Error(`no toggle for ${id}`);
  return element as HTMLInputElement;
}

function printHeaders(): string[] {
  const root = document.getElementById('bucket-usage-print');
  if (!root) throw new Error('no print root');
  return within(root).queryAllByRole('columnheader').map((cell) => cell.textContent?.trim() ?? '');
}

function printBodyText(): string {
  const root = document.getElementById('bucket-usage-print');
  if (!root) throw new Error('no print root');
  return within(root).queryAllByRole('cell').map((cell) => cell.textContent?.trim() ?? '').join(' | ');
}

function screenTableText(): string {
  const table = document.querySelector('[data-automation-id="bucket-usage-table"]');
  return table?.textContent ?? '';
}

function statusFilter(): HTMLSelectElement {
  const element = document.getElementById('bucket-usage-status-filter');
  if (!element) throw new Error('no status filter');
  return element as HTMLSelectElement;
}

async function renderBucketTab() {
  render(<ContractReports />);
  const tab = await screen.findByRole('tab', { name: 'Bucket Hours' });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  await waitFor(() => expect(document.getElementById('bucket-usage-column-toggle-total_hours')).not.toBeNull());
}

describe('Bucket Hours Utilization columns', () => {
  beforeEach(() => {
    prefs.store = {};
    prefs.writes = [];
    reports.pools = [];
    reports.blocks = [];
  });
  afterEach(() => cleanup());

  it('shows the core and block columns by default when only prepaid blocks exist, without Client/Contract toggles', async () => {
    reports.blocks = [blockRow];
    await renderBucketTab();

    for (const id of TOGGLEABLE_COLUMNS) expect(toggle(id)).not.toBeDisabled();
    for (const id of ALWAYS_ON_COLUMNS) expect(() => toggle(id)).toThrow(`no toggle for ${id}`);
    for (const id of ['total_hours', 'used_hours', 'remaining_hours', 'utilization_percentage', 'service_name', 'hourly_rate', 'remaining_value', 'valid_from', 'expiration_date', 'status']) {
      expect(toggle(id)).toBeChecked();
    }
    expect(toggle('overage_hours')).not.toBeChecked();
    expect(printHeaders()).toEqual([
      'Client', 'Contract', 'Service', 'Total Hours', 'Used Hours', 'Remaining', 'Utilization', 'Rate / hr', 'Remaining value', 'Valid from', 'Expires', 'Status',
    ]);
    // 36 h x 110.00/h, formatted from minor units in the block's own currency.
    expect(within(document.getElementById('bucket-usage-print') as HTMLElement).getByText('$3,960.00')).toBeInTheDocument();
  });

  it('defaults to Overage and no block columns when only bucket pools exist', async () => {
    reports.pools = [poolRow];
    await renderBucketTab();

    expect(toggle('overage_hours')).toBeChecked();
    for (const id of ['service_name', 'hourly_rate', 'remaining_value', 'valid_from', 'expiration_date', 'status']) expect(toggle(id)).not.toBeChecked();
    expect(printHeaders()).toEqual(['Client', 'Contract', 'Total Hours', 'Used Hours', 'Remaining', 'Utilization', 'Overage']);
  });

  it('lets the user show a defaulted-off column and hide a togglable core one, storing only those choices', async () => {
    reports.blocks = [blockRow];
    await renderBucketTab();

    fireEvent.click(toggle('overage_hours'));
    fireEvent.click(toggle('status'));

    await waitFor(() => expect(toggle('overage_hours')).toBeChecked());
    expect(toggle('status')).not.toBeChecked();
    expect(prefs.store[PREF_KEY]).toEqual({ overage_hours: true, status: false });
    expect(printHeaders()).toContain('Overage');
    expect(printHeaders()).not.toContain('Status');
  });

  it('keeps Client and Contract visible even when a stale preference hides them', async () => {
    reports.blocks = [blockRow];
    prefs.store[PREF_KEY] = { client_name: false, contract_name: false, status: false };
    await renderBucketTab();

    expect(() => toggle('client_name')).toThrow('no toggle for client_name');
    expect(() => toggle('contract_name')).toThrow('no toggle for contract_name');
    expect(printHeaders()).toContain('Client');
    expect(printHeaders()).toContain('Contract');
    expect(printHeaders()).not.toContain('Status');
  });

  it('keeps stored choices over content defaults, and reset returns to the defaults', async () => {
    reports.blocks = [blockRow];
    prefs.store[PREF_KEY] = { status: false, overage_hours: true };
    await renderBucketTab();

    expect(toggle('status')).not.toBeChecked();
    expect(toggle('overage_hours')).toBeChecked();
    expect(toggle('hourly_rate')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default columns' }));
    await waitFor(() => expect(toggle('status')).toBeChecked());
    expect(toggle('overage_hours')).not.toBeChecked();
    expect(prefs.store[PREF_KEY]).toEqual({});
    expect(screen.queryByRole('button', { name: 'Reset to default columns' })).toBeNull();
  });
});

describe('Bucket Hours Utilization block-status filter', () => {
  beforeEach(() => {
    prefs.store = {};
    prefs.writes = [];
    reports.pools = [poolRow];
    reports.blocks = [blockRow, expiredBlockRow, voidedBlockRow];
  });
  afterEach(() => cleanup());

  it('shows pools and every returned block status by default', async () => {
    await renderBucketTab();

    expect(statusFilter().value).toBe('all');
    for (const label of ['Managed Services', 'Time Block - 40 Hours', 'Lapsed Block', 'Cancelled Block']) {
      expect(screenTableText()).toContain(label);
      expect(printBodyText()).toContain(label);
    }
  });

  it('narrows to expired blocks, dropping pool and active rows', async () => {
    await renderBucketTab();

    fireEvent.change(statusFilter(), { target: { value: 'expired' } });
    await waitFor(() => expect(screenTableText()).not.toContain('Managed Services'));

    expect(screenTableText()).toContain('Lapsed Block');
    expect(screenTableText()).not.toContain('Time Block - 40 Hours');
    expect(screenTableText()).not.toContain('Cancelled Block');
    expect(printBodyText()).toContain('Lapsed Block');
    expect(printBodyText()).not.toContain('Cancelled Block');
  });

  it('counts bucket pools as active alongside active blocks', async () => {
    await renderBucketTab();

    fireEvent.change(statusFilter(), { target: { value: 'active' } });
    await waitFor(() => expect(screenTableText()).not.toContain('Lapsed Block'));

    expect(screenTableText()).toContain('Managed Services');
    expect(screenTableText()).toContain('Time Block - 40 Hours');
    expect(screenTableText()).not.toContain('Cancelled Block');
  });

  it('falls back to the empty message when a status matches nothing', async () => {
    reports.blocks = [blockRow];
    await renderBucketTab();

    fireEvent.change(statusFilter(), { target: { value: 'voided' } });
    await waitFor(() => expect(screen.getAllByText('No bucket-based contracts found').length).toBeGreaterThan(0));

    expect(document.querySelector('[data-automation-id="bucket-usage-table"]')).toBeNull();
  });
});
