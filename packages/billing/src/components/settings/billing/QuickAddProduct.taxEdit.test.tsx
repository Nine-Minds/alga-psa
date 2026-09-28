// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

/**
 * QuickAddProduct edit-mode coverage for the tenant default tax rate
 * (card alga-2026-0002527): a saved NULL or UUID is retained on update and the
 * inherit option is not offered while editing (edit must never silently
 * inherit).
 */

const mocks = vi.hoisted(() => ({
  updateService: vi.fn(),
  createService: vi.fn(),
  getServiceTypesForSelection: vi.fn(),
  setServicePrices: vi.fn(),
  createServiceTypeInline: vi.fn(),
  updateServiceTypeInline: vi.fn(),
  deleteServiceTypeInline: vi.fn(),
  getDefaultBillingSettings: vi.fn(),
  getTaxRates: vi.fn(),
  getTenantTaxSettings: vi.fn(),
  getProductInventorySettings: vi.fn(),
  enableInventory: vi.fn(),
  updateInventorySettings: vi.fn(),
  setProductSerialized: vi.fn(),
  setProductKit: vi.fn(),
  listVendorProducts: vi.fn(),
  getServiceCategories: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  updateService: (...args: unknown[]) => mocks.updateService(...args),
  createService: (...args: unknown[]) => mocks.createService(...args),
  getServiceTypesForSelection: (...args: unknown[]) => mocks.getServiceTypesForSelection(...args),
  setServicePrices: (...args: unknown[]) => mocks.setServicePrices(...args),
  createServiceTypeInline: (...args: unknown[]) => mocks.createServiceTypeInline(...args),
  updateServiceTypeInline: (...args: unknown[]) => mocks.updateServiceTypeInline(...args),
  deleteServiceTypeInline: (...args: unknown[]) => mocks.deleteServiceTypeInline(...args),
}));
vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => mocks.getDefaultBillingSettings(...args),
}));
vi.mock('@alga-psa/billing/actions/taxRateActions', () => ({
  getTaxRates: (...args: unknown[]) => mocks.getTaxRates(...args),
}));
vi.mock('@alga-psa/billing/actions/taxSettingsActions', () => ({
  getTenantTaxSettings: (...args: unknown[]) => mocks.getTenantTaxSettings(...args),
}));
vi.mock('@alga-psa/billing/actions/categoryActions', () => ({
  getServiceCategories: (...args: unknown[]) => mocks.getServiceCategories(...args),
}));
vi.mock('@alga-psa/inventory/actions/productInventorySettingsActions', () => ({
  getProductInventorySettings: (...args: unknown[]) => mocks.getProductInventorySettings(...args),
  enableInventory: (...args: unknown[]) => mocks.enableInventory(...args),
  updateInventorySettings: (...args: unknown[]) => mocks.updateInventorySettings(...args),
  setProductSerialized: (...args: unknown[]) => mocks.setProductSerialized(...args),
  setProductKit: (...args: unknown[]) => mocks.setProductKit(...args),
}));
vi.mock('@alga-psa/inventory/actions/vendorProductActions', () => ({
  listVendorProducts: (...args: unknown[]) => mocks.listVendorProducts(...args),
}));
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (cents: number) => `$${(cents / 100).toFixed(2)}` }),
}));
vi.mock('@alga-psa/core', () => ({
  CURRENCY_OPTIONS: [{ value: 'USD', label: 'USD' }],
  getCurrencySymbol: () => '$',
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionMessageError: (value: any) => Boolean(value && 'actionError' in value),
  isActionPermissionError: (value: any) => Boolean(value && 'permissionError' in value),
  getErrorMessage: (value: any) => value?.actionError ?? value?.permissionError ?? 'error',
  handleError: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, values: any = {}) =>
      String(values.defaultValue ?? '').replace(/{{(\w+)}}/g, (_m: string, key: string) => values[key]),
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/EditableServiceTypeSelect', () => ({
  EditableServiceTypeSelect: ({ value, onChange, serviceTypes }: any) => (
    <select id="product-service-type" value={value} onChange={(e) => onChange(e.target.value)}>
      {(serviceTypes ?? []).map((type: { id: string; name: string }) => (
        <option key={type.id} value={type.id}>
          {type.name}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ value, onValueChange, options }: any) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { QuickAddProduct } from './QuickAddProduct';
import { INHERIT_TAX_RATE_VALUE, NON_TAXABLE_VALUE } from './catalogTaxSelection';

function productFixture(taxRateId: string | null) {
  return {
    service_id: 'prod-1',
    service_name: 'Existing Product',
    custom_service_type_id: 'st1',
    unit_of_measure: 'each',
    billing_method: 'usage',
    item_kind: 'product',
    is_active: true,
    is_license: false,
    tax_rate_id: taxRateId,
    default_rate: 10000,
    prices: [{ currency_code: 'USD', rate: 10000 }],
    cost: null,
    cost_currency: 'USD',
  } as any;
}

function taxSelect(): HTMLSelectElement {
  return Array.from(document.querySelectorAll('select')).find((select) =>
    Array.from(select.options).some((option) => option.value === NON_TAXABLE_VALUE),
  ) as HTMLSelectElement;
}

async function renderEdit(product: any) {
  render(
    <QuickAddProduct isOpen onClose={vi.fn()} onProductAdded={vi.fn()} product={product} />,
  );
  await waitFor(() => expect(taxSelect()).toBeTruthy());
}

async function submitAndGetUpdatePayload(product: any) {
  await renderEdit(product);
  fireEvent.click(document.getElementById('quick-add-product-submit-button')!);
  await waitFor(() => expect(mocks.updateService).toHaveBeenCalledTimes(1));
  return mocks.updateService.mock.calls[0][1] as Record<string, unknown>;
}

describe('QuickAddProduct edit-mode tax selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the default-currency fetch pending: its resolution rewrites
    // formPrices to rate 0, which would clobber the edit fixture. The edit path
    // under test does not depend on it.
    mocks.getDefaultBillingSettings.mockReturnValue(new Promise(() => undefined));
    mocks.getTaxRates.mockResolvedValue([
      { tax_rate_id: 'rate-1', region_code: 'AU-GST', description: 'GST', tax_percentage: 10, is_active: true },
    ]);
    mocks.getTenantTaxSettings.mockResolvedValue({
      default_tax_rate_id: 'rate-1',
      default_tax_rate: { region_code: 'AU-GST', description: 'GST', tax_percentage: 10 },
    });
    mocks.getServiceTypesForSelection.mockResolvedValue([{ id: 'st1', name: 'Standard', is_standard: false }]);
    mocks.getServiceCategories.mockResolvedValue([]);
    mocks.getProductInventorySettings.mockResolvedValue(null);
    mocks.listVendorProducts.mockResolvedValue([]);
    mocks.updateService.mockResolvedValue({ service_id: 'prod-1' });
    mocks.setServicePrices.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('retains a saved NULL tax rate on update and never offers inherit in edit mode', async () => {
    const payload = await submitAndGetUpdatePayload(productFixture(null));
    expect(payload.tax_rate_id).toBeNull();
    expect(
      Array.from(taxSelect().options).some((option) => option.value === INHERIT_TAX_RATE_VALUE),
    ).toBe(false);
  });

  it('retains a saved tax rate UUID on update', async () => {
    const payload = await submitAndGetUpdatePayload(productFixture('22222222-2222-4222-8222-222222222222'));
    expect(payload.tax_rate_id).toBe('22222222-2222-4222-8222-222222222222');
  });
});
