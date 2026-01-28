import { describe, expect, it } from 'vitest';
import { clampDuration } from './durationHelpers';

describe('clampDuration', () => {
  it('treats empty input as zero', () => {
    expect(clampDuration('', '')).toEqual({ hours: 0, minutes: 0, totalMinutes: 0 });
  });

  it('calculates total minutes for valid inputs', () => {
    expect(clampDuration('2', '30')).toEqual({ hours: 2, minutes: 30, totalMinutes: 150 });
  });

  it('clamps out-of-range hours to 24', () => {
    expect(clampDuration('25', '30')).toEqual({ hours: 24, minutes: 0, totalMinutes: 1440 });
  });

  it('forces minutes to 0 when hours equals 24', () => {
    expect(clampDuration('24', '59')).toEqual({ hours: 24, minutes: 0, totalMinutes: 1440 });
  });

  it('clamps out-of-range minutes to 59', () => {
    expect(clampDuration('2', '61')).toEqual({ hours: 2, minutes: 59, totalMinutes: 179 });
  });

  it('clamps negative inputs to zero', () => {
    expect(clampDuration('-3', '-5')).toEqual({ hours: 0, minutes: 0, totalMinutes: 0 });
  });

  it('handles non-numeric hour input', () => {
    expect(clampDuration('abc', '5')).toEqual({ hours: 0, minutes: 5, totalMinutes: 5 });
  });
});
