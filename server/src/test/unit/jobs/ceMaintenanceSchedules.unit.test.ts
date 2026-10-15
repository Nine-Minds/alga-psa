import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseExpression } from 'cron-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantHandlerMock = vi.fn();
const systemHandlerMock = vi.fn();
const contractSweepMock = vi.fn();
const listTenantsMock = vi.fn();
const slaTimerMock = vi.fn();
const acquireLockMock = vi.fn();
const releaseMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => (table: string) => {
    const selector: any = {
      whereNull: (column: string) => { expect(column).toBe('suspended_at'); return selector; },
      where: () => selector,
      whereNotNull: () => selector,
      select: () => Promise.resolve(table === 'tenants' ? listTenantsMock() : []),
      distinct: () => Promise.resolve([]),
    };
    return selector;
  },
}));
vi.mock('../../../lib/eventBus/subscribers/maintenanceJobLock', () => ({
  acquireMaintenanceJobLock: (...args: unknown[]) => acquireLockMock(...args),
}));
vi.mock('../../../lib/jobs/handlers/slaTimerHandler', () => ({ slaTimerHandler: (...a: unknown[]) => slaTimerMock(...a) }));
vi.mock('../../../lib/jobs/handlers/emailWebhookMaintenanceHandler', () => ({ emailWebhookMaintenanceHandler: vi.fn() }));
vi.mock('../../../lib/jobs/dateTriggerWorkflowLauncher', () => ({ configureEditionDateTriggerWorkflowLauncher: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/expiredCreditsHandler', () => ({ expiredCreditsHandler: (...a: unknown[]) => tenantHandlerMock('expired-credits', ...a) }));
vi.mock('@alga-psa/jobs/handlers/dateTriggerScanHandler', () => ({ createDateTriggerScanHandler: (launcher: unknown) => { dateScanLauncherCapture(launcher); return async ({ tenantId }: { tenantId: string }) => { if (typeof launcher === 'function') await (launcher as Function)({ tenantId, today: '2026-10-01', now: new Date('2026-10-01T12:00:00Z'), timezone: 'UTC', knex: {}, sources: [] }); }; } }));
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
vi.mock('@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization', () => ({
  replenishContractCadenceServicePeriodsSweep: (...a: unknown[]) => contractSweepMock(...a),
}));

import { registerMaintenanceJob, isKnownMaintenanceJob, runMaintenanceJob } from '@alga-psa/jobs/fanout';
import {
  CE_SHARED_MAINTENANCE_JOBS,
  CE_ONLY_MAINTENANCE_SCHEDULES,
  MAINTENANCE_FANOUT_SCHEDULES,
  resolveCeMaintenanceSchedules,
} from '@alga-psa/types';
import { convergeCeMaintenanceSchedules } from '../../../lib/jobs/convergeCeMaintenanceSchedules';
import { registerCeMaintenanceJobs } from '../../../lib/jobs/registerCeMaintenanceJobs';
import { registerServerMaintenanceJobs } from '../../../lib/jobs/registerServerMaintenanceJobs';
import { runMaintenanceJobExclusive } from '../../../lib/jobs/runMaintenanceJobExclusive';
import { CE_MAINTENANCE_JOBS } from '../../../lib/jobs/serverMaintenanceJobNames';

const repoRoot = resolve(__dirname, '../../../../..');
const catalog = resolveCeMaintenanceSchedules({});
const cronOf = (jobName: string) => catalog.find((e) => e.jobName === jobName)?.cron;

function firesBetween(cron: string, start: string, end: string, tz = 'UTC'): number {
  const it = parseExpression(cron, { tz, currentDate: new Date(new Date(start).getTime() - 1), endDate: new Date(end) });
  let n = 0;
  for (;;) {
    try { const d = it.next(); if (d.getTime() >= new Date(end).getTime()) break; n += 1; } catch { break; }
  }
  return n;
}

describe('CE maintenance schedule catalog', () => {
  it('schedules the sub-daily jobs at their cron cadence', () => {
    expect(cronOf('auto-close-tickets')).toBe('*/15 * * * *');
    expect(cronOf('sla-timer')).toBe('*/5 * * * *');
    expect(cronOf('email-webhook-maintenance')).toBe('0 4 * * *');
  });

  it('fires 4x/hour for auto-close-tickets and 12x/hour for sla-timer in UTC', () => {
    const [s, e] = ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'];
    expect(firesBetween(cronOf('auto-close-tickets')!, s, e)).toBe(4);
    expect(firesBetween(cronOf('sla-timer')!, s, e)).toBe(12);
  });

  it('every entry fires at least once a day', () => {
    for (const { jobName, cron } of catalog) {
      expect(firesBetween(cron, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'), jobName).toBeGreaterThanOrEqual(1);
    }
  });

  it('shares crons with the EE catalog and lists each name once', () => {
    for (const jobName of CE_SHARED_MAINTENANCE_JOBS) {
      expect(cronOf(jobName)).toBe(MAINTENANCE_FANOUT_SCHEDULES.find((s) => s.jobName === jobName)?.cron);
    }
    expect(catalog).toHaveLength(CE_SHARED_MAINTENANCE_JOBS.length + CE_ONLY_MAINTENANCE_SCHEDULES.length);
    expect(new Set(catalog.map((e) => e.jobName)).size).toBe(catalog.length);
    expect(catalog.map((e) => e.jobName)).not.toContain('renew-microsoft-calendar-webhooks');
  });

  it('resolves every entry to a registered fan-out definition', () => {
    registerServerMaintenanceJobs();
    registerCeMaintenanceJobs();
    expect(catalog.filter((e) => !isKnownMaintenanceJob(e.jobName)).map((e) => e.jobName)).toEqual([]);
  });

  it('applies valid env overrides and falls back on invalid ones', () => {
    const ok = resolveCeMaintenanceSchedules({ UNIFIED_INBOUND_EMAIL_RECOVERY_CRON: '*/10 * * * *' }, { isValidCron: (c) => c === '*/10 * * * *' });
    expect(ok.find((e) => e.jobName === 'inbound-email-recovery')?.cron).toBe('*/10 * * * *');
    const onInvalid = vi.fn();
    const bad = resolveCeMaintenanceSchedules({ PROVIDER_DISCONNECT_RETRY_CRON: 'nope' }, { isValidCron: () => false, onInvalidOverride: onInvalid });
    expect(bad.find((e) => e.jobName === 'provider-disconnect-retry')?.cron)
      .toBe(MAINTENANCE_FANOUT_SCHEDULES.find((s) => s.jobName === 'provider-disconnect-retry')?.cron);
    expect(onInvalid).toHaveBeenCalled();
  });
});

describe('convergeCeMaintenanceSchedules', () => {
  function fakeRunner(type: string, existing: string[] = []) {
    return {
      getRunnerType: () => type,
      scheduleGlobalRecurringJob: vi.fn().mockResolvedValue(undefined),
      listGlobalRecurringJobs: vi.fn().mockResolvedValue(existing.map((scheduleId) => ({ scheduleId, cron: '* * * * *', timezone: 'UTC' }))),
      unscheduleGlobalRecurringJob: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('does nothing on a Temporal runner', async () => {
    const runner = fakeRunner('temporal');
    expect(await convergeCeMaintenanceSchedules(runner as any, {})).toBe('temporal-authority');
    expect(runner.scheduleGlobalRecurringJob).not.toHaveBeenCalled();
    expect(runner.listGlobalRecurringJobs).not.toHaveBeenCalled();
    expect(runner.unscheduleGlobalRecurringJob).not.toHaveBeenCalled();
  });

  it('upserts every entry and removes only stale maintenance-fanout:* schedules', async () => {
    const runner = fakeRunner('pgboss', ['maintenance-fanout:obsolete', 'maintenance-fanout:sla-timer', 'other-queue']);
    const result: any = await convergeCeMaintenanceSchedules(runner as any, {});
    expect(runner.scheduleGlobalRecurringJob).toHaveBeenCalledTimes(catalog.length);
    expect(runner.scheduleGlobalRecurringJob).toHaveBeenCalledWith('maintenance-fanout', '*/5 * * * *', expect.objectContaining({
      scheduleId: 'maintenance-fanout:sla-timer', timezone: 'UTC', data: { jobName: 'sla-timer' }, queuePolicy: 'stately', expireInSeconds: 3600,
    }));
    expect(runner.unscheduleGlobalRecurringJob).toHaveBeenCalledTimes(1);
    expect(runner.unscheduleGlobalRecurringJob).toHaveBeenCalledWith('maintenance-fanout:obsolete');
    expect(result.removed).toEqual(['maintenance-fanout:obsolete']);
  });
});

describe('legacy JobScheduler.scheduleRecurringJob is gone', () => {
  it('is absent from the scheduler types and sources', () => {
    type Scheduler = import('../../../lib/jobs/jobScheduler').IJobScheduler;
    // @ts-expect-error scheduleRecurringJob no longer exists on IJobScheduler
    const probe = (s: Scheduler) => s.scheduleRecurringJob;
    void probe;
    for (const file of ['server/src/lib/jobs/jobScheduler.ts', 'packages/jobs/src/lib/jobs/jobScheduler.ts']) {
      expect(readFileSync(resolve(repoRoot, file), 'utf8')).not.toContain('scheduleRecurringJob');
    }
  });
});

describe('maintenance-fanout handler', () => {
  beforeEach(() => {
    listTenantsMock.mockReset().mockReturnValue([{ tenant: 't1' }, { tenant: 't2' }]);
    slaTimerMock.mockReset().mockResolvedValue(undefined);
    releaseMock.mockReset().mockResolvedValue(undefined);
    acquireLockMock.mockReset().mockResolvedValue({ release: releaseMock });
  });

  it('runs the sla-timer definition once per non-suspended tenant under the lock', async () => {
    registerServerMaintenanceJobs();
    registerCeMaintenanceJobs();
    const { JobHandlerRegistry } = await import('../../../lib/jobs/jobHandlerRegistry');
    void JobHandlerRegistry;
    await runMaintenanceJobExclusive(CE_MAINTENANCE_JOBS.slaTimer);
    expect(acquireLockMock).toHaveBeenCalledWith('sla-timer');
    expect(slaTimerMock).toHaveBeenCalledTimes(2);
    expect(slaTimerMock).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('skips when the lock is held', async () => {
    acquireLockMock.mockResolvedValue(null);
    await runMaintenanceJobExclusive(CE_MAINTENANCE_JOBS.slaTimer);
    expect(slaTimerMock).not.toHaveBeenCalled();
  });

  it('is wired as a CE-only handler in registerAllHandlers', () => {
    const src = readFileSync(resolve(repoRoot, 'server/src/lib/jobs/registerAllHandlers.ts'), 'utf8');
    expect(src).toContain('MAINTENANCE_FANOUT_JOB');
    expect(src).toContain('runMaintenanceJobExclusive(String(data.jobName))');
  });
});
