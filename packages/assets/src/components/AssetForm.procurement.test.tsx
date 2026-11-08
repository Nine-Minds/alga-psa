/* @vitest-environment jsdom */

/**
 * T014 (F010) — the edit form's Make & Purchase section: the five new inputs
 * render with their kebab-case ids, load from the asset, and submit with the
 * purchase cost converted to minor units.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AssetForm from './AssetForm';

const mockGetAsset = vi.fn();
const mockUpdateAsset = vi.fn();
const mockGetAssetTypes = vi.fn();
const mockGetVendors = vi.fn();

vi.mock('../actions/assetActions', () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
  updateAsset: (...args: unknown[]) => mockUpdateAsset(...args),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('../actions/clientLookupActions', () => ({
  getClientLocationsForAssets: vi.fn(async () => []),
  getClientContactsForAssets: vi.fn(async () => []),
  getVendorOptionsForAssets: (...args: unknown[]) => mockGetVendors(...args),
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, id }: any) => <a id={id} href={href}>{children}</a>,
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@radix-ui/themes', () => ({
  Text: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui', () => ({
  useClientDrawer: () => ({ openClientDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => ({}),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    let result = String(options?.defaultValue ?? key);
    for (const [k, v] of Object.entries(options ?? {})) {
      if (k !== 'defaultValue') result = result.replace(`{{${k}}}`, String(v));
    }
    return result;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: any) => <div id={id}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  __esModule: true,
  default: () => <div data-testid="spinner" />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, name, value, onChange, placeholder }: any) => (
    <input
      id={id}
      name={name}
      aria-label={id ?? name ?? placeholder}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options = [], value, onValueChange, placeholder }: any) => (
    <select aria-label={id ?? placeholder} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">{placeholder ?? 'Select option'}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({ id }: any) => <select aria-label={id ?? 'contact-picker'} />,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id }: any) => <input type="checkbox" id={id} aria-label={id} />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id }: any) => <input id={id} aria-label={id} />,
}));

const TENANT = 'a0000000-0000-4000-8000-00000000000a';
const CLIENT_ID = 'b0000000-0000-4000-8000-00000000000b';
const ASSET_ID = 'f0000000-0000-4000-8000-00000000000f';
const VENDOR_ID = 'c0000000-0000-4000-8000-00000000000c';
const NOW_ISO = '2026-10-09T00:00:00.000Z';

const REGISTRY = [{
  tenant: TENANT,
  type_id: 'type-unknown',
  slug: 'unknown',
  name: 'Unknown',
  icon: null,
  fields_schema: [],
  is_builtin: true,
  display_order: 0,
  created_at: NOW_ISO,
  updated_at: NOW_ISO,
}];

const asset = {
  asset_id: ASSET_ID,
  client_id: CLIENT_ID,
  asset_type: 'unknown',
  asset_tag: 'CA-001',
  name: 'Reception PC',
  status: 'active',
  location_id: null,
  location: '',
  attributes: null,
  manufacturer: 'Lenovo',
  model: 'ThinkCentre M70q',
  vendor_id: VENDOR_ID,
  vendor_name: 'Acme Supplies',
  purchase_cost: 123456,
  purchase_cost_currency: 'USD',
  order_number: 'PO-4471',
  created_at: NOW_ISO,
  updated_at: NOW_ISO,
  tenant: TENANT,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAssetTypes.mockResolvedValue(REGISTRY);
  mockGetAsset.mockResolvedValue(asset);
  mockGetVendors.mockResolvedValue([{ vendor_id: VENDOR_ID, vendor_name: 'Acme Supplies' }]);
  mockUpdateAsset.mockResolvedValue({ asset_id: ASSET_ID });
});

afterEach(() => {
  cleanup();
});

describe('AssetForm make & purchase fields', () => {
  it('renders the five new inputs with their ids, seeded from the asset', async () => {
    render(<AssetForm assetId={ASSET_ID} />);

    const manufacturer = (await screen.findByLabelText('asset-manufacturer-input')) as HTMLInputElement;
    expect(manufacturer.value).toBe('Lenovo');
    expect((screen.getByLabelText('asset-model-input') as HTMLInputElement).value).toBe('ThinkCentre M70q');
    expect((screen.getByLabelText('asset-vendor-select') as HTMLSelectElement).value).toBe(VENDOR_ID);
    // 123456 minor units render as the editable decimal amount.
    expect((screen.getByLabelText('asset-purchase-cost-input') as HTMLInputElement).value).toBe('1234.56');
    expect((screen.getByLabelText('asset-order-number-input') as HTMLInputElement).value).toBe('PO-4471');
  });

  it('submits the edited values with the cost converted to minor units', async () => {
    render(<AssetForm assetId={ASSET_ID} />);
    const manufacturer = (await screen.findByLabelText('asset-manufacturer-input')) as HTMLInputElement;

    fireEvent.change(manufacturer, { target: { name: 'manufacturer', value: 'Dell' } });
    fireEvent.change(screen.getByLabelText('asset-purchase-cost-input'), { target: { value: '2,000.50' } });
    fireEvent.change(screen.getByLabelText('asset-order-number-input'), { target: { name: 'order_number', value: 'PO-9' } });
    fireEvent.submit(document.getElementById('asset-edit-form-element') ?? screen.getByRole('button', { name: /Save changes/i }).closest('form')!);

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalled());
    const [, payload] = mockUpdateAsset.mock.calls[0];
    expect(payload.manufacturer).toBe('Dell');
    expect(payload.purchase_cost).toBe(200050);
    expect(payload.order_number).toBe('PO-9');
    expect(payload.vendor_id).toBe(VENDOR_ID);
  });

  it('clears an emptied field with an explicit null', async () => {
    render(<AssetForm assetId={ASSET_ID} />);
    const manufacturer = (await screen.findByLabelText('asset-manufacturer-input')) as HTMLInputElement;

    fireEvent.change(manufacturer, { target: { name: 'manufacturer', value: '' } });
    fireEvent.change(screen.getByLabelText('asset-purchase-cost-input'), { target: { value: '' } });
    fireEvent.submit(screen.getByRole('button', { name: /Save changes/i }).closest('form')!);

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalled());
    const [, payload] = mockUpdateAsset.mock.calls[0];
    expect(payload.manufacturer).toBeNull();
    expect(payload.purchase_cost).toBeNull();
  });
});
