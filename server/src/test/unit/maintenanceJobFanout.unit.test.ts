import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantHandlerMock = vi.fn();
const systemHandlerMock = vi.fn();
const listTenantsMock = vi.fn();
// Rows returned for the per-job tenant selector tables (teams_integrations, email_providers).
const selectTenantsMock = vi.fn();
const selectorTablesSeen: string[] = [];

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => (table: string) => {
    if (table === 'tenants') {
      const builder = {
        whereNull: (column: string) => {
          expect(column).toBe('suspended_at');
          return builder;
        },
        select: (_col: string) => Promise.resolve(listTenantsMock()),
      };
      return builder;
    }
    selectorTablesSeen.push(table);
    const selector = {
      where: () => selector,
      whereNull: () => selector,
      whereNotNull: () => selector,
      distinct: (_col: string) => Promise.resolve(selectTenantsMock(table)),
    };
    return selector;
  },
}));

// Every handler imported by maintenanceJobFanout must be mocked or the module
// will try to load the real (heavy) handler graph.
vi.mock('@alga-psa/jobs/handlers/expiredCreditsHandler', () => ({ expiredCreditsHandler: (...a: unknown[]) => tenantHandlerMock('expired-credits', ...a) }));
vi.mock('@alga-psa/jobs/handlers/expiringCreditsNotificationHandler', () => ({ expiringCreditsNotificationHandler: (...a: unknown[]) => tenantHandlerMock('expiring-credits-notification', ...a) }));
vi.mock('@alga-psa/jobs/handlers/reconcileBucketUsageHandler', () => ({ handleReconcileBucketUsage: (...a: unknown[]) => tenantHandlerMock('reconcile-bucket-usage', ...a) }));
vi.mock('@alga-psa/jobs/handlers/processRenewalQueueHandler', () => ({ processRenewalQueueHandler: (...a: unknown[]) => tenantHandlerMock('process-renewal-queue', ...a) }));
vi.mock('@alga-psa/jobs/handlers/autoCloseTicketsHandler', () => ({ autoCloseTicketsHandler: (...a: unknown[]) => tenantHandlerMock('auto-close-tickets', ...a) }));
vi.mock('@alga-psa/jobs/handlers/searchReconcileHandler', () => ({ SEARCH_RECONCILE_JOB_NAME: 'search:reconcile', searchReconcileHandler: (...a: unknown[]) => tenantHandlerMock('search:reconcile', ...a) }));
vi.mock('@alga-psa/jobs/handlers/calendarWebhookMaintenanceHandler', () => ({ verifyGoogleCalendarProvisioning: (...a: unknown[]) => tenantHandlerMock('verify-google-calendar-pubsub', ...a) }));
vi.mock('@alga-psa/jobs/handlers/googleGmailWatchRenewalHandler', () => ({ renewGoogleGmailWatchSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-google-gmail-watch', ...a) }));
vi.mock('@alga-psa/jobs/handlers/teamsMeetingArtifactWebhookHandler', () => ({ renewTeamsMeetingArtifactSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-teams-meeting-artifact-subscriptions', ...a) }));
vi.mock('@alga-psa/jobs/handlers/workflowQuotaResumeScanHandler', () => ({ workflowQuotaResumeScanHandler: (...a: unknown[]) => systemHandlerMock('workflow-quota-resume-scan', ...a) }));
vi.mock('@alga-psa/jobs/handlers/cleanupAiSessionKeysHandler', () => ({ cleanupAiSessionKeysHandler: (...a: unknown[]) => systemHandlerMock('cleanup-ai-session-keys', ...a) }));
vi.mock('@alga-psa/jobs/handlers/cleanupTemporaryFormsJob', () => ({ cleanupTemporaryFormsJob: (...a: unknown[]) => systemHandlerMock('cleanup-temporary-workflow-forms', ...a) }));
vi.mock('@alga-psa/jobs/handlers/cleanupWebhookDeliveriesJob', () => ({ cleanupWebhookDeliveriesJob: (...a: unknown[]) => systemHandlerMock('cleanup-webhook-deliveries', ...a) }));
vi.mock('@alga-psa/jobs/handlers/teamsMeetingSweepHandler', () => ({ TEAMS_MEETING_SWEEP_JOB: 'sweep-teams-online-meetings', teamsMeetingSweepHandler: (...a: unknown[]) => tenantHandlerMock('sweep-teams-online-meetings', ...a) }));
vi.mock('@alga-psa/jobs/handlers/inboundEmailRecoveryHandler', () => ({ inboundEmailRecoveryHandler: (...a: unknown[]) => tenantHandlerMock('inbound-email-recovery', ...a) }));
vi.mock('@alga-psa/jobs/handlers/telephonyCallNotificationHandler', () => ({ renewTelephonyCallSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-telephony-call-subscriptions', ...a) }));
vi.mock('@alga-psa/jobs/handlers/telephonyCallArtifactHandler', () => ({ TELEPHONY_CALL_ARTIFACT_SWEEP_JOB: 'sweep-telephony-call-artifacts', telephonyCallArtifactSweepHandler: (...a: unknown[]) => tenantHandlerMock('sweep-telephony-call-artifacts', ...a) }));

import { runMaintenanceJob, isKnownMaintenanceJob } from '@alga-psa/jobs/fanout';

describe('runMaintenanceJob', () => {
  beforeEach(() => {
    tenantHandlerMock.mockReset();
    systemHandlerMock.mockReset();
    listTenantsMock.mockReset();
    selectTenantsMock.mockReset();
    selectorTablesSeen.length = 0;
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

  it('does not consult a selector table for jobs that fan out to every tenant', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }]);
    await runMaintenanceJob('auto-close-tickets');
    expect(selectorTablesSeen).toEqual([]);
    expect(selectTenantsMock).not.toHaveBeenCalled();
  });

  it('narrows the Teams sweep to tenants with an active integration', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }, { tenant: 't3' }]);
    selectTenantsMock.mockReturnValue([{ tenant: 't2' }]);
    const result = await runMaintenanceJob('sweep-teams-online-meetings');
    expect(selectorTablesSeen).toEqual(['teams_integrations']);
    expect(tenantHandlerMock).toHaveBeenCalledTimes(1);
    expect(tenantHandlerMock).toHaveBeenCalledWith('sweep-teams-online-meetings', { tenantId: 't2' });
    expect(result).toEqual({ jobName: 'sweep-teams-online-meetings', scope: 'tenant', total: 1, succeeded: 1, failed: 0 });
  });

  it('never runs a selected tenant that is suspended', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }]);
    selectTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 'suspended' }]);
    const result = await runMaintenanceJob('sweep-teams-online-meetings');
    expect(tenantHandlerMock).toHaveBeenCalledTimes(1);
    expect(tenantHandlerMock).toHaveBeenCalledWith('sweep-teams-online-meetings', { tenantId: 't1' });
    expect(result.total).toBe(1);
  });

  it('narrows inbound-email recovery to tenants with an active provider and caps its concurrency', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }, { tenant: 't3' }, { tenant: 't4' }]);
    selectTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't3' }, { tenant: 't4' }]);
    let inFlight = 0;
    let peak = 0;
    tenantHandlerMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });
    const result = await runMaintenanceJob('inbound-email-recovery');
    expect(selectorTablesSeen).toEqual(['email_providers']);
    expect(tenantHandlerMock).toHaveBeenCalledTimes(3);
    expect(tenantHandlerMock).not.toHaveBeenCalledWith('inbound-email-recovery', { tenantId: 't2' });
    expect(peak).toBeLessThanOrEqual(3);
    expect(result).toEqual({ jobName: 'inbound-email-recovery', scope: 'tenant', total: 3, succeeded: 3, failed: 0 });
  });

  it.each([
    ['renew-teams-meeting-artifact-subscriptions', 'teams_integrations'],
    ['renew-telephony-call-subscriptions', 'telephony_providers'],
    ['sweep-telephony-call-artifacts', 'telephony_call_records'],
  ])('narrows %s to tenants selected from %s', async (jobName, table) => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }]);
    selectTenantsMock.mockReturnValue([{ tenant: 't2' }]);
    const result = await runMaintenanceJob(jobName);
    expect(selectorTablesSeen).toEqual([table]);
    expect(tenantHandlerMock).toHaveBeenCalledTimes(1);
    expect(tenantHandlerMock).toHaveBeenCalledWith(jobName, { tenantId: 't2' });
    expect(result.total).toBe(1);
  });

  it('throws for an unknown job name', async () => {
    await expect(runMaintenanceJob('not-a-real-job')).rejects.toThrow(/Unknown maintenance job/);
  });

  it('reports known jobs via isKnownMaintenanceJob', () => {
    expect(isKnownMaintenanceJob('search:reconcile')).toBe(true);
    expect(isKnownMaintenanceJob('sla-timer')).toBe(false);
  });
});
