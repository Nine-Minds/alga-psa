import { describe, expect, it } from 'vitest';

import { formatStock, formatStockSummary, isLocationOccupied } from './stockLocationDisplay';

describe('stock location occupancy display', () => {
  describe('isLocationOccupied (gates Deactivate)', () => {
    it('is false for an empty / count-less location', () => {
      expect(isLocationOccupied({ item_type_count: 0, on_hand_qty: 0, unit_count: 0 })).toBe(false);
      expect(isLocationOccupied({})).toBe(false);
    });
    it('is true when products are on hand or serialized units are present', () => {
      expect(isLocationOccupied({ item_type_count: 3 })).toBe(true);
      expect(isLocationOccupied({ unit_count: 2 })).toBe(true); // allocated / in transit, none on hand
    });
  });

  describe('formatStock (the Stock column = distinct product types)', () => {
    it('reads Empty when nothing is stocked', () => {
      expect(formatStock({ item_type_count: 0, on_hand_qty: 0, unit_count: 0 })).toBe('Empty');
      expect(formatStock({})).toBe('Empty');
    });
    it('counts distinct products, not pieces — 15 phones + 3 SSDs + 4 cables = 3 products', () => {
      expect(formatStock({ item_type_count: 3, on_hand_qty: 22, unit_count: 18 })).toBe('3 products');
    });
    it('stays legible at scale (does not enumerate)', () => {
      expect(formatStock({ item_type_count: 1 })).toBe('1 product');
      expect(formatStock({ item_type_count: 750 })).toBe('750 products');
    });
    it('surfaces units only when present but not on hand (allocated / in transit)', () => {
      expect(formatStock({ item_type_count: 0, on_hand_qty: 0, unit_count: 1 })).toBe('1 unit');
      expect(formatStock({ item_type_count: 0, on_hand_qty: 0, unit_count: 3 })).toBe('3 units');
    });
  });

  describe('formatStockSummary (the drill-in header)', () => {
    it('pairs the type count with the coarse piece total', () => {
      expect(formatStockSummary({ item_type_count: 3, on_hand_qty: 22 })).toBe('3 products · 22 on hand');
      expect(formatStockSummary({ item_type_count: 1, on_hand_qty: 5 })).toBe('1 product · 5 on hand');
    });
    it('reads Nothing on hand when empty', () => {
      expect(formatStockSummary({ item_type_count: 0, on_hand_qty: 0 })).toBe('Nothing on hand');
    });
  });
});
