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
    it('shows bulk quantity alone', () => {
      expect(formatOnHand({ on_hand_qty: 142, unit_count: 0 })).toBe('142');
    });
    it('shows serialized units alone, singular vs plural', () => {
      expect(formatOnHand({ on_hand_qty: 0, unit_count: 1 })).toBe('1 unit');
      expect(formatOnHand({ on_hand_qty: 0, unit_count: 12 })).toBe('12 units');
    });
    it('shows both, separated', () => {
      expect(formatOnHand({ on_hand_qty: 142, unit_count: 12 })).toBe('142 · 12 units');
    });
  });
});
