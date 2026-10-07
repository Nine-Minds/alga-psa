import { describe, expect, it } from 'vitest';
import { buildFallbackBusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/businessDayCalendar';
import type { RecurrenceRule } from '@alga-psa/shared/lib/recurrence';
import { listCandidateOccurrences } from '../candidateOccurrences';

const TZ = 'America/New_York';
const monthlyOn1: RecurrenceRule = { frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 1 }, end: { type: 'never' } };
const weeklyMon: RecurrenceRule = { frequency: 'weekly', interval: 1, weekdays: ['mon'], end: { type: 'never' } };

// 2026-03-01 is a Sunday. EST until Mar 8 2026 (UTC-5), EDT after (UTC-4).
const base = {
  rule: monthlyOn1,
  startDate: '2026-01-01',
  createTime: '08:00',
  dueTime: '17:00',
  leadDays: 0,
  policy: 'keep' as const,
  calendar: null,
  timeZone: TZ,
};

const at = (iso: string) => new Date(iso);

describe('listCandidateOccurrences', () => {
  it("includes today's occurrence once its create time has passed and before it is due", () => {
    const result = listCandidateOccurrences({
      ...base,
      evaluatedThrough: at('2026-02-28T12:00:00Z'),
      now: at('2026-03-01T14:00:00Z'), // 09:00 EST
    });
    expect(result.map((c) => c.nominal)).toEqual(['2026-03-01']);
    expect(result[0].createAt.toISOString()).toBe('2026-03-01T13:00:00.000Z');
    expect(result[0].dueAt.toISOString()).toBe('2026-03-01T22:00:00.000Z');
  });

  it('excludes an occurrence whose create time is still in the future', () => {
    const result = listCandidateOccurrences({
      ...base,
      evaluatedThrough: at('2026-02-28T12:00:00Z'),
      now: at('2026-03-01T12:59:00Z'), // 07:59 EST
    });
    expect(result).toEqual([]);
  });

  it('is empty when the watermark is already past the due time (no backfill at activation)', () => {
    const result = listCandidateOccurrences({
      ...base,
      evaluatedThrough: at('2026-03-01T23:00:00Z'), // activated after 17:00 on the 1st
      now: at('2026-03-01T23:30:00Z'),
    });
    expect(result).toEqual([]);
  });

  it('returns every occurrence that fell due during an outage, oldest first', () => {
    const result = listCandidateOccurrences({
      ...base,
      rule: weeklyMon,
      startDate: '2026-01-05',
      evaluatedThrough: at('2026-03-01T00:00:00Z'),
      now: at('2026-03-17T12:00:00Z'),
    });
    expect(result.map((c) => c.nominal)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });

  it('with lead days, an occurrence becomes a candidate lead days before it is due', () => {
    const args = { ...base, leadDays: 3, evaluatedThrough: at('2026-03-01T00:00:00Z') };
    // due 2026-04-01 -> create 2026-03-29 08:00 EDT (12:00Z)
    expect(listCandidateOccurrences({ ...args, now: at('2026-03-29T11:59:00Z') }).map((c) => c.nominal)).toEqual(['2026-03-01']);
    const ready = listCandidateOccurrences({ ...args, now: at('2026-03-29T12:00:00Z') });
    expect(ready.map((c) => c.nominal)).toEqual(['2026-03-01', '2026-04-01']);
    expect(ready[1].createAt.toISOString()).toBe('2026-03-29T12:00:00.000Z');
  });

  it('keys on the nominal date when the policy moves the due date', () => {
    // Sunday 2026-03-01 -> next business day Monday 2026-03-02.
    const result = listCandidateOccurrences({
      ...base,
      policy: 'next',
      calendar: buildFallbackBusinessDayCalendar(),
      evaluatedThrough: at('2026-02-28T12:00:00Z'),
      now: at('2026-03-02T14:00:00Z'),
    });
    expect(result).toHaveLength(1);
    expect(result[0].nominal).toBe('2026-03-01');
    expect(result[0].due).toBe('2026-03-02');
    expect(result[0].dueAt.toISOString()).toBe('2026-03-02T22:00:00.000Z');
  });

  it('finds a date that a long holiday moves across the window edge', () => {
    // Nominal Sun 2026-03-01 is 3 days before the watermark's local date, but "next" moves it
    // past a Mon/Tue holiday to Wed 2026-03-04, which is still in the future of the watermark.
    const calendar = {
      ...buildFallbackBusinessDayCalendar(),
      isBusinessDay: (d: string) => !['2026-03-01', '2026-03-02', '2026-03-03', '2026-02-28'].includes(d),
    };
    const result = listCandidateOccurrences({
      ...base,
      policy: 'next',
      calendar,
      evaluatedThrough: at('2026-03-04T05:00:00Z'), // Wed 00:00 EST; local date 03-04 so pad of 2 would start at 03-02
      now: at('2026-03-04T14:00:00Z'),
    });
    expect(result.map((c) => [c.nominal, c.due])).toEqual([['2026-03-01', '2026-03-04']]);
  });

  it('throws when a non-keep policy has no calendar', () => {
    expect(() =>
      listCandidateOccurrences({
        ...base,
        policy: 'previous',
        calendar: null,
        evaluatedThrough: at('2026-02-28T12:00:00Z'),
        now: at('2026-03-02T14:00:00Z'),
      })
    ).toThrow(/calendar/i);
  });

  it('respects the rule end date', () => {
    const result = listCandidateOccurrences({
      ...base,
      rule: { ...monthlyOn1, end: { type: 'onDate', date: '2026-03-01' } },
      evaluatedThrough: at('2026-02-01T00:00:00Z'),
      now: at('2026-04-15T12:00:00Z'),
    });
    // 2026-02-01 is after the watermark; 2026-04-01 is past the rule's end date.
    expect(result.map((c) => c.nominal)).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('is independent of the process timezone', () => {
    const original = process.env.TZ;
    try {
      const run = () =>
        listCandidateOccurrences({
          ...base,
          evaluatedThrough: at('2026-02-28T12:00:00Z'),
          now: at('2026-03-01T14:00:00Z'),
        }).map((c) => [c.nominal, c.createAt.toISOString(), c.dueAt.toISOString()]);
      process.env.TZ = 'Pacific/Auckland';
      const auckland = run();
      process.env.TZ = 'UTC';
      expect(run()).toEqual(auckland);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
