import { beforeEach, describe, expect, it, vi } from 'vitest';

const { locals, processRmmAlertEvent } = vi.hoisted(() => {
  const locals = [{
    external_alert_id: 'datto-open-1',
    status: 'active',
    metadata: { __alga_ingest_source: 'reconciliation' },
  }];
  const processRmmAlertEvent = vi.fn(async (_ctx: any, event: any) => {
    if (event.kind === 'reset') {
      const alert = locals.find((row) => row.external_alert_id === event.externalAlertId);
      if (alert) alert.status = 'resolved';
    }
    return { outcome: 'resolved', warnings: [] };
  });
  return { locals, processRmmAlertEvent };
});
vi.mock('./processRmmAlertEvent', () => ({ processRmmAlertEvent }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (tableName: string) => {
      const query = {
        where() { return this; },
        whereIn() { return this; },
        select: async () => tableName === 'rmm_alerts' ? locals : [],
      };
      return query;
    },
  }),
}));

import { registerRmmAlertFetcher, runRmmAlertReconciliation } from './reconciliation';

describe('active alert snapshot held IDs', () => {
  beforeEach(() => {
    processRmmAlertEvent.mockClear();
    locals[0].status = 'active';
  });

  it('keeps a held native-feed alert open when its site is unmapped or muted', async () => {
    registerRmmAlertFetcher('datto', {
      async fetchActiveAlerts() { return []; },
      async fetchActiveAlertSnapshot() { return { events: [], heldExternalAlertIds: ['datto-open-1'] }; },
    });
    const result = await runRmmAlertReconciliation(
      { knex: {} as any },
      { tenantId: 'tenant-a', integrationId: 'integration-a', provider: 'datto' },
    );
    expect(result.resetsSynthesized).toBe(0);
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
    expect(locals[0].status).toBe('active');
  });

  it('resets poller alerts absent from a successful native snapshot', async () => {
    registerRmmAlertFetcher('native-test', {
      async fetchActiveAlerts() { return []; },
      async fetchActiveAlertSnapshot() { return { events: [], heldExternalAlertIds: [] }; },
    });
    const result = await runRmmAlertReconciliation(
      { knex: {} as any },
      { tenantId: 'tenant-a', integrationId: 'integration-a', provider: 'native-test' },
    );
    expect(result.resetsSynthesized).toBe(1);
    expect(processRmmAlertEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'reset', externalAlertId: 'datto-open-1' }),
    );
    expect(locals[0].status).toBe('resolved');
  });
});
