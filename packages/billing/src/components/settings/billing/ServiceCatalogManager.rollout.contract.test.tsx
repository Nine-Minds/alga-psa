/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the two UI blockers found by the live smoke round:
 *
 *  1. `PriceChangeRolloutDialog` was unreachable because the save guard
 *     compared the new rate against `editingService.default_rate`, which the
 *     primary input's onBlur had already overwritten. The dialog could never
 *     open, and a typed-but-never-blurred value was silently discarded.
 *  2. `RateReviewDialog` was unreachable without going through a price change,
 *     so legacy `unreviewed` lines had no route to reclassification.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const getServicesMock = vi.hoisted(() => vi.fn());
const updateServiceMock = vi.hoisted(() => vi.fn());
const updateServicePricingMock = vi.hoisted(() => vi.fn());
const getServiceContractUsageMock = vi.hoisted(() => vi.fn());
const applyServicePriceChangeMock = vi.hoisted(() => vi.fn());
const previewServicePriceChangeMock = vi.hoisted(() => vi.fn());
const previewRateReclassificationMock = vi.hoisted(() => vi.fn());
const applyRateReclassificationMock = vi.hoisted(() => vi.fn());

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

vi.mock('../../../actions/serviceActions', () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args),
  updateService: (...args: unknown[]) => updateServiceMock(...args),
  updateServicePricing: (...args: unknown[]) => updateServicePricingMock(...args),
  deleteService: vi.fn(async () => ({ success: true })),
  getServiceTypesForSelection: vi.fn(async () => [
    { id: 'type-1', name: 'Managed Services', is_standard: false },
  ]),
  createServiceTypeInline: vi.fn(async () => ({ id: 'type-2', name: 'New' })),
  updateServiceTypeInline: vi.fn(async () => ({ id: 'type-1', name: 'Managed' })),
  deleteServiceTypeInline: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../actions/servicePriceRolloutActions', () => ({
  getServiceContractUsage: (...args: unknown[]) => getServiceContractUsageMock(...args),
  applyServicePriceChange: (...args: unknown[]) => applyServicePriceChangeMock(...args),
  previewServicePriceChange: (...args: unknown[]) => previewServicePriceChangeMock(...args),
}));

vi.mock('../../../actions/rateReviewActions', () => ({
  previewRateReclassification: (...args: unknown[]) => previewRateReclassificationMock(...args),
  applyRateReclassification: (...args: unknown[]) => applyRateReclassificationMock(...args),
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
  }: {
    id: string;
    data: Array<Record<string, any>>;
    columns: Array<{
      title?: string;
      dataIndex: string;
      render?: (value: unknown, row: any, index: number) => React.ReactNode;
    }>;
    onRowClick?: (row: Record<string, any>) => void;
  }) => (
    <div data-testid={id}>
      {data.map((row, rowIndex) => (
        <div
          key={rowIndex}
          role="row"
          data-testid={`data-row-${row.service_id ?? row.contractLineId ?? rowIndex}`}
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

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value?: Date;
    onChange: (date: Date | undefined) => void;
  }) => (
    <input
      id={id}
      type="date"
      value={value
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
        : ''}
      onChange={(event) => onChange(event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined)}
    />
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

const service = {
  service_id: 'svc-1',
  service_name: 'Emerald City Security',
  custom_service_type_id: 'type-1',
  billing_method: 'fixed' as const,
  default_rate: 10000,
  category_id: null,
  unit_of_measure: 'month',
  is_active: true,
  prices: [
    {
      price_id: 'price-1',
      service_id: 'svc-1',
      currency_code: 'USD',
      rate: 10000,
      effective_date: '1970-01-01',
    },
  ],
  scheduled_prices: [],
};

const usage = {
  contractCount: 1,
  lineCount: 1,
  byProvenance: { inherited: 1, custom: 0, unreviewed: 0 },
};

const preview = {
  serviceId: 'svc-1',
  currency: 'USD',
  oldRateCents: 10000,
  newRateCents: 15000,
  effectiveDate: '2026-10-01',
  period: { start: '2026-10-01', end: '2026-11-01' },
  willChange: [],
  custom: [],
  unreviewed: [],
  excluded: [],
  totalMonthlyDeltaCents: 0,
};

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
});

function configureMocks() {
  vi.clearAllMocks();
  getServicesMock.mockResolvedValue({
    services: [service],
    totalCount: 1,
    page: 1,
    pageSize: 10,
  });
  getServiceContractUsageMock.mockResolvedValue(usage);
  applyServicePriceChangeMock.mockResolvedValue({ success: true });
  updateServicePricingMock.mockResolvedValue({ prices: service.prices });
  previewServicePriceChangeMock.mockResolvedValue(preview);
  previewRateReclassificationMock.mockResolvedValue({
    period: { start: '2026-10-01', end: '2026-11-01' },
    rows: [
      {
        contractLineId: 'line-1',
        contractId: 'contract-1',
        contractName: 'Emerald Contract',
        clientId: 'client-1',
        currency: 'USD',
        serviceNames: ['Emerald City Security'],
        storedRateCents: 10000,
        resolvedRateCents: 10000,
        currentProvenance: 'unreviewed',
        proposed: 'inherited',
        skipReason: null,
        reason: 'Exact match',
      },
    ],
    summary: { total: 1, inherited: 1, custom: 0, skipped: 0 },
  });
  applyRateReclassificationMock.mockResolvedValue({
    applied: [{ contractLineId: 'line-1', target: 'inherited' }],
    refused: [],
  });
}

async function openEditDialog() {
  render(<ServiceCatalogManager />);
  const row = await screen.findByTestId('data-row-svc-1');
  fireEvent.click(row);
  await screen.findByText('Edit Service');
  return document.getElementById('edit-price-rate-0') as HTMLInputElement;
}

describe('ServiceCatalogManager price-change rollout reachability', () => {
  beforeEach(configureMocks);

  it('opens the rollout dialog when the rate changes, and does not write until Apply', async () => {
    const input = await openEditDialog();

    fireEvent.change(input, { target: { value: '150.00' } });
    // The original repro: clicking Save blurs the field first, which mirrored
    // the new cents into editingService.default_rate and made the guard false.
    fireEvent.blur(input);
    fireEvent.click(document.getElementById('save-button') as HTMLButtonElement);

    await screen.findByText('Price change rollout');
    expect(applyServicePriceChangeMock).not.toHaveBeenCalled();
    expect(updateServicePricingMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /apply to inherited lines/i }));

    await waitFor(() => expect(applyServicePriceChangeMock).toHaveBeenCalledTimes(1));
    expect(applyServicePriceChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'svc-1',
        prices: [{ currency_code: 'USD', rate: 15000 }],
      }),
    );
  });

  it('proposes the typed rate even when the field never blurred (no silent discard)', async () => {
    const input = await openEditDialog();

    fireEvent.change(input, { target: { value: '175.50' } });
    // No blur: the old code read editingPrices[0].rate, which still held the
    // old cents, so it both skipped the rollout and saved the old value.
    fireEvent.click(document.getElementById('save-button') as HTMLButtonElement);

    await screen.findByText('Price change rollout');
    expect(updateServicePricingMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /apply to inherited lines/i }));

    await waitFor(() => expect(applyServicePriceChangeMock).toHaveBeenCalledTimes(1));
    expect(applyServicePriceChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: [{ currency_code: 'USD', rate: 17550 }],
      }),
    );
  });
});

describe('ServiceCatalogManager rate-review reachability', () => {
  beforeEach(configureMocks);

  it('opens rate review from the catalog without a price change and can apply a decision', async () => {
    render(<ServiceCatalogManager />);
    await screen.findByTestId('data-row-svc-1');

    // No edit dialog, no price change: the crux surface must be reachable on
    // its own terms.
    expect(screen.queryByText('Edit Service')).not.toBeInTheDocument();
    fireEvent.click(document.getElementById('open-rate-review') as HTMLButtonElement);

    await waitFor(() => expect(previewRateReclassificationMock).toHaveBeenCalledTimes(1));
    await screen.findByText('Rate review');

    fireEvent.click(document.getElementById('rate-review-apply') as HTMLButtonElement);

    await waitFor(() => expect(applyRateReclassificationMock).toHaveBeenCalledTimes(1));
    expect(applyRateReclassificationMock).toHaveBeenCalledWith(
      [{ contractLineId: 'line-1', target: 'inherited' }],
      expect.anything(),
    );
  });
});
