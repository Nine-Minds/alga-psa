// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />
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
  AsyncSearchableSelect: ({ id, onChange }: any) => (
    <button id={id} type="button" onClick={() => onChange('as-9')}>
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
  Dialog: ({ id, isOpen, title, children }: any) =>
    isOpen ? (
      <div id={id} role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: any) => (
    <div id={id}>
      {data.map((row: any) => (
        <div key={row.asset_id} id={`${id}-row-${row.asset_id}`}>
          {columns.map((column: any, index: number) => (
            <span key={index}>
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

const { AssetAuditDetail } = await import('./AssetAuditDetail');

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
    expect(document.getElementById('asset-audit-location')).toHaveTextContent('HQ');
    expect(document.getElementById('asset-audit-started-by')).toHaveTextContent('Ada Lovelace');
    expect(document.getElementById('asset-audit-notes')).toHaveTextContent('Quarterly walk');
    expect(document.getElementById('asset-audit-stat-expected')).toHaveTextContent('3');
    expect(document.getElementById('asset-audit-stat-present')).toHaveTextContent('1');
    // While the run is open the third stat is what is left to find, not missing.
    expect(document.getElementById('asset-audit-stat-missing')).toHaveTextContent('remaining');
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
    fireEvent.click(document.getElementById('asset-audit-add-unexpected-select')!);

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
});
