/**
 * @vitest-environment jsdom
 *
 * Contract coverage for multi-select bulk actions on the products list.
 *
 * Products delete through a two-step gate — `checkProductCanBeDeleted` then
 * `deleteProductPermanently` — so the batch must run that gate per id, skip the
 * products it refuses (never issue the delete for them), and report each
 * refusal with the association that caused it.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const getServicesMock = vi.hoisted(() => vi.fn());
const updateServiceMock = vi.hoisted(() => vi.fn());
const checkProductCanBeDeletedMock = vi.hoisted(() => vi.fn());
const deleteProductPermanentlyMock = vi.hoisted(() => vi.fn());

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as unknown as {
    (...args: unknown[]): void;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    loading: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
  };
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.loading = vi.fn();
  fn.dismiss = vi.fn();
  return fn;
});

const tMock = vi.hoisted(() => (
  (key: string, options?: { defaultValue?: string; [token: string]: unknown }) => {
    let value = options?.defaultValue ?? key;
    for (const [token, replacement] of Object.entries(options ?? {})) {
      if (token !== 'defaultValue') {
        value = value.replace(`{{${token}}}`, String(replacement));
      }
    }
    return value;
  }
));

vi.mock('react-hot-toast', () => ({
  default: toastMock,
  toast: toastMock,
  Toaster: () => null,
}));

vi.mock('../../../actions/serviceActions', () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args),
  updateService: (...args: unknown[]) => updateServiceMock(...args),
  checkProductCanBeDeleted: (...args: unknown[]) => checkProductCanBeDeletedMock(...args),
  deleteProductPermanently: (...args: unknown[]) => deleteProductPermanentlyMock(...args),
  getServiceTypesForSelection: vi.fn(async () => [
    { id: 'type-1', name: 'Hardware', is_standard: false },
  ]),
}));

vi.mock('../../../actions/categoryActions', () => ({
  getServiceCategories: vi.fn(async () => []),
}));

vi.mock('../../../actions/taxRateActions', () => ({
  getTaxRates: vi.fn(async () => []),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTranslation: () => ({ t: tMock }),
  };
});

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({
    id,
    data,
    columns,
    onRowClick,
    rowClassName,
  }: {
    id: string;
    data: Array<Record<string, any>>;
    columns: Array<{
      title?: React.ReactNode;
      dataIndex: string;
      render?: (value: unknown, row: any, index: number) => React.ReactNode;
    }>;
    onRowClick?: (row: Record<string, any>) => void;
    rowClassName?: (row: Record<string, any>) => string;
  }) => (
    <div data-testid={id}>
      <div role="row" data-testid={`${id}-header`}>
        {columns.map((column, columnIndex) => (
          <span key={columnIndex}>{column.title}</span>
        ))}
      </div>
      {data.map((row, rowIndex) => (
        <div
          key={rowIndex}
          role="row"
          data-testid={`data-row-${row.service_id ?? rowIndex}`}
          className={rowClassName?.(row) || undefined}
          onClick={() => onRowClick?.(row)}
        >
          {columns.map((column, columnIndex) => (
            <span key={columnIndex}>
              {column.render
                ? column.render(row[column.dataIndex], row, rowIndex)
                : String(row[column.dataIndex] ?? '')}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    id,
    value,
    onValueChange,
    options,
  }: {
    id?: string;
    value?: string;
    onValueChange?: (value: string) => void;
    options?: Array<{ value: string; label: string }>;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./QuickAddProduct', () => ({
  QuickAddProduct: () => <div data-testid="quick-add-product" />,
}));

import ProductsManager from './ProductsManager';

const products = [
  {
    service_id: 'prod-1',
    service_name: 'Ruby Slippers',
    custom_service_type_id: 'type-1',
    billing_method: 'fixed' as const,
    default_rate: 12000,
    category_id: null,
    unit_of_measure: 'each',
    is_active: true,
    prices: [],
  },
  {
    service_id: 'prod-2',
    service_name: 'Emerald Spectacles',
    custom_service_type_id: 'type-1',
    billing_method: 'fixed' as const,
    default_rate: 4500,
    category_id: null,
    unit_of_measure: 'each',
    is_active: true,
    prices: [],
  },
];

const bulkBar = () => document.querySelector('[data-bulk-action-bar="products-bulk-action-bar"]');
const rowCheckbox = (serviceId: string) =>
  document.getElementById(`products-select-${serviceId}`) as HTMLInputElement;
const selectAllCheckbox = () => document.getElementById('products-select-all') as HTMLInputElement;
const barButton = (action: string) =>
  document.getElementById(`products-bulk-action-bar-${action}-button`) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(() => false),
  });
  getServicesMock.mockResolvedValue({
    services: products,
    totalCount: products.length,
    page: 1,
    pageSize: 10,
  });
  updateServiceMock.mockResolvedValue({ service_id: 'prod-1' });
  checkProductCanBeDeletedMock.mockResolvedValue({ canDelete: true, associations: [] });
  deleteProductPermanentlyMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

async function renderProducts() {
  render(<ProductsManager />);
  await screen.findByTestId('data-row-prod-1');
}

describe('ProductsManager bulk selection', () => {
  it('ticks one row into the selection without opening the edit dialog', async () => {
    await renderProducts();

    expect(bulkBar()).toBeNull();
    fireEvent.click(rowCheckbox('prod-1'));

    await screen.findByText('1 selected');
    expect(screen.getByTestId('data-row-prod-1')).toHaveClass('bg-table-selected');
    expect(screen.getByTestId('data-row-prod-2')).not.toHaveClass('bg-table-selected');
  });

  it('selects every row on the visible page from the header checkbox', async () => {
    await renderProducts();

    fireEvent.click(selectAllCheckbox());

    await screen.findByText('2 selected');
    expect(rowCheckbox('prod-1').checked).toBe(true);
    expect(rowCheckbox('prod-2').checked).toBe(true);
  });

  it('drops the whole selection on Clear', async () => {
    await renderProducts();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(
      document.getElementById('products-bulk-action-bar-clear-button') as HTMLButtonElement,
    );

    await waitFor(() => expect(bulkBar()).toBeNull());
    expect(rowCheckbox('prod-1').checked).toBe(false);
  });
});

describe('ProductsManager bulk archive/restore', () => {
  it('archives with one updateService call per selected id and clears the selection', async () => {
    await renderProducts();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('archive'));

    await waitFor(() => expect(updateServiceMock).toHaveBeenCalledTimes(2));
    expect(updateServiceMock).toHaveBeenCalledWith('prod-1', { is_active: false });
    expect(updateServiceMock).toHaveBeenCalledWith('prod-2', { is_active: false });
    expect(toastMock.success).toHaveBeenCalledWith('2 product(s) archived');
    await waitFor(() => expect(bulkBar()).toBeNull());
  });

  it('restores with one updateService call per selected id', async () => {
    await renderProducts();
    fireEvent.click(rowCheckbox('prod-2'));
    await screen.findByText('1 selected');

    fireEvent.click(barButton('restore'));

    await waitFor(() => expect(updateServiceMock).toHaveBeenCalledTimes(1));
    expect(updateServiceMock).toHaveBeenCalledWith('prod-2', { is_active: true });
    expect(toastMock.success).toHaveBeenCalledWith('1 product(s) restored');
  });

  it('reports a partial failure instead of claiming the whole batch succeeded', async () => {
    updateServiceMock.mockImplementation(async (serviceId: string) =>
      serviceId === 'prod-2'
        ? { permissionError: 'Permission denied: Cannot update services/products' }
        : { service_id: serviceId },
    );

    await renderProducts();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('archive'));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(
      'Archived 1 product(s); 1 could not be archived',
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe('ProductsManager bulk permanent delete', () => {
  it('confirms first, then skips products the association check refuses and names the reason', async () => {
    checkProductCanBeDeletedMock.mockImplementation(async (serviceId: string) =>
      serviceId === 'prod-2'
        ? {
            canDelete: false,
            associations: [{ type: 'invoice', count: 2, description: '2 invoice line items' }],
          }
        : { canDelete: true, associations: [] },
    );

    await renderProducts();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('delete'));

    // Destructive: nothing is issued until the dialog is confirmed.
    await screen.findByText('Delete Products Permanently');
    expect(checkProductCanBeDeletedMock).not.toHaveBeenCalled();

    fireEvent.click(
      document.getElementById('products-bulk-delete-dialog-confirm') as HTMLButtonElement,
    );

    await waitFor(() => expect(checkProductCanBeDeletedMock).toHaveBeenCalledTimes(2));
    // The refused product must never reach the permanent delete.
    expect(deleteProductPermanentlyMock).toHaveBeenCalledTimes(1);
    expect(deleteProductPermanentlyMock).toHaveBeenCalledWith('prod-1');
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(
      'Deleted 1 product(s); 1 could not be deleted: Emerald Spectacles (2 invoice line items)',
    );
    await waitFor(() => expect(bulkBar()).toBeNull());
  });

  it('reports a clean batch as a success', async () => {
    await renderProducts();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('delete'));
    await screen.findByText('Delete Products Permanently');
    fireEvent.click(
      document.getElementById('products-bulk-delete-dialog-confirm') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('2 product(s) deleted permanently'),
    );
    expect(deleteProductPermanentlyMock).toHaveBeenCalledTimes(2);
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
