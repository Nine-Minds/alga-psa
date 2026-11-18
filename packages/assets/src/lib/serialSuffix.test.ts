import { describe, expect, it } from 'vitest';
import { serialSuffixOf } from './ticketLinkedAssetLabels';

describe('T-suffix serialSuffixOf', () => {
  it('returns the last 4 characters only for serials of 8 or more', () => {
    expect(serialSuffixOf('ABCDEFGH')).toBe('EFGH');
    expect(serialSuffixOf('  PF2Z9K41X7  ')).toBe('41X7');
    expect(serialSuffixOf('ABCDEFG')).toBeNull();
    expect(serialSuffixOf('')).toBeNull();
    expect(serialSuffixOf(null)).toBeNull();
    expect(serialSuffixOf(undefined)).toBeNull();
  });

  it('never returns the whole serial', () => {
    for (const serial of ['12345678', 'x'.repeat(40)]) {
      expect(serialSuffixOf(serial)!.length).toBeLessThan(serial.length);
    }
  });
});
