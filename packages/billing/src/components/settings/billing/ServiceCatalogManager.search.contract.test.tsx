/**
 * @vitest-environment jsdom
 *
 * Contract coverage for service catalog search and bulk actions.
 *
 * The bar composes the existing single-item actions client-side, so the things
 * worth pinning are the ones a composition gets wrong: one request per selected
 * id (not one for the whole batch), a per-id refusal that skips instead of
 * aborting and is named back to the operator, and a selection that does not
 * outlive the rows it was made against.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@alga-psa/ui/components/SearchInput', async () => {
  const React = await import('react');
  return {
    SearchInput: ({ id, value, onChange, onClear, debounceMs, loading, placeholder, className }: any) => {
      const [visibleValue, setVisibleValue] = React.useState(value);
      React.useEffect(() => setVisibleValue(value), [value]);
      const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
      return <div><input id={id} aria-label={placeholder} className={className} value={visibleValue} onChange={(event) => {
        const next = event.target.value;
        setVisibleValue(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(event), debounceMs);
      }} /><button type="button" aria-label="clear search" disabled={!visibleValue} onClick={() => { setVisibleValue(''); onClear(); }} />{loading ? <span data-testid="search-loading" /> : null}</div>;
    },
  };
});

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({
    id,
    data,
    columns,
    onRowClick,
    rowClassName,
    onPageChange,
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
    onPageChange?: (page: number) => void;
  }) => (
    <div data-testid={id}>
      <button type="button" id="mock-page-three" onClick={() => onPageChange?.(3)}>Page 3</button>
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

describe('ServiceCatalogManager search', () => {
  it('debounces typing and sends the search on page one', async () => {
    await renderCatalog();
    vi.useFakeTimers();
    getServicesMock.mockClear();
    const input = screen.getByLabelText('Search services by name, SKU, or description...');
    fireEvent.change(input, { target: { value: 'n' } });
    fireEvent.change(input, { target: { value: 'ne' } });
    fireEvent.change(input, { target: { value: 'network' } });
    expect(getServicesMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(getServicesMock).toHaveBeenCalledTimes(1);
    expect(getServicesMock).toHaveBeenCalledWith(1, 10, expect.objectContaining({ item_kind: 'service', search: 'network' }));
    vi.useRealTimers();
  });

  it('combines service type, billing method, and search without fetching 1000 rows', async () => {
    render(<ServiceCatalogManager />);
    await screen.findByTestId('data-row-svc-1');
    fireEvent.change(screen.getByLabelText('Search services by name, SKU, or description...'), { target: { value: 'network' } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    fireEvent.change(document.getElementById('service-catalog-service-type-filter')!, { target: { value: 'type-1' } });
    fireEvent.change(document.getElementById('service-catalog-billing-method-filter')!, { target: { value: 'hourly' } });
    await waitFor(() => expect(getServicesMock).toHaveBeenCalledWith(1, 10, expect.objectContaining({
      item_kind: 'service', search: 'network', custom_service_type_id: 'type-1', billing_method: 'hourly',
    })));
    expect(getServicesMock.mock.calls.every((call) => call[1] !== 1000)).toBe(true);
  });

  it('resets to page one and clears selection when the search changes', async () => {
    render(<ServiceCatalogManager />);
    await screen.findByTestId('data-row-svc-1');
    fireEvent.click(rowCheckbox('svc-1'));
    await screen.findByText('1 selected');
    fireEvent.click(document.getElementById('mock-page-three')!);
    await waitFor(() => expect(getServicesMock).toHaveBeenCalledWith(3, 10, expect.anything()));
    fireEvent.change(screen.getByLabelText('Search services by name, SKU, or description...'), { target: { value: 'network' } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await waitFor(() => expect(getServicesMock).toHaveBeenLastCalledWith(1, 10, expect.objectContaining({ search: 'network' })));
    await waitFor(() => expect(bulkBar()).toBeNull());
  });

  it('refetches after zero results when search is cleared', async () => {
    render(<ServiceCatalogManager />);
    await screen.findByTestId('data-row-svc-1');
    getServicesMock.mockResolvedValueOnce({ services: [], totalCount: 0, page: 1, pageSize: 10 });
    fireEvent.change(screen.getByLabelText('Search services by name, SKU, or description...'), { target: { value: 'missing' } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await waitFor(() => expect(getServicesMock).toHaveBeenLastCalledWith(1, 10, expect.objectContaining({ search: 'missing' })));
    await screen.findByText('No services match your search.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(getServicesMock).toHaveBeenLastCalledWith(1, 10, expect.objectContaining({ search: undefined })));
    await screen.findByTestId('data-row-svc-1');
  });

  it('ignores an older response that resolves after the newer response', async () => {
    let resolveOld!: (value: any) => void;
    let resolveNew!: (value: any) => void;
    getServicesMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    render(<ServiceCatalogManager />);
    await waitFor(() => expect(getServicesMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Search services by name, SKU, or description...'), { target: { value: 'new' } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await waitFor(() => expect(getServicesMock).toHaveBeenCalledTimes(2));
    resolveNew({ services: [{ ...services[0], service_id: 'new-result', service_name: 'New result' }], totalCount: 1, page: 1, pageSize: 10 });
    await screen.findByTestId('data-row-new-result');
    resolveOld({ services: [{ ...services[0], service_id: 'old-result', service_name: 'Old result' }], totalCount: 1, page: 1, pageSize: 10 });
    await waitFor(() => expect(screen.queryByTestId('data-row-old-result')).not.toBeInTheDocument());
    expect(screen.getByTestId('data-row-new-result')).toBeInTheDocument();
  });

  it('shows the empty state and Clear filters resets all controls', async () => {
    render(<ServiceCatalogManager />);
    await screen.findByTestId('data-row-svc-1');
    getServicesMock.mockResolvedValue({ services: [], totalCount: 0, page: 1, pageSize: 10 });
    fireEvent.change(document.getElementById('service-catalog-service-type-filter')!, { target: { value: 'type-1' } });
    await screen.findByText('No services match your search.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect((document.getElementById('service-catalog-service-type-filter') as HTMLSelectElement).value).toBe('all');
      expect((document.getElementById('service-catalog-billing-method-filter') as HTMLSelectElement).value).toBe('all');
      expect((document.getElementById('service-catalog-search') as HTMLInputElement).value).toBe('');
    });
  });
});
