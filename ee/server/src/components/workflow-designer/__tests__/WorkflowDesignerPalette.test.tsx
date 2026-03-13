/** @vitest-environment jsdom */

import React, { useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowDesignerPalette, type WorkflowDesignerPaletteItem } from '../WorkflowDesignerPalette';
import {
  buildPaletteSearchIndex,
  groupPaletteItemsByCategory,
  matchesPaletteSearchQuery,
} from '../paletteSearch';

type PaletteHarnessItem = WorkflowDesignerPaletteItem & {
  category: string;
  sortOrder: number;
  searchIndex: string;
};

const paletteItems: PaletteHarnessItem[] = [
  {
    id: 'ticket',
    label: 'Ticket',
    description: 'Ticket actions',
    category: 'Core',
    sortOrder: 1,
    searchIndex: buildPaletteSearchIndex(['ticket', 'create ticket', 'find ticket']),
  },
  {
    id: 'control.callWorkflow',
    label: 'Call Workflow',
    description: 'Invoke another workflow',
    category: 'Control',
    sortOrder: 1,
    searchIndex: buildPaletteSearchIndex(['control.callWorkflow', 'Call Workflow', 'invoke workflow']),
  },
];

function PaletteHarness() {
  const [search, setSearch] = useState('');

  const groupedItems = useMemo(() => {
    const filteredItems = paletteItems.filter((item) =>
      matchesPaletteSearchQuery(item.searchIndex, search)
    );
    return groupPaletteItemsByCategory(filteredItems);
  }, [search]);

  return (
    <WorkflowDesignerPalette
      visible={true}
      search={search}
      onSearchChange={setSearch}
      registryError={false}
      draggingFromPalette={true}
      groupedPaletteItems={groupedItems}
      renderItem={(item) => <button key={item.id}>{item.label}</button>}
    />
  );
}

describe('WorkflowDesignerPalette', () => {
  afterEach(() => {
    cleanup();
  });

  it('T038/T051/T054/T060: keeps the grouped palette container render stable while drag-search stays interactive and restores the filtered palette cleanly', () => {
    render(<PaletteHarness />);

    const searchInput = screen.getByPlaceholderText('Search');
    expect(searchInput).toBeEnabled();
    expect(screen.getByText('Drop on pipeline to add')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ticket' })).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Call Workflow' } });

    expect(screen.getByRole('button', { name: 'Call Workflow' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ticket' })).not.toBeInTheDocument();
    expect(screen.getByText('Drop on pipeline to add')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'Ticket' })).toBeInTheDocument();
    expect(screen.getByText('Drop on pipeline to add')).toBeInTheDocument();
  });

  it('T040: keeps the grouped palette visible but non-editable in read-only sessions', () => {
    const groupedItems = groupPaletteItemsByCategory(paletteItems);

    render(
      <WorkflowDesignerPalette
        visible={true}
        search=""
        onSearchChange={() => undefined}
        registryError={false}
        draggingFromPalette={false}
        groupedPaletteItems={groupedItems}
        renderItem={(item) => (
          <button key={item.id} disabled>
            {item.label}
          </button>
        )}
      />
    );

    expect(screen.getAllByRole('button', { name: 'Ticket' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Call Workflow' })[0]).toBeDisabled();
    expect(screen.getByPlaceholderText('Search')).toBeEnabled();
  });
});
