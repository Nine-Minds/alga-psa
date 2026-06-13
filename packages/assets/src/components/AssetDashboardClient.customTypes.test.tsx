/* @vitest-environment jsdom */

/**
 * T314 (F311): the asset list renders custom-type assets with their
 * registry label (and built-ins/unknowns unchanged), the type filter offers
 * registry custom types, and selecting a custom type narrows the list by
 * its slug. Also covers the F313 breakdown wiring on the dashboard.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AssetDashboardClient from './AssetDashboardClient';
import type { AssetListResponse } from '@alga-psa/types';

const mockListAssets = vi.fn();
const mockGetClientMaintenanceSummaries = vi.fn();
const mockGetAssetTypes = vi.fn();
const mockGetAssetCountsByType = vi.fn();

vi.mock('../actions/assetActions', () => ({
  listAssets: (...args: unknown[]) => mockListAssets(...args),
  bulkUpdateAssets: vi.fn(),
  bulkDeleteAssets: vi.fn(),
  getClientMaintenanceSummaries: (...args: unknown[]) => mockGetClientMaintenanceSummaries(...args),
}));

vi.mock('../actions/assetDrawerActions', () => ({
  loadAssetDetailDrawerData: vi.fn(async () => ({ data: { asset: null } })),
}));

vi.mock('../actions/clientLookupActions', () => ({
  getAllClientsForAssets: vi.fn(async () => []),
  getClientLocationsForAssets: vi.fn(async () => []),
}));

vi.mock('../actions/assetTypeRegistryActions', () => ({
  getAssetTypes: (...args: unknown[]) => mockGetAssetTypes(...args),
}));

vi.mock('../actions/assetStatisticsActions', () => ({
  getAssetCountsByType: (...args: unknown[]) => mockGetAssetCountsByType(...args),
}));

vi.mock('../context/AssetCrossFeatureContext', () => ({
  useAssetCrossFeature: () => ({ renderQuickAddTicket: () => null }),
}));

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

vi.mock('@alga-psa/ui/hooks', () => ({
  useRangeSelection: () => ({
    isSelected: () => false,
    handleSelect: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => undefined,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id, 'data-automation-id': id }),
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
  BulkActionBar: () => null,
}));

vi.mock('@alga-psa/ui/components/IconPicker', () => ({
  getIconComponent: () => (props: any) => <span data-testid="custom-type-icon" {...props} />,
}));

function asset(id: string, name: string, assetType: string) {
  return {
    asset_id: id,
    asset_type: assetType,
    client_id: '',
    asset_tag: `tag-${id}`,
    name,
    status: 'active',
    created_at: '2026-06-12T00:00:00Z',
    updated_at: '2026-06-12T00:00:00Z',
    tenant: 'tenant-1',
  } as any;
}

const allAssets = [
  asset('a1', 'WS-1', 'workstation'),
  asset('a2', 'Door 42', 'door_access'),
  asset('a3', 'Mystery Box', 'mystery_thing'),
];

const doorAccessEntry = {
  tenant: 'tenant-1',
  type_id: 'type-1',
  slug: 'door_access',
  name: 'Door Access System',
  icon: 'shield',
  fields_schema: [],
  is_builtin: false,
  display_order: 0,
  created_at: '2026-06-12T00:00:00Z',
  updated_at: '2026-06-12T00:00:00Z',
};

const workstationEntry = {
  ...doorAccessEntry,
  type_id: 'type-2',
  slug: 'workstation',
  name: 'Workstation',
  icon: null,
  is_builtin: true,
};

function initialAssets(): AssetListResponse {
  return { assets: allAssets, total: allAssets.length, page: 1, limit: 10 } as AssetListResponse;
}

describe('AssetDashboardClient custom types (T314)', () => {
  beforeEach(() => {
    mockListAssets.mockReset();
    mockListAssets.mockImplementation(async (params: any) => {
      const filtered = params?.asset_type
        ? allAssets.filter((item) => item.asset_type === params.asset_type)
        : allAssets;
      return { assets: filtered, total: filtered.length, page: params?.page ?? 1, limit: params?.limit ?? 10 };
    });
    mockGetClientMaintenanceSummaries.mockReset();
    mockGetClientMaintenanceSummaries.mockResolvedValue({});
    mockGetAssetTypes.mockReset();
    mockGetAssetTypes.mockResolvedValue([workstationEntry, doorAccessEntry]);
    mockGetAssetCountsByType.mockReset();
    mockGetAssetCountsByType.mockResolvedValue({ workstation: 1, door_access: 1, mystery_thing: 1 });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders registry labels for custom-type rows, keeps built-ins, and falls back for unknown slugs', async () => {
    render(<AssetDashboardClient initialAssets={initialAssets()} />);

    await waitFor(() => {
      expect(screen.getByText('WS-1')).toBeTruthy();
    });

    const table = document.getElementById('asset-table')!;
    await waitFor(() => {
      // Custom type shows its registry display name, not the raw slug.
      expect(table.textContent).toContain('Door Access System');
    });
    expect(table.textContent).toContain('Workstation');
    // Unknown slug keeps the historical title-cased fallback.
    expect(table.textContent).toContain('Mystery Thing');
    expect(table.textContent).not.toContain('door_access');
    // Custom registry icon renders in the type cell.
    expect(screen.getAllByTestId('custom-type-icon').length).toBeGreaterThan(0);
  });

  it('offers custom types in the type filter and narrows the list by the custom slug', async () => {
    render(<AssetDashboardClient initialAssets={initialAssets()} />);

    // Filter option appears once the registry resolves.
    const checkbox = await waitFor(() => {
      const el = document.getElementById('type-checkbox-door_access');
      expect(el).toBeTruthy();
      return el as HTMLInputElement;
    });

    const optionRow = document.getElementById('filter-type-door_access')!;
    expect(optionRow.textContent).toContain('Door Access System');

    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(mockListAssets).toHaveBeenLastCalledWith(
        expect.objectContaining({ asset_type: 'door_access' })
      );
    });

    const table = document.getElementById('asset-table')!;
    await waitFor(() => {
      expect(table.textContent).toContain('Door 42');
      expect(table.textContent).not.toContain('WS-1');
      expect(table.textContent).not.toContain('Mystery Box');
    });
  });

  it('shows the by-type breakdown with registry labels (F313 wiring)', async () => {
    render(<AssetDashboardClient initialAssets={initialAssets()} />);

    await waitFor(() => {
      const chip = document.getElementById('asset-type-breakdown-door_access');
      expect(chip).toBeTruthy();
      expect(chip!.textContent).toContain('Door Access System');
    });
  });
});
