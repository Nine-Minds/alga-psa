// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({
  getAssetAudit: vi.fn(),
  markAssetAuditItem: vi.fn(),
  unmarkAssetAuditItem: vi.fn(),
  addUnexpectedAuditAsset: vi.fn(),
  completeAssetAudit: vi.fn(),
  cancelAssetAudit: vi.fn(),
  previewAssetAuditScope: vi.fn(),
  listAssets: vi.fn(),
  getAssetTypes: vi.fn(),
  renderQuickAddTicket: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastPlain: vi.fn(),
  lastColumns: [] as any[],
}));

vi.mock('../../actions/assetAuditActions', () => ({
  getAssetAudit: h.getAssetAudit,
  markAssetAuditItem: h.markAssetAuditItem,
  unmarkAssetAuditItem: h.unmarkAssetAuditItem,
  addUnexpectedAuditAsset: h.addUnexpectedAuditAsset,
  completeAssetAudit: h.completeAssetAudit,
  cancelAssetAudit: h.cancelAssetAudit,
  previewAssetAuditScope: h.previewAssetAuditScope,
  listAssetAudits: vi.fn(),
}));
vi.mock('../../actions/assetActions', () => ({ listAssets: h.listAssets }));
vi.mock('../../actions/assetActionErrors', () => ({ unwrapAssetActionResult: (value: unknown) => value }));
vi.mock('../../actions/assetTypeRegistryActions', () => ({ getAssetTypes: h.getAssetTypes }));
// The scope statuses are read through the registry, as every other asset
// surface does; the hook itself is a server round trip.
vi.mock('../shared/useAssetStatusOptions', () => ({ useAssetStatusRegistry: () => ({ statuses: null }) }));
vi.mock('react-hot-toast', () => ({
  toast: Object.assign((message: string) => h.toastPlain(message), { success: h.toastSuccess }),
}));
vi.mock('../../context/AssetCrossFeatureContext', () => ({
  useAssetCrossFeature: () => ({ renderQuickAddTicket: h.renderQuickAddTicket }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
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
vi.mock('@alga-psa/ui/components/BackNav', () => ({
  __esModule: true,
  default: ({ id, href, children }: any) => (
    <a id={id} href={href}>
      {children}
    </a>
  ),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, children, onClick, disabled }: any) => (
    <button id={id} type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, value, onChange, placeholder }: any) => (
    <input id={id} value={value} onChange={onChange} placeholder={placeholder} />
  ),
}));
vi.mock('@alga-psa/ui/components/AsyncSearchableSelect', () => ({
  AsyncSearchableSelect: ({ id, onChange, dropdownMode }: any) => (
    <button id={id} type="button" data-dropdown-mode={dropdownMode} onClick={() => onChange('as-9')}>
      choose asset
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  CustomTabs: ({ idPrefix, tabs, onTabChange }: any) => (
    <div id={idPrefix}>
      {tabs.map((tab: any) => (
        <button key={tab.id} id={`${idPrefix}-${tab.id}`} type="button" onClick={() => onTabChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ id, isOpen, title, children, allowOverflow }: any) =>
    isOpen ? (
      <div id={id} role="dialog" data-allow-overflow={allowOverflow ? 'true' : 'false'}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
// A stand-in for the real table's paging: it slices to the page it was given,
// which is what the real one does whether or not the pager is on screen. A
// table asked not to paginate would therefore hide everything past row 10.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns, pagination, currentPage, pageSize, onPageChange }: any) => {
    h.lastColumns = columns;
    const size = pagination === false ? 10 : (pageSize ?? 10);
    const page = pagination === false ? 1 : (currentPage ?? 1);
    const visible = data.slice((page - 1) * size, page * size);
    return (
      <div id={id} data-page={page} data-page-size={size} data-total={data.length}>
        {visible.map((row: any) => (
          <div key={row.asset_id} id={`${id}-row-${row.asset_id}`}>
            {columns.map((column: any, index: number) => (
              <span key={index}>
                {column.render ? column.render(row[column.dataIndex], row) : String(row[column.dataIndex] ?? '')}
              </span>
            ))}
          </div>
        ))}
        {pagination !== false && data.length > page * size ? (
          <button id={`${id}-next-page`} type="button" onClick={() => onPageChange?.(page + 1)}>
            next
          </button>
        ) : null}
      </div>
    );
  },
}));
vi.mock('@alga-psa/ui/components/bento', () => ({
  BentoChip: ({ children }: any) => <span>{children}</span>,
  BentoLabelValue: ({ id, label, value }: any) => (
    <div id={id}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  BentoStat: ({ id, value, label }: any) => (
    <div id={id}>
      <span>{value}</span>
      <span>{label}</span>
    </div>
  ),
  BentoTile: ({ id, title, action, children }: any) => (
    <section id={id}>
      <h3>{title}</h3>
      {action}
      {children}
    </section>
  ),
  BentoTileEmpty: ({ id, children }: any) => <p id={id}>{children}</p>,
}));

const { computeColumnFit, getColumnId, getColumnLayout } = await import(
  '@alga-psa/ui/components/dataTableColumnFit'
);
const { AssetAuditDetail, effectiveAuditSegment } = await import('./AssetAuditDetail');

const item = (overrides: Record<string, unknown> = {}) => ({
  asset_id: 'as-1',
  result: 'expected',
  method: null,
  marked_at: null,
  marked_by: null,
  marked_by_name: null,
  asset_name: 'Reception PC',
  asset_tag: 'ACME-001',
  serial_number: 'SN1',
  asset_type: 'workstation',
  ...overrides,
});

const auditPayload = (overrides: Record<string, unknown> = {}) => ({
  audit_id: 'au-1',
  tenant: 't',
  client_id: 'acme',
  client_name: 'Acme Corp',
  location_id: 'loc-1',
  location_name: 'HQ',
  status: 'in_progress',
  started_by: 'u-1',
  started_by_name: 'Ada Lovelace',
  started_at: '2026-03-02T10:00:00.000Z',
  completed_at: null,
  expected_count: 3,
  present_count: 0,
  missing_count: 0,
  unexpected_count: 0,
  statuses: ['active'],
  notes: 'Quarterly walk',
  items: [
    item(),
    item({ asset_id: 'as-2', asset_name: 'Back office laptop', result: 'present', method: 'manual', marked_by_name: 'Grace Hopper', marked_at: '2026-03-02T11:00:00.000Z' }),
    item({ asset_id: 'as-3', asset_name: 'Store tablet', result: 'missing', asset_type: 'door_access' }),
    item({ asset_id: 'as-4', asset_name: 'Stray printer', result: 'unexpected', method: 'manual' }),
  ],
  ...overrides,
});

function renderDetail() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AssetAuditDetail auditId="au-1" />
    </SWRConfig>,
  );
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as any).mockReset?.());
  h.getAssetAudit.mockResolvedValue({ success: true, data: auditPayload() });
  h.previewAssetAuditScope.mockResolvedValue({ success: true, data: { expected_count: 0 } });
  h.getAssetTypes.mockResolvedValue([{ slug: 'door_access', name: 'Door access', is_builtin: false }]);
  h.listAssets.mockResolvedValue({ assets: [], total: 0 });
  h.markAssetAuditItem.mockResolvedValue({ success: true, data: auditPayload() });
  h.unmarkAssetAuditItem.mockResolvedValue({ success: true, data: auditPayload() });
  h.addUnexpectedAuditAsset.mockResolvedValue({ success: true, data: auditPayload() });
  h.completeAssetAudit.mockResolvedValue({ success: true, data: auditPayload({ status: 'completed' }) });
  h.cancelAssetAudit.mockResolvedValue({ success: true, data: auditPayload({ status: 'cancelled' }) });
  h.renderQuickAddTicket.mockImplementation((props: any) => (
    <div id="quick-add-ticket-stub" data-asset={props.assetId} data-title={props.prefilledTitle} />
  ));
});

afterEach(cleanup);

describe('AssetAuditDetail', () => {
  it('heads the run with its scope, counts and who started it', async () => {
    renderDetail();

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    // The same handle the list links from, so a row and this page read as one run.
    expect(document.getElementById('asset-audit-reference')).toHaveTextContent('#au-1');
    expect(document.getElementById('asset-audit-location')).toHaveTextContent('HQ');
    expect(document.getElementById('asset-audit-started-by')).toHaveTextContent('Ada Lovelace');
    expect(document.getElementById('asset-audit-notes')).toHaveTextContent('Quarterly walk');
    expect(document.getElementById('asset-audit-stat-expected')).toHaveTextContent('3');
    expect(document.getElementById('asset-audit-stat-present')).toHaveTextContent('1');
    // While the run is open the third stat is what is left to find, not missing.
    expect(document.getElementById('asset-audit-stat-missing')).toHaveTextContent('remaining');
  });

  // The items table hides what does not fit rather than scrolling, so every
  // column declares the width it may shrink to instead of losing "Marked at".
  it.each([1400, 1100])('fits every item column in a %ipx table', async (containerWidth) => {
    renderDetail();
    await waitFor(() => expect(h.lastColumns.length).toBeGreaterThan(0));

    const columns = h.lastColumns;
    const { visibleColumnIds } = computeColumnFit(
      columns,
      containerWidth,
      getColumnLayout(columns, containerWidth),
    );

    expect(visibleColumnIds).toEqual(columns.map((column) => getColumnId(column)));
  });

  it('names a location-less scope', async () => {
    h.getAssetAudit.mockResolvedValue({
      success: true,
      data: auditPayload({ location_id: null, location_name: null }),
    });
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-location')).toHaveTextContent('No location'));
  });

  it('shows the registry display name for a custom asset type, never the slug', async () => {
    renderDetail();
    // The remaining segment holds the workstation; the missing one holds the
    // custom type, so switch to it.
    await waitFor(() => expect(document.getElementById('asset-audit-segments-missing')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-segments-missing')!);

    expect(await screen.findByText('Door access')).toBeInTheDocument();
    expect(screen.queryByText('door_access')).toBeNull();
  });

  it('opens on the remaining segment, and filters by segment', async () => {
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-items-table-row-as-1')).not.toBeNull());
    expect(document.getElementById('asset-audit-items-table-row-as-2')).toBeNull();

    fireEvent.click(document.getElementById('asset-audit-segments-present')!);

    await waitFor(() => expect(document.getElementById('asset-audit-items-table-row-as-2')).not.toBeNull());
    expect(document.getElementById('asset-audit-items-table-row-as-1')).toBeNull();
  });

  it('pages over every item instead of stopping at the table default', async () => {
    // 26 devices in one scope: more than the table's default page of 10, and
    // more than one page of the audit's own size.
    const many = Array.from({ length: 26 }, (_value, index) =>
      item({ asset_id: `as-${index + 1}`, asset_name: `Device ${String(index + 1).padStart(2, '0')}` }),
    );
    h.getAssetAudit.mockResolvedValue({ success: true, data: auditPayload({ items: many, expected_count: 26 }) });
    renderDetail();

    const table = async () => {
      await waitFor(() => expect(document.getElementById('asset-audit-items-table')).not.toBeNull());
      return document.getElementById('asset-audit-items-table')!;
    };

    // Row 11 is past the table default but inside the audit's page size.
    await waitFor(() => expect(document.getElementById('asset-audit-items-table-row-as-11')).not.toBeNull());
    expect((await table()).getAttribute('data-page-size')).toBe('25');
    expect(document.getElementById('asset-audit-items-table-row-as-26')).toBeNull();

    fireEvent.click(document.getElementById('asset-audit-items-table-next-page')!);

    await waitFor(() => expect(document.getElementById('asset-audit-items-table-row-as-26')).not.toBeNull());
  });

  it('returns to the first page when the segment changes', async () => {
    const many = Array.from({ length: 30 }, (_value, index) =>
      item({ asset_id: `as-${index + 1}`, asset_name: `Device ${index + 1}` }),
    );
    h.getAssetAudit.mockResolvedValue({ success: true, data: auditPayload({ items: many }) });
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-items-table-next-page')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-items-table-next-page')!);
    await waitFor(() =>
      expect(document.getElementById('asset-audit-items-table')?.getAttribute('data-page')).toBe('2'),
    );

    fireEvent.click(document.getElementById('asset-audit-segments-all')!);

    await waitFor(() =>
      expect(document.getElementById('asset-audit-items-table')?.getAttribute('data-page')).toBe('1'),
    );
  });

  it('searches the items by name, tag or serial', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-segments-all')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-segments-all')!);

    fireEvent.change(document.getElementById('asset-audit-item-search')!, { target: { value: 'tablet' } });

    await waitFor(() => expect(document.getElementById('asset-audit-items-table-row-as-3')).not.toBeNull());
    expect(document.getElementById('asset-audit-items-table-row-as-1')).toBeNull();
  });

  it('marks a remaining asset present and revalidates the run', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-mark-present-button-as-1')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-mark-present-button-as-1')!);

    await waitFor(() => expect(h.markAssetAuditItem).toHaveBeenCalledWith('au-1', 'as-1'));
    // Mutated rather than written from the response, so a mark made on a phone
    // in the meantime is picked up too.
    await waitFor(() => expect(h.getAssetAudit.mock.calls.length).toBeGreaterThan(1));
  });

  it('undoes a mark on an already-marked asset', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-segments-present')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-segments-present')!);

    await waitFor(() => expect(document.getElementById('asset-audit-undo-mark-button-as-2')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-undo-mark-button-as-2')!);

    await waitFor(() => expect(h.unmarkAssetAuditItem).toHaveBeenCalledWith('au-1', 'as-2'));
  });

  it('counts the one unmarked device in the Complete confirmation', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-complete-button')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-complete-button')!);

    expect(await screen.findByText('1 unmarked device will be recorded as missing.')).toBeInTheDocument();
    fireEvent.click(document.getElementById('asset-audit-complete-confirm-button')!);
    await waitFor(() => expect(h.completeAssetAudit).toHaveBeenCalledWith('au-1'));
  });

  it('pluralises the Complete confirmation when several are unmarked', async () => {
    h.getAssetAudit.mockResolvedValue({
      success: true,
      data: auditPayload({
        items: [item(), item({ asset_id: 'as-5', asset_name: 'Spare monitor' }), item({ asset_id: 'as-2', result: 'present' })],
      }),
    });
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-complete-button')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-complete-button')!);

    expect(await screen.findByText('2 unmarked devices will be recorded as missing.')).toBeInTheDocument();
  });

  it('confirms before cancelling the run', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-cancel-button')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-cancel-button')!);
    expect(await screen.findByText(/The run is abandoned/)).toBeInTheDocument();

    fireEvent.click(document.getElementById('asset-audit-cancel-confirm-button')!);
    await waitFor(() => expect(h.cancelAssetAudit).toHaveBeenCalledWith('au-1'));
  });

  it('adds an out-of-scope asset through the audit, which stores it unexpected', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-add-unexpected-button')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-add-unexpected-button')!);

    // The candidate list is anchored to the dialog rather than to its
    // scrollable body, so it is on screen instead of below the fold.
    const select = document.getElementById('asset-audit-add-unexpected-select')!;
    expect(select).toHaveAttribute('data-dropdown-mode', 'overlay');
    expect(document.getElementById('asset-audit-add-unexpected-dialog')).toHaveAttribute(
      'data-allow-overflow',
      'true',
    );

    fireEvent.click(select);

    await waitFor(() => expect(h.addUnexpectedAuditAsset).toHaveBeenCalledWith('au-1', 'as-9'));
  });

  it('hides every write affordance once the run is closed', async () => {
    h.getAssetAudit.mockResolvedValue({
      success: true,
      data: auditPayload({ status: 'completed', completed_at: '2026-03-02T13:00:00.000Z' }),
    });
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-header')).not.toBeNull());
    expect(document.getElementById('asset-audit-complete-button')).toBeNull();
    expect(document.getElementById('asset-audit-cancel-button')).toBeNull();
    expect(document.getElementById('asset-audit-add-unexpected-button')).toBeNull();
    expect(document.getElementById('asset-audit-mark-present-button-as-1')).toBeNull();
    // Reading the run is still possible, and the export stays available.
    expect(document.getElementById('asset-audit-export-button')).not.toBeNull();
  });

  it('hides the write affordances from a user without asset:update', async () => {
    h.previewAssetAuditScope.mockResolvedValue({ permissionError: 'Permission denied: Cannot update asset audits' });
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-header')).not.toBeNull());
    expect(document.getElementById('asset-audit-complete-button')).toBeNull();
    expect(document.getElementById('asset-audit-mark-present-button-as-1')).toBeNull();
  });

  it('creates a ticket for a missing device through the cross-feature quick add', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-segments-missing')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-segments-missing')!);

    await waitFor(() => expect(document.getElementById('asset-audit-create-ticket-button-as-3')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-create-ticket-button-as-3')!);

    await waitFor(() => expect(document.getElementById('quick-add-ticket-stub')).not.toBeNull());
    expect(h.renderQuickAddTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'as-3',
        assetName: 'Store tablet',
        prefilledClient: { id: 'acme', name: 'Acme Corp' },
        prefilledTitle: 'Missing at site audit: Store tablet',
      }),
    );
  });

  it('offers Create ticket only for missing devices', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-segments-all')).not.toBeNull());
    fireEvent.click(document.getElementById('asset-audit-segments-all')!);

    await waitFor(() => expect(document.getElementById('asset-audit-create-ticket-button-as-3')).not.toBeNull());
    expect(document.getElementById('asset-audit-create-ticket-button-as-2')).toBeNull();
  });

  it('reads the scope statuses, never their slugs', async () => {
    h.getAssetAudit.mockResolvedValue({
      success: true,
      data: auditPayload({ statuses: ['active', 'held_by_msp'] }),
    });
    renderDetail();

    await waitFor(() =>
      expect(document.getElementById('asset-audit-scope-statuses')).toHaveTextContent('Active, Held by MSP'),
    );
    expect(document.getElementById('asset-audit-scope-statuses')).not.toHaveTextContent('held_by_msp');
  });

  it('hands the CSV to the browser and says so', async () => {
    const createObjectURL = vi.fn(() => 'blob:audit');
    const revokeObjectURL = vi.fn();
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    const clicks: Array<{ download: string; inDocument: boolean }> = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        // The anchor has to be in the document when it is clicked, and its blob
        // URL must still be alive — revoking in the same tick is what made this
        // button do nothing at all.
        clicks.push({ download: this.download, inDocument: document.body.contains(this) });
        expect(revokeObjectURL).not.toHaveBeenCalled();
      });

    try {
      renderDetail();
      await waitFor(() => expect(document.getElementById('asset-audit-export-button')).not.toBeNull());

      fireEvent.click(document.getElementById('asset-audit-export-button')!);

      expect(clicks).toEqual([{ download: 'site-audit-au-1.csv', inDocument: true }]);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(h.toastSuccess).toHaveBeenCalledWith('CSV export started.');
    } finally {
      clickSpy.mockRestore();
    }
  });

  it('says there is nothing to export instead of downloading an empty file', async () => {
    const createObjectURL = vi.fn(() => 'blob:audit');
    (URL as any).createObjectURL = createObjectURL;
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-segments-all')).not.toBeNull());
    fireEvent.change(document.getElementById('asset-audit-item-search')!, { target: { value: 'nothing here' } });

    fireEvent.click(document.getElementById('asset-audit-export-button')!);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(h.toastPlain).toHaveBeenCalledWith('There is nothing to export in this view.');
  });

  it('goes back to the client Audits tab', async () => {
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-back-button')).not.toBeNull());
    expect(document.getElementById('asset-audit-back-button')).toHaveAttribute(
      'href',
      '/msp/clients/acme?tab=audits',
    );
  });

  it('opens the asset page from an item', async () => {
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-asset-link-as-1')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-asset-link-as-1')!);

    expect(h.push).toHaveBeenCalledWith('/msp/assets/as-1');
  });

  it('shows the server refusal from a failed action instead of failing silently', async () => {
    h.markAssetAuditItem.mockResolvedValue({ success: false, error: { message: 'Audit is completed' } });
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-mark-present-button-as-1')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-mark-present-button-as-1')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Audit is completed');
  });

  it('surfaces a failed load with a retry instead of an empty page', async () => {
    h.getAssetAudit.mockResolvedValue({ success: false, error: { message: 'Audit not found' } });
    renderDetail();

    expect(await screen.findByRole('alert')).toHaveTextContent('Audit not found');
    expect(document.getElementById('asset-audit-retry-button')).not.toBeNull();
  });

  // Completing a run turns every unmarked `expected` item into `missing`, so a
  // finished audit has nothing "remaining": opening on that segment showed the
  // per-asset results as "No assets in this view".
  it('opens a finished run on every item instead of an empty Remaining view', async () => {
    h.getAssetAudit.mockResolvedValue({
      success: true,
      data: auditPayload({
        status: 'completed',
        completed_at: '2026-03-02T13:00:00.000Z',
        items: [
          item({ asset_id: 'as-2', asset_name: 'Back office laptop', result: 'present', method: 'manual' }),
          item({ asset_id: 'as-3', asset_name: 'Store tablet', result: 'missing' }),
          item({ asset_id: 'as-4', asset_name: 'Stray printer', result: 'unexpected', method: 'manual' }),
        ],
      }),
    });
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-items-table-row-as-3')).not.toBeNull());
    expect(document.getElementById('asset-audit-items-table-row-as-2')).not.toBeNull();
    expect(document.getElementById('asset-audit-items-table-row-as-4')).not.toBeNull();
    expect(document.getElementById('asset-audit-items-empty')).toBeNull();
    // A closed run is never asked what is left to walk.
    expect(document.getElementById('asset-audit-segments-remaining')).toBeNull();
  });

  // Cancelling leaves the unwalked items `expected`, so an abandoned run has to
  // show what was marked next to what never was — not only its to-do list.
  it('opens a cancelled run on every item too', async () => {
    h.getAssetAudit.mockResolvedValue({
      success: true,
      data: auditPayload({
        status: 'cancelled',
        items: [
          item({ asset_id: 'as-7', asset_name: 'Spare dock' }),
          item({ asset_id: 'as-8', asset_name: 'Till PC', result: 'present', method: 'manual' }),
        ],
      }),
    });
    renderDetail();

    await waitFor(() => expect(document.getElementById('asset-audit-items-table-row-as-8')).not.toBeNull());
    expect(document.getElementById('asset-audit-items-table-row-as-7')).not.toBeNull();
    expect(document.getElementById('asset-audit-segments-remaining')).toBeNull();
  });

  it('says something went wrong when a mark throws, and frees the row again', async () => {
    h.markAssetAuditItem.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-mark-present-button-as-1')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-mark-present-button-as-1')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('An error occurred. Please try again later.');
    // The database's own wording is never put in front of the tech.
    expect(screen.queryByText(/Connection terminated/)).toBeNull();
    // The row is usable again — a flaky building is the normal case here.
    await waitFor(() =>
      expect(document.getElementById('asset-audit-mark-present-button-as-1')).not.toBeDisabled(),
    );
  });

  it('keeps the Complete confirmation usable when the write throws', async () => {
    h.completeAssetAudit.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-complete-button')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-complete-button')!);
    fireEvent.click(document.getElementById('asset-audit-complete-confirm-button')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('An error occurred. Please try again later.');
    await waitFor(() =>
      expect(document.getElementById('asset-audit-complete-confirm-button')).not.toBeDisabled(),
    );
  });

  it('keeps the Cancel confirmation usable when the write throws', async () => {
    h.cancelAssetAudit.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    renderDetail();
    await waitFor(() => expect(document.getElementById('asset-audit-cancel-button')).not.toBeNull());

    fireEvent.click(document.getElementById('asset-audit-cancel-button')!);
    fireEvent.click(document.getElementById('asset-audit-cancel-confirm-button')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('An error occurred. Please try again later.');
    await waitFor(() =>
      expect(document.getElementById('asset-audit-cancel-confirm-button')).not.toBeDisabled(),
    );
  });
});

describe('effectiveAuditSegment', () => {
  it('starts an open run on its to-do list and a closed one on every item', () => {
    expect(effectiveAuditSegment(null, true)).toBe('remaining');
    expect(effectiveAuditSegment(null, false)).toBe('all');
  });

  it('keeps the segment the user picked', () => {
    expect(effectiveAuditSegment('present', true)).toBe('present');
    expect(effectiveAuditSegment('missing', false)).toBe('missing');
  });

  it('drops a Remaining choice once the run is closed', () => {
    expect(effectiveAuditSegment('remaining', false)).toBe('all');
  });
});
