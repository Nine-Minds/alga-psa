import { describe, expect, it } from 'vitest';
import { calculateItilPriority, ItilLabels } from '../priorityMatrix';

/**
 * T002 — F002: the Impact × Urgency matrix, now the single copy in `shared/lib/itil`.
 * The expected grid is written out in full so a change to the matrix has to be deliberate.
 */
const EXPECTED: Record<number, number[]> = {
  // impact: [urgency 1, 2, 3, 4, 5]
  1: [1, 2, 2, 3, 3],
  2: [2, 2, 3, 3, 4],
  3: [2, 3, 3, 4, 4],
  4: [3, 3, 4, 4, 5],
  5: [3, 4, 4, 5, 5],
};

describe('ITIL Impact × Urgency matrix', () => {
  it('T002: returns the expected level for all 25 pairs', () => {
    const seen: Array<[number, number, number]> = [];
    for (let impact = 1; impact <= 5; impact += 1) {
      for (let urgency = 1; urgency <= 5; urgency += 1) {
        const level = calculateItilPriority(impact, urgency);
        seen.push([impact, urgency, level]);
        expect(level, `impact ${impact} × urgency ${urgency}`).toBe(EXPECTED[impact][urgency - 1]);
      }
    }
    expect(seen).toHaveLength(25);
  });

  it('T002: rejects values outside 1 to 5', () => {
    for (const [impact, urgency] of [
      [0, 3],
      [6, 3],
      [3, 0],
      [3, 6],
      [-1, -1],
      [2.5, 3],
      [Number.NaN, 3],
    ]) {
      expect(() => calculateItilPriority(impact, urgency)).toThrow(/between 1 and 5/);
    }
  });

  it('T002: labels cover every level of all three scales', () => {
    for (const scale of ['impact', 'urgency', 'priority'] as const) {
      expect(Object.keys(ItilLabels[scale])).toEqual(['1', '2', '3', '4', '5']);
    }
  });
});
