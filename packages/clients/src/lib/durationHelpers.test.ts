import { describe, expect, it } from 'vitest';
import { clampDuration } from './durationHelpers';

describe('clampDuration', () => {
  it('treats empty input as zero', () => {
    expect(clampDuration('', '')).toEqual({ hours: 0, minutes: 0, totalMinutes: 0 });
  });

  it('calculates total minutes for valid inputs', () => {
    expect(clampDuration('2', '30')).toEqual({ hours: 2, minutes: 30, totalMinutes: 150 });
  });

  it('clamps out-of-range inputs', () => {
    expect(clampDuration('25', '61')).toEqual({ hours: 24, minutes: 59, totalMinutes: 1499 });
  });

  it('clamps negative inputs to zero', () => {
    expect(clampDuration('-3', '-5')).toEqual({ hours: 0, minutes: 0, totalMinutes: 0 });
  });

  it('handles non-numeric hour input', () => {
    expect(clampDuration('abc', '5')).toEqual({ hours: 0, minutes: 5, totalMinutes: 5 });
  });
});
