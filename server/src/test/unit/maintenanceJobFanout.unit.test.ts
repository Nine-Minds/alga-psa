import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantHandlerMock = vi.fn();
const systemHandlerMock = vi.fn();
const listTenantsMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => (table: string) => {
    expect(table).toBe('tenants');
    return { select: (_col: string) => Promise.resolve(listTenantsMock()) };
  },
}));

// Every handler imported by maintenanceJobFanout must be mocked or the module
// will try to load the real (heavy) handler graph.
vi.mock('@/lib/jobs/handlers/expiredCreditsHandler', () => ({ expiredCreditsHandler: (...a: unknown[]) => tenantHandlerMock('expired-credits', ...a) }));
vi.mock('@/lib/jobs/handlers/expiringCreditsNotificationHandler', () => ({ expiringCreditsNotificationHandler: (...a: unknown[]) => tenantHandlerMock('expiring-credits-notification', ...a) }));
vi.mock('@/lib/jobs/handlers/creditReconciliationHandler', () => ({ creditReconciliationHandler: (...a: unknown[]) => tenantHandlerMock('credit-reconciliation', ...a) }));
vi.mock('@/lib/jobs/handlers/reconcileBucketUsageHandler', () => ({ handleReconcileBucketUsage: (...a: unknown[]) => tenantHandlerMock('reconcile-bucket-usage', ...a) }));
vi.mock('@/lib/jobs/handlers/processRenewalQueueHandler', () => ({ processRenewalQueueHandler: (...a: unknown[]) => tenantHandlerMock('process-renewal-queue', ...a) }));
vi.mock('@/lib/jobs/handlers/autoCloseTicketsHandler', () => ({ autoCloseTicketsHandler: (...a: unknown[]) => tenantHandlerMock('auto-close-tickets', ...a) }));
vi.mock('@/lib/jobs/handlers/searchReconcileHandler', () => ({ SEARCH_RECONCILE_JOB_NAME: 'search:reconcile', searchReconcileHandler: (...a: unknown[]) => tenantHandlerMock('search:reconcile', ...a) }));
vi.mock('@/lib/jobs/handlers/calendarWebhookMaintenanceHandler', () => ({ verifyGoogleCalendarProvisioning: (...a: unknown[]) => tenantHandlerMock('verify-google-calendar-pubsub', ...a) }));
vi.mock('@/lib/jobs/handlers/googleGmailWatchRenewalHandler', () => ({ renewGoogleGmailWatchSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-google-gmail-watch', ...a) }));
vi.mock('@/lib/jobs/handlers/teamsMeetingArtifactWebhookHandler', () => ({ renewTeamsMeetingArtifactSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-teams-meeting-artifact-subscriptions', ...a) }));
vi.mock('@/lib/jobs/handlers/workflowQuotaResumeScanHandler', () => ({ workflowQuotaResumeScanHandler: (...a: unknown[]) => systemHandlerMock('workflow-quota-resume-scan', ...a) }));
vi.mock('@/lib/jobs/handlers/cleanupAiSessionKeysHandler', () => ({ cleanupAiSessionKeysHandler: (...a: unknown[]) => systemHandlerMock('cleanup-ai-session-keys', ...a) }));
vi.mock('@/services/cleanupTemporaryFormsJob', () => ({ cleanupTemporaryFormsJob: (...a: unknown[]) => systemHandlerMock('cleanup-temporary-workflow-forms', ...a) }));
vi.mock('@/services/cleanupWebhookDeliveriesJob', () => ({ cleanupWebhookDeliveriesJob: (...a: unknown[]) => systemHandlerMock('cleanup-webhook-deliveries', ...a) }));

import { runMaintenanceJob, isKnownMaintenanceJob } from '@/lib/jobs/maintenanceJobFanout';

describe('runMaintenanceJob', () => {
  beforeEach(() => {
    tenantHandlerMock.mockReset();
    systemHandlerMock.mockReset();
    listTenantsMock.mockReset();
    tenantHandlerMock.mockResolvedValue(undefined);
    systemHandlerMock.mockResolvedValue(undefined);
  });

  it('runs a system job once and does not list tenants', async () => {
    const result = await runMaintenanceJob('cleanup-temporary-workflow-forms');
    expect(systemHandlerMock).toHaveBeenCalledTimes(1);
    expect(systemHandlerMock).toHaveBeenCalledWith('cleanup-temporary-workflow-forms');
    expect(listTenantsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ jobName: 'cleanup-temporary-workflow-forms', scope: 'system', total: 1, succeeded: 1, failed: 0 });
  });

  it('fans a tenant job out across every tenant', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }, { tenant: 't3' }]);
    const result = await runMaintenanceJob('auto-close-tickets', { concurrency: 2 });
    expect(tenantHandlerMock).toHaveBeenCalledTimes(3);
    expect(tenantHandlerMock).toHaveBeenCalledWith('auto-close-tickets', { tenantId: 't1' });
    expect(tenantHandlerMock).toHaveBeenCalledWith('auto-close-tickets', { tenantId: 't3' });
    expect(result).toEqual({ jobName: 'auto-close-tickets', scope: 'tenant', total: 3, succeeded: 3, failed: 0 });
  });

  it('isolates a single tenant failure without aborting the rest', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }, { tenant: 't3' }]);
    tenantHandlerMock.mockImplementation((_job: string, data: { tenantId: string }) =>
      data.tenantId === 't2' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined));
    const result = await runMaintenanceJob('process-renewal-queue', { concurrency: 3 });
    expect(tenantHandlerMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ jobName: 'process-renewal-queue', scope: 'tenant', total: 3, succeeded: 2, failed: 1 });
  });

  it('passes the renewal horizon to the handler', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }]);
    await runMaintenanceJob('process-renewal-queue');
    expect(tenantHandlerMock).toHaveBeenCalledWith('process-renewal-queue', { tenantId: 't1', horizonDays: 90 });
  });

  it('throws for an unknown job name', async () => {
    await expect(runMaintenanceJob('not-a-real-job')).rejects.toThrow(/Unknown maintenance job/);
  });

  it('reports known jobs via isKnownMaintenanceJob', () => {
    expect(isKnownMaintenanceJob('search:reconcile')).toBe(true);
    expect(isKnownMaintenanceJob('sla-timer')).toBe(false);
  });
});
