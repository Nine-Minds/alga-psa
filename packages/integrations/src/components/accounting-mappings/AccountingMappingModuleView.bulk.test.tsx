/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingMappingModuleView } from './AccountingMappingModuleView';
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
    // Hidden rows are untouched: only Hosting is left to save.
    expect(screen.getByTestId(`${P}-count`)).toHaveTextContent('1');
    fireEvent.change(el(`${P}-search`), { target: { value: '' } });
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
});
