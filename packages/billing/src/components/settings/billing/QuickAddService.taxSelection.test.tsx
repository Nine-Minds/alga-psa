// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

/**
 * QuickAddService create-form interaction coverage for the tenant default tax
 * rate (card alga-2026-0002527): the create payload omits tax_rate_id to
 * inherit, explicit non-taxable sends null, a successful create resets the
 * selection to inherit, and a late tenant-default fetch cannot overwrite an
 * explicit choice.
 */

const mocks = vi.hoisted(() => ({
  createService: vi.fn(),
  setServicePrices: vi.fn(),
  createServiceTypeInline: vi.fn(),
  updateServiceTypeInline: vi.fn(),
  deleteServiceTypeInline: vi.fn(),
  getDefaultBillingSettings: vi.fn(),
  getTaxRates: vi.fn(),
  getTenantTaxSettings: vi.fn(),
  getServiceCategories: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  createService: (...args: unknown[]) => mocks.createService(...args),
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
vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => ({ tenant: 'tenant-1' }),
}));
vi.mock('@alga-psa/core', () => ({
  CURRENCY_OPTIONS: [{ value: 'USD', label: 'USD' }],
  getCurrencySymbol: () => '$',
}));
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
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));
vi.mock('@alga-psa/ui/components/CurrencyPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/EditableServiceTypeSelect', () => ({
  EditableServiceTypeSelect: ({ value, onChange, serviceTypes }: any) => (
    <select id="service-type-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {serviceTypes.map((type: { id: string; name: string }) => (
        <option key={type.id} value={type.id}>
          {type.name}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { QuickAddService } from './QuickAddService';
import { INHERIT_TAX_RATE_VALUE, NON_TAXABLE_VALUE } from './catalogTaxSelection';

const TAX_SELECT_ID = 'quick-add-service-tax-rate-select';

function taxSelect(): HTMLSelectElement {
  return document.getElementById(TAX_SELECT_ID) as HTMLSelectElement;
}

function billingMethodSelect(): HTMLSelectElement {
  return Array.from(document.querySelectorAll('select')).find((select) =>
    Array.from(select.options).some((option) => option.value === 'fixed'),
  ) as HTMLSelectElement;
}

async function renderForm() {
  render(
    <QuickAddService
      onServiceAdded={vi.fn()}
      allServiceTypes={[{ id: 'st1', name: 'Standard' }]}
      onServiceTypesChange={vi.fn()}
      isOpen
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(document.getElementById(TAX_SELECT_ID)).toBeTruthy());
  await waitFor(() => expect(taxSelect().options.length).toBeGreaterThan(1));
}

function fillRequiredFields() {
  fireEvent.change(document.getElementById('serviceName')!, { target: { value: 'Test Service' } });
  fireEvent.change(document.getElementById('service-type-select')!, { target: { value: 'st1' } });
  fireEvent.change(billingMethodSelect(), { target: { value: 'fixed' } });
  fireEvent.change(document.getElementById('price-rate-0')!, { target: { value: '100' } });
}

function submitForm() {
  const form = document.getElementById('quick-add-service-form') as HTMLFormElement;
  fireEvent.submit(form);
}

describe('QuickAddService tax selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultBillingSettings.mockResolvedValue({ defaultCurrencyCode: 'USD' });
    mocks.getTaxRates.mockResolvedValue([
      { tax_rate_id: 'rate-1', region_code: 'AU-GST', description: 'GST', tax_percentage: 10, is_active: true },
    ]);
    mocks.getTenantTaxSettings.mockResolvedValue({
      default_tax_rate_id: 'rate-1',
      default_tax_rate: { region_code: 'AU-GST', description: 'GST', tax_percentage: 10 },
    });
    mocks.getServiceCategories.mockResolvedValue([]);
    mocks.createService.mockResolvedValue({ service_id: 'svc-1' });
    mocks.setServicePrices.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('omits tax_rate_id when the default inherit selection is used', async () => {
    await renderForm();
    expect(taxSelect().value).toBe(INHERIT_TAX_RATE_VALUE);

    fillRequiredFields();
    submitForm();

    await waitFor(() => expect(mocks.createService).toHaveBeenCalledTimes(1));
    const payload = mocks.createService.mock.calls[0][0] as Record<string, unknown>;
    expect('tax_rate_id' in payload).toBe(false);
  });

  it('sends explicit null for the non-taxable selection', async () => {
    await renderForm();
    fireEvent.change(taxSelect(), { target: { value: NON_TAXABLE_VALUE } });

    fillRequiredFields();
    submitForm();

    await waitFor(() => expect(mocks.createService).toHaveBeenCalledTimes(1));
    const payload = mocks.createService.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tax_rate_id).toBeNull();
  });

  it('resets the selection to inherit after a successful create', async () => {
    await renderForm();
    fireEvent.change(taxSelect(), { target: { value: NON_TAXABLE_VALUE } });

    fillRequiredFields();
    submitForm();

    await waitFor(() => expect(mocks.createService).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((document.getElementById('serviceName') as HTMLInputElement).value).toBe(''));
    expect(taxSelect().value).toBe(INHERIT_TAX_RATE_VALUE);
  });

  it('does not let a late tenant-default fetch overwrite an explicit non-taxable choice', async () => {
    let resolveSettings: (value: unknown) => void = () => undefined;
    mocks.getTenantTaxSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );

    await renderForm();
    fireEvent.change(taxSelect(), { target: { value: NON_TAXABLE_VALUE } });
    expect(taxSelect().value).toBe(NON_TAXABLE_VALUE);

    resolveSettings({
      default_tax_rate_id: 'rate-1',
      default_tax_rate: { region_code: 'AU-GST', description: 'GST', tax_percentage: 10 },
    });
    await waitFor(() =>
      expect(Array.from(taxSelect().options).some((option) => option.textContent?.includes('GST'))).toBe(true),
    );

    expect(taxSelect().value).toBe(NON_TAXABLE_VALUE);
  });
});
