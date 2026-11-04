/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountingMappingDialog } from './AccountingMappingDialog';
import type { AccountingMappingModule } from './types';

function buildModule(fields: NonNullable<AccountingMappingModule['metadata']>['fields']): AccountingMappingModule {
  return {
    id: 'quickbooks_desktop-service-mapping',
    adapterType: 'quickbooks_desktop',
    algaEntityType: 'service',
    externalEntityType: 'Account',
    labels: {
      tab: 'Items / Services',
      addButton: 'Add mapping',
      algaColumn: 'Items / Services',
      externalColumn: 'Desktop income account name',
      dialog: {
        addTitle: 'Items / Services',
        editTitle: 'Items / Services',
        algaField: 'Items / Services',
        externalField: 'Desktop income account name'
      },
      deleteConfirmation: { title: 'Remove mapping', message: () => 'Remove?' }
    },
    metadata: { fields },
    load: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn()
  } as unknown as AccountingMappingModule;
}

const existingMapping = {
  id: 'map-1',
  tenant: 'tenant-1',
  integration_type: 'quickbooks_desktop',
  alga_entity_type: 'service',
  alga_entity_id: 'svc-1',
  external_entity_id: 'Services Income',
  external_realm_id: null,
  sync_status: 'manual_link',
  last_synced_at: null,
  created_at: '2026-10-17T00:00:00.000Z',
  updated_at: '2026-10-17T00:00:00.000Z',
  metadata: { qbdItem: 'Old Item', qbdCreateInBatch: 'batch-1' }
} as unknown as React.ComponentProps<typeof AccountingMappingDialog>['existingMapping'];

function renderDialog(fields: NonNullable<AccountingMappingModule['metadata']>['fields']) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <AccountingMappingDialog
      module={buildModule(fields)}
      context={{ realmId: null }}
      isOpen
      onClose={vi.fn()}
      onSubmit={onSubmit}
      existingMapping={existingMapping}
      algaEntities={[{ id: 'svc-1', name: 'Managed Backup' }]}
      externalEntities={[]}
    />
  );
  return { onSubmit };
}

describe('AccountingMappingDialog metadata fields', () => {
  afterEach(() => cleanup());

  const itemField = { key: 'qbdItem', label: 'Desktop item name', required: true };

  it('seeds the field from stored metadata and saves it alongside the other metadata keys', async () => {
    const { onSubmit } = renderDialog([itemField]);
    const input = screen.getByLabelText('Desktop item name') as HTMLInputElement;
    expect(input.value).toBe('Old Item');

    fireEvent.change(input, { target: { value: '  Managed Backup  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      algaEntityId: 'svc-1',
      externalEntityId: 'Services Income',
      metadata: { qbdItem: 'Managed Backup', qbdCreateInBatch: 'batch-1' },
      mappingId: 'map-1'
    }));
  });

  it('blocks saving while a required field is empty', async () => {
    const { onSubmit } = renderDialog([itemField]);
    fireEvent.change(screen.getByLabelText('Desktop item name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));

    expect(await screen.findByText('Please enter desktop item name.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('drops an optional field key when it is cleared', async () => {
    const { onSubmit } = renderDialog([{ key: 'qbdItem', label: 'Desktop item name' }]);
    fireEvent.change(screen.getByLabelText('Desktop item name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { qbdCreateInBatch: 'batch-1' }
    })));
  });
});
