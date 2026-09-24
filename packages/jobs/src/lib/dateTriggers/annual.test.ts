import { describe, expect, it } from 'vitest';
import { nextAnnualOccurrence } from './annual';

describe('nextAnnualOccurrence', () => {
  it('maps leap day anniversaries to February 28 in non-leap years', () => {
    expect(nextAnnualOccurrence('2020-02-29', '2025-02-28', '2025-02-28')).toEqual([
      { occursOn: '2025-02-28', yearsAsClient: 5 },
    ]);
    expect(nextAnnualOccurrence('2020-02-29', '2024-02-29', '2024-02-29')).toEqual([
      { occursOn: '2024-02-29', yearsAsClient: 4 },
    ]);
  });

  it('finds occurrences across a year boundary', () => {
    expect(nextAnnualOccurrence('2019-12-31', '2024-12-30', '2025-12-31')).toEqual([
      { occursOn: '2024-12-31', yearsAsClient: 5 },
      { occursOn: '2025-12-31', yearsAsClient: 6 },
    ]);
  });

  it('excludes the first-year date', () => {
    expect(nextAnnualOccurrence('2025-10-01', '2025-10-01', '2025-10-01')).toEqual([]);
  });
});
