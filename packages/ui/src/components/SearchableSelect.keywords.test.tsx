/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect } from './SearchableSelect';

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

const options = [
  { value: 'replied', label: 'Ticket Customer Replied', keywords: 'ticket customer replied reply response respond' },
  { value: 'closed', label: 'Ticket Closed' },
];

function openAndSearch(term: string) {
  render(<SearchableSelect id="picker" value="" onChange={vi.fn()} options={options} />);
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: term } });
}

describe('SearchableSelect keywords', () => {
  it('matches hidden keywords without showing them', () => {
    openAndSearch('reply');

    expect(screen.getByText('Ticket Customer Replied')).toBeTruthy();
    expect(screen.queryByText(/respond/)).toBeNull();
    expect(screen.queryByText('Ticket Closed')).toBeNull();
  });

  it('matches every word of a multi-word search in any order', () => {
    openAndSearch('closed ticket');

    expect(screen.getByText('Ticket Closed')).toBeTruthy();
    expect(screen.queryByText('Ticket Customer Replied')).toBeNull();
  });

  it('still matches labels for options without keywords', () => {
    openAndSearch('closed');

    expect(screen.getByText('Ticket Closed')).toBeTruthy();
  });
});
