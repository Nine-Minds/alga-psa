/* @vitest-environment jsdom */

/**
 * T310/T311/T312 (F308/F309): QuickAddAsset type select sources the registry
 * (built-ins + customs), a custom selection renders the schema-driven fields
 * panel with required enforcement, values land in payload.attributes, and the
 * built-in flow is unchanged (extension fields render + submit as before).
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { QuickAddAsset } from './QuickAddAsset';

const mockCreateAsset = vi.fn();
const mockGetAssetTypes = vi.fn();

vi.mock('../actions/assetActions', () => ({
  createAsset: (...args: unknown[]) => mockCreateAsset(...args),
}));

vi.mock('../actions/clientLookupActions', () => ({
  getAllClientsForAssets: vi.fn(async () => []),
  getClientLocationsForAssets: vi.fn(async () => []),
}));

vi.mock('../actions/assetTypeRegistryActions', () => ({
  getAssetTypes: (...args: unknown[]) => mockGetAssetTypes(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable t identity — effects list `t` in their dependency arrays.
  const t = (key: string, options?: Record<string, unknown>) => {
    let result = String(options?.defaultValue ?? key);
    for (const [k, v] of Object.entries(options ?? {})) {
      if (k !== 'defaultValue') result = result.replace(`{{${k}}}`, String(v));
    }
    return result;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id, 'data-automation-id': id }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div>
        <h1>{title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, value, onChange, placeholder, type, className }: any) => (
    <input
      id={id}
      aria-label={id ?? placeholder}
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

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

const TENANT = 'a0000000-0000-4000-8000-00000000000a';
const CLIENT_ID = 'b0000000-0000-4000-8000-00000000000b';

const registryEntry = (overrides: Record<string, unknown>) => ({
  tenant: TENANT,
  type_id: `type-${overrides.slug}`,
  icon: null,
  fields_schema: [],
  is_builtin: true,
  display_order: 0,
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
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
      { key: 'environment', label: 'Environment', kind: 'select', options: ['prod', 'staging'] },
      { key: 'seats', label: 'Seats', kind: 'number' },
      { key: 'mfa_enabled', label: 'MFA Enabled', kind: 'boolean' },
    ],
  }),
];

if (!HTMLFormElement.prototype.requestSubmit) {
  HTMLFormElement.prototype.requestSubmit = function requestSubmit() {
    this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
}

async function renderQuickAdd() {
  render(<QuickAddAsset clientId={CLIENT_ID} onAssetAdded={vi.fn()} defaultOpen />);
  const typeSelect = (await screen.findByLabelText('asset-type-select')) as HTMLSelectElement;
  await waitFor(() => expect(mockGetAssetTypes).toHaveBeenCalled());
  return { typeSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAssetTypes.mockResolvedValue(REGISTRY);
  mockCreateAsset.mockResolvedValue({ asset_id: 'created-1' });
});

afterEach(() => {
  cleanup();
});

describe('QuickAddAsset custom asset types', () => {
  it('T310: type select offers built-ins (existing labels, first) plus registry customs', async () => {
    const { typeSelect } = await renderQuickAdd();

    await waitFor(() => {
      expect(
        Array.from(typeSelect.options).map((option) => option.value)
      ).toContain('cloud_account');
    });

    const values = Array.from(typeSelect.options).map((option) => option.value);
    // placeholder + five built-ins (no 'unknown', as before) + custom last
    expect(values).toEqual([
      '',
      'workstation',
      'network_device',
      'server',
      'mobile_device',
      'printer',
      'cloud_account',
    ]);
    expect(screen.getByRole('option', { name: 'Cloud Account' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Workstation' })).toBeTruthy();
  });

  it('T310: falls back to the hardcoded built-ins when the registry fetch fails', async () => {
    mockGetAssetTypes.mockRejectedValue(new Error('boom'));
    const { typeSelect } = await renderQuickAdd();

    const values = Array.from(typeSelect.options).map((option) => option.value);
    expect(values).toEqual(['', 'workstation', 'network_device', 'server', 'mobile_device', 'printer']);
  });

  it('T311: custom selection renders the schema panel, blocks submit on missing required, and lands values in payload.attributes', async () => {
    const user = userEvent.setup();
    const { typeSelect } = await renderQuickAdd();

    await waitFor(() =>
      expect(Array.from(typeSelect.options).map((o) => o.value)).toContain('cloud_account')
    );

    await user.type(screen.getByLabelText('asset-name-input'), 'Acme Cloud');
    await user.type(screen.getByLabelText('asset-tag-input'), 'CA-001');
    await user.selectOptions(typeSelect, 'cloud_account');

    // Schema panel rendered, built-in extension fields not.
    const accountInput = await screen.findByLabelText('quick-add-asset-field-account_name');
    expect(screen.queryByLabelText('workstation-os-type-input')).toBeNull();
    expect(screen.getByLabelText('quick-add-asset-field-environment')).toBeTruthy();
    expect(screen.getByLabelText('quick-add-asset-field-seats')).toBeTruthy();
    expect((screen.getByLabelText('MFA Enabled') as HTMLInputElement).type).toBe('checkbox');

    // Required enforcement blocks submit with an inline error.
    await user.click(screen.getByRole('button', { name: 'Create Asset' }));
    expect(mockCreateAsset).not.toHaveBeenCalled();
    expect(
      document.getElementById('quick-add-asset-field-account_name-error')?.textContent
    ).toBe('Account Name is required');

    // Fill the schema fields and submit.
    await user.type(accountInput, 'Acme Prod');
    await user.selectOptions(screen.getByLabelText('quick-add-asset-field-environment'), 'prod');
    await user.type(screen.getByLabelText('quick-add-asset-field-seats'), '25');
    await user.click(screen.getByLabelText('MFA Enabled'));
    await user.click(screen.getByRole('button', { name: 'Create Asset' }));

    await waitFor(() => expect(mockCreateAsset).toHaveBeenCalledTimes(1));
    expect(mockCreateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        asset_type: 'cloud_account',
        client_id: CLIENT_ID,
        name: 'Acme Cloud',
        asset_tag: 'CA-001',
        attributes: {
          account_name: 'Acme Prod',
          environment: 'prod',
          seats: 25,
          mfa_enabled: true,
        },
      })
    );
    const payload = mockCreateAsset.mock.calls[0][0];
    expect(payload.workstation).toBeUndefined();
  });

  it('T312: built-in flow regression — workstation extension fields render and submit unchanged, no attributes key', async () => {
    const user = userEvent.setup();
    const { typeSelect } = await renderQuickAdd();

    await user.type(screen.getByLabelText('asset-name-input'), 'WS-01');
    await user.type(screen.getByLabelText('asset-tag-input'), 'TAG-01');
    await user.selectOptions(typeSelect, 'workstation');

    const osTypeInput = await screen.findByLabelText('workstation-os-type-input');
    expect(screen.queryByLabelText('quick-add-asset-field-account_name')).toBeNull();

    await user.type(osTypeInput, 'Windows');
    await user.type(screen.getByLabelText('workstation-os-version-input'), '11');
    await user.click(screen.getByRole('button', { name: 'Create Asset' }));

    await waitFor(() => expect(mockCreateAsset).toHaveBeenCalledTimes(1));
    const payload = mockCreateAsset.mock.calls[0][0];
    expect(payload.asset_type).toBe('workstation');
    expect(payload.workstation).toEqual({
      os_type: 'Windows',
      os_version: '11',
      cpu_model: '',
      cpu_cores: 0,
      ram_gb: 0,
      storage_type: '',
      storage_capacity_gb: 0,
      installed_software: [],
    });
    expect(payload.attributes).toBeUndefined();
  });

  it('D4: switching type keeps entered attribute values; fields simply stop rendering', async () => {
    const user = userEvent.setup();
    const { typeSelect } = await renderQuickAdd();

    await user.type(screen.getByLabelText('asset-name-input'), 'Acme Cloud');
    await user.type(screen.getByLabelText('asset-tag-input'), 'CA-002');
    await user.selectOptions(typeSelect, 'cloud_account');
    await user.type(await screen.findByLabelText('quick-add-asset-field-account_name'), 'Kept Value');

    // Switch away — schema fields stop rendering…
    await user.selectOptions(typeSelect, 'server');
    expect(screen.queryByLabelText('quick-add-asset-field-account_name')).toBeNull();

    // …switch back — value is still there and submits.
    await user.selectOptions(typeSelect, 'cloud_account');
    const restored = (await screen.findByLabelText(
      'quick-add-asset-field-account_name'
    )) as HTMLInputElement;
    expect(restored.value).toBe('Kept Value');

    await user.click(screen.getByRole('button', { name: 'Create Asset' }));
    await waitFor(() => expect(mockCreateAsset).toHaveBeenCalledTimes(1));
    expect(mockCreateAsset.mock.calls[0][0].attributes).toEqual({ account_name: 'Kept Value' });
  });
});
