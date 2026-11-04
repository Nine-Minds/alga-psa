/* @vitest-environment jsdom */

/**
 * The edit drawer pins Save and Cancel in the drawer footer, so the form has
 * to drop its own trailing row (`hideActions`), report when it is busy
 * (`onSavingChange`) and close the drawer on Cancel (`onCancel`) rather than
 * navigating the page behind it away.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AssetForm from './AssetForm';

const mockGetAsset = vi.fn();
const mockUpdateAsset = vi.fn();
const mockGetAssetTypes = vi.fn();
const mockGetVendors = vi.fn();
const mockRouterBack = vi.fn();

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
  ]),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: mockRouterBack }),
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
  created_at: NOW_ISO,
  updated_at: NOW_ISO,
  tenant: TENANT,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAssetTypes.mockResolvedValue(REGISTRY);
  mockGetAsset.mockResolvedValue(asset);
  mockGetVendors.mockResolvedValue([]);
  mockUpdateAsset.mockResolvedValue({ asset_id: ASSET_ID });
});

afterEach(() => {
  cleanup();
});

describe('AssetForm actions in a drawer', () => {
  it('keeps its own Save and Cancel on the standalone edit page', async () => {
    render(<AssetForm assetId={ASSET_ID} />);

    await screen.findByLabelText('name');
    expect(document.getElementById('form-actions')).not.toBeNull();
    expect(document.getElementById('save-button')).not.toBeNull();
    expect(document.getElementById('cancel-button')).not.toBeNull();
  });

  it('drops the trailing action row when the drawer owns the buttons', async () => {
    render(<AssetForm assetId={ASSET_ID} hideActions />);

    await screen.findByLabelText('name');
    expect(document.getElementById('form-actions')).toBeNull();
    expect(document.getElementById('save-button')).toBeNull();
    expect(document.getElementById('cancel-button')).toBeNull();
    // The footer button submits by name, so the id has to stay.
    expect(document.getElementById('asset-edit-form')?.tagName).toBe('FORM');
  });

  it('reports its saving state so the footer can disable Save', async () => {
    let release: (value: unknown) => void = () => {};
    mockUpdateAsset.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const onSavingChange = vi.fn();

    render(<AssetForm assetId={ASSET_ID} hideActions onSavingChange={onSavingChange} />);
    await screen.findByLabelText('name');
    expect(onSavingChange).toHaveBeenCalledWith(false);

    fireEvent.submit(document.getElementById('asset-edit-form')!);
    await waitFor(() => expect(onSavingChange).toHaveBeenCalledWith(true));

    release({ asset_id: ASSET_ID });
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
  });

  it('is submitted by a button outside it that names the form', async () => {
    render(
      <>
        <AssetForm assetId={ASSET_ID} hideActions />
        <button id="asset-bento-focus-save" type="submit" form="asset-edit-form">Save Changes</button>
      </>
    );

    await screen.findByLabelText('name');
    fireEvent.click(document.getElementById('asset-bento-focus-save')!);

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalled());
  });

  it('closes the drawer on Cancel instead of navigating back', async () => {
    const onCancel = vi.fn();
    render(<AssetForm assetId={ASSET_ID} onCancel={onCancel} />);

    await screen.findByLabelText('name');
    fireEvent.click(document.getElementById('cancel-button')!);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockRouterBack).not.toHaveBeenCalled();
  });
});
