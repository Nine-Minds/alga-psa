/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AccountingMappingModuleView } from './AccountingMappingModuleView';
import type { AccountingMappingAlgaPickerProps, AccountingMappingAlgaSearch, AccountingMappingModule } from './types';

/**
 * A module whose Alga side is searched (clients) never hands the engine the tenant's list: the table
 * names only the mapped entities, the dialog renders the module's searched picker, and the full list is
 * read only when the user opens the bulk grid.
 */

function StubPicker({ id, excludeIds, value }: AccountingMappingAlgaPickerProps) {
  return <div data-testid="searched-picker" id={id} data-exclude={excludeIds.join(',')} data-value={value} />;
}

function buildModule(algaSearch: AccountingMappingAlgaSearch): AccountingMappingModule {
  return {
    id: 'qbcsv-customer-mappings',
    adapterType: 'quickbooks_csv',
    algaEntityType: 'client',
    externalEntityType: 'Customer',
    manualExternalEntry: true,
    labels: {
      tab: 'Clients',
      addButton: 'Add Client Mapping',
      algaColumn: 'Alga Client',
      externalColumn: 'QuickBooks Customer',
      dialog: { addTitle: 'Add', editTitle: 'Edit', algaField: 'Alga Client', externalField: 'Customer' },
      deleteConfirmation: { title: 'Delete', message: () => 'Delete?' },
    },
    algaSearch,
    load: vi.fn(async () => ({
      mappings: [
        { id: 'm-1', alga_entity_id: 'client-mapped', external_entity_id: 'Acme Customer', metadata: null },
      ],
      algaEntities: [],
      externalEntities: [],
    })),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as AccountingMappingModule;
}

function buildSearch() {
  return {
    Picker: StubPicker,
    resolve: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, name: id === 'client-mapped' ? 'Acme Corp' : id }))),
    loadAll: vi.fn(async () => [
      { id: 'client-mapped', name: 'Acme Corp' },
      { id: 'client-new', name: 'Globex' },
    ]),
  } satisfies AccountingMappingAlgaSearch;
}

describe('AccountingMappingModuleView with a searched Alga side', () => {
  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => cleanup());

  it('names mapped clients by id and renders the searched picker, without the full list', async () => {
    const search = buildSearch();
    render(<AccountingMappingModuleView module={buildModule(search)} context={{ realmId: null }} />);

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(search.resolve).toHaveBeenCalledWith(['client-mapped']);

    fireEvent.click(screen.getByText('Add Client Mapping'));
    const picker = await screen.findByTestId('searched-picker');
    expect(picker).toHaveAttribute('id', 'qbcsv-customer-mappings-alga-select');
    expect(picker).toHaveAttribute('data-exclude', 'client-mapped');
    expect(search.loadAll).not.toHaveBeenCalled();
  });

  it('reads every client only when the bulk grid opens', async () => {
    const search = buildSearch();
    render(<AccountingMappingModuleView module={buildModule(search)} context={{ realmId: null }} />);
    await screen.findByText('Acme Corp');
    expect(search.loadAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Bulk map'));
    await waitFor(() => expect(search.loadAll).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Globex')).toBeInTheDocument();
  });
});
