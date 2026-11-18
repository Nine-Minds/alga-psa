/**
 * @vitest-environment jsdom
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, d: any) => (typeof d === 'string' ? d : d?.defaultValue ?? _k) }),
}));

import { WhereTagFilter } from './WhereTagFilter';
import { WhereLocationFilter } from './WhereLocationFilter';
import { setWhereSelection, setWhereTagSelection } from '../lib/ticketWhereFilters';

const defs = [
  { tag_id: 'def-vip', tag_text: 'VIP', tagged_id: '', tagged_type: 'contact', tenant: 't' },
  { tag_id: 'def-poc', tag_text: 'POC', tagged_id: '', tagged_type: 'contact', tenant: 't' },
] as any[];

describe('WhereTagFilter', () => {
  it('writes an any-of contact.tags predicate with definition ids when a tag is picked', () => {
    let where: any;
    const onChange = vi.fn((selection) => {
      where = setWhereTagSelection(undefined, 'contact.tags', selection);
    });
    render(<WhereTagFilter id="f" label="Requester tags" definitions={defs} selection={null} onChange={onChange} />);
    fireEvent.click(screen.getByText('Requester tags'));
    fireEvent.click(screen.getByText('VIP'));
    expect(where).toEqual({ join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: ['def-vip'] }] });
  });

  it('toggles to none-of and keeps the selected ids', () => {
    const onChange = vi.fn();
    render(
      <WhereTagFilter
        id="f"
        label="Requester tags"
        definitions={defs}
        selection={{ mode: 'in', ids: ['def-vip'] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Any of'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'not_in', ids: ['def-vip'] });
  });

  it('shows the none-of mode label for a not_in selection', () => {
    render(
      <WhereTagFilter id="f" label="Client tags" definitions={defs} selection={{ mode: 'not_in', ids: ['def-poc'] }} onChange={() => {}} />,
    );
    expect(screen.getByText('None of')).toBeTruthy();
  });
});

const WAREHOUSE = '11111111-1111-4111-8111-111111111111';
const HEAD_OFFICE = '22222222-2222-4222-8222-222222222222';
const ELSEWHERE = '33333333-3333-4333-8333-333333333333';
const locations = [
  { location_id: WAREHOUSE, location_name: 'Warehouse', client_name: 'Acme' },
  { location_id: HEAD_OFFICE, location_name: 'Head office', client_name: 'Acme' },
];

describe('WhereLocationFilter', () => {
  it('writes a location_id predicate with ids, labelled by client', () => {
    let where: any;
    const onChange = vi.fn((selection) => {
      where = setWhereSelection(undefined, 'location_id', selection);
    });
    render(<WhereLocationFilter id="f" label="Location" options={locations} selection={null} onChange={onChange} />);
    fireEvent.click(screen.getByText('Location'));
    fireEvent.click(screen.getByText('Acme · Warehouse'));
    expect(where).toEqual({ join: 'and', clauses: [{ path: 'location_id', operator: 'in', value: [WAREHOUSE] }] });
  });

  it('toggles to none-of and keeps the selected ids', () => {
    const onChange = vi.fn();
    render(
      <WhereLocationFilter
        id="f"
        label="Requester location"
        options={locations}
        selection={{ mode: 'in', ids: [WAREHOUSE] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Any of'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'not_in', ids: [WAREHOUSE] });
  });

  // A saved view can carry a location this list does not offer (another client's, or deactivated).
  // Touching the control must not quietly drop it.
  it('keeps a selected location that is not among the current options', () => {
    const onChange = vi.fn();
    render(
      <WhereLocationFilter
        id="f"
        label="Location"
        options={locations}
        selection={{ mode: 'in', ids: [ELSEWHERE] }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Location: 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Location: 1'));
    fireEvent.click(screen.getByText('Acme · Head office'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'in', ids: [ELSEWHERE, HEAD_OFFICE] });
  });
});

describe('TicketingDashboard wiring (descriptor table)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'TicketingDashboard.tsx'), 'utf8');
  it('renders the toolbar filters, chips and reset from the descriptor table', () => {
    // The table is WHERE_FILTERS now that it holds location rows as well as tag rows; the control
    // each row renders is chosen from its options source, so a new row is still never new wiring.
    expect(source).toContain('WHERE_FILTERS.map((descriptor) =>');
    expect(source).toContain('whereFilterChips(');
    expect(source).toMatch(/where: undefined,\s*\n\s*assignedToIds: undefined/);
    expect(source).toContain('onFilterChange({ where: chip.clear() })');
  });

  // T063: one option list behind both Location filters, narrowed to the filtered client and
  // reloaded when that filter changes.
  it('loads the location options for the filtered client and shares them between both rows', () => {
    expect(source).toContain('listTicketFilterLocations(selectedClient ?? null)');
    expect(source).toMatch(/return \(\) => \{ cancelled = true; \};\s*\n\s*\}, \[selectedClient\]\);/);
    expect((source.match(/options=\{whereLocationOptions\}/g) ?? []).length).toBe(1);
    expect(source).toContain('<WhereLocationFilter');
  });

  it('derives the active-filter count and the toolbar controls from the same table', () => {
    expect(source).toContain('WHERE_FILTERS.some((d) => getWhereTagSelection(selectedWhere, d.path) !== null)');
    expect(source).toContain('WHERE_FILTERS.filter((d) => getWhereTagSelection(selectedWhere, d.path) !== null)');
  });
});
