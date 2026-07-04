import { describe, it, expect } from 'vitest';
import { computeSlaClocks, formatDurationShort } from './slaClocks';

// Fixed "now" so the running/overdue arithmetic is deterministic.
const NOW = Date.parse('2026-06-20T12:00:00.000Z');
const iso = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString();

describe('formatDurationShort', () => {
  it('renders minutes, hours, and days at the right granularity', () => {
    expect(formatDurationShort(42 * 60_000)).toBe('42m');
    expect(formatDurationShort(60 * 60_000)).toBe('1h');
    expect(formatDurationShort(90 * 60_000)).toBe('1h 30m');
    expect(formatDurationShort(25 * 60 * 60_000)).toBe('1d 1h');
    expect(formatDurationShort(-5 * 60_000)).toBe('0m'); // never negative
  });
});

describe('computeSlaClocks', () => {
  it('reports no policy when sla_policy_id is absent', () => {
    const clocks = computeSlaClocks({}, NOW);
    expect(clocks.policyApplied).toBe(false);
    expect(clocks.response.state).toBe('none');
    expect(clocks.resolution.state).toBe('none');
  });

  it('reports no policy when a policy id exists but no due dates are set', () => {
    const clocks = computeSlaClocks({ sla_policy_id: 'p1' }, NOW);
    expect(clocks.policyApplied).toBe(false);
  });

  it('marks a met response using response_met and reports how long it took', () => {
    const clocks = computeSlaClocks(
      {
        sla_policy_id: 'p1',
        sla_started_at: iso(-60),
        sla_response_due_at: iso(0),
        sla_response_at: iso(-18),
        sla_response_met: true,
      },
      NOW,
    );
    expect(clocks.policyApplied).toBe(true);
    expect(clocks.response.state).toBe('met');
    // Started 60m before now, responded 18m before now -> 42m elapsed.
    expect(clocks.response.label).toBe('Met in 42m');
    expect(clocks.response.pctElapsed).toBe(100);
  });

  it('marks a missed target when response_met is false', () => {
    const clocks = computeSlaClocks(
      {
        sla_policy_id: 'p1',
        sla_started_at: iso(-120),
        sla_response_due_at: iso(-60),
        sla_response_at: iso(-30),
        sla_response_met: false,
      },
      NOW,
    );
    expect(clocks.response.state).toBe('missed');
    expect(clocks.response.label).toContain('Missed by');
  });

  it('counts down a running resolution clock and reports time left', () => {
    const clocks = computeSlaClocks(
      {
        sla_policy_id: 'p1',
        sla_started_at: iso(-180),
        sla_resolution_due_at: iso(60),
      },
      NOW,
    );
    expect(clocks.resolution.state).toBe('running');
    expect(clocks.resolution.label).toBe('1h left');
    // 180m elapsed of a 240m window -> 75%.
    expect(clocks.resolution.pctElapsed).toBe(75);
  });

  it('reports overdue once the due date has passed with no completion', () => {
    const clocks = computeSlaClocks(
      {
        sla_policy_id: 'p1',
        sla_started_at: iso(-300),
        sla_resolution_due_at: iso(-120),
      },
      NOW,
    );
    expect(clocks.resolution.state).toBe('overdue');
    expect(clocks.resolution.label).toBe('Overdue by 2h');
    expect(clocks.resolution.pctElapsed).toBe(100);
  });

  it('reports paused when the clock is paused and not yet completed', () => {
    const clocks = computeSlaClocks(
      {
        sla_policy_id: 'p1',
        sla_started_at: iso(-60),
        sla_resolution_due_at: iso(120),
        sla_paused_at: iso(-10),
      },
      NOW,
    );
    expect(clocks.resolution.state).toBe('paused');
    expect(clocks.resolution.label).toBe('Paused');
  });

  it('prefers completion state over a pause (a met clock is not "paused")', () => {
    const clocks = computeSlaClocks(
      {
        sla_policy_id: 'p1',
        sla_started_at: iso(-60),
        sla_resolution_due_at: iso(30),
        sla_resolution_at: iso(-5),
        sla_resolution_met: true,
        sla_paused_at: iso(-10),
      },
      NOW,
    );
    expect(clocks.resolution.state).toBe('met');
  });

  it('accepts Date objects as well as ISO strings', () => {
    const clocks = computeSlaClocks(
      {
        sla_policy_id: 'p1',
        sla_started_at: new Date(NOW - 60 * 60_000),
        sla_resolution_due_at: new Date(NOW + 60 * 60_000),
      },
      NOW,
    );
    expect(clocks.resolution.state).toBe('running');
  });
});
