/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AssetTypesManager from './AssetTypesManager';

const mockGetAssetTypes = vi.fn();
const mockGetAssetType = vi.fn();
const mockCreateAssetTypeAction = vi.fn();
const mockUpdateAssetTypeAction = vi.fn();
const mockDeleteAssetTypeAction = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../actions/assetTypeRegistryActions', () => ({
  getAssetTypes: (...args: unknown[]) => mockGetAssetTypes(...args),
  getAssetType: (...args: unknown[]) => mockGetAssetType(...args),
  createAssetTypeAction: (...args: unknown[]) => mockCreateAssetTypeAction(...args),
  updateAssetTypeAction: (...args: unknown[]) => mockUpdateAssetTypeAction(...args),
  deleteAssetTypeAction: (...args: unknown[]) => mockDeleteAssetTypeAction(...args),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// A stable t (and a stable return object) mirrors react-i18next, whose t keeps
// its identity between renders; a fresh t per render would refetch forever.
const stableT = (key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    text = text.replace(`{{${name}}}`, String(value));
  }
  return text;
};
const stableTranslation = { t: stableT };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableTranslation,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, value, onChange, placeholder, type, disabled }: any) => (
    <input
      id={id}
      aria-label={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type={type}
      disabled={disabled}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: any) => (
    <div id={id} role="alert">
      {children}
    </div>
  ),
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, footer, children, id }: any) =>
    isOpen ? (
      <div id={id}>
        <h2>{title}</h2>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data = [], columns = [] }: any) => (
    <table id={id}>
      <tbody>
        {data.map((record: any, rowIndex: number) => (
          <tr key={rowIndex}>
            {columns.map((column: any, colIndex: number) => (
              <td key={colIndex}>
                {column.render
                  ? column.render(record[column.dataIndex], record, rowIndex)
                  : String(record[column.dataIndex] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, id, onClick }: any) => (
    <button id={id} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/IconPicker', () => ({
  IconPicker: ({ value, onValueChange, disabled }: any) => (
    <input
      id="assets-types-icon-input"
      aria-label="assets-types-icon-input"
      value={value ?? ''}
      onChange={(e: any) => onValueChange(e.target.value)}
      disabled={disabled}
    />
  ),
  getIconComponent: () => (_props: any) => <span data-testid="type-icon" />,
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  __esModule: true,
  default: ({ text }: any) => <div>{text}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options = [], value, onValueChange, disabled }: any) => (
    <select
      id={id}
      aria-label={id}
      value={value ?? ''}
      onChange={(e: any) => onValueChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, label }: any) => (
    <label>
      <input
        type="checkbox"
        id={id}
        aria-label={id}
        checked={!!checked}
        onChange={(e: any) => onCheckedChange?.(e.target.checked)}
      />
      {label}
    </label>
  ),
}));

const builtinType = {
  tenant: 'tenant-1',
  type_id: 'type-builtin',
  slug: 'workstation',
  name: 'Workstation',
  icon: 'monitor',
  fields_schema: [{ key: 'cpu', label: 'CPU', kind: 'text' }],
  is_builtin: true,
  display_order: 1,
  created_at: '2026-06-12T00:00:00Z',
  updated_at: '2026-06-12T00:00:00Z',
};

const customType = {
  tenant: 'tenant-1',
  type_id: 'type-custom',
  slug: 'firewall',
  name: 'Firewall',
  icon: null,
  fields_schema: [
    { key: 'vendor', label: 'Vendor', kind: 'text' },
    { key: 'throughput', label: 'Throughput', kind: 'number' },
  ],
  is_builtin: false,
  display_order: 7,
  created_at: '2026-06-12T00:00:00Z',
  updated_at: '2026-06-12T00:00:00Z',
};

const byId = (id: string) => document.getElementById(id);
const inputById = (id: string) => byId(id) as HTMLInputElement;

async function renderManager() {
  render(<AssetTypesManager />);
  await screen.findByText('Workstation');
}

afterEach(() => {
  cleanup();
});

describe('AssetTypesManager (T308)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssetTypes.mockResolvedValue([builtinType, customType]);
  });

  it('lists registry entries with built-in flags, field counts, and per-row affordances', async () => {
    await renderManager();

    expect(screen.getByText('Workstation')).toBeTruthy();
    expect(screen.getByText('Firewall')).toBeTruthy();
    expect(screen.getByText('workstation')).toBeTruthy();
    expect(screen.getByText('firewall')).toBeTruthy();
    // Exactly one built-in badge (the workstation row).
    expect(screen.getAllByText('Built-in')).toHaveLength(1);
    // Field counts: builtin has 1 field, custom has 2; display orders 1 and 7.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();

    expect(byId('assets-types-edit-workstation')).toBeTruthy();
    expect(byId('assets-types-edit-firewall')).toBeTruthy();
    expect(byId('assets-types-delete-firewall')).toBeTruthy();
    // Delete is hidden for built-ins.
    expect(byId('assets-types-delete-workstation')).toBeNull();
  });

  it('create flow round-trips a schema with one of each field kind', async () => {
    const user = userEvent.setup();
    mockCreateAssetTypeAction.mockResolvedValue({ success: true, data: customType });
    await renderManager();

    await user.click(byId('assets-types-add-button')!);
    expect(byId('assets-types-dialog')).toBeTruthy();

    await user.type(inputById('assets-types-name-input'), 'Firewall Cluster');

    const fieldSpecs: Array<{ label: string; kind: string; options?: string; required?: boolean }> = [
      { label: 'Hostname', kind: 'text', required: true },
      { label: 'Port Count', kind: 'number' },
      { label: 'Purchased On', kind: 'date' },
      { label: 'Tier', kind: 'select', options: 'Gold, Silver' },
      { label: 'Admin URL', kind: 'url' },
      { label: 'Managed', kind: 'boolean' },
    ];

    for (let i = 0; i < fieldSpecs.length; i++) {
      const spec = fieldSpecs[i];
      await user.click(byId('assets-types-add-field-button')!);
      await user.type(inputById(`asset-type-field-${i}-label`), spec.label);
      if (spec.kind !== 'text') {
        await user.selectOptions(byId(`asset-type-field-${i}-kind`)!, spec.kind);
      }
      if (spec.required) {
        await user.click(byId(`asset-type-field-${i}-required`)!);
      }
      if (spec.options) {
        await user.type(inputById(`asset-type-field-${i}-options`), spec.options);
      }
    }

    await user.click(byId('assets-types-save-button')!);

    await waitFor(() => expect(mockCreateAssetTypeAction).toHaveBeenCalledTimes(1));
    expect(mockCreateAssetTypeAction.mock.calls[0][0]).toStrictEqual({
      name: 'Firewall Cluster',
      icon: null,
      display_order: 8,
      fields_schema: [
        { key: 'hostname', label: 'Hostname', kind: 'text', required: true },
        { key: 'port_count', label: 'Port Count', kind: 'number' },
        { key: 'purchased_on', label: 'Purchased On', kind: 'date' },
        { key: 'tier', label: 'Tier', kind: 'select', options: ['Gold', 'Silver'] },
        { key: 'admin_url', label: 'Admin URL', kind: 'url' },
        { key: 'managed', label: 'Managed', kind: 'boolean' },
      ],
    });

    await waitFor(() => expect(byId('assets-types-dialog')).toBeNull());
    expect(mockGetAssetTypes).toHaveBeenCalledTimes(2);
    expect(mockToastSuccess).toHaveBeenCalledWith('Asset type created');
  });

  it('built-in edit allows name/icon only and locks the schema area with a hint', async () => {
    const user = userEvent.setup();
    mockUpdateAssetTypeAction.mockResolvedValue({ success: true, data: builtinType });
    await renderManager();

    await user.click(byId('assets-types-edit-workstation')!);
    expect(byId('assets-types-dialog')).toBeTruthy();

    // Schema editor is replaced by a read-only hint; no field rows, no add button.
    expect(byId('assets-types-builtin-schema-note')).toBeTruthy();
    expect(byId('asset-type-field-0-label')).toBeNull();
    expect(byId('assets-types-add-field-button')).toBeNull();
    expect(byId('assets-types-display-order-input')).toBeNull();
    expect(
      screen.getByText(
        'Built-in types use fixed forms managed by AlgaPSA, so their field schema cannot be edited. You can still rename the type or change its icon.'
      )
    ).toBeTruthy();

    const nameInput = inputById('assets-types-name-input');
    expect(nameInput.value).toBe('Workstation');
    await user.clear(nameInput);
    await user.type(nameInput, 'Workstation X');

    await user.click(byId('assets-types-save-button')!);

    await waitFor(() => expect(mockUpdateAssetTypeAction).toHaveBeenCalledTimes(1));
    expect(mockUpdateAssetTypeAction).toHaveBeenCalledWith('workstation', {
      name: 'Workstation X',
      icon: 'monitor',
    });
    await waitFor(() => expect(byId('assets-types-dialog')).toBeNull());
  });

  it('delete of an in-use type renders the typed asset-count error inline', async () => {
    const user = userEvent.setup();
    mockDeleteAssetTypeAction.mockResolvedValue({
      success: false,
      error: { code: 'in_use', slug: 'firewall', asset_count: 3 },
    });
    await renderManager();

    await user.click(byId('assets-types-delete-firewall')!);
    expect(byId('assets-types-delete-dialog')).toBeTruthy();
    expect(
      screen.getByText('This permanently removes "Firewall" from your asset type registry.')
    ).toBeTruthy();

    await user.click(byId('assets-types-confirm-delete-button')!);

    await waitFor(() => expect(mockDeleteAssetTypeAction).toHaveBeenCalledWith('firewall'));
    expect(
      await screen.findByText(
        'This type is still used by 3 asset(s). Reassign those assets before deleting it.'
      )
    ).toBeTruthy();
    // Dialog stays open and the list is not refetched.
    expect(byId('assets-types-delete-dialog')).toBeTruthy();
    expect(mockGetAssetTypes).toHaveBeenCalledTimes(1);
  });

  it('successful delete closes the dialog and refetches the registry', async () => {
    const user = userEvent.setup();
    mockDeleteAssetTypeAction.mockResolvedValue({ success: true, data: { slug: 'firewall' } });
    await renderManager();

    await user.click(byId('assets-types-delete-firewall')!);
    await user.click(byId('assets-types-confirm-delete-button')!);

    await waitFor(() => expect(byId('assets-types-delete-dialog')).toBeNull());
    expect(mockGetAssetTypes).toHaveBeenCalledTimes(2);
    expect(mockToastSuccess).toHaveBeenCalledWith('Asset type deleted');
  });
});

describe('AssetTypeSchemaEditor inside the manager (T309)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssetTypes.mockResolvedValue([builtinType, customType]);
  });

  it('add/remove/reorder/kind-switch/options round-trip into the create payload', async () => {
    const user = userEvent.setup();
    mockCreateAssetTypeAction.mockResolvedValue({ success: true, data: customType });
    await renderManager();

    await user.click(byId('assets-types-add-button')!);
    await user.type(inputById('assets-types-name-input'), 'Switch Stack');

    for (const label of ['Alpha', 'Beta', 'Gamma']) {
      await user.click(byId('assets-types-add-field-button')!);
      const index = ['Alpha', 'Beta', 'Gamma'].indexOf(label);
      await user.type(inputById(`asset-type-field-${index}-label`), label);
    }

    // Boundary buttons are disabled.
    expect((byId('asset-type-field-0-move-up') as HTMLButtonElement).disabled).toBe(true);
    expect((byId('asset-type-field-2-move-down') as HTMLButtonElement).disabled).toBe(true);

    // Move Gamma up: Alpha, Gamma, Beta.
    await user.click(byId('asset-type-field-2-move-up')!);
    expect(inputById('asset-type-field-1-label').value).toBe('Gamma');
    expect(inputById('asset-type-field-2-label').value).toBe('Beta');

    // Remove Beta (now last): Alpha, Gamma.
    await user.click(byId('asset-type-field-2-remove')!);
    expect(byId('asset-type-field-2-label')).toBeNull();

    // Switch Alpha to select; the options editor appears only for select kind.
    expect(byId('asset-type-field-0-options')).toBeNull();
    await user.selectOptions(byId('asset-type-field-0-kind')!, 'select');
    await user.type(inputById('asset-type-field-0-options'), 'One, Two');

    await user.click(byId('assets-types-save-button')!);

    await waitFor(() => expect(mockCreateAssetTypeAction).toHaveBeenCalledTimes(1));
    expect(mockCreateAssetTypeAction.mock.calls[0][0]).toStrictEqual({
      name: 'Switch Stack',
      icon: null,
      display_order: 8,
      fields_schema: [
        { key: 'alpha', label: 'Alpha', kind: 'select', options: ['One', 'Two'] },
        { key: 'gamma', label: 'Gamma', kind: 'text' },
      ],
    });
  });

  it('blocks an invalid key client-side with an inline error and keeps manual keys sticky', async () => {
    const user = userEvent.setup();
    await renderManager();

    await user.click(byId('assets-types-add-button')!);
    await user.type(inputById('assets-types-name-input'), 'Bad Type');
    await user.click(byId('assets-types-add-field-button')!);

    await user.type(inputById('asset-type-field-0-label'), 'Status');
    expect(inputById('asset-type-field-0-key').value).toBe('status');

    await user.clear(inputById('asset-type-field-0-key'));
    await user.type(inputById('asset-type-field-0-key'), '1bad');
    // Manual key edits stop label-derived auto-keys.
    await user.type(inputById('asset-type-field-0-label'), ' Code');
    expect(inputById('asset-type-field-0-key').value).toBe('1bad');

    await user.click(byId('assets-types-save-button')!);

    expect(mockCreateAssetTypeAction).not.toHaveBeenCalled();
    expect(byId('asset-type-field-0-errors')).toBeTruthy();
    expect(
      screen.getByText(
        'Key must start with a lowercase letter and use only lowercase letters, numbers, and underscores.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('The field schema is invalid. Fix the highlighted fields and try again.')
    ).toBeTruthy();
  });

  it('blocks duplicate keys client-side with an inline error on the duplicate row', async () => {
    const user = userEvent.setup();
    await renderManager();

    await user.click(byId('assets-types-add-button')!);
    await user.type(inputById('assets-types-name-input'), 'Dup Type');

    await user.click(byId('assets-types-add-field-button')!);
    await user.type(inputById('asset-type-field-0-label'), 'Status');
    await user.click(byId('assets-types-add-field-button')!);
    await user.type(inputById('asset-type-field-1-label'), 'Status');

    await user.click(byId('assets-types-save-button')!);

    expect(mockCreateAssetTypeAction).not.toHaveBeenCalled();
    expect(byId('asset-type-field-0-errors')).toBeNull();
    expect(byId('asset-type-field-1-errors')).toBeTruthy();
    expect(screen.getByText('Each field key must be unique.')).toBeTruthy();
  });

  it('blocks select fields without options client-side with an inline error', async () => {
    const user = userEvent.setup();
    await renderManager();

    await user.click(byId('assets-types-add-button')!);
    await user.type(inputById('assets-types-name-input'), 'Select Type');
    await user.click(byId('assets-types-add-field-button')!);
    await user.type(inputById('asset-type-field-0-label'), 'Tier');
    await user.selectOptions(byId('asset-type-field-0-kind')!, 'select');

    await user.click(byId('assets-types-save-button')!);

    expect(mockCreateAssetTypeAction).not.toHaveBeenCalled();
    expect(byId('asset-type-field-0-errors')).toBeTruthy();
    expect(screen.getByText('Select fields need at least one option.')).toBeTruthy();
  });
});
