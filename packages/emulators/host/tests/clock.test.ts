import { describe, expect, it } from 'vitest';
import { parseDuration, seededRng, VirtualClock } from '../src/clock';

describe('parseDuration', () => {
  it('parses single units', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('32d')).toBe(32 * 86_400_000);
    expect(parseDuration('1w')).toBe(604_800_000);
  });

  it('parses compound durations', () => {
    expect(parseDuration('4h30m')).toBe(4 * 3_600_000 + 30 * 60_000);
    expect(parseDuration('1d12h')).toBe(86_400_000 + 12 * 3_600_000);
  });

  it('rejects garbage', () => {
    expect(() => parseDuration('')).toThrow(/Invalid duration/);
    expect(() => parseDuration('32')).toThrow(/Invalid duration/);
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
    expect(() => parseDuration('4h30')).toThrow(/Invalid duration/);
  });
});

describe('VirtualClock', () => {
  it('advances by duration strings and numbers', () => {
    const clock = new VirtualClock();
    const before = clock.now().getTime();
    clock.advance('32d');
    clock.advance(1_000);
    const after = clock.now().getTime();
    expect(clock.offset).toBe(32 * 86_400_000 + 1_000);
    expect(after - before).toBeGreaterThanOrEqual(32 * 86_400_000 + 1_000);
  });

  it('refuses to go backward', () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow(/forward/);
  });
});

describe('seededRng', () => {
  it('is deterministic per seed', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const c = seededRng(43);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual([c(), c(), c()]);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
