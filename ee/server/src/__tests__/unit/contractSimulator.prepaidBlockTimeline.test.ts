/**
 * Pure unit tests for the Prepaid Block timeline used by the contract
 * simulator (plan section 8). No database access.
 */

import { describe, expect, it } from 'vitest';
import { simulatePrepaidBlockTimeline } from '@ee/lib/billing/simulator/prepaidBlockTimeline';

const monthly = (count: number, year = 2026) =>
  Array.from({ length: count }, (_, i) => {
    const m = (i % 12) + 1;
    const y = year + Math.floor(i / 12);
    const nm = (m % 12) + 1;
    const ny = m === 12 ? y + 1 : y;
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      index: i,
      startDate: `${y}-${pad(m)}-01`,
      endDateExclusive: `${ny}-${pad(nm)}-01`,
    };
  });

const baseConfig = {
  block_minutes: 600, // 10 h
  expiry_months: 12 as number | null,
  trigger_on_exhaustion: true,
  trigger_threshold_percent: null as number | null,
  trigger_on_expiry: false,
};

const demand = (entries: Record<number, number>) =>
  new Map(Object.entries(entries).map(([k, v]) => [Number(k), v * 60]));

describe('simulatePrepaidBlockTimeline', () => {
  it('issues the first block in the start period and draws it down', () => {
    const t = simulatePrepaidBlockTimeline({
      config: baseConfig,
      periods: monthly(3),
      contractStartDate: '2026-01-01',
      contractEndDate: null,
      demandMinutesByPeriod: demand({ 0: 4, 1: 3 }),
    });
    expect(t.issues).toHaveLength(1);
    expect(t.issues[0]).toMatchObject({ periodIndex: 0, trigger: 'contract_start', issueDate: '2026-01-01', expirationDate: '2026-12-31' });
    expect(t.draws.map((d) => [d.periodIndex, d.minutes, d.remainingMinutes])).toEqual([
      [0, 240, 360],
      [1, 180, 180],
    ]);
    expect(t.overageMinutesByPeriod.size).toBe(0);
  });

  it('issues a follow-on on exhaustion and draws the spill from the new block', () => {
    const t = simulatePrepaidBlockTimeline({
      config: baseConfig,
      periods: monthly(2),
      contractStartDate: '2026-01-01',
      contractEndDate: null,
      demandMinutesByPeriod: demand({ 0: 13 }),
    });
    expect(t.issues.map((i) => [i.blockOrdinal, i.trigger, i.periodIndex])).toEqual([
      [1, 'contract_start', 0],
      [2, 'exhaustion', 0],
    ]);
    expect(t.draws.map((d) => [d.blockOrdinal, d.minutes, d.remainingMinutes])).toEqual([
      [1, 600, 0],
      [2, 180, 420],
    ]);
    expect(t.overageMinutesByPeriod.size).toBe(0);
  });

  it('fires the threshold trigger once per block', () => {
    const t = simulatePrepaidBlockTimeline({
      config: { ...baseConfig, trigger_on_exhaustion: false, trigger_threshold_percent: 80 },
      periods: monthly(3),
      contractStartDate: '2026-01-01',
      contractEndDate: null,
      demandMinutesByPeriod: demand({ 0: 8, 1: 1, 2: 1 }),
    });
    const thresholdIssues = t.issues.filter((i) => i.trigger === 'threshold');
    expect(thresholdIssues).toHaveLength(1);
    expect(thresholdIssues[0].periodIndex).toBe(0);
  });

  it('bills demand beyond the available blocks as overage when no follow-on is configured', () => {
    const t = simulatePrepaidBlockTimeline({
      config: { ...baseConfig, trigger_on_exhaustion: false },
      periods: monthly(2),
      contractStartDate: '2026-01-01',
      contractEndDate: null,
      demandMinutesByPeriod: demand({ 0: 12 }),
    });
    expect(t.issues).toHaveLength(1);
    expect(t.overageMinutesByPeriod.get(0)).toBe(120);
  });

  it('forfeits the unused balance at the anniversary and issues the next block on expiry', () => {
    const t = simulatePrepaidBlockTimeline({
      config: { ...baseConfig, expiry_months: 2, trigger_on_exhaustion: false, trigger_on_expiry: true },
      periods: monthly(4),
      contractStartDate: '2026-01-01',
      contractEndDate: null,
      demandMinutesByPeriod: demand({ 0: 2, 2: 1 }),
    });
    expect(t.forfeitures).toEqual([
      { periodIndex: 2, blockOrdinal: 1, date: '2026-03-01', minutes: 480 },
    ]);
    expect(t.issues.map((i) => [i.trigger, i.issueDate])).toEqual([
      ['contract_start', '2026-01-01'],
      ['expiry', '2026-03-01'],
    ]);
    expect(t.draws.find((d) => d.periodIndex === 2)).toMatchObject({ blockOrdinal: 2, minutes: 60 });
  });

  it('does not issue follow-on blocks after the contract end', () => {
    const t = simulatePrepaidBlockTimeline({
      config: baseConfig,
      periods: monthly(3),
      contractStartDate: '2026-01-01',
      contractEndDate: '2026-01-31',
      demandMinutesByPeriod: demand({ 0: 12, 1: 5 }),
    });
    expect(t.issues.filter((i) => i.periodIndex > 0)).toHaveLength(0);
    expect(t.draws.every((d) => d.periodIndex === 0)).toBe(true);
  });

  it('returns an empty timeline for a non-positive block size', () => {
    const t = simulatePrepaidBlockTimeline({
      config: { ...baseConfig, block_minutes: 0 },
      periods: monthly(1),
      contractStartDate: null,
      contractEndDate: null,
      demandMinutesByPeriod: demand({ 0: 1 }),
    });
    expect(t.issues).toHaveLength(0);
  });
});
