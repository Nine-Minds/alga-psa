/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingMappingDialog } from './AccountingMappingDialog';
import type { AccountingMappingModule } from './types';

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

describe('AccountingMappingDialog explicit target-kind selection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders the kind chooser and never offers free-text entry, even with an empty catalog', () => {
    render(
      <AccountingMappingDialog
        module={buildModule()}
        context={context}
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        algaEntities={[{ id: 'svc-1', name: 'IT Professional Services' }]}
        externalEntities={[]}
      />
    );

    expect(screen.getByText('Map To')).toBeInTheDocument();
    // Zero catalog records (the alga0002321 org had zero Items) must NOT fall
    // back to a manual input where an arbitrary string could be typed.
    expect(
      document.getElementById('xero-live-service-mappings-external-manual-input')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('No usable records of this type were found in the connected organisation.')
    ).toBeInTheDocument();
  });

  it('editing an invalid legacy mapping shows the remediation notice and starts with no selection', () => {
    render(
      <AccountingMappingDialog
        module={buildModule()}
        context={context}
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        existingMapping={{
          id: 'mapping-legacy',
          tenant: 't',
          integration_type: 'xero',
          alga_entity_type: 'service',
          alga_entity_id: 'svc-1',
          external_entity_id: '200',
          created_at: '',
          updated_at: '',
          metadata: { externalDisplayName: 'Old item label (200)' }
        } as any}
        algaEntities={[{ id: 'svc-1', name: 'IT Professional Services' }]}
        externalEntities={[
          { id: 'account:200', name: 'Revenue account · Sales (200)', kind: 'account' }
        ]}
      />
    );

    // Legacy kind-less mapping resolves to item:200, which the catalog no
    // longer carries — the dialog demands an explicit re-selection.
    expect(
      screen.getByTestId('xero-live-service-mappings-stale-target-notice')
    ).toHaveTextContent('Pick a valid Xero Item, or explicitly switch to a Revenue Account.');
  });

  it('preselects the stored kind and option when the target still exists', () => {
    render(
      <AccountingMappingDialog
        module={buildModule()}
        context={context}
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        existingMapping={{
          id: 'mapping-account',
          tenant: 't',
          integration_type: 'xero',
          alga_entity_type: 'service',
          alga_entity_id: 'svc-1',
          external_entity_id: '200',
          created_at: '',
          updated_at: '',
          metadata: { xeroTargetKind: 'account' }
        } as any}
        algaEntities={[{ id: 'svc-1', name: 'IT Professional Services' }]}
        externalEntities={[
          { id: 'item:200', name: 'Item · Duplicate code (200)', kind: 'item' },
          { id: 'account:200', name: 'Revenue account · Sales (200)', kind: 'account' }
        ]}
      />
    );

    expect(screen.queryByTestId('xero-live-service-mappings-stale-target-notice')).toBeNull();
    // The visible selections resolve by (kind, code): the account label, not
    // the same-code item label. (Radix renders the value in trigger + hidden
    // native select, so match on at-least-one.)
    expect(screen.getAllByText('Xero Revenue Account').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revenue account · Sales (200)').length).toBeGreaterThan(0);
    expect(screen.queryByText('Item · Duplicate code (200)')).toBeNull();
  });
});
