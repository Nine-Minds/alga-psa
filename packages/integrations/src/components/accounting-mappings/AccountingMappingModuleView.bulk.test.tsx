/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingMappingModuleView } from './AccountingMappingModuleView';
import { isManualEntryModule } from './AccountingMappingBulkGrid';
import type { AccountingMappingModule } from './types';

const loadMock = vi.fn();
const createMock = vi.fn();
const createManyMock = vi.fn();

const externalTarget = {
  label: 'Map To',
  kinds: [
    { id: 'item', label: 'Xero Item' },
    { id: 'account', label: 'Xero Revenue Account' }
  ],
  defaultKindId: 'item',
  kindForMapping: (m: any) => (m.metadata?.xeroTargetKind === 'account' ? 'account' : 'item'),
  optionIdForMapping: (m: any) =>
    `${m.metadata?.xeroTargetKind === 'account' ? 'account' : 'item'}:${m.external_entity_id}`,
  invalidNotice: 'invalid'
};

function buildModule(overrides: Partial<AccountingMappingModule> = {}): AccountingMappingModule {
  return {
    id: 'xero-live-service-mappings',
    adapterType: 'xero',
    algaEntityType: 'service',
    externalEntityType: 'Item',
    labels: {
      tab: 'Items',
      addButton: 'Add Service Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'Xero Target',
      dialog: { addTitle: 'Add', editTitle: 'Edit', algaField: 'Alga Service', externalField: 'Xero Item or Account' },
      deleteConfirmation: { title: 'Delete', message: () => 'Delete?' }
    },
    externalTarget,
    load: loadMock,
    create: createMock,
    update: vi.fn(),
    remove: vi.fn(),
    createMany: createManyMock,
    ...overrides
  } as unknown as AccountingMappingModule;
}

const context = { realmId: 'realm-1', connectionId: 'conn-1' };

const item = (code: string, baseName: string) => ({
  id: `item:${code}`,
  name: `Item · ${baseName} (${code})`,
  kind: 'item',
  code,
  baseName
});

function loadResult(mapped: string[] = ['svc-mapped']) {
  return {
    mappings: mapped.map((id) => ({
      id: `m-${id}`,
      alga_entity_id: id,
      external_entity_id: 'OLD',
      metadata: { xeroTargetKind: 'item', externalDisplayName: 'Old target' }
    })),
    algaEntities: [
      { id: 'svc-basic', name: 'Microsoft 365 Business Basic (M365-BASIC)', code: 'M365-BASIC', baseName: 'Microsoft 365 Business Basic' },
      { id: 'svc-std', name: 'Microsoft 365 Business Standard (M365-STD)', code: 'M365-STD', baseName: 'Microsoft 365 Business Standard' },
      { id: 'svc-host', name: 'Hosting', baseName: 'Hosting' },
      { id: 'svc-backup', name: 'Backup', baseName: 'Backup' },
      { id: 'svc-mapped', name: 'Already Done', baseName: 'Already Done' }
    ],
    externalEntities: [
      item('M365-BASIC', 'M365 Basic'),
      item('M365-STD', 'M365 Standard'),
      item('HOST', 'Hosting'),
      item('MISC', 'Misc'),
      { id: 'account:200', name: 'Revenue account · Sales (200)', kind: 'account', code: '200', baseName: 'Sales' },
      item('200', 'Item two hundred')
    ]
  };
}

const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const P = 'xero-live-service-mappings-bulk';
const saveAll = () => screen.getByRole('button', { name: 'Save all' });

async function openBulk() {
  render(<AccountingMappingModuleView module={buildModule()} context={context} />);
  fireEvent.click(await screen.findByText('Bulk map'));
  await screen.findByTestId(`${P}-grid`);
}

describe('AccountingMappingModuleView bulk grid', () => {
  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  });
  beforeEach(() => {
    vi.clearAllMocks();
    loadMock.mockResolvedValue(loadResult());
  });
  afterEach(() => cleanup());

  it('shows prefilled suggestions with a Suggested badge, only unmapped rows by default', async () => {
    await openBulk();
    expect(screen.getByTestId(`${P}-suggested-svc-basic`)).toBeInTheDocument();
    expect(screen.getByTestId(`${P}-suggested-svc-std`)).toBeInTheDocument();
    expect(screen.getByTestId(`${P}-suggested-svc-host`)).toBeInTheDocument();
    expect(screen.queryByTestId(`${P}-suggested-svc-backup`)).not.toBeInTheDocument();
    expect(screen.queryByText('Already Done')).not.toBeInTheDocument();
    // Each SKU got its own item.
    expect(screen.getByText('Item · M365 Basic (M365-BASIC)')).toBeInTheDocument();
    expect(screen.getByText('Item · M365 Standard (M365-STD)')).toBeInTheDocument();
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('3');
  });

  it('search "365" narrows to the M365 family', async () => {
    await openBulk();
    fireEvent.change(el(`${P}-search`), { target: { value: '365' } });
    expect(screen.getByText(/Microsoft 365 Business Basic/)).toBeInTheDocument();
    expect(screen.getByText(/Microsoft 365 Business Standard/)).toBeInTheDocument();
    expect(screen.queryByText('Hosting', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('Backup')).not.toBeInTheDocument();
  });

  it('the mapped/unmapped/all filter works', async () => {
    await openBulk();
    // Switch to "All" through the select.
    fireEvent.click(el(`${P}-filter`));
    fireEvent.click(await screen.findByRole('option', { name: 'All' }));
    expect(await screen.findByText('Already Done')).toBeInTheDocument();
    expect(screen.getByText('Old target')).toBeInTheDocument();
    expect(screen.getByTestId(`${P}-status-svc-mapped`)).toHaveTextContent('Mapped');
  });

  it('ignore all and select all act on the visible rows only', async () => {
    await openBulk();
    fireEvent.change(el(`${P}-search`), { target: { value: '365' } });
    fireEvent.click(el(`${P}-ignore-all`));
    expect(el(`${P}-ignore-svc-basic`).checked).toBe(true);
    expect(el(`${P}-ignore-svc-std`).checked).toBe(true);
    // The count is visible-only: both visible rows are ignored.
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('0');
    fireEvent.change(el(`${P}-search`), { target: { value: '' } });
    // Hidden Hosting was untouched and is the only thing left to save.
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('1');
    expect(el(`${P}-ignore-svc-host`).checked).toBe(false);

    // Select-all on a filtered view only touches visible rows with a target.
    fireEvent.click(el(`${P}-ignore-all`)); // all visible ignored? no -> ignore every visible
    fireEvent.click(el(`${P}-ignore-all`)); // now all ignored -> un-ignore all
    fireEvent.click(el(`${P}-select-all`)); // currently all with targets selected -> deselect
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('0');
    fireEvent.click(el(`${P}-select-all`));
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('3');
    // Backup has no target so select-all cannot make it saveable.
    expect(el(`${P}-select-svc-backup`).checked).toBe(false);
  });

  it('saves with ONE createMany call containing only checked, non-ignored, targeted rows', async () => {
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) => ({ algaEntityId: i.algaEntityId, ok: true }))
    );
    await openBulk();
    fireEvent.click(el(`${P}-ignore-svc-host`));
    fireEvent.click(saveAll());

    await waitFor(() => expect(createManyMock).toHaveBeenCalledTimes(1));
    const inputs = createManyMock.mock.calls[0][1];
    expect(inputs.map((i: any) => i.algaEntityId).sort()).toEqual(['svc-basic', 'svc-std']);
    expect(inputs.find((i: any) => i.algaEntityId === 'svc-basic')).toMatchObject({
      externalEntityId: 'item:M365-BASIC',
      metadata: { externalDisplayName: 'Item · M365 Basic (M365-BASIC)' }
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('keeps item:200 and account:200 distinct and sends the picked kind-prefixed id', async () => {
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) => ({ algaEntityId: i.algaEntityId, ok: true }))
    );
    await openBulk();
    // Switch Backup's kind to account, then pick account 200.
    fireEvent.click(el(`${P}-kind-svc-backup`));
    fireEvent.click(await screen.findByRole('option', { name: 'Xero Revenue Account' }));
    fireEvent.click(screen.getAllByText('Select Xero Item or Account...')[0].closest('button')!);
    fireEvent.click(await screen.findByText('Revenue account · Sales (200)'));
    fireEvent.click(saveAll());
    await waitFor(() => expect(createManyMock).toHaveBeenCalledTimes(1));
    const inputs = createManyMock.mock.calls[0][1];
    expect(inputs.find((i: any) => i.algaEntityId === 'svc-backup').externalEntityId).toBe('account:200');
  });

  it('renders per-row errors while successful rows clear after reload', async () => {
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) =>
        i.algaEntityId === 'svc-std'
          ? { algaEntityId: i.algaEntityId, ok: false, error: 'A mapping for this entity already exists' }
          : { algaEntityId: i.algaEntityId, ok: true }
      )
    );
    await openBulk();
    // The reload after saving returns the successful rows as mapped.
    loadMock.mockResolvedValue(loadResult(['svc-mapped', 'svc-basic', 'svc-host']));
    fireEvent.click(saveAll());

    expect(await screen.findByTestId(`${P}-error-svc-std`)).toHaveTextContent(
      'A mapping for this entity already exists'
    );
    await waitFor(() => expect(screen.queryByText(/Business Basic/)).not.toBeInTheDocument());
    expect(screen.queryByText('Hosting', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.getByText(/Business Standard/)).toBeInTheDocument();
  });

  it('falls back to sequential create with per-row error capture when createMany is absent', async () => {
    createMock.mockImplementation(async (_ctx: unknown, input: any) => {
      if (input.algaEntityId === 'svc-basic') throw new Error('boom');
      return { id: 'new' };
    });
    render(
      <AccountingMappingModuleView module={buildModule({ createMany: undefined })} context={context} />
    );
    fireEvent.click(await screen.findByText('Bulk map'));
    await screen.findByTestId(`${P}-grid`);
    await act(async () => {
      fireEvent.click(saveAll());
    });
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByTestId(`${P}-error-svc-basic`)).toHaveTextContent('boom');
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('Save all only saves rows visible under the current search', async () => {
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) => ({ algaEntityId: i.algaEntityId, ok: true }))
    );
    await openBulk();
    fireEvent.change(el(`${P}-search`), { target: { value: '365' } });
    // Hosting is selected by default but hidden: not counted, not saved.
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('2');
    fireEvent.click(saveAll());
    await waitFor(() => expect(createManyMock).toHaveBeenCalledTimes(1));
    expect(
      createManyMock.mock.calls[0][1].map((i: any) => i.algaEntityId).sort()
    ).toEqual(['svc-basic', 'svc-std']);
  });

  it('hidden edits stay in state and save once the row is visible again', async () => {
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) => ({ algaEntityId: i.algaEntityId, ok: true }))
    );
    await openBulk();
    fireEvent.click(el(`${P}-ignore-svc-basic`));
    fireEvent.change(el(`${P}-search`), { target: { value: 'hosting' } });
    fireEvent.click(saveAll());
    await waitFor(() => expect(createManyMock).toHaveBeenCalledTimes(1));
    expect(createManyMock.mock.calls[0][1].map((i: any) => i.algaEntityId)).toEqual(['svc-host']);
    fireEvent.change(el(`${P}-search`), { target: { value: '' } });
    // svc-basic is still ignored (edit preserved). The mocked reload still
    // reports host as unmapped, so std and host are the two pending rows.
    expect(el(`${P}-ignore-svc-basic`).checked).toBe(true);
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('2');
  });

  it('prefills a fuzzy match with a Possible match badge but leaves it unchecked', async () => {
    const base = loadResult();
    loadMock.mockResolvedValue({
      ...base,
      algaEntities: [
        ...base.algaEntities,
        { id: 'svc-fuzzy', name: 'Managed Backup Service Plan', baseName: 'Managed Backup Service Plan' }
      ],
      externalEntities: [...base.externalEntities, item('MBA', 'Managed Backup Service Plan Annual')]
    });
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) => ({ algaEntityId: i.algaEntityId, ok: true }))
    );
    await openBulk();
    expect(screen.getByTestId(`${P}-possible-svc-fuzzy`)).toHaveTextContent('Possible match');
    expect(screen.queryByTestId(`${P}-suggested-svc-fuzzy`)).not.toBeInTheDocument();
    expect(el(`${P}-select-svc-fuzzy`).checked).toBe(false);
    // The exact row is checked.
    expect(el(`${P}-select-svc-host`).checked).toBe(true);
    expect(screen.getByText('Item · Managed Backup Service Plan Annual (MBA)')).toBeInTheDocument();

    fireEvent.click(saveAll());
    await waitFor(() => expect(createManyMock).toHaveBeenCalledTimes(1));
    expect(createManyMock.mock.calls[0][1].map((i: any) => i.algaEntityId)).not.toContain('svc-fuzzy');

    // Ticking it opts in explicitly.
    fireEvent.click(el(`${P}-select-svc-fuzzy`));
    expect(el(`${P}-select-svc-fuzzy`).checked).toBe(true);
  });

  it('renders suggested, possible-match and full-text row error affordances together', async () => {
    const base = loadResult();
    const message = 'This target is already mapped to another entity in this organisation. Choose a different target.';
    loadMock.mockResolvedValue({
      ...base,
      algaEntities: [
        ...base.algaEntities,
        { id: 'svc-fuzzy', name: 'Managed Backup Service Plan', baseName: 'Managed Backup Service Plan' }
      ],
      externalEntities: [...base.externalEntities, item('MBA', 'Managed Backup Service Plan Annual')]
    });
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) => ({ algaEntityId: i.algaEntityId, ok: false, error: message }))
    );
    await openBulk();
    expect(screen.getByTestId(`${P}-suggested-svc-host`)).toBeInTheDocument();
    expect(screen.getByTestId(`${P}-possible-svc-fuzzy`)).toBeInTheDocument();
    fireEvent.click(saveAll());
    const error = await screen.findByTestId(`${P}-error-svc-host`);
    expect(error).toHaveTextContent(message);
    expect(error).toHaveAttribute('title', message);
  });
});

describe('AccountingMappingModuleView bulk grid without a provider catalog', () => {
  // QuickBooks CSV/Desktop and Xero CSV have no catalog to pick from, like the
  // single-mapping dialog's free-text fallback.
  const MP = 'qbcsv-service-mappings-bulk';
  const manualModule = () =>
    buildModule({
      id: 'qbcsv-service-mappings',
      adapterType: 'quickbooks_csv',
      externalTarget: undefined,
      manualExternalEntry: true,
      labels: {
        tab: 'Items / Services',
        addButton: 'Add Service Mapping',
        algaColumn: 'Alga Service',
        externalColumn: 'QuickBooks Item',
        dialog: { addTitle: 'Add', editTitle: 'Edit', algaField: 'Alga Service', externalField: 'QuickBooks Item' },
        deleteConfirmation: { title: 'Delete', message: () => 'Delete?' }
      }
    } as Partial<AccountingMappingModule>);

  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  });
  beforeEach(() => {
    vi.clearAllMocks();
    loadMock.mockResolvedValue({ ...loadResult([]), externalEntities: [] });
  });
  afterEach(() => cleanup());

  async function openManualBulk() {
    render(<AccountingMappingModuleView module={manualModule()} context={{ realmId: null }} />);
    fireEvent.click(await screen.findByText('Bulk map'));
    await screen.findByTestId(`${MP}-grid`);
  }

  it('renders a writable text field per row instead of an empty picker', async () => {
    await openManualBulk();
    const input = el(`${MP}-external-svc-host`);
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('placeholder', 'Enter QuickBooks Item...');
    expect(screen.getByText('Enter the identifier exactly as it appears in your accounting system.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Web Hosting' } });
    expect(el(`${MP}-external-svc-host`).value).toBe('Web Hosting');
    expect(el(`${MP}-select-svc-host`)).toBeChecked();
    expect(screen.getByTestId(`${MP}-count`)).toHaveTextContent('1 to save');
  });

  it('keeps the field focused while a value is typed into it', async () => {
    await openManualBulk();
    const input = el(`${MP}-external-svc-host`);
    input.focus();

    // The first character gives the cell text it did not have, which used to
    // rebuild the cell and drop the caret after one keystroke.
    fireEvent.change(input, { target: { value: 'W' } });
    expect(el(`${MP}-external-svc-host`)).toBe(input);
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'Web Hosting' } });
    expect(el(`${MP}-external-svc-host`).value).toBe('Web Hosting');
    expect(document.activeElement).toBe(input);
  });

  it('greys the field out and drops it from the count when the row is ignored', async () => {
    await openManualBulk();
    fireEvent.change(el(`${MP}-external-svc-host`), { target: { value: 'Web Hosting' } });
    expect(screen.getByTestId(`${MP}-count`)).toHaveTextContent('1 to save');

    fireEvent.click(el(`${MP}-ignore-svc-host`));
    expect(el(`${MP}-external-svc-host`)).toBeDisabled();
    expect(el(`${MP}-external-svc-host`).className).toContain('disabled:opacity-50');
    expect(el(`${MP}-select-svc-host`)).not.toBeChecked();
    expect(screen.getByTestId(`${MP}-count`)).toHaveTextContent('0 to save');
    expect(screen.getByTestId(`${MP}-status-svc-host`)).toHaveTextContent('Ignored');
  });

  it('treats a whitespace-only value as blank', async () => {
    await openManualBulk();
    fireEvent.change(el(`${MP}-external-svc-host`), { target: { value: '   ' } });
    expect(el(`${MP}-select-svc-host`)).not.toBeChecked();
    expect(screen.getByTestId(`${MP}-count`)).toHaveTextContent('0 to save');
    expect(screen.getByTestId(`${MP}-status-svc-host`)).toHaveTextContent('—');
  });

  it('saves the typed values, trimmed, and skips blank or ignored rows', async () => {
    createManyMock.mockImplementation(async (_ctx: unknown, inputs: any[]) =>
      inputs.map((i) => ({ algaEntityId: i.algaEntityId, ok: true }))
    );
    await openManualBulk();
    fireEvent.change(el(`${MP}-external-svc-host`), { target: { value: '  Web Hosting  ' } });
    fireEvent.change(el(`${MP}-external-svc-backup`), { target: { value: 'Managed Backup' } });
    fireEvent.change(el(`${MP}-external-svc-basic`), { target: { value: '   ' } });
    fireEvent.click(el(`${MP}-ignore-svc-backup`));

    await act(async () => {
      fireEvent.click(saveAll());
    });
    await waitFor(() => expect(createManyMock).toHaveBeenCalledTimes(1));
    expect(createManyMock.mock.calls[0][1]).toEqual([
      expect.objectContaining({ algaEntityId: 'svc-host', externalEntityId: 'Web Hosting' })
    ]);
  });
});

describe('bulk grid manual-entry opt-in', () => {
  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  });
  beforeEach(() => {
    vi.clearAllMocks();
    loadMock.mockResolvedValue({ ...loadResult([]), externalEntities: [] });
  });
  afterEach(() => cleanup());

  it('only file-based modules that opt in type the target', () => {
    expect(isManualEntryModule({ manualExternalEntry: true })).toBe(true);
    expect(isManualEntryModule({})).toBe(false);
    expect(isManualEntryModule({ manualExternalEntry: false })).toBe(false);
    // A multi-catalog target kind always needs a catalog pick.
    expect(isManualEntryModule({ manualExternalEntry: true, externalTarget: {} as never })).toBe(false);
  });

  it('keeps the catalog picker when a catalog-backed module returns an empty catalog', async () => {
    const qboLike = buildModule({ id: 'qbo-live-service-mappings', adapterType: 'quickbooks_online', externalTarget: undefined } as Partial<AccountingMappingModule>);
    render(<AccountingMappingModuleView module={qboLike} context={context} />);
    fireEvent.click(await screen.findByText('Bulk map'));
    await screen.findByTestId('qbo-live-service-mappings-bulk-grid');

    expect(document.querySelector('input#qbo-live-service-mappings-bulk-external-svc-host')).toBeNull();
    expect(screen.queryByText('Enter the identifier exactly as it appears in your accounting system.')).toBeNull();
  });
});
