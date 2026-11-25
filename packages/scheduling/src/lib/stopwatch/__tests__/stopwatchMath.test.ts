import { describe, expect, it } from 'vitest';
import { activeMs, clockOffset, firstStart, isRunning, toEntryPlan, toEntrySpan } from '../stopwatchMath';
import { zonedWorkDayCalendar } from '../../timeEntryPeriodSelection';

const t = (iso: string) => iso;
const MIN = 60_000;

describe('stopwatchMath', () => {
  const paused = [
    { started_at: t('2026-10-10T09:00:20Z'), ended_at: t('2026-10-10T09:30:20Z') },
    { started_at: t('2026-10-10T10:30:00Z'), ended_at: t('2026-10-10T11:00:00Z') },
  ];

  it('sums closed segments across pause/resume', () => {
    expect(activeMs(paused, new Date('2026-10-10T12:00:00Z'))).toBe(60 * MIN);
    expect(isRunning(paused)).toBe(false);
  });

  it('adds the open segment up to now and tolerates Date and ISO inputs', () => {
    const segs = [
      { started_at: new Date('2026-10-10T09:00:00Z'), ended_at: '2026-10-10T09:10:00Z' },
      { started_at: '2026-10-10T09:20:00Z', ended_at: null },
    ];
    expect(activeMs(segs, new Date('2026-10-10T09:25:00Z'))).toBe(15 * MIN);
    expect(isRunning(segs)).toBe(true);
  });

  it('is unaffected by how long the process slept: depends only on now', () => {
    const segs = [{ started_at: '2026-10-10T09:00:00Z', ended_at: null }];
    expect(activeMs(segs, '2026-10-10T09:10:00Z')).toBe(10 * MIN);
    expect(activeMs(segs, '2026-10-10T09:40:00Z')).toBe(40 * MIN);
  });

  it('ignores negative/inverted segments and handles no segments', () => {
    expect(activeMs([], Date.now())).toBe(0);
    expect(activeMs([{ started_at: '2026-10-10T09:10:00Z', ended_at: '2026-10-10T09:00:00Z' }], 0)).toBe(0);
    expect(firstStart([])).toBeNull();
  });

  it('firstStart returns the earliest start regardless of order', () => {
    expect(firstStart([...paused].reverse())?.toISOString()).toBe('2026-10-10T09:00:20.000Z');
  });

  it('toEntrySpan anchors start on the first start truncated to the minute and keeps start/end/duration consistent', () => {
    const span = toEntrySpan(paused, new Date('2026-10-10T12:00:00Z'));
    expect(span.start.toISOString()).toBe('2026-10-10T09:00:00.000Z');
    expect(span.billableMinutes).toBe(60);
    expect(span.end.getTime() - span.start.getTime()).toBe(span.billableMinutes * MIN);
    expect(span.segmentCount).toBe(2);
    // wall clock 09:00:20 -> 11:00:00 = 119m40s, active 60m -> paused 59m40s
    expect(span.pausedMs).toBe(59 * MIN + 40_000);
  });

  it('rounds to the nearest minute (29s down, 30s up)', () => {
    const down = toEntrySpan([{ started_at: '2026-10-10T09:00:00Z', ended_at: '2026-10-10T09:05:29Z' }], 0);
    const up = toEntrySpan([{ started_at: '2026-10-10T09:00:00Z', ended_at: '2026-10-10T09:05:30Z' }], 0);
    expect(down.billableMinutes).toBe(5);
    expect(up.billableMinutes).toBe(6);
  });

  it('floors at one minute, including a zero-length session', () => {
    const tiny = toEntrySpan([{ started_at: '2026-10-10T09:00:10Z', ended_at: '2026-10-10T09:00:20Z' }], 0);
    expect(tiny.billableMinutes).toBe(1);
    expect(tiny.end.getTime() - tiny.start.getTime()).toBe(MIN);
    const zero = toEntrySpan([{ started_at: '2026-10-10T09:00:10Z', ended_at: '2026-10-10T09:00:10Z' }], 0);
    expect(zero.billableMinutes).toBe(1);
    expect(zero.pausedMs).toBe(0);
  });

  it('uses now for an open segment', () => {
    const span = toEntrySpan([{ started_at: '2026-10-10T09:00:30Z', ended_at: null }], new Date('2026-10-10T09:45:30Z'));
    expect(span.start.toISOString()).toBe('2026-10-10T09:00:00.000Z');
    expect(span.billableMinutes).toBe(45);
    expect(span.pausedMs).toBe(0);
  });

  it('recomputing minutes from the span (as the entry form does) equals billableMinutes', () => {
    const span = toEntrySpan(paused, new Date('2026-10-10T12:00:00Z'));
    expect(Math.round((span.end.getTime() - span.start.getTime()) / MIN)).toBe(span.billableMinutes);
  });

  it('clockOffset is serverNow minus receivedAt and works with mixed input types', () => {
    expect(clockOffset('2026-10-10T09:00:05Z', new Date('2026-10-10T09:00:00Z'))).toBe(5000);
    expect(clockOffset(1000, 4000)).toBe(-3000);
  });
});

describe('toEntryPlan (America/New_York calendar)', () => {
  const calendar = zonedWorkDayCalendar('America/New_York');
  const NOW = Date.parse('2026-12-01T00:00:00Z');
  const seg = (a: string, b: string | null) => ({ started_at: a, ended_at: b });
  const iso = (d: Date) => d.toISOString();

  it('single segment within one day matches toEntrySpan', () => {
    const segments = [seg('2026-10-28T14:00:20Z', '2026-10-28T15:30:50Z')];
    const plan = toEntryPlan(segments, NOW, calendar);
    const span = toEntrySpan(segments, NOW);
    expect(plan).toHaveLength(1);
    expect(plan[0].workDate).toBe('2026-10-28');
    expect(iso(plan[0].start)).toBe(iso(span.start));
    expect(iso(plan[0].end)).toBe(iso(span.end));
    expect(plan[0].minutes).toBe(span.billableMinutes);
  });

  it('multi-segment in one day: first start, active minutes, pause not booked', () => {
    const segments = [
      seg('2026-10-28T14:00:20Z', '2026-10-28T14:30:20Z'),
      seg('2026-10-28T16:30:00Z', '2026-10-28T17:00:00Z'),
    ];
    const plan = toEntryPlan(segments, NOW, calendar);
    expect(plan).toHaveLength(1);
    expect(plan[0].minutes).toBe(60);
    expect(plan[0].segmentCount).toBe(2);
    expect(iso(plan[0].start)).toBe('2026-10-28T14:00:00.000Z');
    expect(iso(plan[0].end)).toBe('2026-10-28T15:00:00.000Z');
    const span = toEntrySpan(segments, NOW);
    expect(iso(plan[0].end)).toBe(iso(span.end));
  });

  it('cuts a segment through midnight: earlier day capped at 23:59, later starts 00:00', () => {
    // 22:30 EDT -> 01:30 EDT next day
    const segments = [seg('2026-10-29T02:30:00Z', '2026-10-29T05:30:00Z')];
    const plan = toEntryPlan(segments, NOW, calendar);
    expect(plan.map((p) => p.workDate)).toEqual(['2026-10-28', '2026-10-29']);
    expect(iso(plan[0].start)).toBe('2026-10-29T02:30:00.000Z');
    expect(iso(plan[0].end)).toBe('2026-10-29T03:59:00.000Z'); // 23:59 EDT
    expect(plan[0].minutes).toBe(89);
    expect(iso(plan[1].start)).toBe('2026-10-29T04:00:00.000Z'); // 00:00 EDT
    expect(plan[1].minutes).toBe(90);
    const total = plan.reduce((n, p) => n + p.minutes, 0);
    expect(Math.abs(total - 180)).toBeLessThanOrEqual(1);
  });

  it('Joymode shape: 7:06 PM start, 2 segments, 12h34m active, 128h15m paused', () => {
    const segments = [
      seg('2026-10-28T23:06:00Z', '2026-10-29T05:06:00Z'), // 7:06 PM -> 1:06 AM EDT
      seg('2026-11-03T13:21:00Z', '2026-11-03T19:55:00Z'), // 8:21 AM -> 2:55 PM EST
    ];
    expect(activeMs(segments, NOW)).toBe((12 * 60 + 34) * MIN);
    const plan = toEntryPlan(segments, NOW, calendar);
    expect(plan.map((p) => p.workDate)).toEqual(['2026-10-28', '2026-10-29', '2026-11-03']);
    expect(plan.map((p) => p.minutes)).toEqual([293, 66, 394]);
    const total = plan.reduce((n, p) => n + p.minutes, 0);
    expect(Math.abs(total - 754)).toBeLessThanOrEqual(plan.length);
    // No day lies between 10/29 and 11/03: the 128h pause books nothing.
    expect(plan.some((p) => p.workDate > '2026-10-29' && p.workDate < '2026-11-03')).toBe(false);
  });

  it('ignores zero-length and inverted segments; drops sub-30s days', () => {
    const segments = [
      seg('2026-10-28T14:00:00Z', '2026-10-28T14:00:00Z'),
      seg('2026-10-28T15:00:00Z', '2026-10-28T14:00:00Z'),
      seg('2026-10-28T16:00:00Z', '2026-10-28T16:10:00Z'),
      seg('2026-10-30T16:00:00Z', '2026-10-30T16:00:20Z'),
    ];
    const plan = toEntryPlan(segments, NOW, calendar);
    expect(plan).toHaveLength(1);
    expect(plan[0].workDate).toBe('2026-10-28');
    expect(plan[0].minutes).toBe(10);
  });

  it('an all-tiny session yields a single 1-minute item on the first day', () => {
    const plan = toEntryPlan(
      [seg('2026-10-28T16:00:05Z', '2026-10-28T16:00:15Z'), seg('2026-10-29T16:00:00Z', '2026-10-29T16:00:10Z')],
      NOW,
      calendar,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].minutes).toBe(1);
    expect(plan[0].workDate).toBe('2026-10-28');
    expect(iso(plan[0].end)).toBe('2026-10-28T16:01:00.000Z');
    expect(toEntryPlan([], NOW, calendar)).toHaveLength(1);
  });

  it('closes an open segment at now', () => {
    const now = Date.parse('2026-10-28T15:00:00Z');
    const plan = toEntryPlan([seg('2026-10-28T14:00:00Z', null)], now, calendar);
    expect(plan).toHaveLength(1);
    expect(plan[0].minutes).toBe(60);
  });

  it('DST spring-forward: books real elapsed time on a 23h day', () => {
    // 00:30 EST -> 05:30 EDT on 2026-03-08 (4h elapsed)
    const one = toEntryPlan([seg('2026-03-08T05:30:00Z', '2026-03-08T09:30:00Z')], NOW, calendar);
    expect(one).toHaveLength(1);
    expect(one[0].minutes).toBe(240);
    // 22:00 EST 3/7 -> 06:00 EDT 3/8: midnight is 05:00Z, 7h elapsed overall
    const two = toEntryPlan([seg('2026-03-08T03:00:00Z', '2026-03-08T10:00:00Z')], NOW, calendar);
    expect(two.map((p) => p.workDate)).toEqual(['2026-03-07', '2026-03-08']);
    expect(two[0].minutes).toBe(119);
    expect(two[1].minutes).toBe(300);
  });

  it('DST fall-back: books real elapsed time on a 25h day', () => {
    // 00:30 EDT -> 04:30 EST on 2026-11-01 (5h elapsed)
    const one = toEntryPlan([seg('2026-11-01T04:30:00Z', '2026-11-01T09:30:00Z')], NOW, calendar);
    expect(one).toHaveLength(1);
    expect(one[0].minutes).toBe(300);
    // 22:00 EST 11/1 -> 01:00 EST 11/2
    const two = toEntryPlan([seg('2026-11-02T03:00:00Z', '2026-11-02T06:00:00Z')], NOW, calendar);
    expect(two.map((p) => p.workDate)).toEqual(['2026-11-01', '2026-11-02']);
    expect(two.map((p) => p.minutes)).toEqual([119, 60]);
  });
});
