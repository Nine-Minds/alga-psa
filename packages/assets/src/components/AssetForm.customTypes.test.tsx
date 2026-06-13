/* @vitest-environment jsdom */

/**
 * T310/T311/T312 (F308/F309) — edit form: type select sources the registry,
 * a custom-type asset renders the schema panel seeded from assets.attributes,
 * required blocks submit inline, submitted attributes carry only schema keys
 * (server merge preserves integration namespaces), and the built-in flow is
 * unchanged (extension panel renders + submits exactly as before).
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AssetForm from './AssetForm';

const mockGetAsset = vi.fn();
const mockUpdateAsset = vi.fn();
const mockGetAssetTypes = vi.fn();
const mockPush = vi.fn();
const mockToastError = vi.fn();

vi.mock('../actions/assetActions', () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
  updateAsset: (...args: unknown[]) => mockUpdateAsset(...args),
}));

vi.mock('../actions/clientLookupActions', () => ({
  getAllClientsForAssets: vi.fn(async () => [
    { client_id: 'b0000000-0000-4000-8000-00000000000b', client_name: 'Acme Inc' },
  ]),
  getClientLocationsForAssets: vi.fn(async () => []),
}));

vi.mock('../actions/assetTypeRegistryActions', () => ({
  getAssetTypes: (...args: unknown[]) => mockGetAssetTypes(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => mockToastError(...args),
  },
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
  // Stable t identity — AssetForm effects list `t` in their dependency
  // arrays, so a per-render function would loop the effects forever.
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
  Input: ({ id, name, value, onChange, placeholder, type, className }: any) => (
    <input
      id={id}
      name={name}
      aria-label={id ?? name ?? placeholder}
      type={type ?? 'text'}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options = [], value, onValueChange, placeholder, disabled }: any) => (
    <select
      aria-label={id ?? placeholder}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder ?? 'Select option'}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, label, checked, onChange }: any) => (
    <label>
      <input
        type="checkbox"
        id={id}
        aria-label={typeof label === 'string' ? label : id}
        checked={Boolean(checked)}
        onChange={onChange}
      />
      {label}
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id, value }: any) => (
    <input id={id} aria-label={id} readOnly value={value ? value.toISOString() : ''} />
  ),
}));

const TENANT = 'a0000000-0000-4000-8000-00000000000a';
const CLIENT_ID = 'b0000000-0000-4000-8000-00000000000b';
const ASSET_ID = 'f0000000-0000-4000-8000-00000000000f';
const NOW_ISO = '2026-06-12T00:00:00.000Z';

const registryEntry = (overrides: Record<string, unknown>) => ({
  tenant: TENANT,
  type_id: `type-${overrides.slug}`,
  icon: null,
  fields_schema: [],
  is_builtin: true,
  display_order: 0,
  created_at: NOW_ISO,
  updated_at: NOW_ISO,
  ...overrides,
});

const REGISTRY = [
  registryEntry({ slug: 'workstation', name: 'Workstation' }),
  registryEntry({ slug: 'network_device', name: 'Network Device' }),
  registryEntry({ slug: 'server', name: 'Server' }),
  registryEntry({ slug: 'mobile_device', name: 'Mobile Device' }),
  registryEntry({ slug: 'printer', name: 'Printer' }),
  registryEntry({ slug: 'unknown', name: 'Unknown' }),
  registryEntry({
    slug: 'cloud_account',
    name: 'Cloud Account',
    is_builtin: false,
    fields_schema: [
      { key: 'account_name', label: 'Account Name', kind: 'text', required: true },
      { key: 'seats', label: 'Seats', kind: 'number' },
    ],
  }),
];

const baseAsset = {
  asset_id: ASSET_ID,
  client_id: CLIENT_ID,
  asset_tag: 'CA-001',
  name: 'Acme Cloud',
  status: 'active',
  location_id: null,
  location: '',
  created_at: NOW_ISO,
  updated_at: NOW_ISO,
  tenant: TENANT,
};

const cloudAccountAsset = {
  ...baseAsset,
  asset_type: 'cloud_account',
  attributes: {
    account_name: 'Acme Prod',
    hudu_fields: [{ label: 'Plan', value: 'Gold' }],
  },
};

const workstationAsset = {
  ...baseAsset,
  asset_type: 'workstation',
  attributes: null,
  workstation: {
    tenant: TENANT,
    asset_id: ASSET_ID,
    os_type: 'windows',
    os_version: '11',
    cpu_model: 'i7',
    cpu_cores: 8,
    ram_gb: 32,
    storage_type: 'nvme',
    storage_capacity_gb: 1024,
    installed_software: [],
  },
};

async function renderForm() {
  render(<AssetForm assetId={ASSET_ID} />);
  const typeSelect = (await screen.findByLabelText('asset-type-select')) as HTMLSelectElement;
  return { typeSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAssetTypes.mockResolvedValue(REGISTRY);
  mockUpdateAsset.mockResolvedValue({ asset_id: ASSET_ID });
});

afterEach(() => {
  cleanup();
});

describe('AssetForm custom asset types', () => {
  it('T310: edit type select sources the registry (six built-ins incl. unknown + customs)', async () => {
    mockGetAsset.mockResolvedValue(cloudAccountAsset);
    const { typeSelect } = await renderForm();

    await waitFor(() =>
      expect(Array.from(typeSelect.options).map((o) => o.value)).toContain('cloud_account')
    );
    expect(Array.from(typeSelect.options).map((o) => o.value)).toEqual([
      '',
      'workstation',
      'network_device',
      'server',
      'mobile_device',
      'printer',
      'unknown',
      'cloud_account',
    ]);
    expect(typeSelect.value).toBe('cloud_account');
  });

  it('T311: custom asset renders the schema panel from attributes, enforces required inline, submits only schema keys', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(cloudAccountAsset);
    await renderForm();

    const accountInput = (await screen.findByLabelText(
      'asset-edit-field-account_name'
    )) as HTMLInputElement;
    expect(accountInput.value).toBe('Acme Prod');
    expect(screen.getByText('Cloud Account Details')).toBeTruthy();
    // Built-in extension panel absent for a custom type.
    expect(document.getElementById('type-specific-details')).toBeNull();

    // Blank the required field -> inline error, no save call.
    await user.clear(accountInput);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mockUpdateAsset).not.toHaveBeenCalled();
    expect(document.getElementById('asset-edit-field-account_name-error')?.textContent).toBe(
      'Account Name is required'
    );
    expect(mockToastError).toHaveBeenCalled();

    // Fix it and save: attributes carry ONLY schema-declared keys (the
    // server-side jsonb merge keeps hudu_fields intact).
    await user.type(accountInput, 'Acme EU');
    await user.type(screen.getByLabelText('asset-edit-field-seats'), '12');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalledTimes(1));
    const [calledAssetId, payload] = mockUpdateAsset.mock.calls[0];
    expect(calledAssetId).toBe(ASSET_ID);
    expect(payload.asset_type).toBe('cloud_account');
    expect(payload.attributes).toEqual({ account_name: 'Acme EU', seats: 12 });
    expect(payload.workstation).toBeUndefined();
  });

  it('T312: built-in regression — workstation extension panel renders and submits unchanged, no attributes', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(workstationAsset);
    const { typeSelect } = await renderForm();

    expect(typeSelect.value).toBe('workstation');
    expect(screen.getByText('Workstation Details')).toBeTruthy();
    expect(screen.getByText('CPU Model')).toBeTruthy();
    expect(document.getElementById('custom-type-details')).toBeNull();
    expect(screen.queryByLabelText('asset-edit-field-account_name')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateAsset.mock.calls[0];
    expect(payload.asset_type).toBe('workstation');
    expect(payload.workstation).toMatchObject({ os_type: 'windows', os_version: '11', cpu_model: 'i7' });
    expect(payload.attributes).toBeUndefined();
  });

  it('D4: switching a built-in asset to a custom type swaps the panels (values kept server-side via merge)', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(workstationAsset);
    const { typeSelect } = await renderForm();

    expect(screen.getByText('Workstation Details')).toBeTruthy();

    await user.selectOptions(typeSelect, 'cloud_account');

    // Extension panel hides, schema panel shows.
    expect(screen.queryByText('Workstation Details')).toBeNull();
    expect(await screen.findByLabelText('asset-edit-field-account_name')).toBeTruthy();

    // Required enforcement applies to the newly selected schema.
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mockUpdateAsset).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('asset-edit-field-account_name'), 'Migrated');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateAsset.mock.calls[0];
    expect(payload.asset_type).toBe('cloud_account');
    expect(payload.attributes).toEqual({ account_name: 'Migrated' });
  });
});
