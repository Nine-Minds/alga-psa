import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const tenantQueryCalls: string[] = [];
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  tenantDb: vi.fn(() => ({
    unscoped: () => {
      const q: any = {
        whereNull: (c: string) => { tenantQueryCalls.push(`whereNull:${c}`); return q; },
        select: async () => [{ tenant: 'a' }, { tenant: 'b' }],
      };
      return q;
    },
  })),
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization', () => ({ replenishContractCadenceServicePeriodsSweep: vi.fn() }));

// The native handler modules pull in other workspace packages whose exports maps
// point at unbuilt dist output; this suite only exercises the fan-out dispatcher.
// Constants (…_JOB…) stay strings, everything else becomes a stub function.
vi.mock('./handlers/expiredCreditsHandler', () => ({ expiredCreditsHandler: vi.fn() }));
vi.mock('./handlers/expiringCreditsNotificationHandler', () => ({ expiringCreditsNotificationHandler: vi.fn() }));
vi.mock('./handlers/prepaidBalanceAlertScanHandler', () => ({ PREPAID_BALANCE_ALERT_SCAN_JOB: 'stub:PREPAID_BALANCE_ALERT_SCAN_JOB', prepaidBalanceAlertScanHandler: vi.fn() }));
vi.mock('./handlers/expiredHourBlocksHandler', () => ({ expiredHourBlocksHandler: vi.fn() }));
vi.mock('./handlers/expiringHourBlocksNotificationHandler', () => ({ expiringHourBlocksNotificationHandler: vi.fn() }));
vi.mock('./handlers/reconcileBucketUsageHandler', () => ({ handleReconcileBucketUsage: vi.fn() }));
vi.mock('./handlers/reconcileHourBlockAllocationsHandler', () => ({ handleReconcileHourBlockAllocations: vi.fn() }));
vi.mock('./handlers/processRenewalQueueHandler', () => ({ processRenewalQueueHandler: vi.fn() }));
vi.mock('./handlers/dateTriggerScanHandler', () => ({ createDateTriggerScanHandler: vi.fn() }));
vi.mock('./handlers/autoCloseTicketsHandler', () => ({ autoCloseTicketsHandler: vi.fn() }));
vi.mock('./handlers/searchReconcileHandler', () => ({ SEARCH_RECONCILE_JOB_NAME: 'stub:SEARCH_RECONCILE_JOB_NAME', searchReconcileHandler: vi.fn() }));
vi.mock('./handlers/calendarWebhookMaintenanceHandler', () => ({ verifyGoogleCalendarProvisioning: vi.fn() }));
vi.mock('./handlers/googleGmailWatchRenewalHandler', () => ({ renewGoogleGmailWatchSubscriptions: vi.fn() }));
vi.mock('./handlers/teamsMeetingArtifactWebhookHandler', () => ({ renewTeamsMeetingArtifactSubscriptions: vi.fn() }));
vi.mock('./handlers/telephonyCallNotificationHandler', () => ({ renewTelephonyCallSubscriptions: vi.fn() }));
vi.mock('./handlers/telephonyCallArtifactHandler', () => ({ TELEPHONY_CALL_ARTIFACT_SWEEP_JOB: 'stub:TELEPHONY_CALL_ARTIFACT_SWEEP_JOB', telephonyCallArtifactSweepHandler: vi.fn() }));
vi.mock('./handlers/teamsMeetingSweepHandler', () => ({ teamsMeetingSweepHandler: vi.fn(), TEAMS_MEETING_SWEEP_JOB: 'stub:TEAMS_MEETING_SWEEP_JOB' }));
vi.mock('./handlers/threecxCallControlReconcileHandler', () => ({ reconcileThreecxCallControlHandler: vi.fn(), THREECX_CALL_CONTROL_RECONCILE_JOB: 'stub:THREECX_CALL_CONTROL_RECONCILE_JOB' }));
vi.mock('./handlers/threecxCdrBackfillHandler', () => ({ backfillThreecxCdrHandler: vi.fn(), THREECX_CDR_BACKFILL_JOB: 'stub:THREECX_CDR_BACKFILL_JOB' }));
vi.mock('./handlers/threecxPhonebookHandlers', () => ({ reconcileThreecxPhonebookHandler: vi.fn(), THREECX_PHONEBOOK_RECONCILE_JOB: 'stub:THREECX_PHONEBOOK_RECONCILE_JOB' }));
vi.mock('./handlers/workflowQuotaResumeScanHandler', () => ({ workflowQuotaResumeScanHandler: vi.fn() }));
vi.mock('./handlers/cleanupAiSessionKeysHandler', () => ({ cleanupAiSessionKeysHandler: vi.fn() }));
vi.mock('./handlers/cleanupTemporaryFormsJob', () => ({ cleanupTemporaryFormsJob: vi.fn() }));
vi.mock('./handlers/cleanupWebhookDeliveriesJob', () => ({ cleanupWebhookDeliveriesJob: vi.fn() }));
vi.mock('./handlers/inboundEmailRecoveryHandler', () => ({ inboundEmailRecoveryHandler: vi.fn() }));
vi.mock('./handlers/providerDisconnectRetryHandler', () => ({ providerDisconnectRetryHandler: vi.fn() }));

import { MAINTENANCE_FANOUT_SCHEDULES, listMaintenanceFanoutSchedules, resolveCeMaintenanceSchedules } from '@alga-psa/types';
import { defineJob, listJobDescriptorNames, registerJobCapabilityFilter, resetJobDescriptors } from './jobDescriptors';
import { isKnownMaintenanceJob, listMaintenanceJobNames, registerMaintenanceJob, runMaintenanceJob } from './maintenanceJobFanout';

afterEach(() => { resetJobDescriptors(); tenantQueryCalls.length = 0; });

describe('jobDescriptors', () => {
  it('with no descriptors the name list is the native list and an unknown job still throws', async () => {
    const names = listMaintenanceJobNames();
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(isKnownMaintenanceJob('co-managed-test-job')).toBe(false);
    await expect(runMaintenanceJob('co-managed-test-job')).rejects.toThrow('Unknown maintenance job');
  });

  it('registration is additive: native names first, descriptor names after', async () => {
    const native = listMaintenanceJobNames();
    const run = vi.fn(async () => ({ total: 2, succeeded: 2, failed: 0 }));
    defineJob({ name: 'ext-job', scope: 'system', run, schedule: { cron: '*/5 * * * *' } });
    expect(listMaintenanceJobNames()).toEqual([...native, 'ext-job']);
    expect(isKnownMaintenanceJob('ext-job')).toBe(true);
    await expect(runMaintenanceJob('ext-job')).resolves.toMatchObject({ jobName: 'ext-job', scope: 'system', total: 2 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects a descriptor that would shadow a native job or a native schedule', () => {
    const [first] = listMaintenanceJobNames();
    expect(() => defineJob({ name: first, scope: 'system', run: async () => undefined })).toThrow('native maintenance job');
    expect(() => defineJob({ name: 'sla-timer', scope: 'system', run: async () => undefined })).toThrow('native maintenance job');
    expect(listJobDescriptorNames()).toEqual([]);
  });

  it('a native registration cannot take a descriptor name', () => {
    defineJob({ name: 'ext-owned', scope: 'system', run: async () => undefined });
    expect(() => registerMaintenanceJob('ext-owned', { scope: 'system', run: async () => undefined })).toThrow('defineJob');
  });

  it('a schedule registers a row both schedulers read, scoped by edition', () => {
    const nativeEe = listMaintenanceFanoutSchedules();
    const nativeCe = resolveCeMaintenanceSchedules({});
    expect(nativeEe).toEqual([...MAINTENANCE_FANOUT_SCHEDULES]);
    defineJob({ name: 'both-eds', scope: 'system', run: async () => undefined, schedule: { cron: '*/5 * * * *' } });
    defineJob({ name: 'ee-only', scope: 'system', run: async () => undefined, schedule: { cron: '0 1 * * *' }, edition: 'ee' });
    defineJob({ name: 'ce-only', scope: 'system', run: async () => undefined, schedule: { cron: '0 2 * * *' }, edition: 'ce' });
    defineJob({ name: 'unscheduled', scope: 'system', run: async () => undefined });
    expect(listMaintenanceFanoutSchedules()).toEqual([
      ...nativeEe,
      { jobName: 'both-eds', cron: '*/5 * * * *' },
      { jobName: 'ee-only', cron: '0 1 * * *' },
    ]);
    expect(resolveCeMaintenanceSchedules({})).toEqual([
      ...nativeCe,
      { jobName: 'both-eds', cron: '*/5 * * * *' },
      { jobName: 'ce-only', cron: '0 2 * * *' },
    ]);
    resetJobDescriptors();
    expect(listMaintenanceFanoutSchedules()).toEqual(nativeEe);
  });

  it('an edition without a schedule is rejected', () => {
    expect(() => defineJob({ name: 'ed', scope: 'system', run: async () => undefined, edition: 'ee' })).toThrow('edition');
  });

  it('rejects duplicate names and malformed crons', () => {
    defineJob({ name: 'dup', scope: 'system', run: async () => undefined });
    expect(() => defineJob({ name: 'dup', scope: 'system', run: async () => undefined })).toThrow('duplicate');
    expect(() => defineJob({ name: 'bad', scope: 'system', run: async () => undefined, schedule: { cron: 'every day' } })).toThrow('malformed cron');
    expect(() => defineJob({ name: 'bad2', scope: 'system', run: async () => undefined, schedule: { cron: '* * * *' } })).toThrow('malformed cron');
  });

  it('includeSuspended only changes the tenant query when set', async () => {
    const seen: string[] = [];
    defineJob({ name: 'plain', scope: 'tenant', run: async (t) => { seen.push(t); } });
    await runMaintenanceJob('plain');
    expect(tenantQueryCalls).toEqual(['whereNull:suspended_at']);
    tenantQueryCalls.length = 0;
    defineJob({ name: 'all', scope: 'tenant', includeSuspended: true, run: async () => undefined });
    await runMaintenanceJob('all');
    expect(tenantQueryCalls).toEqual([]);
    expect(seen).toEqual(['a', 'b']);
  });

  it('a capability-gated job skips before any tenant SQL when no filter is registered', async () => {
    const run = vi.fn(async () => undefined);
    defineJob({ name: 'gated', scope: 'tenant', capability: 'co-managed', run });
    await expect(runMaintenanceJob('gated')).resolves.toEqual({ jobName: 'gated', scope: 'tenant', total: 0, succeeded: 0, failed: 0 });
    expect(tenantQueryCalls).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('a capability-gated job runs only for the tenants the filter serves', async () => {
    const seen: string[] = [];
    const filter = vi.fn(async (_cap: string, ids: readonly string[]) => ids.filter((t) => t === 'b'));
    registerJobCapabilityFilter(filter);
    defineJob({ name: 'gated', scope: 'tenant', capability: 'co-managed', run: async (t) => { seen.push(t); } });
    await expect(runMaintenanceJob('gated')).resolves.toMatchObject({ total: 1, succeeded: 1 });
    expect(filter).toHaveBeenCalledWith('co-managed', ['a', 'b']);
    expect(seen).toEqual(['b']);
  });

  it('an ungated job never consults the capability filter', async () => {
    const filter = vi.fn(async () => []);
    registerJobCapabilityFilter(filter);
    defineJob({ name: 'open', scope: 'tenant', run: async () => undefined });
    await expect(runMaintenanceJob('open')).resolves.toMatchObject({ total: 2 });
    expect(filter).not.toHaveBeenCalled();
  });
});
