/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountingMappingDialog } from './AccountingMappingDialog';
import type { AccountingMappingModule } from './types';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const module = {
  id: 'xero-live-service-mappings',
  adapterType: 'xero',
  algaEntityType: 'service',
  externalEntityType: 'Item',
  labels: {
    tab: 'Items',
    addButton: 'Add',
    algaColumn: 'Alga Service',
    externalColumn: 'Xero Target',
    dialog: { addTitle: 'Add', editTitle: 'Edit', algaField: 'Alga Service', externalField: 'Xero Item' },
    deleteConfirmation: { title: 'Delete', message: () => 'Delete?' }
  },
  load: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn()
} as unknown as AccountingMappingModule;

const algaEntities = [
  { id: 'svc-1', name: 'Mapped Service' },
  { id: 'svc-2', name: 'Free Service' },
  { id: 'svc-3', name: 'Other Mapped Service' }
];
const externalEntities = [{ id: 'X1', name: 'Xero One' }];
const mappedAlgaIds = new Set(['svc-1', 'svc-3']);

function renderDialog(existingMapping?: any) {
  render(
    <AccountingMappingDialog
      module={module}
      context={{ realmId: 'r1' }}
      isOpen
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      existingMapping={existingMapping}
      algaEntities={algaEntities}
      externalEntities={externalEntities}
      mappedAlgaIds={mappedAlgaIds}
    />
  );
}

afterEach(() => cleanup());

describe('AccountingMappingDialog already-mapped filtering', () => {
  it('hides already-mapped entities in add mode and leaves unmapped ones alone', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Select Alga Service...').closest('button')!);
    expect(screen.getByText('Free Service')).toBeInTheDocument();
    expect(screen.queryByText('Mapped Service')).not.toBeInTheDocument();
    expect(screen.queryByText('Other Mapped Service')).not.toBeInTheDocument();
  });

  it('keeps and preselects the mapping\'s own entity in edit mode, hiding other mapped ones', () => {
    renderDialog({
      id: 'm1',
      alga_entity_id: 'svc-1',
      external_entity_id: 'X1',
      metadata: null
    });
    // Preselected: the trigger shows the own entity's name.
    const trigger = screen.getByText('Mapped Service').closest('button')!;
    fireEvent.click(trigger);
    expect(screen.getByText('Free Service')).toBeInTheDocument();
    expect(screen.queryByText('Other Mapped Service')).not.toBeInTheDocument();
    expect(screen.getAllByText('Mapped Service').length).toBeGreaterThan(0);
  });
});
