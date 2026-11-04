import { beforeEach, describe, expect, it, vi } from 'vitest';

const { locals, processRmmAlertEvent } = vi.hoisted(() => ({
  locals: [{ external_alert_id: 'datto-open-1', metadata: { __alga_ingest_source: 'reconciliation' } }],
  processRmmAlertEvent: vi.fn(async () => ({ outcome: 'resolved', warnings: [] })),
}));
vi.mock('./processRmmAlertEvent', () => ({ processRmmAlertEvent }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      where() { return this; },
      whereIn() { return this; },
      select: async () => locals,
    }),
  }),
}));

import { registerRmmAlertFetcher, runRmmAlertReconciliation } from './reconciliation';

describe('active alert snapshot held IDs', () => {
  beforeEach(() => processRmmAlertEvent.mockClear());

  it('keeps a held native-feed alert open when its site is unmapped or muted', async () => {
    registerRmmAlertFetcher('datto', {
      async fetchActiveAlerts() { return []; },
      async fetchActiveAlertSnapshot() { return { events: [], heldExternalAlertIds: ['datto-open-1'] }; },
    });
    await runRmmAlertReconciliation({ knex: {} as any }, { tenantId: 'tenant-a', integrationId: 'integration-a', provider: 'datto' });
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('resets poller alerts absent from a successful native snapshot', async () => {
    registerRmmAlertFetcher('native-test', {
      async fetchActiveAlerts() { return []; },
      async fetchActiveAlertSnapshot() { return { events: [], heldExternalAlertIds: [] }; },
    });
    await runRmmAlertReconciliation({ knex: {} as any }, { tenantId: 'tenant-a', integrationId: 'integration-a', provider: 'native-test' });
    expect(processRmmAlertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'reset', externalAlertId: 'datto-open-1' }));
  });
});
