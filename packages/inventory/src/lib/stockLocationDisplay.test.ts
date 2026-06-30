import { describe, expect, it } from 'vitest';

import { formatOnHand, isLocationOccupied } from './stockLocationDisplay';

describe('stock location occupancy display', () => {
  describe('isLocationOccupied (gates Deactivate)', () => {
    it('is false for an empty or count-less location', () => {
      expect(isLocationOccupied({ on_hand_qty: 0, unit_count: 0 })).toBe(false);
      expect(isLocationOccupied({})).toBe(false);
    });
    it('is true when bulk stock or serialized units are present', () => {
      expect(isLocationOccupied({ on_hand_qty: 5, unit_count: 0 })).toBe(true);
      expect(isLocationOccupied({ on_hand_qty: 0, unit_count: 3 })).toBe(true);
      expect(isLocationOccupied({ on_hand_qty: 5, unit_count: 3 })).toBe(true);
    });
  });

  describe('formatOnHand (the On hand column)', () => {
    it('reads Empty when nothing is on hand', () => {
      expect(formatOnHand({ on_hand_qty: 0, unit_count: 0 })).toBe('Empty');
      expect(formatOnHand({})).toBe('Empty');
    });
    it('shows the canonical on-hand total', () => {
      expect(formatOnHand({ on_hand_qty: 142, unit_count: 0 })).toBe('142');
    });
    it('does NOT add serialized units to the on-hand total (they are already in it)', () => {
      // 15 phones + 3 SSDs (serialized) + 4 cables (bulk) = 22 on hand; the 18 serialized units are
      // already counted in quantity_on_hand, so the cell must read "22", never "22 · 18 units".
      expect(formatOnHand({ on_hand_qty: 22, unit_count: 18 })).toBe('22');
    });
    it('surfaces units only when present but not on hand (allocated / in transit)', () => {
      expect(formatOnHand({ on_hand_qty: 0, unit_count: 1 })).toBe('1 unit');
      expect(formatOnHand({ on_hand_qty: 0, unit_count: 3 })).toBe('3 units');
    });
  });
});
