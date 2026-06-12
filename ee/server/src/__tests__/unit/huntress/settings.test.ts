import { describe, expect, it } from 'vitest';
import {
  parseHuntressSettings,
  isRoutingConfigComplete,
  prefillSeverityPriorityMap,
  isPollDue,
} from '@ee/lib/integrations/huntress/settings';

describe('parseHuntressSettings', () => {
  it('applies defaults to an empty object', () => {
    const s = parseHuntressSettings({});
    expect(s.pollIntervalMinutes).toBe(5);
    expect(s.backfillDays).toBe(7);
    expect(s.autoCloseTickets).toBe(false);
    expect(s.severityPriorityMap).toEqual({});
    expect(s.incidentCursor).toBeUndefined();
  });

  it('accepts a JSON string (jsonb may arrive serialized)', () => {
    const s = parseHuntressSettings(JSON.stringify({ pollIntervalMinutes: 10 }));
    expect(s.pollIntervalMinutes).toBe(10);
  });

  it('tolerates null/undefined/garbage', () => {
    expect(parseHuntressSettings(null).pollIntervalMinutes).toBe(5);
    expect(parseHuntressSettings(undefined).backfillDays).toBe(7);
    expect(parseHuntressSettings('not json').autoCloseTickets).toBe(false);
  });

  it('clamps pollIntervalMinutes to [1, 60] and backfillDays to [1, 30]', () => {
    expect(parseHuntressSettings({ pollIntervalMinutes: 0 }).pollIntervalMinutes).toBe(1);
    expect(parseHuntressSettings({ pollIntervalMinutes: 999 }).pollIntervalMinutes).toBe(60);
    expect(parseHuntressSettings({ backfillDays: 0 }).backfillDays).toBe(1);
    expect(parseHuntressSettings({ backfillDays: 90 }).backfillDays).toBe(30);
  });

  it('preserves configured routing fields', () => {
    const s = parseHuntressSettings({
      boardId: 'b1',
      fallbackClientId: 'c1',
      fallbackBoardId: 'b2',
      severityPriorityMap: { critical: 'p1', high: 'p2', low: 'p3' },
      autoCloseTickets: true,
      closedStatusId: 's1',
      accountSubdomain: 'acme',
      incidentCursor: '2026-06-01T00:00:00Z',
    });
    expect(s.boardId).toBe('b1');
    expect(s.fallbackClientId).toBe('c1');
    expect(s.fallbackBoardId).toBe('b2');
    expect(s.severityPriorityMap.critical).toBe('p1');
    expect(s.autoCloseTickets).toBe(true);
    expect(s.closedStatusId).toBe('s1');
    expect(s.accountSubdomain).toBe('acme');
    expect(s.incidentCursor).toBe('2026-06-01T00:00:00Z');
  });
});

describe('isRoutingConfigComplete', () => {
  const complete = parseHuntressSettings({
    boardId: 'b1',
    fallbackClientId: 'c1',
    fallbackBoardId: 'b2',
    severityPriorityMap: { critical: 'p1', high: 'p2', low: 'p3' },
  });

  it('true when board, fallback client/board, and all three severities are set', () => {
    expect(isRoutingConfigComplete(complete)).toBe(true);
  });

  it('false when any required piece is missing', () => {
    expect(isRoutingConfigComplete({ ...complete, boardId: undefined })).toBe(false);
    expect(isRoutingConfigComplete({ ...complete, fallbackClientId: undefined })).toBe(false);
    expect(isRoutingConfigComplete({ ...complete, fallbackBoardId: undefined })).toBe(false);
    expect(
      isRoutingConfigComplete({ ...complete, severityPriorityMap: { critical: 'p1', high: 'p2' } })
    ).toBe(false);
  });
});

describe('prefillSeverityPriorityMap', () => {
  it('matches by name, case-insensitively, with preference order', () => {
    const priorities = [
      { priority_id: 'p-med', priority_name: 'Medium' },
      { priority_id: 'p-high', priority_name: 'HIGH' },
      { priority_id: 'p-crit', priority_name: 'Critical' },
    ];
    const map = prefillSeverityPriorityMap(priorities);
    expect(map).toEqual({ critical: 'p-crit', high: 'p-high', low: 'p-med' });
  });

  it('prefers Urgent for critical when Critical is absent', () => {
    const map = prefillSeverityPriorityMap([
      { priority_id: 'p-urg', priority_name: 'Urgent' },
    ]);
    expect(map.critical).toBe('p-urg');
  });

  it('leaves severities unset when nothing matches', () => {
    const map = prefillSeverityPriorityMap([{ priority_id: 'x', priority_name: 'Weird' }]);
    expect(map).toEqual({});
  });
});

describe('isPollDue', () => {
  const now = new Date('2026-06-09T12:00:00Z');

  it('true when never synced', () => {
    expect(isPollDue(null, 5, now)).toBe(true);
    expect(isPollDue(undefined, 5, now)).toBe(true);
  });

  it('true when the interval has elapsed', () => {
    expect(isPollDue('2026-06-09T11:54:59Z', 5, now)).toBe(true);
  });

  it('false when within the interval', () => {
    expect(isPollDue('2026-06-09T11:58:00Z', 5, now)).toBe(false);
  });

  it('accepts Date input for lastSyncAt', () => {
    expect(isPollDue(new Date('2026-06-09T11:00:00Z'), 5, now)).toBe(true);
  });
});
