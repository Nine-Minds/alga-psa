// @vitest-environment jsdom
/**
 * T230–T236 — HuduAssetMappingManager component (asset-mapping-ui group).
 * T266 — three-way bulk summary + serial-conflict row error naming the
 * existing asset; rmmSkipped surfaced in the sync summary line.
 *
 * jsdom + @testing-library, mirroring huduCompanyMappingManager.component.test:
 * mapping/import/sync actions, asset list, permissions, CustomSelect (as a
 * plain select), toast hook, i18n, and UI primitives are all mocked;
 * assertions run against the DOM.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HuduAssetMappingManager from '@ee/components/integrations/hudu/HuduAssetMappingManager';
import type { HuduAssetMappingView } from '@ee/lib/actions/integrations/huduAssetMappingActions';

const {
  getHuduAssetMappingsMock,
  setHuduAssetMappingMock,
  clearHuduAssetMappingMock,
  importHuduAssetMock,
  importAllUnmatchedHuduAssetsMock,
  syncHuduClientAssetsMock,
  listAssetsMock,
  checkCurrentUserPermissionsMock,
  toastMock,
} = vi.hoisted(() => ({
  getHuduAssetMappingsMock: vi.fn(),
  setHuduAssetMappingMock: vi.fn(),
  clearHuduAssetMappingMock: vi.fn(),
  importHuduAssetMock: vi.fn(),
  importAllUnmatchedHuduAssetsMock: vi.fn(),
  syncHuduClientAssetsMock: vi.fn(),
  listAssetsMock: vi.fn(),
  checkCurrentUserPermissionsMock: vi.fn(),
  toastMock: vi.fn(),
}));

// Same modules as the component's relative imports (vitest dedupes by resolved id).
vi.mock('@ee/lib/actions/integrations/huduAssetMappingActions', () => ({
  getHuduAssetMappings: getHuduAssetMappingsMock,
  setHuduAssetMapping: setHuduAssetMappingMock,
  clearHuduAssetMapping: clearHuduAssetMappingMock,
}));

vi.mock('@ee/lib/actions/integrations/huduAssetImportActions', () => ({
  importHuduAsset: importHuduAssetMock,
  importAllUnmatchedHuduAssets: importAllUnmatchedHuduAssetsMock,
}));

vi.mock('@ee/lib/actions/integrations/huduAssetSyncActions', () => ({
  syncHuduClientAssets: syncHuduClientAssetsMock,
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  listAssets: listAssetsMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  checkCurrentUserPermissions: checkCurrentUserPermissionsMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable identity + {{var}} interpolation so count/summary strings are assertable.
  const t = (key: string, options?: Record<string, unknown>) => {
    let out = (options?.defaultValue as string) ?? key;
    if (options) {
      for (const [name, value] of Object.entries(options)) {
        if (name !== 'defaultValue') {
          out = out.split(`{{${name}}}`).join(String(value));
        }
      }
    }
    return out;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock, toasts: [] }),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <span id={id} data-variant={variant}>
      {children}
    </span>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// CustomSelect as a plain select: '' = no selection, otherwise the asset id.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    id,
    options = [],
    value,
    onValueChange,
    placeholder,
    disabled,
  }: {
    id?: string;
    options?: Array<{ value: string; label: string }>;
    value?: string | null;
    onValueChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      data-testid={id}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder ?? ''}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

const algaAssets = [
  { asset_id: 'asset-1', name: 'DC-01' },
  { asset_id: 'asset-2', name: 'FW-01' },
  { asset_id: 'asset-3', name: 'Spare-01' },
  { asset_id: 'asset-4', name: 'OLD-01' },
];

function buildRows(): HuduAssetMappingView[] {
  return [
    {
      hudu_asset_id: 1,
      hudu_asset_name: 'DC-01',
      asset_layout_id: 7,
      asset_layout_name: 'Server',
      primary_serial: 'SN-1',
      url: 'https://docs.example.com/a/1',
      archived: false,
      layout_excluded: false,
      mapping: { mapping_id: 'map-1', asset_id: 'asset-1', asset_name: 'DC-01', stale: false },
      suggestion: null,
    },
    {
      hudu_asset_id: 2,
      hudu_asset_name: 'FW-01',
      asset_layout_id: 8,
      asset_layout_name: 'Firewall',
      primary_serial: null,
      url: null,
      archived: false,
      layout_excluded: false,
      mapping: null,
      suggestion: { asset_id: 'asset-2', asset_name: 'FW-01', source: 'exact_name', confidence: 0.9 },
    },
    {
      hudu_asset_id: 3,
      hudu_asset_name: 'PRN-01',
      asset_layout_id: 9,
      asset_layout_name: 'Printer',
      primary_serial: null,
      url: null,
      archived: false,
      layout_excluded: false,
      mapping: null,
      suggestion: null,
    },
    {
      hudu_asset_id: 4,
      hudu_asset_name: 'OLD-01',
      asset_layout_id: 7,
      asset_layout_name: 'Server',
      primary_serial: 'SN-4',
      url: null,
      archived: true,
      layout_excluded: false,
      mapping: { mapping_id: 'map-4', asset_id: 'asset-4', asset_name: 'OLD-01', stale: true },
      suggestion: null,
    },
  ];
}

function mockMappings(assets: HuduAssetMappingView[]) {
  getHuduAssetMappingsMock.mockResolvedValue({
    state: 'ok',
    assets,
    huduCompanyId: '101',
    fetchedAt: '2026-06-11T00:00:00.000Z',
    fromCache: true,
  });
}

function mockPermissions(create: boolean, update: boolean) {
  checkCurrentUserPermissionsMock.mockResolvedValue([
    { resource: 'asset', action: 'create', granted: create },
    { resource: 'asset', action: 'update', granted: update },
  ]);
}

async function renderManager() {
  render(<HuduAssetMappingManager clientId={CLIENT_ID} />);
  await screen.findByText('PRN-01');
}

describe('HuduAssetMappingManager', () => {
  beforeEach(() => {
    getHuduAssetMappingsMock.mockReset();
    setHuduAssetMappingMock.mockReset();
    clearHuduAssetMappingMock.mockReset();
    importHuduAssetMock.mockReset();
    importAllUnmatchedHuduAssetsMock.mockReset();
    syncHuduClientAssetsMock.mockReset();
    listAssetsMock.mockReset();
    checkCurrentUserPermissionsMock.mockReset();
    toastMock.mockReset();
    listAssetsMock.mockResolvedValue({ assets: algaAssets, total: algaAssets.length, page: 1, limit: 1000 });
    mockPermissions(true, true);
    mockMappings(buildRows());
  });

  describe('T230: rows, counters and badges', () => {
    it('renders counters and one row per Hudu asset with metadata and deep-links', async () => {
      await renderManager();

      expect(document.getElementById('hudu-asset-count-mapped')?.textContent).toBe('2 mapped');
      expect(document.getElementById('hudu-asset-count-suggested')?.textContent).toBe('1 suggested');
      expect(document.getElementById('hudu-asset-count-unmapped')?.textContent).toBe('1 unmapped');
      expect(document.getElementById('hudu-asset-count-total')?.textContent).toBe('4 total');

      const bodyRows = document.querySelectorAll('tbody tr');
      expect(bodyRows).toHaveLength(4);

      // Deep-link when the Hudu asset has a URL; plain text otherwise.
      const linked = document.getElementById('hudu-asset-link-1') as HTMLAnchorElement;
      expect(linked.tagName).toBe('A');
      expect(linked.getAttribute('href')).toBe('https://docs.example.com/a/1');
      expect(linked.getAttribute('target')).toBe('_blank');
      expect(linked.getAttribute('rel')).toContain('noopener');
      expect(document.getElementById('hudu-asset-link-3')?.tagName).toBe('SPAN');

      // Layout name + serial + archived metadata.
      expect(bodyRows[0].textContent).toContain('Server · Serial: SN-1');
      expect(bodyRows[3].textContent).toContain('Archived');
    });

    it('shows status badges incl. a Stale badge on a stale mapping row', async () => {
      await renderManager();

      const mapped = document.getElementById('hudu-asset-status-1');
      const suggested = document.getElementById('hudu-asset-status-2');
      const unmapped = document.getElementById('hudu-asset-status-3');
      const staleMapped = document.getElementById('hudu-asset-status-4');
      const stale = document.getElementById('hudu-asset-stale-4');

      expect(mapped?.textContent).toBe('Mapped');
      expect(mapped?.getAttribute('data-variant')).toBe('success');
      expect(suggested?.textContent).toBe('Suggested');
      expect(suggested?.getAttribute('data-variant')).toBe('primary');
      expect(unmapped?.textContent).toBe('Unmapped');
      expect(unmapped?.getAttribute('data-variant')).toBe('warning');
      expect(staleMapped?.textContent).toBe('Mapped');
      expect(stale?.textContent).toBe('Stale');
      expect(stale?.getAttribute('data-variant')).toBe('error');
      // Healthy mapped row has no stale badge.
      expect(document.getElementById('hudu-asset-stale-1')).toBeNull();
    });
  });

  describe('T231: picking stages only; Save commits set / clear+set', () => {
    it('staging a pick shows Pending + save bar without calling actions; Save commits set', async () => {
      setHuduAssetMappingMock.mockResolvedValue({ success: true, data: { mapping_id: 'map-new' } });

      await renderManager();

      // Dismiss the pre-filled suggestion (row 2) to isolate the manual pick.
      fireEvent.click(document.getElementById('hudu-asset-row-action-2')!);
      fireEvent.change(screen.getByTestId('hudu-asset-picker-3'), { target: { value: 'asset-3' } });

      expect(setHuduAssetMappingMock).not.toHaveBeenCalled();
      expect(clearHuduAssetMappingMock).not.toHaveBeenCalled();
      expect(document.getElementById('hudu-asset-status-3')?.textContent).toBe('Pending');
      expect(document.getElementById('hudu-asset-status-3')?.getAttribute('data-variant')).toBe('secondary');
      expect(document.getElementById('hudu-asset-mapping-save-bar')?.textContent).toContain(
        'Unsaved changes: 1'
      );

      fireEvent.click(screen.getByRole('button', { name: /Save mappings/ }));

      await waitFor(() => {
        expect(setHuduAssetMappingMock).toHaveBeenCalledTimes(1);
      });
      expect(setHuduAssetMappingMock).toHaveBeenCalledWith({
        clientId: CLIENT_ID,
        assetId: 'asset-3',
        huduAssetId: 3,
        metadata: {
          hudu_asset_name: 'PRN-01',
          asset_layout_id: 9,
          asset_layout_name: 'Printer',
          primary_serial: null,
          url: null,
        },
      });
      await waitFor(() => {
        expect(document.getElementById('hudu-asset-status-3')?.textContent).toBe('Mapped');
      });
      expect(document.getElementById('hudu-asset-count-mapped')?.textContent).toBe('3 mapped');
      expect(clearHuduAssetMappingMock).not.toHaveBeenCalled();
    });

    it('replacing a saved mapping commits clear then set', async () => {
      clearHuduAssetMappingMock.mockResolvedValue({ success: true, data: { cleared: 1 } });
      setHuduAssetMappingMock.mockResolvedValue({ success: true, data: { mapping_id: 'map-replaced' } });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-row-action-2')!); // dismiss suggestion
      fireEvent.change(screen.getByTestId('hudu-asset-picker-1'), { target: { value: 'asset-3' } });
      fireEvent.click(screen.getByRole('button', { name: /Save mappings/ }));

      await waitFor(() => {
        expect(clearHuduAssetMappingMock).toHaveBeenCalledWith({ mappingId: 'map-1' });
      });
      await waitFor(() => {
        expect(setHuduAssetMappingMock).toHaveBeenCalledWith(
          expect.objectContaining({ clientId: CLIENT_ID, assetId: 'asset-3', huduAssetId: 1 })
        );
      });
      const clearOrder = clearHuduAssetMappingMock.mock.invocationCallOrder[0];
      const setOrder = setHuduAssetMappingMock.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(setOrder);
      await waitFor(() => {
        expect(document.getElementById('hudu-asset-status-1')?.textContent).toBe('Mapped');
      });
    });

    it('a save failure keeps the row staged and surfaces a destructive toast', async () => {
      setHuduAssetMappingMock.mockResolvedValue({
        success: false,
        error: 'Asset is already mapped.',
        code: 'asset_already_mapped',
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-row-action-2')!); // dismiss suggestion
      fireEvent.change(screen.getByTestId('hudu-asset-picker-3'), { target: { value: 'asset-1' } });
      fireEvent.click(screen.getByRole('button', { name: /Save mappings/ }));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: 'destructive',
            description:
              'That asset is already mapped to another Hudu asset. Clear the existing mapping first.',
          })
        );
      });
      expect(document.getElementById('hudu-asset-status-3')?.textContent).toBe('Pending');
      expect((screen.getByTestId('hudu-asset-picker-3') as HTMLSelectElement).value).toBe('asset-1');
    });
  });

  describe('T232: suggestion confirm / dismiss / revert', () => {
    it('Save confirms an untouched suggestion', async () => {
      setHuduAssetMappingMock.mockResolvedValue({ success: true, data: { mapping_id: 'map-2' } });

      await renderManager();

      // The suggestion alone makes the save bar appear; Save is the confirmation.
      expect((screen.getByTestId('hudu-asset-picker-2') as HTMLSelectElement).value).toBe('asset-2');
      expect(document.getElementById('hudu-asset-suggestion-2')?.textContent).toContain('Exact name');
      expect(document.getElementById('hudu-asset-suggestion-2')?.textContent).toContain('90%');
      expect(document.getElementById('hudu-asset-mapping-save-bar')).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Save mappings/ }));

      await waitFor(() => {
        expect(setHuduAssetMappingMock).toHaveBeenCalledWith(
          expect.objectContaining({ clientId: CLIENT_ID, assetId: 'asset-2', huduAssetId: 2 })
        );
      });
      await waitFor(() => {
        expect(document.getElementById('hudu-asset-status-2')?.textContent).toBe('Mapped');
      });
      expect(document.getElementById('hudu-asset-mapping-save-bar')).toBeNull();
    });

    it('dismissing a suggestion excludes it from Save; revert restores it', async () => {
      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-row-action-2')!);

      // No dirty rows left: bar gone, picker emptied, row shows Unmapped, note hidden.
      expect(document.getElementById('hudu-asset-mapping-save-bar')).toBeNull();
      expect((screen.getByTestId('hudu-asset-picker-2') as HTMLSelectElement).value).toBe('');
      expect(document.getElementById('hudu-asset-status-2')?.textContent).toBe('Unmapped');
      expect(document.getElementById('hudu-asset-suggestion-2')).toBeNull();
      // A dismissed-suggestion row becomes importable.
      expect(document.getElementById('hudu-asset-import-2')).not.toBeNull();

      // The same button now reverts the dismissal.
      fireEvent.click(document.getElementById('hudu-asset-row-action-2')!);
      expect((screen.getByTestId('hudu-asset-picker-2') as HTMLSelectElement).value).toBe('asset-2');
      expect(document.getElementById('hudu-asset-mapping-save-bar')).not.toBeNull();
      expect(document.getElementById('hudu-asset-import-2')).toBeNull();
      expect(setHuduAssetMappingMock).not.toHaveBeenCalled();
      expect(clearHuduAssetMappingMock).not.toHaveBeenCalled();
    });
  });

  describe('T233: per-row Import', () => {
    it('imports the row and re-renders it as Mapped', async () => {
      importHuduAssetMock.mockResolvedValue({
        success: true,
        data: {
          asset_id: 'asset-new',
          mapping_id: 'map-new',
          asset_tag: 'HUDU-3',
          asset_type: 'printer',
          status: 'active',
        },
      });

      await renderManager();

      // Only the plain-unmapped row shows Import (no mapping, no live suggestion).
      expect(document.getElementById('hudu-asset-import-3')).not.toBeNull();
      expect(document.getElementById('hudu-asset-import-1')).toBeNull();
      expect(document.getElementById('hudu-asset-import-2')).toBeNull();

      fireEvent.click(document.getElementById('hudu-asset-import-3')!);

      await waitFor(() => {
        expect(importHuduAssetMock).toHaveBeenCalledWith({ clientId: CLIENT_ID, huduAssetId: 3 });
      });
      await waitFor(() => {
        expect(document.getElementById('hudu-asset-status-3')?.textContent).toBe('Mapped');
      });
      expect(document.getElementById('hudu-asset-import-3')).toBeNull();
      expect(document.getElementById('hudu-asset-count-mapped')?.textContent).toBe('3 mapped');
      expect((screen.getByTestId('hudu-asset-picker-3') as HTMLSelectElement).value).toBe('asset-new');
    });
  });

  describe('T234: Import all unmatched', () => {
    it('renders the created/failed summary and the failed row stays importable', async () => {
      importAllUnmatchedHuduAssetsMock.mockResolvedValue({
        success: true,
        data: { created: 2, skipped: 0, failed: [{ huduAssetId: 3, error: 'create failed', code: 'create_failed' }] },
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-import-all-btn')!);

      await waitFor(() => {
        expect(importAllUnmatchedHuduAssetsMock).toHaveBeenCalledWith({ clientId: CLIENT_ID });
      });
      await waitFor(() => {
        expect(document.getElementById('hudu-asset-import-summary')?.textContent).toContain(
          'Import finished: 2 created · 0 skipped · 1 failed.'
        );
      });
      expect(document.getElementById('hudu-asset-import-failure-3')?.textContent).toContain('create failed');
      // The rows reloaded after the batch; the failed row is still importable.
      expect(getHuduAssetMappingsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(document.getElementById('hudu-asset-import-3')).not.toBeNull();
    });

    it('a rate-limited batch renders its partial summary plus the error alert', async () => {
      importAllUnmatchedHuduAssetsMock.mockResolvedValue({
        success: false,
        error: 'HTTP 429',
        code: 'rate_limited',
        errorKind: 'rate_limited',
        partial: { created: 1, skipped: 0, failed: [] },
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-import-all-btn')!);

      await waitFor(() => {
        expect(document.getElementById('hudu-asset-import-summary')?.textContent).toContain(
          'Import finished: 1 created · 0 skipped · 0 failed.'
        );
      });
      expect(document.getElementById('hudu-asset-mapping-error')?.textContent).toContain(
        'Hudu rate limit reached. Try again later.'
      );
    });
  });

  describe('T266: three-way bulk summary + serial-conflict naming', () => {
    it('renders created/skipped/failed and the conflict row names the existing asset', async () => {
      importAllUnmatchedHuduAssetsMock.mockResolvedValue({
        success: true,
        data: {
          created: 1,
          skipped: 1,
          failed: [
            {
              huduAssetId: 3,
              error: 'An asset with serial number "SN-3" already exists: "DC-01".',
              code: 'serial_conflict',
              existing_asset_name: 'DC-01',
            },
          ],
        },
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-import-all-btn')!);

      await waitFor(() => {
        expect(document.getElementById('hudu-asset-import-summary')?.textContent).toContain(
          'Import finished: 1 created · 1 skipped · 1 failed.'
        );
      });
      // The conflict row renders the translated message with the EXISTING asset's
      // name (not the raw server error).
      const failureRow = document.getElementById('hudu-asset-import-failure-3');
      expect(failureRow?.textContent).toContain('PRN-01');
      expect(failureRow?.textContent).toContain('Serial number already in use by "DC-01".');
      expect(failureRow?.textContent).not.toContain('already exists');
    });

    it('a single-row import serial conflict surfaces the translated message with the existing asset name', async () => {
      importHuduAssetMock.mockResolvedValue({
        success: false,
        error: 'An asset with serial number "SN-3" already exists: "DC-01".',
        code: 'serial_conflict',
        existing_asset_id: 'asset-1',
        existing_asset_name: 'DC-01',
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-import-3')!);

      await waitFor(() => {
        expect(document.getElementById('hudu-asset-mapping-error')?.textContent).toBe(
          'Serial number already in use by "DC-01".'
        );
      });
      // The row stays plain-unmapped and importable.
      expect(document.getElementById('hudu-asset-status-3')?.textContent).toBe('Unmapped');
      expect(document.getElementById('hudu-asset-import-3')).not.toBeNull();
    });
  });

  describe('T261: excluded-layout rows', () => {
    const withExcluded = (rows: HuduAssetMappingView[]): HuduAssetMappingView[] =>
      rows.map((row) => (row.hudu_asset_id === 3 ? { ...row, layout_excluded: true } : row));

    it('hides the per-row Import, shows the Excluded hint, and disables Import all when nothing else is unmatched', async () => {
      mockMappings(withExcluded(buildRows()));

      await renderManager();

      // Row 3 is plain-unmapped but excluded: no Import affordance, hint shown.
      expect(document.getElementById('hudu-asset-import-3')).toBeNull();
      expect(document.getElementById('hudu-asset-excluded-3')?.textContent).toBe(
        'Not imported (layout excluded)'
      );
      // The other rows show no hint.
      expect(document.getElementById('hudu-asset-excluded-1')).toBeNull();
      // It was the only unmatched row, so the Import-all count is zero → disabled.
      expect((document.getElementById('hudu-asset-import-all-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('Import all stays enabled when a non-excluded unmatched row remains', async () => {
      const rows = withExcluded(buildRows()).map((row) =>
        row.hudu_asset_id === 2 ? { ...row, suggestion: null } : row
      );
      mockMappings(rows);

      await renderManager();

      // Row 2 (unmatched, not excluded) keeps the trigger live; row 3 still has no Import.
      expect((document.getElementById('hudu-asset-import-all-btn') as HTMLButtonElement).disabled).toBe(false);
      expect(document.getElementById('hudu-asset-import-2')).not.toBeNull();
      expect(document.getElementById('hudu-asset-import-3')).toBeNull();
    });

    it('an excluded row is still stage- and mappable to an existing asset', async () => {
      mockMappings(withExcluded(buildRows()));
      setHuduAssetMappingMock.mockResolvedValue({ success: true, data: { mapping_id: 'map-excluded' } });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-row-action-2')!); // dismiss suggestion
      fireEvent.change(screen.getByTestId('hudu-asset-picker-3'), { target: { value: 'asset-3' } });

      expect(document.getElementById('hudu-asset-status-3')?.textContent).toBe('Pending');

      fireEvent.click(screen.getByRole('button', { name: /Save mappings/ }));

      await waitFor(() => {
        expect(setHuduAssetMappingMock).toHaveBeenCalledWith(
          expect.objectContaining({ clientId: CLIENT_ID, assetId: 'asset-3', huduAssetId: 3 })
        );
      });
      await waitFor(() => {
        expect(document.getElementById('hudu-asset-status-3')?.textContent).toBe('Mapped');
      });
    });
  });

  describe('T235: Sync from Hudu', () => {
    it('renders the updated/unchanged/stale summary with the synced timestamp', async () => {
      syncHuduClientAssetsMock.mockResolvedValue({
        state: 'ok',
        updated: 2,
        unchanged: 5,
        stale: 1,
        rmmSkipped: 0,
        syncedAt: '2026-06-11T10:00:00.000Z',
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-sync-btn')!);

      await waitFor(() => {
        expect(syncHuduClientAssetsMock).toHaveBeenCalledWith({ clientId: CLIENT_ID });
      });
      await waitFor(() => {
        expect(document.getElementById('hudu-asset-sync-summary')?.textContent).toContain(
          'Sync complete: 2 updated · 5 unchanged · 1 stale.'
        );
      });
      const summary = document.getElementById('hudu-asset-sync-summary');
      expect(summary?.textContent).toContain('Last synced:');
      expect(summary?.textContent).toContain(new Date('2026-06-11T10:00:00.000Z').toLocaleString());
      // rmmSkipped: 0 → the RMM note stays hidden.
      expect(document.getElementById('hudu-asset-sync-rmm-skipped')).toBeNull();
      expect(summary?.textContent).not.toContain('RMM-managed');
      // The rows reloaded so stale flags/names reflect the sync.
      expect(getHuduAssetMappingsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('surfaces rmmSkipped in the summary line when RMM-owned rows were suppressed (F260)', async () => {
      syncHuduClientAssetsMock.mockResolvedValue({
        state: 'ok',
        updated: 1,
        unchanged: 4,
        stale: 0,
        rmmSkipped: 3,
        syncedAt: '2026-06-12T10:00:00.000Z',
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-sync-btn')!);

      await waitFor(() => {
        expect(document.getElementById('hudu-asset-sync-summary')?.textContent).toContain(
          'Sync complete: 1 updated · 4 unchanged · 0 stale.'
        );
      });
      expect(document.getElementById('hudu-asset-sync-rmm-skipped')?.textContent).toContain(
        '3 RMM-managed skipped.'
      );
    });

    it('a typed sync failure surfaces the rate-limited message', async () => {
      syncHuduClientAssetsMock.mockResolvedValue({
        state: 'error',
        error: 'HTTP 429',
        errorKind: 'rate_limited',
      });

      await renderManager();

      fireEvent.click(document.getElementById('hudu-asset-sync-btn')!);

      await waitFor(() => {
        expect(document.getElementById('hudu-asset-mapping-error')?.textContent).toContain(
          'Hudu rate limit reached. Try again later.'
        );
      });
      expect(document.getElementById('hudu-asset-sync-summary')).toBeNull();
    });
  });

  describe('T236: RBAC-conditional affordances', () => {
    it('hides Import and Sync affordances (and the save path) without asset permissions', async () => {
      mockPermissions(false, false);

      await renderManager();

      expect(document.getElementById('hudu-asset-import-all-btn')).toBeNull();
      expect(document.getElementById('hudu-asset-sync-btn')).toBeNull();
      expect(document.getElementById('hudu-asset-import-3')).toBeNull();
      // No row actions, disabled pickers, and no save bar despite the dirty suggestion.
      expect(document.getElementById('hudu-asset-row-action-2')).toBeNull();
      expect((screen.getByTestId('hudu-asset-picker-3') as HTMLSelectElement).disabled).toBe(true);
      expect(document.getElementById('hudu-asset-mapping-save-bar')).toBeNull();
    });

    it('asset create without update shows Import but hides Sync and the save path', async () => {
      mockPermissions(true, false);

      await renderManager();

      expect(document.getElementById('hudu-asset-import-all-btn')).not.toBeNull();
      expect(document.getElementById('hudu-asset-import-3')).not.toBeNull();
      expect(document.getElementById('hudu-asset-sync-btn')).toBeNull();
      expect(document.getElementById('hudu-asset-mapping-save-bar')).toBeNull();
    });
  });
});
