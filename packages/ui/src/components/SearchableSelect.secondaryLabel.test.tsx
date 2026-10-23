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

// cmdk observes its list and scrolls the active item; jsdom has neither API.
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
  { value: 'p1', label: 'Professional Business IP Phone (FTS-00004)', secondaryLabel: 'Grandstream GRP2614' },
  { value: 'p2', label: 'Plain Service' },
];

function openAndSearch(term: string) {
  render(<SearchableSelect id="picker" value="" onChange={vi.fn()} options={options} />);
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: term } });
}

describe('SearchableSelect secondaryLabel', () => {
  it('matches a case-insensitive substring of the secondary line and renders it muted', () => {
    openAndSearch('grp26');

    expect(screen.getByText('Professional Business IP Phone (FTS-00004)')).toBeTruthy();
    expect(screen.getByText('Grandstream GRP2614')).toBeTruthy();
    expect(screen.queryByText('Plain Service')).toBeNull();
  });

  it('still matches the primary label and leaves rows without a secondary line single-line', () => {
    openAndSearch('plain');

    expect(screen.getByText('Plain Service')).toBeTruthy();
    expect(screen.queryByText('Professional Business IP Phone (FTS-00004)')).toBeNull();
  });
});
