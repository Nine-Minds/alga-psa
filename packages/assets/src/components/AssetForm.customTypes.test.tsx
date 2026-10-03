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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  // Interactive stand-in: typing "YYYY-MM-DD" emits what the real picker emits —
  // a Date at LOCAL midnight of the chosen calendar day.
  DatePicker: ({ id, value, onChange }: any) => (
    <input
      id={id}
      aria-label={id}
      data-local-day={value ? `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}` : ''}
      value={value ? value.toISOString() : ''}
      onChange={(e) => {
        const [y, m, d] = e.target.value.split('-').map(Number);
        onChange?.(new Date(y, m - 1, d));
      }}
    />
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

  it('renders built-in additional fields under Additional fields and submits them in attributes', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue({ ...workstationAsset, attributes: {} });
    mockGetAssetTypes.mockResolvedValue(REGISTRY.map((entry: any) => entry.slug === 'workstation'
      ? { ...entry, fields_schema: [{ key: 'sc_session', label: 'ScreenConnect Session', kind: 'text' }] }
      : entry));
    await renderForm();
    expect(screen.getByText('Additional fields')).toBeTruthy();
    await user.type(await screen.findByLabelText('asset-edit-field-sc_session'), 'sess-2562-abc');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalledTimes(1));
    expect(mockUpdateAsset.mock.calls[0][1].attributes).toEqual({ sc_session: 'sess-2562-abc' });
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

// ---------------------------------------------------------------------------
// alga0002283: numeric inputs and returned validation results
// ---------------------------------------------------------------------------

// The mocked Input only labels fields that have an id, and the extension number
// inputs have none — find them through their visible label instead.
const numberInputFor = (labelText: string): HTMLInputElement => {
  const label = screen.getByText(labelText);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`No input found under label "${labelText}"`);
  return input as HTMLInputElement;
};

const networkDeviceAsset = {
  ...baseAsset,
  asset_type: 'network_device',
  attributes: null,
  network_device: {
    tenant: TENANT,
    asset_id: ASSET_ID,
    device_type: 'switch',
    management_ip: '10.0.0.2',
    port_count: 24,
    firmware_version: '1.0',
    supports_poe: true,
    power_draw_watts: 0,
    vlan_config: {},
    port_config: {},
  },
};

describe('AssetForm numeric extension fields (alga0002283)', () => {
  it('renders a stored 0 as "0", not blank', async () => {
    mockGetAsset.mockResolvedValue(networkDeviceAsset);
    await renderForm();

    expect(numberInputFor('Power Draw (Watts)').value).toBe('0');
    expect(numberInputFor('Port Count').value).toBe('24');
  });

  it('submits null for a cleared numeric input and keeps decimals for power draw', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(networkDeviceAsset);
    await renderForm();

    await user.clear(numberInputFor('Port Count'));
    fireEvent.change(numberInputFor('Power Draw (Watts)'), { target: { value: '12.5' } });
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateAsset.mock.calls[0];
    expect(payload.network_device.port_count).toBeNull();
    expect(payload.network_device.power_draw_watts).toBe(12.5);
  });

  it('a form opened on a blank-numeric workstation submits nulls, never NaN or 0', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue({
      ...workstationAsset,
      workstation: { ...workstationAsset.workstation, cpu_cores: null, ram_gb: null, storage_capacity_gb: null },
    });
    await renderForm();

    expect(numberInputFor('CPU Cores').value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalledTimes(1));
    const { workstation } = mockUpdateAsset.mock.calls[0][1];
    expect(workstation.cpu_cores).toBeNull();
    expect(workstation.ram_gb).toBeNull();
    expect(workstation.storage_capacity_gb).toBeNull();
  });
});

describe('AssetForm returned update results (alga0002283)', () => {
  it('renders returned validationIssues inline and toasts the validation summary, not "Failed to update asset"', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(networkDeviceAsset);
    mockUpdateAsset.mockResolvedValue({
      actionError: 'network_device.power_draw_watts has the wrong type.',
      validationIssues: [
        { path: ['network_device', 'power_draw_watts'], code: 'invalid_type', message: 'Expected number, received string' },
      ],
    });
    await renderForm();

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    const inline = await waitFor(() => {
      const node = document.getElementById('field-error-network-device-power-draw-watts');
      expect(node).not.toBeNull();
      return node!;
    });
    expect(inline.textContent).toBe('Expected number, received string');
    // Rendered directly under the offending input.
    expect(numberInputFor('Power Draw (Watts)').parentElement?.contains(inline)).toBe(true);

    expect(mockToastError).toHaveBeenCalledWith('Please fix the highlighted fields before saving.');
    expect(mockToastError).not.toHaveBeenCalledWith('Failed to update asset');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('toasts the message of any other returned action error', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(workstationAsset);
    mockUpdateAsset.mockResolvedValue({ actionError: 'Asset not found. It may have been deleted. Please refresh and try again.' });
    await renderForm();

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Asset not found. It may have been deleted. Please refresh and try again.')
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('only a thrown error falls back to the generic "Failed to update asset"', async () => {
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(workstationAsset);
    mockUpdateAsset.mockRejectedValue(new Error('An error occurred in the Server Components render.'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderForm();

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to update asset'));
  });
});

describe('AssetForm date pickers use local calendar parts (alga0002283)', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('under TZ=Australia/Brisbane, picking 31 Dec submits 2026-12-31T00:00:00.000Z', async () => {
    process.env.TZ = 'Australia/Brisbane';
    const user = userEvent.setup();
    mockGetAsset.mockResolvedValue(workstationAsset);
    await renderForm();

    fireEvent.change(screen.getByLabelText('warranty_end_date'), { target: { value: '2026-12-31' } });
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateAsset).toHaveBeenCalled());
    const payload = mockUpdateAsset.mock.calls[0][1];
    expect(payload.warranty_end_date).toBe('2026-12-31T00:00:00.000Z');
  });

  it('under a western TZ, a stored date is shown on the same calendar day in the picker', async () => {
    process.env.TZ = 'America/Los_Angeles';
    mockGetAsset.mockResolvedValue({ ...workstationAsset, warranty_end_date: '2026-12-31T00:00:00.000Z' });
    await renderForm();

    await waitFor(() =>
      expect(screen.getByLabelText('warranty_end_date').getAttribute('data-local-day')).toBe('2026-12-31')
    );
  });
});
