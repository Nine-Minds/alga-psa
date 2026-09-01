/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFormatters } from './client';

vi.unmock('@alga-psa/ui/lib/i18n/client');

const NOW = new Date('2026-08-29T16:00:00.000Z');

describe('useFormatters formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function formatOffset(offsetMs: number) {
    const { result } = renderHook(() => useFormatters());
    return result.current.formatRelativeTime(new Date(NOW.getTime() + offsetMs));
  }

  it.each([
    ['seconds', -(30 * 1000 + 999), '30 seconds ago'],
    ['minutes', -(5 * 60 * 1000 + 59 * 1000), '5 minutes ago'],
    ['hours', -(3 * 60 * 60 * 1000 + 59 * 60 * 1000), '3 hours ago'],
  ])('keeps recent-past %s in the matching unit', (_label, offsetMs, expected) => {
    expect(formatOffset(offsetMs)).toBe(expected);
  });

  it('stays in hours immediately below 24 hours in the past', () => {
    expect(formatOffset(-(24 * 60 * 60 * 1000 - 1))).toBe('23 hours ago');
  });

  it.each([
    ['at', -(24 * 60 * 60 * 1000)],
    ['above', -(24 * 60 * 60 * 1000 + 59 * 60 * 1000)],
  ])('uses yesterday %s the 24-hour past boundary', (_label, offsetMs) => {
    expect(formatOffset(offsetMs)).toBe('yesterday');
  });

  it.each([
    ['seconds', 30 * 1000 + 999, 'in 30 seconds'],
    ['minutes', 5 * 60 * 1000 + 59 * 1000, 'in 5 minutes'],
    ['hours', 3 * 60 * 60 * 1000 + 59 * 60 * 1000, 'in 3 hours'],
    ['immediately below 24 hours', 24 * 60 * 60 * 1000 - 1, 'in 23 hours'],
    ['at 24 hours', 24 * 60 * 60 * 1000, 'tomorrow'],
  ])('preserves future %s behavior', (_label, offsetMs, expected) => {
    expect(formatOffset(offsetMs)).toBe(expected);
  });
});
