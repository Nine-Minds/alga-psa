// @vitest-environment jsdom
// T008: RmaManager statuses, badge variants and ?status= filter match the DB CHECK; RMA # column renders rma_number.

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RmaManager } from './RmaManager';
import { getRmaCase } from '../actions';

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  usePathname: () => '/msp/inventory/rma',
  useSearchParams: () => nav.params,
}));
vi.mock('../actions', () => ({
  getRmaCase: vi.fn(async () => null),
  listRmaCases: vi.fn(async () => []),
  deadUnitsOwedReport: vi.fn(async () => []),
  listVendors: vi.fn(async () => []),
  listStockLocations: vi.fn(async () => []),
  listStockUnits: vi.fn(async () => []),
  openRma: vi.fn(),
  openAdvanceRma: vi.fn(),
  receiveReturn: vi.fn(),
  sendToVendor: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, fallback?: string, values?: Record<string, unknown>) =>
    (fallback ?? key).replace(/{{(\w+)}}/g, (_m, n) => String(values?.[n] ?? ''));
  return { useTranslation: () => ({ t }), useOptionalI18n: () => null };
});
vi.mock('@alga-psa/ui/lib', () => ({ useCurrencyFormat: () => ({ money: (n: number) => `$${n}` }) }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ usePageCreateShortcut: () => {}, useDialogSubmitShortcut: () => {} }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: any) => (
    <table data-testid={id}>
      <thead><tr>{columns.map((c: any, j: number) => <th key={j}>{c.title}</th>)}</tr></thead>
      <tbody>
        {data.map((rec: any, i: number) => (
          <tr key={i}>{columns.map((c: any, j: number) => <td key={j}>{c.render ? c.render(rec[c.dataIndex], rec) : null}</td>)}</tr>
        ))}
      </tbody>
    </table>
  ),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: React.forwardRef<HTMLButtonElement, any>(({ children, variant, size, ...props }, ref) => <button ref={ref} {...props}>{children}</button>),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, variant }: any) => <span data-variant={variant}>{children}</span>,
}));
vi.mock('./rma/RmaWarrantyPanel', () => ({ RmaWarrantyPanel: () => null }));
vi.mock('./rma/NewWarrantyClaimDialog', () => ({ NewWarrantyClaimDialog: () => null }));

const migrationDir = path.resolve(__dirname, '../../../../server/migrations');
const migrationSrc = fs.readFileSync(path.join(migrationDir, '20261029130000_add_warranty_review_to_rma_cases.cjs'), 'utf8');
const DB_STATUSES: string[] = (() => {
  const body = /const STATUSES = \[([\s\S]*?)\];/.exec(migrationSrc)![1];
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
})();

// Mirror of the component's local labels, in English (the mocked t returns fallbacks).
const LABELS: Record<string, string> = {
  warranty_review: 'Warranty review', open: 'Open', awaiting_return: 'Awaiting return', returned: 'Returned',
  sent_to_vendor: 'Sent to vendor', replacement_received: 'Replacement received', replacement_deployed: 'Replacement deployed',
  dead_unit_owed: 'Dead unit owed', replaced: 'Replaced', repaired: 'Repaired', credited: 'Credited', charged: 'Charged', closed: 'Closed',
};

const mk = (status: string, i: number) => ({
  rma_id: `0e7f4c70-0000-4000-8000-${String(i).padStart(12, '0')}`,
  rma_number: `RMA-${String(i).padStart(5, '0')}`,
  rma_reference: `VEND-${i}`,
  rma_type: 'standard',
  status,
  returned_unit_id: null,
  client_name: 'Acme',
  opened_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockClear();
});
afterEach(cleanup);

describe('RmaManager warranty statuses (T008)', () => {
  it('the migration CHECK includes warranty_review and repaired but not dead_unit_returned', () => {
    expect(DB_STATUSES).toContain('warranty_review');
    expect(DB_STATUSES).toContain('repaired');
    expect(DB_STATUSES).not.toContain('dead_unit_returned');
    expect([...DB_STATUSES].sort()).toEqual(Object.keys(LABELS).sort());
  });

  it('labels every DB status (no humanized fallback) and passes the expected badge variant', () => {
    const cases = DB_STATUSES.map((s, i) => mk(s, i + 1));
    render(<RmaManager initialCases={cases as any} initialDeadOwed={[]} />);
    const table = screen.getByTestId('rma-cases-table');
    const variants: Record<string, string> = {
      dead_unit_owed: 'warning', closed: 'success', replaced: 'success', credited: 'success', repaired: 'success',
      warranty_review: 'warning', charged: 'error',
    };
    for (const s of DB_STATUSES) {
      const badge = Array.from(table.querySelectorAll('span[data-variant]')).find((e) => e.textContent === LABELS[s]);
      expect(badge, `badge for ${s}`).toBeTruthy();
      expect(badge!.getAttribute('data-variant')).toBe(variants[s] ?? 'secondary');
    }
    expect(table.textContent).not.toMatch(/dead_unit_returned|Dead unit returned/i);
  });

  it('renders rma_number in the RMA # column, falling back to the vendor reference', () => {
    const noNumber = { ...mk('open', 2), rma_number: null };
    render(<RmaManager initialCases={[mk('warranty_review', 1), noNumber] as any} initialDeadOwed={[]} />);
    const table = screen.getByTestId('rma-cases-table');
    const headers = Array.from(table.querySelectorAll('th')).map((h) => h.textContent);
    expect(headers[0]).toBe('RMA #');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[0].querySelector('td')!.textContent).toBe('RMA-00001');
    expect(rows[1].querySelector('td')!.textContent).toBe('VEND-2');
  });

  it.each(DB_STATUSES)('?status=%s filters to exactly that status', (status) => {
    nav.params = new URLSearchParams(`status=${status}`);
    const cases = DB_STATUSES.map((s, i) => mk(s, i + 1));
    render(<RmaManager initialCases={cases as any} initialDeadOwed={[]} />);
    const rows = screen.getByTestId('rma-cases-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain(LABELS[status]);
    expect(document.getElementById('rma-clear-status-filter')).toBeTruthy();
  });

  it('ignores a status that the DB CHECK does not allow', () => {
    nav.params = new URLSearchParams('status=dead_unit_returned');
    const cases = DB_STATUSES.map((s, i) => mk(s, i + 1));
    render(<RmaManager initialCases={cases as any} initialDeadOwed={[]} />);
    expect(screen.getByTestId('rma-cases-table').querySelectorAll('tbody tr')).toHaveLength(DB_STATUSES.length);
    expect(document.getElementById('rma-clear-status-filter')).toBeNull();
  });

  it('looks up the mirrored vendor-case system for the opened RMA, not before a case is open', async () => {
    const rma = mk('open', 9);
    vi.mocked(getRmaCase).mockResolvedValueOnce(rma as any);
    const getMirrored = vi.fn(async () => 'custom:dell');
    nav.params = new URLSearchParams(`rmaId=${rma.rma_id}`);
    render(
      <RmaManager
        initialCases={[rma] as any}
        initialDeadOwed={[]}
        getMirroredVendorCaseSystem={getMirrored}
      />,
    );
    await waitFor(() => expect(getMirrored).toHaveBeenCalledTimes(1));
    expect(getMirrored).toHaveBeenCalledWith(rma.rma_id);
  });

  it('never looks up a mirrored system when no RMA is open', () => {
    const getMirrored = vi.fn(async () => 'custom:dell');
    render(<RmaManager initialCases={[mk('open', 10)] as any} initialDeadOwed={[]} getMirroredVendorCaseSystem={getMirrored} />);
    expect(getMirrored).not.toHaveBeenCalled();
  });
});
