import { describe, expect, it } from 'vitest';

import { computeTacticalAgentStatus } from '@alga-psa/integrations/lib/rmm/tacticalrmm/agentStatus';

describe('computeTacticalAgentStatus', () => {
  const now = new Date('2026-02-13T12:00:00.000Z');

  it('returns online when last_seen >= now - offline_time', () => {
    const lastSeen = new Date(now.getTime() - 4 * 60_000).toISOString();
    expect(
      computeTacticalAgentStatus({
        lastSeen,
        offlineTimeMinutes: 5,
        overdueTimeMinutes: 30,
        now,
      })
    ).toBe('online');
  });

  it('returns offline when last_seen is between offline_time and overdue_time', () => {
    const lastSeen = new Date(now.getTime() - 10 * 60_000).toISOString();
    expect(
      computeTacticalAgentStatus({
        lastSeen,
        offlineTimeMinutes: 5,
        overdueTimeMinutes: 30,
        now,
      })
    ).toBe('offline');
  });

  it('returns overdue when last_seen <= now - overdue_time', () => {
    const lastSeen = new Date(now.getTime() - 40 * 60_000).toISOString();
    expect(
      computeTacticalAgentStatus({
        lastSeen,
        offlineTimeMinutes: 5,
        overdueTimeMinutes: 30,
        now,
      })
    ).toBe('overdue');
  });

  it('returns offline when last_seen is null', () => {
    expect(
      computeTacticalAgentStatus({
        lastSeen: null,
        offlineTimeMinutes: 5,
        overdueTimeMinutes: 30,
        now,
      })
    ).toBe('offline');
  });
});

