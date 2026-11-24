import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantHandlerMock = vi.fn();
const systemHandlerMock = vi.fn();
const contractSweepMock = vi.fn();
const listTenantsMock = vi.fn();
// Rows returned for the per-job tenant selector tables (teams_integrations, email_providers).
const selectTenantsMock = vi.fn();
const configuredDateLauncherMock = vi.fn();
const dateScanLauncherCapture = vi.fn();
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
      whereRaw: () => selector,
      distinct: (_col: string) => Promise.resolve(selectTenantsMock(table)),
    };
    return selector;
  },
}));

// Every handler imported by maintenanceJobFanout must be mocked or the module
// will try to load the real (heavy) handler graph.
vi.mock('@alga-psa/jobs/handlers/expiredCreditsHandler', () => ({ expiredCreditsHandler: (...a: unknown[]) => tenantHandlerMock('expired-credits', ...a) }));
vi.mock('@alga-psa/jobs/handlers/dateTriggerScanHandler', () => ({ createDateTriggerScanHandler: (launcher: unknown) => { dateScanLauncherCapture(launcher); return async ({ tenantId }: { tenantId: string }) => { if (typeof launcher === 'function') await (launcher as Function)({ tenantId, today: '2026-10-01', now: new Date('2026-10-01T12:00:00Z'), timezone: 'UTC', knex: {}, sources: [] }); }; } }));
vi.mock('@alga-psa/jobs/handlers/expiringCreditsNotificationHandler', () => ({ expiringCreditsNotificationHandler: (...a: unknown[]) => tenantHandlerMock('expiring-credits-notification', ...a) }));
vi.mock('@alga-psa/jobs/handlers/reconcileBucketUsageHandler', () => ({ handleReconcileBucketUsage: (...a: unknown[]) => tenantHandlerMock('reconcile-bucket-usage', ...a) }));
vi.mock('@alga-psa/jobs/handlers/processRenewalQueueHandler', () => ({ processRenewalQueueHandler: (...a: unknown[]) => tenantHandlerMock('process-renewal-queue', ...a) }));
vi.mock('@alga-psa/jobs/handlers/autoCloseTicketsHandler', () => ({ autoCloseTicketsHandler: (...a: unknown[]) => tenantHandlerMock('auto-close-tickets', ...a) }));
vi.mock('@alga-psa/jobs/handlers/searchReconcileHandler', () => ({ SEARCH_RECONCILE_JOB_NAME: 'search:reconcile', searchReconcileHandler: (...a: unknown[]) => tenantHandlerMock('search:reconcile', ...a) }));
vi.mock('@alga-psa/jobs/handlers/calendarWebhookMaintenanceHandler', () => ({ renewMicrosoftCalendarWebhooks: (...a: unknown[]) => tenantHandlerMock('renew-microsoft-calendar-webhooks', ...a), verifyGoogleCalendarProvisioning: (...a: unknown[]) => tenantHandlerMock('verify-google-calendar-pubsub', ...a) }));
vi.mock('@alga-psa/jobs/handlers/googleGmailWatchRenewalHandler', () => ({ renewGoogleGmailWatchSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-google-gmail-watch', ...a) }));
vi.mock('@alga-psa/jobs/handlers/teamsMeetingArtifactWebhookHandler', () => ({ renewTeamsMeetingArtifactSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-teams-meeting-artifact-subscriptions', ...a) }));
vi.mock('@alga-psa/jobs/handlers/workflowQuotaResumeScanHandler', () => ({ workflowQuotaResumeScanHandler: (...a: unknown[]) => systemHandlerMock('workflow-quota-resume-scan', ...a) }));
vi.mock('@alga-psa/jobs/handlers/cleanupAiSessionKeysHandler', () => ({ cleanupAiSessionKeysHandler: (...a: unknown[]) => systemHandlerMock('cleanup-ai-session-keys', ...a) }));
vi.mock('@alga-psa/jobs/handlers/cleanupTemporaryFormsJob', () => ({ cleanupTemporaryFormsJob: (...a: unknown[]) => systemHandlerMock('cleanup-temporary-workflow-forms', ...a) }));
vi.mock('@alga-psa/jobs/handlers/cleanupWebhookDeliveriesJob', () => ({ cleanupWebhookDeliveriesJob: (...a: unknown[]) => systemHandlerMock('cleanup-webhook-deliveries', ...a) }));
vi.mock('@alga-psa/jobs/handlers/cleanupInboundEmailQuarantineJob', () => ({ cleanupInboundEmailQuarantineJob: (...a: unknown[]) => systemHandlerMock('cleanup-inbound-email-quarantine', ...a) }));
vi.mock('@alga-psa/jobs/handlers/teamsMeetingSweepHandler', () => ({ TEAMS_MEETING_SWEEP_JOB: 'sweep-teams-online-meetings', teamsMeetingSweepHandler: (...a: unknown[]) => tenantHandlerMock('sweep-teams-online-meetings', ...a) }));
vi.mock('@alga-psa/jobs/handlers/inboundEmailRecoveryHandler', () => ({ inboundEmailRecoveryHandler: (...a: unknown[]) => tenantHandlerMock('inbound-email-recovery', ...a) }));
vi.mock('@alga-psa/jobs/handlers/telephonyCallNotificationHandler', () => ({ renewTelephonyCallSubscriptions: (...a: unknown[]) => tenantHandlerMock('renew-telephony-call-subscriptions', ...a) }));
vi.mock('@alga-psa/jobs/handlers/telephonyCallArtifactHandler', () => ({ TELEPHONY_CALL_ARTIFACT_SWEEP_JOB: 'sweep-telephony-call-artifacts', telephonyCallArtifactSweepHandler: (...a: unknown[]) => tenantHandlerMock('sweep-telephony-call-artifacts', ...a) }));
vi.mock('@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization', () => ({
  replenishContractCadenceServicePeriodsSweep: (...a: unknown[]) => contractSweepMock(...a),
}));

import {
  runMaintenanceJob,
  isKnownMaintenanceJob,
  configureDateTriggerWorkflowLauncher,
  listMaintenanceJobNames,
  registerMaintenanceJob,
} from '@alga-psa/jobs/fanout';
import { MAINTENANCE_FANOUT_SCHEDULES } from '@alga-psa/types';
import { SERVER_MAINTENANCE_JOBS, CE_MAINTENANCE_JOBS } from '../../lib/jobs/serverMaintenanceJobNames';

describe('runMaintenanceJob', () => {
  beforeEach(() => {
    tenantHandlerMock.mockReset();
    systemHandlerMock.mockReset();
    contractSweepMock.mockReset();
    listTenantsMock.mockReset();
    selectTenantsMock.mockReset();
    selectorTablesSeen.length = 0;
    configuredDateLauncherMock.mockReset().mockResolvedValue(undefined);
    dateScanLauncherCapture.mockReset();
    configureDateTriggerWorkflowLauncher(configuredDateLauncherMock as any);
    tenantHandlerMock.mockResolvedValue(undefined);
    systemHandlerMock.mockResolvedValue(undefined);
    contractSweepMock.mockResolvedValue({ tenantsProcessed: 0, tenantsFailed: 0, summaries: [] });
  });

  function sweepSummary(overrides: { failures?: Array<{ contractLineId: string; error: string }> } = {}) {
    return {
      failures: overrides.failures ?? [],
    };
  }

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

  it('runs the injected date workflow launcher from the maintenance fanout', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't-date' }]);
    await runMaintenanceJob('date-trigger-scan');
    expect(dateScanLauncherCapture).toHaveBeenCalledOnce();
    expect(configuredDateLauncherMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-date', today: '2026-10-01', timezone: 'UTC' }));
  });

  it('does not consult a selector table for jobs that fan out to every tenant', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }]);
    await runMaintenanceJob('auto-close-tickets');
    expect(selectorTablesSeen).toEqual([]);
    expect(selectTenantsMock).not.toHaveBeenCalled();
  });

  it('narrows the Teams sweep to tenants with an active integration (no co-managed rows: native selection unchanged)', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }, { tenant: 't3' }]);
    selectTenantsMock.mockImplementation((table: string) => (table === 'teams_integrations' ? [{ tenant: 't2' }] : []));
    const result = await runMaintenanceJob('sweep-teams-online-meetings');
    expect(selectorTablesSeen).toEqual(['teams_integrations', 'co_managed_meeting_creation_operations', 'online_meetings']);
    expect(tenantHandlerMock).toHaveBeenCalledTimes(1);
    expect(tenantHandlerMock).toHaveBeenCalledWith('sweep-teams-online-meetings', { tenantId: 't2' });
    expect(result).toEqual({ jobName: 'sweep-teams-online-meetings', scope: 'tenant', total: 1, succeeded: 1, failed: 0 });
  });

  it('also sweeps co-managed workspaces with live operations or sync intents after Teams was deactivated, once each', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }, { tenant: 't3' }, { tenant: 't4' }]);
    selectTenantsMock.mockImplementation((table: string) => ({
      teams_integrations: [{ tenant: 't2' }],
      co_managed_meeting_creation_operations: [{ tenant: 't3' }, { tenant: 't2' }],
      online_meetings: [{ tenant: 't4' }],
    } as Record<string, Array<{ tenant: string }>>)[table]);
    const result = await runMaintenanceJob('sweep-teams-online-meetings');
    expect(result.total).toBe(3);
    for (const tenantId of ['t2', 't3', 't4']) {
      expect(tenantHandlerMock).toHaveBeenCalledWith('sweep-teams-online-meetings', { tenantId });
    }
    expect(tenantHandlerMock).not.toHaveBeenCalledWith('sweep-teams-online-meetings', { tenantId: 't1' });
  });

  it('falls back to the native Teams selection when the co-managed tables or columns are absent', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }]);
    selectTenantsMock.mockImplementation((table: string) => {
      if (table === 'teams_integrations') return [{ tenant: 't2' }];
      throw new Error('relation does not exist');
    });
    const result = await runMaintenanceJob('sweep-teams-online-meetings');
    expect(result.total).toBe(1);
    expect(tenantHandlerMock).toHaveBeenCalledWith('sweep-teams-online-meetings', { tenantId: 't2' });
  });

  it('never runs a selected tenant that is suspended', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }]);
    selectTenantsMock.mockImplementation((table: string) => (table === 'teams_integrations' ? [{ tenant: 't1' }, { tenant: 'suspended' }] : []));
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

  it('narrows the calendar jobs to tenants selected from calendar_providers', async () => {
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }, { tenant: 't3' }]);
    selectTenantsMock.mockReturnValue([{ tenant: 't3' }]);
    for (const jobName of ['renew-microsoft-calendar-webhooks', 'verify-google-calendar-pubsub']) {
      tenantHandlerMock.mockClear();
      selectorTablesSeen.length = 0;
      const result = await runMaintenanceJob(jobName);
      expect(selectorTablesSeen).toEqual(['calendar_providers']);
      expect(tenantHandlerMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ jobName, scope: 'tenant', total: 1, succeeded: 1, failed: 0 });
    }
  });

  it('T001: runs the Microsoft calendar renewal per tenant with the 180 minute look-ahead', async () => {
    expect(isKnownMaintenanceJob('renew-microsoft-calendar-webhooks')).toBe(true);
    expect(listMaintenanceJobNames()).toContain('renew-microsoft-calendar-webhooks');
    expect(MAINTENANCE_FANOUT_SCHEDULES).toContainEqual({ jobName: 'renew-microsoft-calendar-webhooks', cron: '*/30 * * * *' });
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }]);
    selectTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }]);
    const result = await runMaintenanceJob('renew-microsoft-calendar-webhooks');
    expect(result).toEqual({ jobName: 'renew-microsoft-calendar-webhooks', scope: 'tenant', total: 2, succeeded: 2, failed: 0 });
    expect(tenantHandlerMock).toHaveBeenCalledWith('renew-microsoft-calendar-webhooks', { tenantId: 't1', lookAheadMinutes: 180 });
    expect(tenantHandlerMock).toHaveBeenCalledWith('renew-microsoft-calendar-webhooks', { tenantId: 't2', lookAheadMinutes: 180 });
  });

  it('throws for an unknown job name', async () => {
    await expect(runMaintenanceJob('not-a-real-job')).rejects.toThrow(/Unknown maintenance job/);
  });

  it('reports known jobs via isKnownMaintenanceJob', () => {
    expect(isKnownMaintenanceJob('search:reconcile')).toBe(true);
    expect(isKnownMaintenanceJob('sla-timer')).toBe(false);
    expect(isKnownMaintenanceJob('replenishContractCadenceServicePeriods')).toBe(true);
  });

  it('runs contract-cadence replenishment once as a system job', async () => {
    contractSweepMock.mockResolvedValue({
      tenantsProcessed: 3,
      tenantsFailed: 0,
      summaries: [sweepSummary(), sweepSummary(), sweepSummary()],
    });

    const result = await runMaintenanceJob('replenishContractCadenceServicePeriods');

    expect(listTenantsMock).not.toHaveBeenCalled();
    expect(contractSweepMock).toHaveBeenCalledTimes(1);
    expect(contractSweepMock).toHaveBeenCalledWith({
      sourceRunPrefix: 'temporal-contract-cadence-replenishment',
    });
    expect(result).toEqual({
      jobName: 'replenishContractCadenceServicePeriods',
      scope: 'system',
      total: 3,
      succeeded: 3,
      failed: 0,
    });
  });

  it('reports partial contract-cadence failures instead of unconditional success', async () => {
    contractSweepMock.mockResolvedValue({
      tenantsProcessed: 2,
      tenantsFailed: 1,
      summaries: [
        sweepSummary(),
        sweepSummary({ failures: [{ contractLineId: 'line-1', error: 'overlap' }] }),
      ],
    });

    const result = await runMaintenanceJob('replenishContractCadenceServicePeriods');

    // One tenant-level failure plus one line-level failure, none of which the
    // system branch may flatten into succeeded=1.
    expect(result).toEqual({
      jobName: 'replenishContractCadenceServicePeriods',
      scope: 'system',
      total: 4,
      succeeded: 2,
      failed: 2,
    });
  });

  it('propagates a total contract-cadence failure', async () => {
    contractSweepMock.mockRejectedValue(new Error('database unavailable'));

    await expect(runMaintenanceJob('replenishContractCadenceServicePeriods')).rejects.toThrow(
      'database unavailable',
    );
  });

  it('runs a server-registered job through the same fan-out', async () => {
    const serverJob = vi.fn().mockResolvedValue(undefined);
    registerMaintenanceJob('test-server-registered-job', { scope: 'tenant', run: serverJob });
    listTenantsMock.mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }]);

    expect(isKnownMaintenanceJob('test-server-registered-job')).toBe(true);
    const result = await runMaintenanceJob('test-server-registered-job');

    expect(serverJob).toHaveBeenCalledWith('t1');
    expect(serverJob).toHaveBeenCalledWith('t2');
    expect(result).toMatchObject({ scope: 'tenant', total: 2, succeeded: 2, failed: 0 });
  });
});

// EE/appliance runs recurring work only from the worker's maintenance-fanout:*
// schedules. A schedule without a definition fails every tick; a definition
// without a schedule silently never runs in EE (hour-block expiry and
// provider-disconnect retry once shipped that way).
describe('maintenance schedule / fan-out registry parity', () => {
  const scheduled = MAINTENANCE_FANOUT_SCHEDULES.map(({ jobName }) => jobName);
  const serverJobs = Object.values(SERVER_MAINTENANCE_JOBS) as string[];

  it('resolves every Temporal maintenance schedule to a fan-out definition', () => {
    const unresolved = scheduled.filter(
      (jobName) => !isKnownMaintenanceJob(jobName) && !serverJobs.includes(jobName),
    );
    expect(unresolved).toEqual([]);
  });

  it('schedules every fan-out definition on Temporal', () => {
    // CE-only definitions run on pg-boss schedules, never on Temporal.
    const ceOnly = Object.values(CE_MAINTENANCE_JOBS) as string[];
    const definitions = [...listMaintenanceJobNames(), ...serverJobs]
      .filter((jobName) => !jobName.startsWith('test-') && !ceOnly.includes(jobName));
    expect(definitions.filter((jobName) => !scheduled.includes(jobName))).toEqual([]);
  });

  it('runs recurring-ticket generation every 15 minutes, matching the CE pg-boss schedule', () => {
    expect(SERVER_MAINTENANCE_JOBS.generateRecurringTickets).toBe('generate-recurring-tickets');
    expect(MAINTENANCE_FANOUT_SCHEDULES).toContainEqual({ jobName: 'generate-recurring-tickets', cron: '*/15 * * * *' });
  });

  // F009 / T009. A registered pg-boss handler that is recurring but has no
  // `maintenance-fanout:<name>` schedule never runs on EE/appliance (the Microsoft
  // calendar renewal was dead for months that way). Every registered handler name
  // therefore has to be in the EE catalog or be listed here with the reason it
  // is not a recurring EE job. A new handler fails this test until someone
  // decides which it is; do not add a name here to silence it without a reason.
  // `renew-microsoft-calendar-webhooks` must never appear in this list.
  const NOT_AN_EE_MAINTENANCE_JOB: Record<string, string> = {
    // On-demand work, enqueued by an action, an import or an event; never recurring.
    'generate-invoice': 'on-demand: enqueued by billing actions',
    'invoice_zip': 'on-demand: enqueued by the invoice zip export action',
    'invoice_email': 'on-demand: enqueued by the invoice email action',
    'finalize-link-accepted-quote': 'on-demand: enqueued when a quote is accepted',
    'asset_import': 'on-demand: enqueued by an asset import',
    'generate-document-previews': 'on-demand: enqueued after a document upload',
    'kb-article-import': 'on-demand: enqueued by a knowledge base import',
    'search-visible-user-reindex': 'on-demand: enqueued when a user\'s visibility changes (the recurring search job is search:reconcile, scheduled)',
    'search-client-scope-reindex': 'on-demand: enqueued when a client scope changes (the recurring search job is search:reconcile, scheduled)',
    'process-teams-meeting-artifact-notification': 'event-driven: runs per Graph notification (renewal is renew-teams-meeting-artifact-subscriptions, scheduled)',
    'process-telephony-call-notification': 'event-driven: runs per Graph notification (renewal is renew-telephony-call-subscriptions, scheduled)',
    'process-telephony-canonical-call': 'event-driven: runs per canonical call record',
    'process-threecx-call-event': 'event-driven: runs per 3CX call event',
    'process-threecx-chat': 'event-driven: runs per 3CX chat message',
    'sync-threecx-phonebook-contact': 'event-driven: runs per contact change (the recurring reconcile is reconcile-threecx-phonebook, scheduled)',
    // Recurring, but not through the maintenance fan-out.
    'marketing:flip-due-posts': 'recurring, scheduled by the EE marketingFanoutWorkflow Temporal schedules (setupSchedules.ts), not the maintenance fan-out',
    'marketing:expire-stale-targets': 'recurring, scheduled by the EE marketingFanoutWorkflow Temporal schedules (setupSchedules.ts), not the maintenance fan-out',
    'marketing:send-sequence-steps': 'recurring, scheduled by the EE marketingFanoutWorkflow Temporal schedules (setupSchedules.ts), not the maintenance fan-out',
    'sla-timer': 'CE-only recurring job (CE_MAINTENANCE_JOBS, pg-boss); EE runs SLA timing through its own mechanism',
  };

  async function registeredHandlerNames(): Promise<string[]> {
    const { getAvailableJobHandlers } = await import('../../lib/jobs/registerAllHandlers');
    const previous = { EDITION: process.env.EDITION, NEXT_PUBLIC_EDITION: process.env.NEXT_PUBLIC_EDITION };
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    try {
      return [...new Set(getAvailableJobHandlers())];
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }

  it('gives every registered handler an EE maintenance schedule or an explicit exemption', async () => {
    const names = await registeredHandlerNames();
    const unclassified = names.filter(
      (name) => !scheduled.includes(name) && !(name in NOT_AN_EE_MAINTENANCE_JOB),
    );
    expect(unclassified).toEqual([]);
  });

  it('never exempts the Microsoft calendar renewal and keeps the exemption list honest', async () => {
    expect(NOT_AN_EE_MAINTENANCE_JOB).not.toHaveProperty('renew-microsoft-calendar-webhooks');
    expect(scheduled).toContain('renew-microsoft-calendar-webhooks');
    const names = await registeredHandlerNames();
    // An exemption for a name that is scheduled, or no longer registered, is stale.
    expect(Object.keys(NOT_AN_EE_MAINTENANCE_JOB).filter((name) => scheduled.includes(name) || !names.includes(name))).toEqual([]);
    for (const reason of Object.values(NOT_AN_EE_MAINTENANCE_JOB)) expect(reason.trim().length).toBeGreaterThan(0);
  });

  it('schedules each job exactly once', () => {
    expect(new Set(scheduled).size).toBe(scheduled.length);
  });
});
