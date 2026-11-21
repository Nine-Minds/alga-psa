import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  locals: [] as Array<{ external_alert_id: string; metadata: unknown }>,
  conditions: [] as Array<{ current_external_alert_id: string }>,
  transitions: [] as Array<{ external_alert_id: string }>,
  processed: [] as Array<{ kind: string; externalAlertId: string }>,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const qb: any = {
        where: () => qb,
        whereIn: () => qb,
        select: async () => {
          switch (name) {
            case 'rmm_alerts': return h.locals;
            case 'rmm_condition_states': return h.conditions;
            case 'rmm_condition_transitions': return h.transitions;
            default: throw new Error(`Unexpected table: ${name}`);
          }
        },
      };
      return qb;
    },
  }),
}));

vi.mock('../processRmmAlertEvent', () => ({
  processRmmAlertEvent: vi.fn(async (_ctx: unknown, event: { kind: string; externalAlertId: string }) => {
    h.processed.push({ kind: event.kind, externalAlertId: event.externalAlertId });
    return { outcome: event.kind === 'reset' ? 'resolved' : 'skipped', warnings: [] };
  }),
}));

import { registerRmmAlertFetcher, runRmmAlertReconciliation, RECONCILIATION_INGEST_MARKER } from '../reconciliation';

const pollerIngested = (id: string) => ({
  external_alert_id: id,
  metadata: { [RECONCILIATION_INGEST_MARKER]: 'reconciliation' },
});

const args = { tenantId: 't1', integrationId: 'i1', provider: 'held-test' };

describe('runRmmAlertReconciliation with held alerts', () => {
  beforeEach(() => {
    h.locals = [];
    h.conditions = [];
    h.transitions = [];
    h.processed = [];
  });

  it('does not reset alerts the fetcher held back from ingestion', async () => {
    h.locals = [pollerIngested('muted-1'), pollerIngested('unmapped-1'), pollerIngested('cleared-1')];
    registerRmmAlertFetcher('held-test', {
      fetchActiveAlerts: async () => [],
      fetchActiveAlertSnapshot: async () => ({ events: [], heldExternalAlertIds: ['muted-1', 'unmapped-1'] }),
    });

    const result = await runRmmAlertReconciliation({ knex: {} as any }, args);

    expect(h.processed).toEqual([{ kind: 'reset', externalAlertId: 'cleared-1' }]);
    expect(result.resetsSynthesized).toBe(1);
  });

  it('falls back to fetchActiveAlerts for fetchers without a snapshot', async () => {
    h.locals = [pollerIngested('gone-1')];
    registerRmmAlertFetcher('held-test', { fetchActiveAlerts: async () => [] });

    const result = await runRmmAlertReconciliation({ knex: {} as any }, args);

    expect(h.processed).toEqual([{ kind: 'reset', externalAlertId: 'gone-1' }]);
    expect(result.resetsSynthesized).toBe(1);
  });

  it('keeps current and pending condition outages open when a snapshot omits them', async () => {
    h.locals = [pollerIngested('current-1'), pollerIngested('pending-1'), pollerIngested('cleared-1')];
    h.conditions = [{ current_external_alert_id: 'current-1' }];
    h.transitions = [{ external_alert_id: 'pending-1' }];
    registerRmmAlertFetcher('held-test', {
      fetchActiveAlerts: async () => [],
      fetchActiveAlertSnapshot: async () => ({ events: [], heldExternalAlertIds: [] }),
    });

    const result = await runRmmAlertReconciliation({ knex: {} as any }, args);

    expect(h.processed).toEqual([{ kind: 'reset', externalAlertId: 'cleared-1' }]);
    expect(result.resetsSynthesized).toBe(1);
  });
});
