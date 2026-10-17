import { describe, expect, it } from 'vitest';
import { activeMs, clockOffset, firstStart, isRunning, toEntrySpan } from '../stopwatchMath';

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
