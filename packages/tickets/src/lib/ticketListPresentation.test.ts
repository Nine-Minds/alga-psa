import { describe, expect, it } from 'vitest';
import type { ITicketCategory, ITicketListItem } from '@alga-psa/types';
import {
  STATUS_PILL_CLOSED_HUE,
  STATUS_PILL_HUES,
  formatCategoryLabel,
  statusPillHue,
} from './ticketListPresentation';

describe('ticket list status pill palette', () => {
  it('uses theme tokens for every open-status hue', () => {
    expect(STATUS_PILL_HUES).toHaveLength(7);
    expect(STATUS_PILL_HUES.every((hue) => /^var\(--color-[a-z0-9-]+\)$/.test(hue))).toBe(true);
  });

  it('keeps custom status colors stable by name and closed statuses semantic', () => {
    expect(statusPillHue('Waiting on Vendor', false)).toBe(statusPillHue('Waiting on Vendor', false));
    expect(statusPillHue('Completed', true)).toBe(STATUS_PILL_CLOSED_HUE);
  });
});

function record(overrides: Partial<ITicketListItem> = {}): ITicketListItem {
  return { category_id: null, subcategory_id: null, ...overrides } as ITicketListItem;
}

const PARENT: ITicketCategory = { category_id: 'parent-kept', category_name: 'Hardware' } as ITicketCategory;
const CHILD: ITicketCategory = {
  category_id: 'child-kept',
  category_name: 'Network',
  parent_category: 'parent-kept',
} as ITicketCategory;

describe('formatCategoryLabel', () => {
  it('reports no category when the ticket carries neither id', () => {
    expect(formatCategoryLabel(record(), [PARENT, CHILD])).toBe('No Category');
  });

  it('resolves a direct match by category_id with no aliases', () => {
    expect(formatCategoryLabel(record({ category_id: 'parent-kept' }), [PARENT, CHILD])).toBe('Hardware');
  });

  it('resolves a direct match by subcategory_id, parent → child', () => {
    expect(formatCategoryLabel(record({ subcategory_id: 'child-kept' }), [PARENT, CHILD])).toBe('Hardware → Network');
  });

  // Regression: R9 de-duplicates the category list passed here to one row per standard category
  // across every ITIL board, so a ticket's own category_id can name a board's copy the list no
  // longer carries. A browser check found this on a second ITIL board's ticket list: the ticket's
  // own detail screen (not de-duplicated) showed "Network" correctly, but the list showed "Unknown
  // Category" because `categories` here held only the first board's copy of each standard row.
  it('translates a de-duplicated-out category_id through the alias map instead of reporting it unknown', () => {
    const aliases = { 'other-board-parent': 'parent-kept' };
    expect(formatCategoryLabel(record({ category_id: 'other-board-parent' }), [PARENT, CHILD], aliases)).toBe('Hardware');
  });

  it('translates a de-duplicated-out subcategory_id through the alias map', () => {
    const aliases = { 'other-board-child': 'child-kept' };
    expect(formatCategoryLabel(record({ subcategory_id: 'other-board-child' }), [PARENT, CHILD], aliases))
      .toBe('Hardware → Network');
  });

  it('still reports unknown when neither the id nor its alias resolves', () => {
    expect(formatCategoryLabel(record({ category_id: 'nowhere' }), [PARENT, CHILD], {})).toBe('Unknown Category');
  });
});
