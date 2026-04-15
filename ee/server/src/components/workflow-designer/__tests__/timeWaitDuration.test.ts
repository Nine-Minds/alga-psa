import { describe, expect, it } from 'vitest';

import {
  composeTimeWaitDurationMs,
  decomposeTimeWaitDurationMs,
  formatTimeWaitDuration,
  parseTimeWaitDurationPart,
} from '../timeWaitDuration';

describe('timeWaitDuration helpers', () => {
  it('composes fixed units into milliseconds', () => {
    expect(composeTimeWaitDurationMs({ days: 1, hours: 2, minutes: 3, seconds: 4 })).toBe(93_784_000);
  });

  it('decomposes milliseconds into fixed units', () => {
    expect(decomposeTimeWaitDurationMs(93_784_000)).toEqual({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
    });
  });

  it('rounds sub-second remainders up to whole seconds for editor fields', () => {
    expect(decomposeTimeWaitDurationMs(1_500)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 2,
    });
  });

  it('formats duration summaries readably', () => {
    expect(formatTimeWaitDuration(93_784_000)).toBe('1d 2h 3m 4s');
    expect(formatTimeWaitDuration(1_500)).toBe('1.5s');
  });

  it('parses positive integer duration parts', () => {
    expect(parseTimeWaitDurationPart('12.9')).toBe(12);
    expect(parseTimeWaitDurationPart('')).toBe(0);
    expect(parseTimeWaitDurationPart('-3')).toBe(0);
  });
});
