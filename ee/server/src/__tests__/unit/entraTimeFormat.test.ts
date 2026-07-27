import { describe, expect, it } from 'vitest';
import {
  formatEntraExactTime,
  formatEntraRelativeTime,
} from '@ee/components/settings/integrations/entra/timeFormat';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const at = (iso: string) => formatEntraRelativeTime(iso, { now: NOW, locale: 'en-US' });

describe('formatEntraRelativeTime', () => {
  it('answers "how stale is this" without making the reader subtract dates', () => {
    expect(at('2026-07-26T11:59:40.000Z')).toBe('now');
    expect(at('2026-07-26T11:45:00.000Z')).toBe('15 minutes ago');
    expect(at('2026-07-26T09:00:00.000Z')).toBe('3 hours ago');
    expect(at('2026-07-24T12:00:00.000Z')).toBe('2 days ago');
  });

  it('falls back to a date once "N days ago" stops meaning anything', () => {
    expect(at('2026-05-02T12:00:00.000Z')).toBe('May 2, 2026');
  });

  it('has nothing to say about a client that never synced', () => {
    expect(at(null as unknown as string)).toBeNull();
    expect(at('not-a-date')).toBeNull();
    expect(formatEntraExactTime(null)).toBeNull();
  });

  it('keeps the precise timestamp available for the title attribute', () => {
    expect(formatEntraExactTime('2026-07-26T09:00:00.000Z', 'en-US')).toContain('2026');
  });
});
