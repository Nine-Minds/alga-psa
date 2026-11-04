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
import { setWhereTagSelection } from '../lib/ticketWhereFilters';

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

describe('TicketingDashboard wiring (descriptor table)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'TicketingDashboard.tsx'), 'utf8');
  it('renders the toolbar filters, chips and reset from WHERE_TAG_FILTERS', () => {
    expect(source).toContain('WHERE_TAG_FILTERS.map((descriptor) =>');
    expect(source).toContain('whereTagFilterChips(');
    expect(source).toMatch(/where: undefined,\s*\n\s*assignedToIds: undefined/);
    expect(source).toContain('onFilterChange({ where: chip.clear() })');
  });
});
