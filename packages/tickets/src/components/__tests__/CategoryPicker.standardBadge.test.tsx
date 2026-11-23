/**
 * T242 — the "ITIL" badge on a category means "a copy of a standard category" (D9), which is what
 * `standard_category_id` says. `is_from_itil_standard` is the priority flag's name and is set on
 * rows that are not standard copies, so it must not decide the badge — on a parent or on a child.
 */
/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ITicketCategory } from '@alga-psa/types';
import { CategoryPicker } from '../CategoryPicker';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const category = (overrides: Partial<ITicketCategory> & { category_id: string; category_name: string }): ITicketCategory =>
  ({ tenant: 'tenant-1', board_id: 'board-1', ...overrides } as ITicketCategory);

const CATEGORIES: ITicketCategory[] = [
  category({
    category_id: 'standard-parent',
    category_name: 'Hardware',
    standard_category_id: 'std-hardware',
    is_from_itil_standard: true,
  }),
  category({
    category_id: 'standard-child',
    category_name: 'Network',
    parent_category: 'standard-parent',
    standard_category_id: 'std-network',
    is_from_itil_standard: true,
  }),
  // The board's own rows. The second one carries the stale flag a tenant category could be left
  // with: it is not a copy of anything, so it gets no badge.
  category({ category_id: 'own-parent', category_name: 'Billing questions' }),
  category({
    category_id: 'own-child',
    category_name: 'Refunds',
    parent_category: 'own-parent',
    is_from_itil_standard: true,
  }),
];

/** The rendered label of one option: the element holding the name, with whatever sits beside it. */
function labelTextOf(name: string): string {
  const node = screen.getByText(name);
  return (node.parentElement ?? node).textContent ?? '';
}

/** Searching forces every branch open, which is how a child row becomes visible here. */
function search(term: string) {
  fireEvent.change(screen.getByPlaceholderText(/Search/i), { target: { value: term } });
}

function openPicker() {
  render(
    <CategoryPicker
      id="category-badge-picker"
      categories={CATEGORIES}
      selectedCategories={[]}
      onSelect={() => undefined}
      multiSelect
    />
  );
  fireEvent.click(screen.getByText(/Select categories/));
}

describe('CategoryPicker standard badge', () => {
  it('T242: badges a standard copy, parent and child', () => {
    openPicker();

    expect(labelTextOf('Hardware')).toContain('ITIL');
    search('Network');
    expect(labelTextOf('Network')).toContain('ITIL');
  });

  it('T242: a board’s own category is not badged, whatever the old flag says', () => {
    openPicker();

    expect(labelTextOf('Billing questions')).not.toContain('ITIL');
    // `is_from_itil_standard` is true on this row and it still has no standard copy behind it.
    search('Refunds');
    expect(labelTextOf('Refunds')).not.toContain('ITIL');
  });
});
