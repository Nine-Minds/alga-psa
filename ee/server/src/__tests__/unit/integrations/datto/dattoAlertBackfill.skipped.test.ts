import { beforeEach, describe, expect, it, vi } from 'vitest';

let reconciliation: { skipped: boolean; remoteActive: number; ingested: number; resetsSynthesized: number; warnings: string[] };
const publishRmmSyncEvent = vi.fn(async (_e: any) => undefined);
const update = vi.fn(async () => 1);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: { fn: { now: () => 'now' } } })),
  tenantDb: () => ({ table: () => ({ where: () => ({ update }) }) }),
}));
vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => ({ integration_id: 'int_1' })),
}));
vi.mock('@ee/lib/integrations/datto/events', () => ({
  publishRmmSyncEvent: (e: any) => publishRmmSyncEvent(e),
}));
vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({ buildRmmAlertPipelineDeps: vi.fn(() => ({})) }));
vi.mock('@ee/lib/integrations/datto/alertFetcher', () => ({}));
vi.mock('@alga-psa/shared/rmm/alerts', () => ({
  runRmmAlertReconciliation: vi.fn(async () => reconciliation),
}));

describe('runDattoRmmAlertBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a skipped reconciliation (not connected / no sites mapped) as an error, not a clean sync', async () => {
    reconciliation = { skipped: true, remoteActive: 0, ingested: 0, resetsSynthesized: 0, warnings: ['could not report'] };
    const { runDattoRmmAlertBackfill } = await import('@ee/lib/integrations/datto/alertBackfill');

    const result = await runDattoRmmAlertBackfill({ tenant: 'tenant_1' });

    expect(result).toMatchObject({ success: false, error: 'Datto RMM is not connected or no sites are mapped.' });
    expect(publishRmmSyncEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'RMM_SYNC_FAILED' }));
    expect(publishRmmSyncEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'RMM_SYNC_COMPLETED' }));
    expect(update).not.toHaveBeenCalled();
  });

  it('still succeeds with counts for a completed cycle', async () => {
    reconciliation = { skipped: false, remoteActive: 3, ingested: 2, resetsSynthesized: 1, warnings: [] };
    const { runDattoRmmAlertBackfill } = await import('@ee/lib/integrations/datto/alertBackfill');

    const result = await runDattoRmmAlertBackfill({ tenant: 'tenant_1' });

    expect(result).toMatchObject({ success: true, items_processed: 3, items_created: 2, items_updated: 1, items_failed: 0 });
  });
});
