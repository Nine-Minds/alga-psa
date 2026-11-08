// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({
  listAssetAudits: vi.fn(),
  previewAssetAuditScope: vi.fn(),
  getClientLocationsForAssets: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../../actions/assetAuditActions', () => ({
  listAssetAudits: h.listAssetAudits,
  previewAssetAuditScope: h.previewAssetAuditScope,
}));
vi.mock('../../actions/clientLookupActions', () => ({
  getClientLocationsForAssets: h.getClientLocationsForAssets,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('./StartAuditDialog', () => ({
  NO_LOCATION_VALUE: '__none__',
  StartAuditDialog: ({ clientId }: { clientId?: string | null }) => (
    <div id="start-audit-dialog-stub">{clientId ?? 'no-client'}</div>
  ),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const count = typeof options?.count === 'number' ? options.count : null;
      const value =
        options?.defaultValue ?? (count === 1 ? options?.defaultValue_one : options?.defaultValue_other) ?? key;
      return String(value).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, onSelect }: any) => (
    <button id={id} type="button" onClick={() => onSelect('acme')}>
      pick client
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange, disabled }: any) => (
    <select aria-label={id} id={id} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  DateRangePicker: ({ id, onChange }: any) => (
    <button
      id={id}
      type="button"
      onClick={() => onChange({ from: new Date(2026, 2, 1), to: new Date(2026, 2, 31) })}
    >
      pick range
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns, onPageChange, onRowClick }: any) => (
    <div id={id}>
      <button id={`${id}-next-page`} type="button" onClick={() => onPageChange(2)}>
        Next page
      </button>
      {data.map((row: any, index: number) => (
        <div key={row.audit_id ?? index} id={`${id}-row-${row.audit_id}`}>
          <button type="button" id={`${id}-open-${row.audit_id}`} onClick={() => onRowClick(row)}>
            open
          </button>
          {columns.map((column: any, columnIndex: number) => (
            <span key={columnIndex}>
              {column.render ? column.render(row[column.dataIndex], row) : String(row[column.dataIndex] ?? '')}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/bento', () => ({
  BentoChip: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, children, onClick, disabled }: any) => (
    <button id={id} type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const { AssetAuditsList } = await import('./AssetAuditsList');

const audit = (overrides: Record<string, unknown> = {}) => ({
  audit_id: 'au-1',
  tenant: 't',
  client_id: 'acme',
  client_name: 'Acme Corp',
  location_id: 'loc-1',
  location_name: 'HQ',
  status: 'completed',
  started_by: 'u-1',
  started_by_name: 'Ada Lovelace',
  started_at: '2026-03-02T10:00:00.000Z',
  completed_at: '2026-03-02T12:00:00.000Z',
  expected_count: 10,
  present_count: 7,
  missing_count: 3,
  unexpected_count: 1,
  ...overrides,
});

function renderList(props: Record<string, unknown> = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AssetAuditsList {...(props as any)} />
    </SWRConfig>,
  );
}

beforeEach(() => {
  h.listAssetAudits.mockReset();
  h.previewAssetAuditScope.mockReset();
  h.getClientLocationsForAssets.mockReset();
  h.push.mockReset();
  h.listAssetAudits.mockResolvedValue({ success: true, data: { audits: [audit()], total: 1 } });
  h.previewAssetAuditScope.mockResolvedValue({ success: true, data: { expected_count: 0 } });
  h.getClientLocationsForAssets.mockResolvedValue([{ location_id: 'loc-1', location_name: 'HQ' }]);
});

afterEach(cleanup);

describe('AssetAuditsList', () => {
  it('lists the tenant audits newest-first page by page', async () => {
    renderList();

    await waitFor(() => expect(h.listAssetAudits).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

    fireEvent.click(document.getElementById('asset-audits-table-next-page')!);
    await waitFor(() =>
      expect(h.listAssetAudits).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it('narrows by client and goes back to the first page', async () => {
    renderList();
    await waitFor(() => expect(h.listAssetAudits).toHaveBeenCalled());
    fireEvent.click(document.getElementById('asset-audits-table-next-page')!);
    await waitFor(() => expect(h.listAssetAudits).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    fireEvent.click(document.getElementById('asset-audits-client-filter')!);

    await waitFor(() =>
      expect(h.listAssetAudits).toHaveBeenLastCalledWith(expect.objectContaining({ client_id: 'acme', page: 1 })),
    );
  });

  it('sends "no location" as its own filter, not as a location id', async () => {
    renderList({ clientId: 'acme' });
    await waitFor(() => expect(h.listAssetAudits).toHaveBeenCalled());

    fireEvent.change(document.getElementById('asset-audits-location-filter')!, { target: { value: '__none__' } });

    await waitFor(() => {
      const last = h.listAssetAudits.mock.calls.at(-1)![0];
      expect(last.no_location).toBe(true);
      expect(last.location_id).toBeUndefined();
    });
  });

  it('narrows by status', async () => {
    renderList();
    await waitFor(() => expect(h.listAssetAudits).toHaveBeenCalled());

    fireEvent.change(document.getElementById('asset-audits-status-filter')!, { target: { value: 'in_progress' } });

    await waitFor(() =>
      expect(h.listAssetAudits).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'in_progress' })),
    );
  });

  it('turns the picked days into instants, so a day means the viewer day', async () => {
    renderList();
    await waitFor(() => expect(h.listAssetAudits).toHaveBeenCalled());

    fireEvent.click(document.getElementById('asset-audits-started-filter')!);

    await waitFor(() => {
      const last = h.listAssetAudits.mock.calls.at(-1)![0];
      expect(last.started_from).toBe(new Date(2026, 2, 1, 0, 0, 0, 0).toISOString());
      expect(last.started_to).toBe(new Date(2026, 2, 31, 23, 59, 59, 999).toISOString());
    });
  });

  it('offers Start audit only to a user with asset:update', async () => {
    renderList();
    await waitFor(() => expect(document.getElementById('asset-audits-start-audit-button')).not.toBeNull());

    cleanup();
    h.previewAssetAuditScope.mockResolvedValue({ permissionError: 'Permission denied: Cannot update asset audits' });
    renderList();

    await waitFor(() => expect(h.listAssetAudits).toHaveBeenCalled());
    expect(document.getElementById('asset-audits-start-audit-button')).toBeNull();
  });

  it('links the client column to the client Audits tab', async () => {
    renderList();
    await waitFor(() => expect(document.getElementById('asset-audits-client-link-au-1')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audits-client-link-au-1')!);

    expect(h.push).toHaveBeenCalledWith('/msp/clients/acme?tab=audits');
  });

  it('drops the client column when embedded in one client', async () => {
    renderList({ clientId: 'acme', embedded: true });

    await waitFor(() => expect(h.listAssetAudits).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'acme' })));
    expect(document.getElementById('asset-audits-client-link-au-1')).toBeNull();
    expect(document.getElementById('asset-audits-client-filter')).toBeNull();
  });

  it('opens an audit detail page from its row', async () => {
    renderList();
    await waitFor(() => expect(document.getElementById('asset-audits-table-open-au-1')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audits-table-open-au-1')!);

    expect(h.push).toHaveBeenCalledWith('/msp/assets/audits/au-1');
  });

  it('names a location-less scope instead of leaving the cell blank', async () => {
    h.listAssetAudits.mockResolvedValue({
      success: true,
      data: { audits: [audit({ location_id: null, location_name: null })], total: 1 },
    });
    renderList();

    expect(await screen.findByText('No location')).toBeInTheDocument();
  });

  it('shows the server refusal instead of an empty table', async () => {
    h.listAssetAudits.mockResolvedValue({ success: false, error: { message: 'Audit store is unavailable' } });
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('Audit store is unavailable');
  });

  it('says the view is empty rather than showing nothing at all', async () => {
    h.listAssetAudits.mockResolvedValue({ success: true, data: { audits: [], total: 0 } });
    renderList();

    await waitFor(() =>
      expect(document.getElementById('asset-audits-empty')).toHaveTextContent('No site audits match this view yet.'),
    );
  });
});
