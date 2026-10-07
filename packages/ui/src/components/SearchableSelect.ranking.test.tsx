/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect, getSearchableSelectRank, rankSearchableSelectOptions } from './SearchableSelect';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: { id: 'searchable-select' },
    updateMetadata: vi.fn(),
  }),
}));

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const events = [
  { value: 'CONTRACT_CREATED', label: 'Contract Created (CONTRACT_CREATED)', keywords: 'contract created client company customer new' },
  { value: 'CLIENT_UPDATED', label: 'Client Updated (CLIENT_UPDATED)', keywords: 'client updated created' },
  { value: 'TICKET_CREATED', label: 'Ticket Created (TICKET_CREATED)', secondaryLabel: 'Fires when a client opens a ticket' },
  { value: 'CLIENT_CREATED', label: 'Client Created (CLIENT_CREATED)' },
];

describe('SearchableSelect ranking', () => {
  it('puts the label that starts with the search before keyword-only matches', () => {
    expect(rankSearchableSelectOptions(events, 'client created').map((option) => option.value)).toEqual([
      'CLIENT_CREATED',
      'TICKET_CREATED',
      'CONTRACT_CREATED',
      'CLIENT_UPDATED',
    ]);
  });

  it('ranks exact label, then prefix, then word start, then anywhere in the label', () => {
    const rank = (label: string) => getSearchableSelectRank({ value: label, label }, 'ticket');
    expect(rank('ticket')).toBeLessThan(rank('Ticket Closed'));
    expect(rank('Ticket Closed')).toBeLessThan(rank('Find Ticket'));
    expect(rank('Find Ticket')).toBeLessThan(rank('Subticketing'));
    expect(getSearchableSelectRank({ value: 'x', label: 'Other' }, 'ticket')).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps the original order for equally good matches and returns all options without a search', () => {
    const options = [
      { value: 'b', label: 'Ticket B' },
      { value: 'a', label: 'Ticket A' },
    ];
    expect(rankSearchableSelectOptions(options, 'ticket').map((option) => option.value)).toEqual(['b', 'a']);
    expect(rankSearchableSelectOptions(options, '  ')).toBe(options);
  });

  it('shows the best match first in the list', () => {
    render(<SearchableSelect id="event" value="" onChange={vi.fn()} options={events} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'client created' } });
    const optionTexts = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    expect(optionTexts[0]).toContain('Client Created');
  });
});
