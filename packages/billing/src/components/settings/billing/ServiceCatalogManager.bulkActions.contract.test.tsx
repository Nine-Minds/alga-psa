/**
 * @vitest-environment jsdom
 *
 * Contract coverage for multi-select bulk actions on the service catalog.
 *
 * The bar composes the existing single-item actions client-side, so the things
 * worth pinning are the ones a composition gets wrong: one request per selected
 * id (not one for the whole batch), a per-id refusal that skips instead of
 * aborting and is named back to the operator, and a selection that does not
 * outlive the rows it was made against.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const getServicesMock = vi.hoisted(() => vi.fn());
const updateServiceMock = vi.hoisted(() => vi.fn());
const deleteServiceMock = vi.hoisted(() => vi.fn());
const getServiceContractUsageMock = vi.hoisted(() => vi.fn());

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
  updateServicePricing: vi.fn(async () => ({ prices: [] })),
  deleteService: (...args: unknown[]) => deleteServiceMock(...args),
  getServiceTypesForSelection: vi.fn(async () => [
    { id: 'type-1', name: 'Managed Services', is_standard: false },
  ]),
  createServiceTypeInline: vi.fn(async () => ({ id: 'type-2', name: 'New' })),
  updateServiceTypeInline: vi.fn(async () => ({ id: 'type-1', name: 'Managed' })),
  deleteServiceTypeInline: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../actions/servicePriceRolloutActions', () => ({
  getServiceContractUsage: (...args: unknown[]) => getServiceContractUsageMock(...args),
  applyServicePriceChange: vi.fn(async () => ({ success: true })),
  previewServicePriceChange: vi.fn(),
}));

vi.mock('../../../actions/rateReviewActions', () => ({
  previewRateReclassification: vi.fn(),
  applyRateReclassification: vi.fn(),
  previewContractLineRateReset: vi.fn(),
  resetContractLineRateToStandard: vi.fn(),
}));

vi.mock('../../../actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: vi.fn(async () => ({ defaultCurrencyCode: 'USD' })),
}));

vi.mock('../../../actions/categoryActions', () => ({
  getServiceCategories: vi.fn(async () => []),
}));

vi.mock('../../../actions/taxRateActions', () => ({
  getTaxRates: vi.fn(async () => []),
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({
  preCheckDeletion: vi.fn(async () => ({
    canDelete: true,
    code: 'CAN_DELETE',
    message: '',
    dependencies: [],
    alternatives: [],
  })),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTranslation: () => ({ t: tMock }),
    useFormatters: () => ({
      formatDate: (value: string | Date) => String(value),
      formatCurrency: (value: number, currency: string = 'USD') => `${currency} ${value.toFixed(2)}`,
    }),
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

vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({
  default: () => <div data-testid="currency-picker" />,
}));

vi.mock('@alga-psa/ui/components/EditableServiceTypeSelect', () => ({
  EditableServiceTypeSelect: () => <div data-testid="editable-service-type" />,
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./QuickAddService', () => ({
  QuickAddService: () => <div data-testid="quick-add-service" />,
}));

import ServiceCatalogManager from './ServiceCatalogManager';

const services = [
  {
    service_id: 'svc-1',
    service_name: 'Emerald City Security',
    custom_service_type_id: 'type-1',
    billing_method: 'fixed' as const,
    default_rate: 10000,
    category_id: null,
    unit_of_measure: 'month',
    is_active: true,
    prices: [],
    scheduled_prices: [],
  },
  {
    service_id: 'svc-2',
    service_name: 'Yellow Brick Monitoring',
    custom_service_type_id: 'type-1',
    billing_method: 'fixed' as const,
    default_rate: 5000,
    category_id: null,
    unit_of_measure: 'month',
    is_active: true,
    prices: [],
    scheduled_prices: [],
  },
];

const bulkBar = () => document.querySelector('[data-bulk-action-bar="service-catalog-bulk-action-bar"]');
const rowCheckbox = (serviceId: string) =>
  document.getElementById(`service-catalog-select-${serviceId}`) as HTMLInputElement;
const selectAllCheckbox = () =>
  document.getElementById('service-catalog-select-all') as HTMLInputElement;
const barButton = (action: string) =>
  document.getElementById(`service-catalog-bulk-action-bar-${action}-button`) as HTMLButtonElement;

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
    services,
    totalCount: services.length,
    page: 1,
    pageSize: 10,
  });
  getServiceContractUsageMock.mockResolvedValue({
    contractCount: 0,
    lineCount: 0,
    byProvenance: { inherited: 0, custom: 0, unreviewed: 0 },
  });
  updateServiceMock.mockResolvedValue({ service_id: 'svc-1' });
  deleteServiceMock.mockResolvedValue({ success: true, deleted: true, canDelete: true });
});

afterEach(() => {
  cleanup();
});

async function renderCatalog() {
  render(<ServiceCatalogManager />);
  await screen.findByTestId('data-row-svc-1');
}

describe('ServiceCatalogManager bulk selection', () => {
  it('ticks one row into the selection without opening the edit dialog', async () => {
    await renderCatalog();

    expect(bulkBar()).toBeNull();
    fireEvent.click(rowCheckbox('svc-1'));

    await screen.findByText('1 selected');
    // The row click is what opens the editor; the checkbox must not inherit it.
    expect(screen.queryByText('Edit Service')).not.toBeInTheDocument();
    expect(screen.getByTestId('data-row-svc-1')).toHaveClass('bg-table-selected');
    expect(screen.getByTestId('data-row-svc-2')).not.toHaveClass('bg-table-selected');
  });

  it('selects every row on the visible page from the header checkbox', async () => {
    await renderCatalog();

    fireEvent.click(selectAllCheckbox());

    await screen.findByText('2 selected');
    expect(rowCheckbox('svc-1').checked).toBe(true);
    expect(rowCheckbox('svc-2').checked).toBe(true);
  });

  it('drops the whole selection on Clear', async () => {
    await renderCatalog();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(
      document.getElementById('service-catalog-bulk-action-bar-clear-button') as HTMLButtonElement,
    );

    await waitFor(() => expect(bulkBar()).toBeNull());
    expect(rowCheckbox('svc-1').checked).toBe(false);
  });
});

describe('ServiceCatalogManager bulk deactivate/activate', () => {
  it('deactivates with one updateService call per selected id and clears the selection', async () => {
    await renderCatalog();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('deactivate'));

    await waitFor(() => expect(updateServiceMock).toHaveBeenCalledTimes(2));
    expect(updateServiceMock).toHaveBeenCalledWith('svc-1', { is_active: false });
    expect(updateServiceMock).toHaveBeenCalledWith('svc-2', { is_active: false });
    expect(toastMock.success).toHaveBeenCalledWith('2 service(s) deactivated');
    await waitFor(() => expect(bulkBar()).toBeNull());
  });

  it('activates with one updateService call per selected id', async () => {
    await renderCatalog();
    fireEvent.click(rowCheckbox('svc-2'));
    await screen.findByText('1 selected');

    fireEvent.click(barButton('activate'));

    await waitFor(() => expect(updateServiceMock).toHaveBeenCalledTimes(1));
    expect(updateServiceMock).toHaveBeenCalledWith('svc-2', { is_active: true });
    expect(toastMock.success).toHaveBeenCalledWith('1 service(s) activated');
  });

  it('reports a partial failure instead of claiming the whole batch succeeded', async () => {
    updateServiceMock.mockImplementation(async (serviceId: string) =>
      serviceId === 'svc-2'
        ? { permissionError: 'Permission denied: Cannot update services/products' }
        : { service_id: serviceId },
    );

    await renderCatalog();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('deactivate'));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(
      'Deactivated 1 service(s); 1 could not be deactivated',
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe('ServiceCatalogManager bulk delete', () => {
  it('confirms first, then skips and names the services dependency validation refuses', async () => {
    deleteServiceMock.mockImplementation(async (serviceId: string) =>
      serviceId === 'svc-2'
        ? {
            success: false,
            deleted: false,
            canDelete: false,
            code: 'DEPENDENCIES_EXIST',
            message: 'Service is used on a contract',
            dependencies: [{ table: 'contract_lines', count: 1 }],
            alternatives: [],
          }
        : { success: true, deleted: true, canDelete: true },
    );

    await renderCatalog();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('delete'));

    // Destructive: nothing is issued until the dialog is confirmed.
    await screen.findByText('Delete Services');
    expect(deleteServiceMock).not.toHaveBeenCalled();

    fireEvent.click(
      document.getElementById('service-catalog-bulk-delete-dialog-confirm') as HTMLButtonElement,
    );

    await waitFor(() => expect(deleteServiceMock).toHaveBeenCalledTimes(2));
    expect(deleteServiceMock).toHaveBeenCalledWith('svc-1');
    expect(deleteServiceMock).toHaveBeenCalledWith('svc-2');
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(
      'Deleted 1 service(s); 1 could not be deleted: Yellow Brick Monitoring',
    );
    await waitFor(() => expect(bulkBar()).toBeNull());
  });

  it('reports a clean batch as a success', async () => {
    await renderCatalog();
    fireEvent.click(selectAllCheckbox());
    await screen.findByText('2 selected');

    fireEvent.click(barButton('delete'));
    await screen.findByText('Delete Services');
    fireEvent.click(
      document.getElementById('service-catalog-bulk-delete-dialog-confirm') as HTMLButtonElement,
    );

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('2 service(s) deleted'));
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
