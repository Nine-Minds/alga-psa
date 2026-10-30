// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockUnitsManager } from './StockUnitsManager';
import { RmaManager } from './RmaManager';

const UNIT_ID = '541b5b63-9e14-47b6-a8f0-0b664f079ed4';
const RMA_ID = '0e7f4c70-0000-4000-8000-000000000001';

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), push: vi.fn() }));
const actions = vi.hoisted(() => ({
  getUnitDetail: vi.fn(),
  getRmaCase: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  usePathname: () => '/msp/inventory/units',
  useSearchParams: () => nav.params,
}));
vi.mock('../actions', () => ({
  getUnitDetail: (id: string) => actions.getUnitDetail(id),
  getRmaCase: (id: string) => actions.getRmaCase(id),
  listStockLocations: vi.fn(async () => []),
  listStockUnits: vi.fn(async () => []),
  listInventoryProducts: vi.fn(async () => []),
  searchUnitsByMac: vi.fn(async () => []),
  searchUnitsBySerial: vi.fn(async () => []),
  listRmaCases: vi.fn(async () => []),
  deadUnitsOwedReport: vi.fn(async () => []),
  listVendors: vi.fn(async () => []),
  openRma: vi.fn(),
  openAdvanceRma: vi.fn(),
  receiveReturn: vi.fn(),
  sendToVendor: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (_key: string, fallback?: string, values?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/{{(\w+)}}/g, (_m, n) => String(values?.[n] ?? ''));
  return { useTranslation: () => ({ t }), useOptionalI18n: () => null };
});
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (n: number) => `$${n}` }),
}));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  usePageCreateShortcut: () => {},
  useDialogSubmitShortcut: () => {},
}));
// Rows render only their action column so the "History" action is reachable.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <div>
      {data.map((rec: any, i: number) => (
        <div key={i}>{columns.map((c: any, j: number) => <span key={j}>{c.render ? c.render(rec[c.dataIndex], rec) : null}</span>)}</div>
      ))}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, ...props }, ref) => <button ref={ref} {...props}>{children}</button>,
  ),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ id, isOpen, title, onClose, children }: any) =>
    isOpen ? (
      <section id={id}>
        <h2>{title}</h2>
        <button id={`${id}-close`} onClick={onClose}>close</button>
        {children}
      </section>
    ) : null,
}));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({ SearchInput: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: () => null }));
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({ CurrencyInput: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/AsyncSearchableSelect', () => ({ AsyncSearchableSelect: () => null }));
vi.mock('@alga-psa/ui/components/EmptyState', () => ({ EmptyState: () => null }));
vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({ ClientNameCell: () => null }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));

const unit = {
  unit_id: UNIT_ID,
  serial_number: 'SN-OPEN-1',
  mac_address: null,
  status: 'in_stock',
  location_id: null,
  unit_cost: null,
  asset_id: null,
};

function setParams(qs: string) {
  nav.params = new URLSearchParams(qs);
}

beforeEach(() => {
  setParams('');
  nav.replace.mockClear();
  actions.getUnitDetail.mockReset();
  actions.getRmaCase.mockReset();
});
afterEach(cleanup);

describe('StockUnitsManager ?unitId=', () => {
  it('opens the unit dialog for a readable unit', async () => {
    actions.getUnitDetail.mockResolvedValue({ unit, movements: [] });
    setParams(`unitId=${UNIT_ID}`);
    render(<StockUnitsManager initialUnits={[]} />);
    await screen.findByText('Unit SN-OPEN-1');
    expect(actions.getUnitDetail).toHaveBeenCalledWith(UNIT_ID);
    expect(document.getElementById('unit-detail-print-label')).toBeTruthy();
  });

  it.each([
    ['unknown id', null],
    ['permission denied', { permissionError: 'Permission denied: inventory read required' }],
  ])('shows only the unavailable state for %s', async (_label, result) => {
    actions.getUnitDetail.mockResolvedValue(result);
    setParams(`unitId=${UNIT_ID}`);
    render(<StockUnitsManager initialUnits={[]} />);
    await screen.findByText("Not found, or you don't have access");
    expect(screen.queryByText(/SN-OPEN-1/)).toBeNull();
    expect(document.getElementById('unit-detail-print-label')).toBeNull();
  });

  it('does not call the action for a malformed id', async () => {
    setParams('unitId=not-a-uuid');
    render(<StockUnitsManager initialUnits={[]} />);
    await screen.findByText("Not found, or you don't have access");
    expect(actions.getUnitDetail).not.toHaveBeenCalled();
  });

  it('closing removes unitId and keeps other params', async () => {
    actions.getUnitDetail.mockResolvedValue({ unit, movements: [] });
    setParams(`status=in_stock&unitId=${UNIT_ID}`);
    render(<StockUnitsManager initialUnits={[]} />);
    await screen.findByText('Unit SN-OPEN-1');
    fireEvent.click(document.getElementById('unit-history-dialog-close')!);
    expect(nav.replace).toHaveBeenCalledWith('/msp/inventory/units?status=in_stock');
  });

  it('the row History action opens the same dialog by setting unitId', async () => {
    render(<StockUnitsManager initialUnits={[unit as never]} />);
    fireEvent.click(await screen.findByText('History'));
    expect(nav.replace).toHaveBeenCalledWith(`/msp/inventory/units?unitId=${UNIT_ID}`);
  });

  it('prints through POST /api/labels/pdf with the stock-unit-identity class', async () => {
    actions.getUnitDetail.mockResolvedValue({ unit, movements: [] });
    setParams(`unitId=${UNIT_ID}`);
    const fetchMock = vi.fn(async () => new Response(new Blob(['%PDF']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    (URL as any).createObjectURL = vi.fn(() => 'blob:pdf');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<StockUnitsManager initialUnits={[]} />);
    await screen.findByText('Unit SN-OPEN-1');
    fireEvent.click(document.getElementById('unit-detail-print-label')!);
    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:pdf', '_blank'));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/labels/pdf');
    expect(JSON.parse(init.body as string)).toEqual({ labelClass: 'stock-unit-identity', labels: [{ recordId: UNIT_ID }] });
    vi.unstubAllGlobals();
  });

  it('shows the server message on 422 and offers the suggested template once', async () => {
    actions.getUnitDetail.mockResolvedValue({ unit, movements: [] });
    setParams(`unitId=${UNIT_ID}`);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Too long for this template', failures: [{ suggestedTemplateCode: 'compact' }] }), { status: 422 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<StockUnitsManager initialUnits={[]} />);
    await screen.findByText('Unit SN-OPEN-1');
    fireEvent.click(document.getElementById('unit-detail-print-label')!);
    await screen.findByText(/Too long for this template/);
    fireEvent.click(document.getElementById('unit-detail-print-suggested')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[1] as any)[1].body).templateId).toBe('compact');
    await waitFor(() => expect(document.getElementById('unit-detail-print-suggested')).toBeNull());
    vi.unstubAllGlobals();
  });
});

describe('RmaManager ?rmaId=', () => {
  const rma = {
    rma_id: RMA_ID, rma_type: 'standard', status: 'returned', rma_reference: 'RMA-77', reason: 'Dead on arrival',
    client_name: 'Client A', vendor_name: 'Vendor A', service_name: 'Router', returned_serial_number: 'SN-R-9',
    returned_unit_id: UNIT_ID, asset_id: null, opened_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  };

  it('opens the RMA dialog and links to the unit', async () => {
    actions.getRmaCase.mockResolvedValue(rma);
    setParams(`rmaId=${RMA_ID}`);
    render(<RmaManager initialCases={[]} initialDeadOwed={[]} />);
    await screen.findByText('RMA RMA-77');
    expect(screen.getByText('SN-R-9')).toBeTruthy();
    fireEvent.click(document.getElementById('rma-detail-view-unit')!);
    expect(nav.push).toHaveBeenCalledWith(`/msp/inventory/units?unitId=${UNIT_ID}`);
  });

  it.each([
    ['missing', null],
    ['denied', { permissionError: 'Permission denied' }],
  ])('%s id shows the unavailable state with no RMA content', async (_l, result) => {
    actions.getRmaCase.mockResolvedValue(result);
    setParams(`rmaId=${RMA_ID}`);
    render(<RmaManager initialCases={[]} initialDeadOwed={[]} />);
    await screen.findByText("Not found, or you don't have access");
    expect(screen.queryByText(/RMA-77|SN-R-9|Dead on arrival/)).toBeNull();
  });

  it('does not call the action for a malformed id', async () => {
    setParams('rmaId=not-a-uuid');
    render(<RmaManager initialCases={[]} initialDeadOwed={[]} />);
    await screen.findByText("Not found, or you don't have access");
    expect(actions.getRmaCase).not.toHaveBeenCalled();
  });

  it('closing removes rmaId', async () => {
    actions.getRmaCase.mockResolvedValue(rma);
    setParams(`rmaId=${RMA_ID}`);
    render(<RmaManager initialCases={[]} initialDeadOwed={[]} />);
    await screen.findByText('RMA RMA-77');
    fireEvent.click(document.getElementById('rma-detail-dialog-close')!);
    expect(nav.replace).toHaveBeenCalledWith('/msp/inventory/units');
  });
});
