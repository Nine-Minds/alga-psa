/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
async function choose(id: string, name: string) {
  fireEvent.keyDown(document.getElementById(id)!, { key: 'Enter', code: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name }));
}
function draftProps() {
  return {
    module: buildModule({ metadata: { enableJsonEditor: true } }),
    context, isOpen: true, onClose: vi.fn(), onSubmit: vi.fn(async () => undefined),
    algaEntities: [{ id: 'svc-1', name: 'IT Professional Services' }],
    externalEntities: [{ id: 'item:CONSULT', name: 'Consulting Services', kind: 'item' }],
  };
}

describe('AccountingMappingDialog explicit target-kind selection', () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('preserves a new mapping draft when the provider catalog refreshes before save', async () => {
    const props = draftProps();
    const { onSubmit } = props;
    const { rerender } = render(<AccountingMappingDialog {...props} />);
    await choose('xero-live-service-mappings-alga-select', 'IT Professional Services');
    await choose('xero-live-service-mappings-external-select', 'Consulting Services');
    fireEvent.change(screen.getByPlaceholderText('Optional metadata as JSON'), { target: { value: '{"accountCode":"200"}' } });

    // A background catalog fetch returns a fresh array while the user edits.
    rerender(<AccountingMappingDialog {...props} externalEntities={[...props.externalEntities]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      algaEntityId: 'svc-1', externalEntityId: 'item:CONSULT', metadata: { accountCode: '200' }, mappingId: undefined,
    }));
  });

  it('preserves the service and metadata but requires re-selection when a provider item disappears', async () => {
    const props = draftProps();
    const { rerender } = render(<AccountingMappingDialog {...props} />);
    await choose('xero-live-service-mappings-alga-select', 'IT Professional Services');
    await choose('xero-live-service-mappings-external-select', 'Consulting Services');
    fireEvent.change(screen.getByPlaceholderText('Optional metadata as JSON'), { target: { value: '{"accountCode":"200"}' } });
    const catalog = [{ id: 'item:NEW', name: 'Replacement Service', kind: 'item' }];
    rerender(<AccountingMappingDialog {...props} externalEntities={catalog} />);
    expect(screen.getByTestId('xero-live-service-mappings-stale-target-notice')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    await choose('xero-live-service-mappings-external-select', 'Replacement Service');
    expect(screen.queryByTestId('xero-live-service-mappings-stale-target-notice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      algaEntityId: 'svc-1', externalEntityId: 'item:NEW', metadata: { accountCode: '200' }, mappingId: undefined,
    }));
  });

  it('keeps Save disabled across a catalog refresh while persistence is pending', async () => {
    const props = draftProps();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const onSubmit = vi.fn(() => pending);
    const { rerender } = render(<AccountingMappingDialog {...props} onSubmit={onSubmit} />);
    await choose('xero-live-service-mappings-alga-select', 'IT Professional Services');
    await choose('xero-live-service-mappings-external-select', 'Consulting Services');
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));
    rerender(<AccountingMappingDialog {...props} onSubmit={onSubmit} externalEntities={[...props.externalEntities]} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await pending; });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['reopen', 'change organisation'])('starts a fresh draft on %s', async action => {
    const props = draftProps();
    const { rerender } = render(<AccountingMappingDialog {...props} />);
    await choose('xero-live-service-mappings-alga-select', 'IT Professional Services');
    await choose('xero-live-service-mappings-external-select', 'Consulting Services');
    fireEvent.change(screen.getByPlaceholderText('Optional metadata as JSON'), { target: { value: '{"accountCode":"200"}' } });
    if (action === 'reopen') {
      rerender(<AccountingMappingDialog {...props} isOpen={false} />);
      rerender(<AccountingMappingDialog {...props} />);
    } else {
      rerender(<AccountingMappingDialog {...props} context={{ realmId: 'different-org', connectionId: 'conn-2' }} />);
    }
    expect(document.getElementById('xero-live-service-mappings-alga-select')).toHaveTextContent('Select Alga Service...');
    expect(document.getElementById('xero-live-service-mappings-external-select')).toHaveTextContent('Select Xero Item or Account...');
    expect(screen.getByPlaceholderText('Optional metadata as JSON')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

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
