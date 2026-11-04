/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AssetStatusesManager from './AssetStatusesManager';

const mockListAssetStatuses = vi.fn();
const mockReorderAssetStatuses = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../actions/assetStatusActions', () => ({
  listAssetStatuses: (...args: unknown[]) => mockListAssetStatuses(...args),
  reorderAssetStatuses: (...args: unknown[]) => mockReorderAssetStatuses(...args),
  createAssetStatus: vi.fn(),
  updateAssetStatus: vi.fn(),
  archiveAssetStatus: vi.fn(),
  restoreAssetStatus: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) },
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

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer, id }: any) => (isOpen ? <div id={id}>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, value }: any) => <select id={id} value={value ?? ''} />,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, id }: any) => (isOpen ? <div id={id} /> : null),
}));

/**
 * Mirrors the real table's `rowProps` contract (attributes land on the `<tr>`)
 * and its row keys: DataTable keys rows by position unless the record carries
 * an `id`, which an AssetStatus does not — so a reordered row reuses the DOM
 * node that was already there, focus included.
 */
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data = [], columns = [], rowClassName, rowProps }: any) => (
    <table id={id}>
      <tbody>
        {data.map((record: any, rowIndex: number) => (
          <tr
            key={`row_${rowIndex}`}
            data-testid={`row-${record.status_id}`}
            className={typeof rowClassName === 'function' ? rowClassName(record) : undefined}
            {...(typeof rowProps === 'function' ? rowProps(record, rowIndex) : {})}
          >
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
  DropdownMenuItem: ({ children, id, onClick }: any) => <button id={id} onClick={onClick}>{children}</button>,
}));

const status = (id: string, label: string, order: number) => ({
  tenant: 'tenant-1',
  status_id: id,
  slug: label.toLowerCase(),
  label,
  kind: 'deployable' as const,
  is_builtin: true,
  is_active: true,
  display_order: order,
  created_at: '',
  updated_at: '',
  in_use_count: 0,
});

const rows = [status('s-1', 'Active', 0), status('s-2', 'In stock', 1), status('s-3', 'Retired', 2)];

describe('AssetStatusesManager reordering', () => {
  beforeEach(() => {
    mockListAssetStatuses.mockReset().mockResolvedValue(rows);
    mockReorderAssetStatuses.mockReset().mockResolvedValue({ success: true, data: rows });
    mockToastError.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  const waitForRows = () => waitFor(() => expect(screen.getByTestId('row-s-1')).toBeTruthy());

  it('offers a drag handle per status and no move arrows', async () => {
    render(<AssetStatusesManager />);
    await waitForRows();

    expect(document.getElementById('asset-status-drag-handle-s-1')).toBeTruthy();
    expect(document.getElementById('asset-status-move-up-s-1')).toBeNull();
    expect(document.getElementById('asset-status-move-down-s-1')).toBeNull();
  });

  it('writes the dragged order when a row is dropped on another', async () => {
    render(<AssetStatusesManager />);
    await waitForRows();

    fireEvent.dragStart(screen.getByTestId('row-s-3'));
    fireEvent.dragOver(screen.getByTestId('row-s-1'));
    fireEvent.dragEnd(screen.getByTestId('row-s-3'));

    await waitFor(() => expect(mockReorderAssetStatuses).toHaveBeenCalledTimes(1));
    expect(mockReorderAssetStatuses).toHaveBeenCalledWith(['s-3', 's-1', 's-2']);
  });

  it('ignores a drag that ends where it started', async () => {
    render(<AssetStatusesManager />);
    await waitForRows();

    fireEvent.dragStart(screen.getByTestId('row-s-2'));
    fireEvent.dragEnd(screen.getByTestId('row-s-2'));

    await Promise.resolve();
    expect(mockReorderAssetStatuses).not.toHaveBeenCalled();
  });

  it('moves a status with the arrow keys on its handle', async () => {
    render(<AssetStatusesManager />);
    await waitForRows();

    fireEvent.keyDown(document.getElementById('asset-status-drag-handle-s-1')!, { key: 'ArrowDown' });

    await waitFor(() => expect(mockReorderAssetStatuses).toHaveBeenCalledWith(['s-2', 's-1', 's-3']));
  });

  it('keeps focus on the moved status so a second arrow continues the move', async () => {
    // The server answers with the order it was just given, as it does live.
    let stored = rows;
    mockListAssetStatuses.mockImplementation(async () => stored);
    mockReorderAssetStatuses.mockImplementation(async (ids: string[]) => {
      stored = ids.map((id, index) => ({
        ...rows.find((row) => row.status_id === id)!,
        display_order: index,
      }));
      return { success: true, data: stored };
    });

    render(<AssetStatusesManager />);
    await waitForRows();

    const handle = document.getElementById('asset-status-drag-handle-s-1')!;
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });

    await waitFor(() => expect(mockReorderAssetStatuses).toHaveBeenLastCalledWith(['s-2', 's-1', 's-3']));
    await waitFor(() => expect(document.activeElement?.id).toBe('asset-status-drag-handle-s-1'));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });

    await waitFor(() => expect(mockReorderAssetStatuses).toHaveBeenLastCalledWith(['s-2', 's-3', 's-1']));
  });

  it('puts the server order back when the write is refused', async () => {
    mockReorderAssetStatuses.mockResolvedValue({ success: false, error: { code: 'not_found', message: 'gone' } });
    render(<AssetStatusesManager />);
    await waitForRows();

    fireEvent.keyDown(document.getElementById('asset-status-drag-handle-s-1')!, { key: 'ArrowDown' });

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    // One load on mount, one after the refusal.
    expect(mockListAssetStatuses).toHaveBeenCalledTimes(2);
  });
});
