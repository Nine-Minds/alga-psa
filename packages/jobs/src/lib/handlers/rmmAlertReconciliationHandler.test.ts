import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The alert-reconciliation job against an integration whose credentials are
 * dead (settings.tokenLifecycle.status === 'reconnect_required').
 *
 * That state is expected, not a failure: the handler must return normally so
 * the EventBus acks the message instead of redelivering it ten times. What must
 * NOT happen is swallowing a genuine failure, so the backstop is pinned from
 * both sides.
 */

const integrationRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const reads = vi.hoisted(() => ({ count: 0 }));
const runReconciliation = vi.hoisted(() => vi.fn());
const logInfo = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => ({ fn: { now: () => new Date('2026-08-13T12:00:00.000Z') } }),
}));

// Branches on table name; each rmm_integrations read pulls the next queued row
// so a test can show "healthy at gate time, reconnect_required on re-read".
const rowQueue = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown> | null> }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => ({
      where: () => ({
        first: async () => {
          reads.count += 1;
          if (name !== 'rmm_integrations') return null;
          return rowQueue.rows.length ? rowQueue.rows.shift() : integrationRow.current;
        },
      }),
    }),
  }),
  createTenantKnex: async () => ({ knex: {} }),
}));

vi.mock('@alga-psa/shared/rmm/alerts', () => ({
  getRmmAlertFetcher: () => ({}),
  registerRmmAlertFetcher: vi.fn(),
  runRmmAlertReconciliation: runReconciliation,
}));

vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({ buildRmmAlertPipelineDeps: vi.fn() }));
vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/alertFetcher', () => ({ tacticalRmmAlertFetcher: {} }));

const { rmmAlertReconciliationHandler } = await import('./rmmAlertPollingHandlers');

const data = { tenantId: 'tenant-1', integrationId: 'integration-1', provider: 'ninjaone' };

const healthy = { is_active: true, settings: { tokenLifecycle: { status: 'healthy' } } };
const reconnect = { is_active: true, settings: { tokenLifecycle: { status: 'reconnect_required' } } };

describe('rmmAlertReconciliationHandler — reconnect_required', () => {
  beforeEach(() => {
    runReconciliation.mockReset();
    runReconciliation.mockResolvedValue({ warnings: [], remoteActive: 0, ingested: 0, resetsSynthesized: 0 });
    logInfo.mockClear();
    rowQueue.rows = [];
    integrationRow.current = { ...healthy };
  });

  it('skips without running reconciliation when reconnect is required', async () => {
    integrationRow.current = { ...reconnect };
    await expect(rmmAlertReconciliationHandler('job-1', data)).resolves.toBeUndefined();

    expect(runReconciliation).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      '[RmmAlertReconciliationJob] Skipping: integration requires reconnect',
      data,
    );
  });

  it('runs reconciliation when the lifecycle is healthy', async () => {
    await rmmAlertReconciliationHandler('job-1', data);
    expect(runReconciliation).toHaveBeenCalledTimes(1);
  });

  it('runs reconciliation when there is no tokenLifecycle', async () => {
    integrationRow.current = { is_active: true, settings: {} };
    await rmmAlertReconciliationHandler('job-1', data);
    expect(runReconciliation).toHaveBeenCalledTimes(1);
  });

  it('resolves when the run fails with a NinjaOneReconnectRequiredError', async () => {
    const error = new Error('NinjaOne requires reconnect');
    error.name = 'NinjaOneReconnectRequiredError';
    runReconciliation.mockRejectedValue(error);

    await expect(rmmAlertReconciliationHandler('job-1', data)).resolves.toBeUndefined();
    expect(logInfo).toHaveBeenCalledWith(
      '[RmmAlertReconciliationJob] Skipping: integration requires reconnect',
      expect.objectContaining({ detectedDuring: 'run' }),
    );
  });

  it('resolves on a generic error when the re-read row now requires reconnect', async () => {
    // First read (the gate) sees healthy; the lifecycle flips mid-run.
    rowQueue.rows = [{ ...healthy }, { ...reconnect }];
    runReconciliation.mockRejectedValue(new Error('refresh failed'));

    await expect(rmmAlertReconciliationHandler('job-1', data)).resolves.toBeUndefined();
  });

  it('rejects with the same error on a generic error when the row is still healthy', async () => {
    const error = new Error('provider 503');
    runReconciliation.mockRejectedValue(error);

    await expect(rmmAlertReconciliationHandler('job-1', data)).rejects.toBe(error);
  });
});
