import { describe, it, expect } from 'vitest';
import {
  laneForEntryType,
  sortTimelineNodes,
  laneCounts,
  filterByLane,
  dayLabel,
  withDayBreaks,
  type Lane,
} from './timelineHelpers';

const node = (occurredAt: string, sortId: string, lane: Lane) => ({ occurredAt, sortId, lane });

describe('laneForEntryType', () => {
  it('maps each unified-timeline entry type to a display lane', () => {
    expect(laneForEntryType('comment')).toBe('reply');
    expect(laneForEntryType('time_entry')).toBe('time');
    expect(laneForEntryType('alert')).toBe('alert');
    expect(laneForEntryType('activity')).toBe('system');
  });
});

describe('sortTimelineNodes', () => {
  it('orders ascending by timestamp', () => {
    const nodes = [
      node('2026-06-03T10:00:00Z', 'c', 'system'),
      node('2026-06-01T10:00:00Z', 'a', 'reply'),
      node('2026-06-02T10:00:00Z', 'b', 'time'),
    ];
    expect(sortTimelineNodes(nodes, 'asc').map((n) => n.sortId)).toEqual(['a', 'b', 'c']);
  });

  it('orders descending by timestamp', () => {
    const nodes = [
      node('2026-06-01T10:00:00Z', 'a', 'reply'),
      node('2026-06-03T10:00:00Z', 'c', 'system'),
      node('2026-06-02T10:00:00Z', 'b', 'time'),
    ];
    expect(sortTimelineNodes(nodes, 'desc').map((n) => n.sortId)).toEqual(['c', 'b', 'a']);
  });

  it('breaks ties on identical timestamps deterministically by sortId', () => {
    const same = '2026-06-01T10:00:00Z';
    const nodes = [
      node(same, 'y', 'reply'),
      node(same, 'x', 'time'),
      node(same, 'z', 'system'),
    ];
    // asc: sortId ascending; desc: sortId descending — mirrors the shared builder.
    expect(sortTimelineNodes(nodes, 'asc').map((n) => n.sortId)).toEqual(['x', 'y', 'z']);
    expect(sortTimelineNodes(nodes, 'desc').map((n) => n.sortId)).toEqual(['z', 'y', 'x']);
  });

  it('does not mutate the input array', () => {
    const nodes = [node('2026-06-02T10:00:00Z', 'b', 'time'), node('2026-06-01T10:00:00Z', 'a', 'reply')];
    const snapshot = nodes.map((n) => n.sortId);
    sortTimelineNodes(nodes, 'asc');
    expect(nodes.map((n) => n.sortId)).toEqual(snapshot);
  });
});

describe('laneCounts and filterByLane', () => {
  const nodes = [
    node('2026-06-01T10:00:00Z', 'a', 'reply'),
    node('2026-06-01T11:00:00Z', 'b', 'reply'),
    node('2026-06-01T12:00:00Z', 'c', 'time'),
    node('2026-06-01T13:00:00Z', 'd', 'system'),
  ];

  it('counts nodes per lane', () => {
    expect(laneCounts(nodes)).toEqual({ reply: 2, time: 1, system: 1, alert: 0 });
  });

  it('passes everything through for the everything filter', () => {
    expect(filterByLane(nodes, 'everything')).toHaveLength(4);
  });

  it('reduces to a single lane without refetching', () => {
    expect(filterByLane(nodes, 'reply').map((n) => n.sortId)).toEqual(['a', 'b']);
    expect(filterByLane(nodes, 'time').map((n) => n.sortId)).toEqual(['c']);
    expect(filterByLane(nodes, 'alert')).toEqual([]);
  });
});

describe('dayLabel', () => {
  const now = new Date('2026-06-20T12:00:00Z');

  it('labels the current calendar day as Today', () => {
    expect(dayLabel('2026-06-20T08:00:00Z', now)).toBe('Today');
  });

  it('labels a same-year day without the year', () => {
    expect(dayLabel('2026-06-09T08:00:00Z', now)).toBe('Jun 9');
  });

  it('includes the year for a different year', () => {
    expect(dayLabel('2025-12-31T08:00:00Z', now)).toContain('2025');
  });

  it('returns the raw input for an unparseable value', () => {
    expect(dayLabel('not-a-date', now)).toBe('not-a-date');
  });
});

describe('withDayBreaks', () => {
  const now = new Date('2026-06-20T12:00:00Z');

  it('marks a day break only when the calendar day changes', () => {
    const nodes = [
      node('2026-06-09T09:00:00Z', 'a', 'reply'),
      node('2026-06-09T15:00:00Z', 'b', 'time'), // same day → no break
      node('2026-06-20T09:00:00Z', 'c', 'system'), // today → break
    ];
    const result = withDayBreaks(nodes, now);
    expect(result.map((r) => r.dayBreak)).toEqual(['Jun 9', null, 'Today']);
  });

  it('emits a break for the very first node', () => {
    const nodes = [node('2026-06-09T09:00:00Z', 'a', 'reply')];
    expect(withDayBreaks(nodes, now)[0].dayBreak).toBe('Jun 9');
  });
});
