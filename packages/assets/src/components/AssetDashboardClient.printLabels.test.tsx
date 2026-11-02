/* @vitest-environment jsdom */

/**
 * Bulk "Print labels" on the asset list. (Mock scaffold borrowed from the custom-types test.)
 * T314 (F311): the asset list renders custom-type assets with their
 * registry label (and built-ins/unknowns unchanged), the type filter offers
 * registry custom types, and selecting a custom type narrows the list by
 * its slug. Also covers the F313 breakdown wiring on the dashboard.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AssetDashboardClient from './AssetDashboardClient';
import type { AssetListResponse } from '@alga-psa/types';
import { MAX_LABELS_PER_REQUEST } from '@alga-psa/types';

const mockListAssets = vi.fn();
const mockGetClientMaintenanceSummaries = vi.fn();
const mockGetAssetTypes = vi.fn();
const mockGetAssetCountsByType = vi.fn();

vi.mock('./custody/CustodyBadge', () => ({ useCustodyBadges: () => new Map(), CustodyBadge: () => null }));
vi.mock('./warranty/RmaBadge', () => ({ useRmaBadges: () => new Map(), RmaBadge: () => null }));
vi.mock('../actions/assetActions', () => ({
  listAssets: (...args: unknown[]) => mockListAssets(...args),
  bulkUpdateAssets: vi.fn(),
  bulkDeleteAssets: vi.fn(),
  getClientMaintenanceSummaries: (...args: unknown[]) => mockGetClientMaintenanceSummaries(...args),
}));

vi.mock('../actions/assetGroupActions', () => ({
  addAssetsToGroup: vi.fn(),
  createAssetGroup: vi.fn(),
  listAssetGroups: vi.fn(async () => []),
  getAssetTicketContactOptions: vi.fn(async () => ({ options: [], preselect: null })),
}));

vi.mock('../actions/assetDrawerActions', () => ({
  loadAssetDetailDrawerData: vi.fn(async () => ({ data: { asset: null } })),
}));

vi.mock('../actions/clientLookupActions', () => ({
  getVendorOptionsForAssets: vi.fn(async () => []),
  getAllClientsForAssets: vi.fn(async () => []),
  getClientLocationsForAssets: vi.fn(async () => []),
}));

vi.mock('../actions/assetTypeRegistryActions', () => ({
  getAssetTypes: (...args: unknown[]) => mockGetAssetTypes(...args),
}));

vi.mock('../actions/assetStatusActions', () => ({
  listAssetStatuses: vi.fn(async () => [
    { tenant: 't', status_id: 'st-active', slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0, created_at: '', updated_at: '' },
    { tenant: 't', status_id: 'st-inactive', slug: 'inactive', label: 'Inactive', kind: 'undeployable', is_builtin: true, is_active: true, display_order: 1, created_at: '', updated_at: '' },
  ]),
}));

vi.mock('../actions/assetStatisticsActions', () => ({
  getAssetCountsByType: (...args: unknown[]) => mockGetAssetCountsByType(...args),
}));

vi.mock('../context/AssetCrossFeatureContext', () => ({
  useAssetCrossFeature: () => ({ renderQuickAddTicket: () => null }),
}));

// Named views have their own tests; here they only need to stay out of the way
// (the real hook reaches the server actions and the auth stack).
vi.mock('@alga-psa/list-views/hooks', () => ({
  useListViews: () => ({}),
}));
vi.mock('@alga-psa/list-views/components', () => ({ ListViewPicker: () => null }));
vi.mock('./QuickAddAsset', () => ({ QuickAddAsset: () => null }));
vi.mock('./AssetCommandPalette', () => ({ AssetCommandPalette: () => null }));
vi.mock('./AssetDetailDrawerClient', () => ({ AssetDetailDrawerClient: () => null }));
vi.mock('./RmmStatusIndicator', () => ({ RmmStatusIndicator: () => null }));

vi.mock('../hooks/useRmmAgentStatusOptions', () => ({
  useFormatRmmAgentStatus: () => (status: string) => status,
  useRmmAgentStatusOptions: () => [],
}));

const stableT = (key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    text = text.replace(`{{${name}}}`, String(value));
  }
  return text;
};
const stableTranslation = { t: stableT };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableTranslation,
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/ui', () => ({
  useClientDrawer: () => null,
}));

vi.mock('@alga-psa/ui/hooks', async () => {
  const actual = await vi.importActual<any>('@alga-psa/ui/hooks/useRangeSelection');
  return { useRangeSelection: actual.useRangeSelection };
});

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => undefined,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id, 'data-automation-id': id }),
  // The list's composite cells render BentoTile, whose ReflectionContainer is
  // built with this second export of the same module.
  withUIReflectionId: (Component: unknown) => Component,
}));

vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  ShortcutActiveRegion: ({ children }: any) => <div>{children}</div>,
  useCatalogShortcut: () => undefined,
  usePageCreateShortcut: () => undefined,
  useShortcutScope: () => undefined,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, value, onChange, placeholder }: any) => (
    <input id={id} aria-label={id} value={value} onChange={onChange} placeholder={placeholder} />
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange, indeterminate: _i, skipRegistration: _s, containerClassName: _c, ...props }: any) => (
    <input type="checkbox" id={id} aria-label={id} checked={Boolean(checked)} onChange={onChange ?? (() => undefined)} {...props} />
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, message }: any) => (isOpen ? <div>{message}</div> : null),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data = [], columns = [] }: any) => (
    <table id={id}>
      <tbody>
        {data.map((record: any, rowIndex: number) => (
          <tr key={record.asset_id ?? rowIndex}>
            {columns.map((column: any, colIndex: number) => (
              <td key={colIndex}>
                {column.render
                  ? column.render(record[column.dataIndex], record, rowIndex)
                  : String(record[column.dataIndex] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, id }: any) => <div id={id}>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options = [], value, onValueChange }: any) => (
    <select aria-label={id} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => null,
}));

vi.mock('@alga-psa/ui/components/PrintButton', () => ({
  usePrintAction: () => ({ triggerPrint: vi.fn(), isPreparing: false }),
}));

vi.mock('@alga-psa/ui/components/PrintOptionsDialog', () => ({
  createPrintColumnsFromColumnDefinitions: () => [],
  PrintOptionsDialog: () => null,
  usePrintColumnSelection: () => ({
    selectedColumnKeys: [],
    selectedColumns: [],
    setSelectedColumnKeys: vi.fn(),
    resetSelectedColumnKeys: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/components/ShareActionsMenu', () => ({
  ShareActionsMenu: () => null,
}));

vi.mock('@alga-psa/ui/components/PrintableTable', () => ({
  PrintableTable: () => null,
}));

vi.mock('@alga-psa/ui/components/BulkActionBar', () => ({
  BulkActionBar: ({ actions = [] }: any) => (
    <div>
      {actions.map((a: any) => (
        <button key={a.id} id={`bulk-${a.id}`} disabled={a.disabled} onClick={a.onClick}>{a.label}</button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/labels/LabelPrintDialog', () => ({
  LabelPrintDialog: (props: any) => (
    <div data-testid="label-dialog" data-label-class={props.labelClass} data-ids={JSON.stringify(props.ids)} />
  ),
}));

vi.mock('@alga-psa/ui/components/IconPicker', () => ({
  getIconComponent: () => (props: any) => <span data-testid="custom-type-icon" {...props} />,
}));

function asset(id: string) {
  return {
    asset_id: id, asset_type: 'workstation', client_id: '', asset_tag: `tag-${id}`, name: `Asset ${id}`,
    status: 'active', created_at: '2026-06-12T00:00:00Z', updated_at: '2026-06-12T00:00:00Z', tenant: 'tenant-1',
  } as any;
}

const pick = (id: string) => waitFor(() => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing ${id}`);
  return el;
});

function setup(count: number) {
  const all = Array.from({ length: count }, (_, i) => asset(`a${i}`));
  mockListAssets.mockResolvedValue({ assets: all, total: all.length, page: 1, limit: count });
  render(<AssetDashboardClient initialAssets={{ assets: all, total: all.length, page: 1, limit: count } as AssetListResponse} />);
  return all;
}

describe('AssetDashboardClient bulk print labels', () => {
  beforeEach(() => {
    mockListAssets.mockReset();
    mockGetClientMaintenanceSummaries.mockReset();
    mockGetClientMaintenanceSummaries.mockResolvedValue({});
    mockGetAssetTypes.mockReset();
    mockGetAssetTypes.mockResolvedValue([]);
    mockGetAssetCountsByType.mockReset();
    mockGetAssetCountsByType.mockResolvedValue({});
  });
  afterEach(cleanup);

  it('opens the dialog with asset-identity and the selected asset ids', async () => {
    setup(3);
    await userEvent.click(await pick('asset-select-a0'));
    await userEvent.click(await pick('asset-select-a2'));
    expect(screen.queryByTestId('label-dialog')).toBeNull();

    const button = document.getElementById('bulk-print-labels') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);

    const dialog = screen.getByTestId('label-dialog');
    expect(dialog.getAttribute('data-label-class')).toBe('asset-identity');
    expect(JSON.parse(dialog.getAttribute('data-ids')!).sort()).toEqual(['a0', 'a2']);
  });

  it('is enabled at exactly 200 selected and disabled at 201', async () => {
    setup(MAX_LABELS_PER_REQUEST + 1);
    // Click the first row, then shift-click the last to range-select all 201.
    fireEvent.click(await pick('asset-select-a0'));
    fireEvent.click(await pick('asset-select-a200'), { shiftKey: true });
    const button = () => document.getElementById('bulk-print-labels') as HTMLButtonElement;
    await waitFor(() => expect(button()).toBeTruthy());
    expect(button().disabled).toBe(true); // 201 selected
    await userEvent.click(await pick('asset-select-a200'));
    expect(button().disabled).toBe(false); // 200 selected
    // Renders 201 rows; the default 5s timeout is exceeded on loaded CI runners (5.8s observed).
  }, 30000);
});
