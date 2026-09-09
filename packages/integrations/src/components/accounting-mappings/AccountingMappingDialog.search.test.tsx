/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingMappingDialog } from './AccountingMappingDialog';
import type { AccountingMappingModule } from './types';

// cmdk scrolls its active item into view; jsdom has no such API.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const externalTarget = {
  label: 'Map To',
  kinds: [
    { id: 'item', label: 'Xero Item' },
    { id: 'account', label: 'Xero Revenue Account' }
  ],
  defaultKindId: 'item',
  kindForMapping: (mapping: any) =>
    mapping.metadata?.xeroTargetKind === 'account' ? 'account' : 'item',
  optionIdForMapping: (mapping: any) =>
    `${mapping.metadata?.xeroTargetKind === 'account' ? 'account' : 'item'}:${mapping.external_entity_id}`,
  invalidNotice: 'Pick a valid Xero Item, or explicitly switch to a Revenue Account.'
};

function buildModule(overrides: Partial<AccountingMappingModule> = {}): AccountingMappingModule {
  return {
    id: 'xero-live-service-mappings',
    adapterType: 'xero',
    algaEntityType: 'service',
    externalEntityType: 'Item',
    labels: {
      tab: 'Items / Services',
      addButton: 'Add Service Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'Xero Target',
      dialog: {
        addTitle: 'Add Live Xero Service Mapping',
        editTitle: 'Edit Live Xero Service Mapping',
        algaField: 'Alga Service',
        externalField: 'Xero Item or Account'
      },
      deleteConfirmation: { title: 'Delete', message: () => 'Delete?' }
    },
    externalTarget,
    load: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides
  } as unknown as AccountingMappingModule;
}

const context = { realmId: 'xero-tenant-1', connectionId: 'conn-1' };

const algaEntities = [
  { id: 'svc-1', name: 'IT Professional Services' },
  { id: 'svc-2', name: 'Network Cabling' },
  { id: 'svc-3', name: 'Managed Backup' }
];

const externalEntities = [
  { id: 'item:CAT6-15m', name: 'Item · CAT6 patch lead 15m (CAT6-15m)', kind: 'item' },
  { id: 'item:LABOUR', name: 'Item · Onsite labour (LABOUR)', kind: 'item' },
  { id: 'item:BACKUP', name: 'Item · Backup subscription (BACKUP)', kind: 'item' },
  { id: 'account:200', name: 'Revenue account · Sales (200)', kind: 'account' }
];

function openPicker(triggerText: string): HTMLElement {
  const trigger = screen.getByText(triggerText).closest('button');
  if (!trigger) throw new Error(`No picker trigger for "${triggerText}"`);
  fireEvent.click(trigger);
  return trigger;
}

function typeSearch(term: string) {
  fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: term } });
}

function renderDialog(props: Partial<React.ComponentProps<typeof AccountingMappingDialog>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <AccountingMappingDialog
      module={buildModule()}
      context={context}
      isOpen
      onClose={vi.fn()}
      onSubmit={onSubmit}
      algaEntities={algaEntities}
      externalEntities={externalEntities}
      {...props}
    />
  );
  return { onSubmit };
}

describe('AccountingMappingDialog searchable pickers', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('filters the external catalog as you type and submits the kind-prefixed option id', async () => {
    const { onSubmit } = renderDialog();

    openPicker('Select Alga Service...');
    fireEvent.click(screen.getByText('Network Cabling'));

    openPicker('Select Xero Item or Account...');
    // Every item-kind record is offered before any search narrows it.
    expect(screen.getByText('Item · Onsite labour (LABOUR)')).toBeInTheDocument();
    // The overlay portals inside the dialog, so the dialog cannot clip it.
    expect(screen.getByPlaceholderText('Search...').closest('[role="dialog"]')).not.toBeNull();

    typeSearch('CAT6');

    expect(screen.getByText('Item · CAT6 patch lead 15m (CAT6-15m)')).toBeInTheDocument();
    expect(screen.queryByText('Item · Onsite labour (LABOUR)')).toBeNull();
    expect(screen.queryByText('Item · Backup subscription (BACKUP)')).toBeNull();

    fireEvent.click(screen.getByText('Item · CAT6 patch lead 15m (CAT6-15m)'));

    fireEvent.submit(document.getElementById('xero-live-service-mappings-mapping-dialog-form')!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ algaEntityId: 'svc-2', externalEntityId: 'item:CAT6-15m' })
    );
  });

  it('never offers records from the other target kind, even when they match the search', () => {
    renderDialog();

    openPicker('Select Xero Item or Account...');
    typeSearch('Sales');

    // The kind chooser still owns which catalog is searched.
    expect(screen.queryByText('Revenue account · Sales (200)')).toBeNull();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('filters the Alga service picker by typed text', () => {
    renderDialog();

    openPicker('Select Alga Service...');
    typeSearch('backup');

    expect(screen.getByText('Managed Backup')).toBeInTheDocument();
    expect(screen.queryByText('IT Professional Services')).toBeNull();
    expect(screen.queryByText('Network Cabling')).toBeNull();

    fireEvent.click(screen.getByText('Managed Backup'));

    // Selecting closes the dropdown and the trigger shows the chosen service.
    expect(screen.queryByPlaceholderText('Search...')).toBeNull();
    expect(screen.getByText('Managed Backup')).toBeInTheDocument();
  });
});
