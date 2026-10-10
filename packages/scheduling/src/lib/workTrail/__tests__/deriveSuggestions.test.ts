import { describe, expect, it } from 'vitest';
import { deriveSuggestions, type WorkTrailTouch } from '../deriveSuggestions';
import { suggestedEntryTimes, suggestionActivityKinds } from '../suggestionTimes';

const base = { openSessionTicketIds: [] as string[], loggedPairs: [], dismissals: [] };
const t = (ticket_id: string, occurred_at: string, event_type = 'TICKET_COMMENT_ADDED'): WorkTrailTouch => ({
  ticket_id, occurred_at, event_type, ticket_number: `T-${ticket_id}`, title: `Title ${ticket_id}`, client_name: 'Acme',
});

describe('deriveSuggestions', () => {
  it('groups touches per ticket and local day with first/last touch, count and distinct kinds', () => {
    const result = deriveSuggestions({
      ...base,
      timeZone: 'UTC',
      touches: [
        t('a', '2026-10-05T11:40:00Z', 'TICKET_STATUS_CHANGED'),
        t('a', '2026-10-05T09:12:00Z'),
        t('a', '2026-10-05T10:00:00Z'),
        t('a', '2026-10-06T08:00:00Z'),
        t('b', '2026-10-05T08:00:00Z'),
      ],
    });
    expect(result.map((s) => [s.ticket_id, s.work_date])).toEqual([
      ['b', '2026-10-05'], ['a', '2026-10-05'], ['a', '2026-10-06'],
    ]);
    const a = result.find((s) => s.ticket_id === 'a' && s.work_date === '2026-10-05')!;
    expect(a.first_touch).toBe('2026-10-05T09:12:00.000Z');
    expect(a.last_touch).toBe('2026-10-05T11:40:00.000Z');
    expect(a.time_zone).toBe('UTC');
    expect(a.event_count).toBe(3);
    expect(a.event_kinds).toEqual(['TICKET_STATUS_CHANGED', 'TICKET_COMMENT_ADDED']);
    expect(a).toMatchObject({ ticket_number: 'T-a', title: 'Title a', client_name: 'Acme' });
  });

  it('assigns work dates in the user timezone across the midnight boundary', () => {
    const touches = [t('a', '2026-10-06T03:30:00Z'), t('a', '2026-10-06T08:00:00Z')];
    // New York is UTC-4 in October: 03:30Z is still Oct 5 locally.
    const ny = deriveSuggestions({ ...base, timeZone: 'America/New_York', touches });
    expect(ny.map((s) => [s.work_date, s.event_count])).toEqual([['2026-10-05', 1], ['2026-10-06', 1]]);
    const utc = deriveSuggestions({ ...base, timeZone: 'UTC', touches });
    expect(utc.map((s) => [s.work_date, s.event_count])).toEqual([['2026-10-06', 2]]);
    // Unknown zones fall back to UTC like computeWorkDateFields.
    expect(deriveSuggestions({ ...base, timeZone: 'Nope/Zone', touches })).toHaveLength(1);
  });

  it('suppresses a ticket-day that already has a logged entry (other days stay)', () => {
    const result = deriveSuggestions({
      ...base,
      timeZone: 'UTC',
      loggedPairs: [{ ticket_id: 'a', work_date: '2026-10-05' }],
      touches: [t('a', '2026-10-05T09:00:00Z'), t('a', '2026-10-06T09:00:00Z')],
    });
    expect(result.map((s) => s.work_date)).toEqual(['2026-10-06']);
  });

  it('suppresses tickets with an open stopwatch session', () => {
    const result = deriveSuggestions({
      ...base,
      timeZone: 'UTC',
      openSessionTicketIds: ['a'],
      touches: [t('a', '2026-10-05T09:00:00Z'), t('b', '2026-10-05T09:00:00Z')],
    });
    expect(result.map((s) => s.ticket_id)).toEqual(['b']);
  });

  it('suppresses dismissed ticket-days even when later activity arrives', () => {
    const result = deriveSuggestions({
      ...base,
      timeZone: 'UTC',
      dismissals: [{ ticket_id: 'a', work_date: '2026-10-05' }],
      touches: [t('a', '2026-10-05T09:00:00Z'), t('a', '2026-10-05T17:00:00Z')],
    });
    expect(result).toEqual([]);
  });
});

describe('suggestedEntryTimes', () => {
  it('rounds the start down and the end up to 5 minutes', () => {
    const { start, end } = suggestedEntryTimes({ first_touch: '2026-10-05T09:12:30Z', last_touch: '2026-10-05T11:41:00Z' });
    expect(start.toISOString()).toBe('2026-10-05T09:10:00.000Z');
    expect(end.toISOString()).toBe('2026-10-05T11:45:00.000Z');
  });

  it('guarantees at least 15 minutes', () => {
    const { start, end } = suggestedEntryTimes({ first_touch: '2026-10-05T09:12:00Z', last_touch: '2026-10-05T09:12:00Z' });
    expect(end.getTime() - start.getTime()).toBe(15 * 60 * 1000);
  });
});

describe('suggestionActivityKinds', () => {
  it('collapses related events and keeps first-seen order', () => {
    expect(suggestionActivityKinds(['TICKET_COMMENT_ADDED', 'TICKET_CLOSED', 'TICKET_STATUS_CHANGED', 'TICKET_CUSTOM_X']))
      .toEqual(['commented', 'statusChanged', 'updated']);
  });
});
