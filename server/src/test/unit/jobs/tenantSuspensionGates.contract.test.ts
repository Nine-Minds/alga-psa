import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('tenant suspension chokepoint gates', () => {
  it('T015-T017: both job handler registry copies carry the identical dispatch gate', () => {
    for (const registryPath of [
      'packages/jobs/src/lib/jobs/jobHandlerRegistry.ts',
      'server/src/lib/jobs/jobHandlerRegistry.ts',
    ]) {
      const source = read(registryPath);
      expect(source).toContain("data?.tenantId && await this.isTenantGated(data.tenantId)");
      expect(source).toContain("event: 'job_skipped_tenant_suspended'");
      expect(source).toContain('running job anyway');
      expect(source).toContain('isTenantSuspended');
    }
  });

  it('T015: the Temporal worker generic-job dispatch gates on suspension with fail-open', () => {
    const source = read('ee/temporal-workflows/src/activities/job-activities.ts');
    expect(source).toContain("tenantId && tenantId !== SYSTEM_TENANT_ID");
    expect(source).toContain('isTenantSuspended(await getAdminConnection(), tenantId)');
    expect(source).toContain("reason: 'tenant_suspended'");
    expect(source).toContain('running job anyway');
  });

  it('T018: EE maintenance fan-out enumeration excludes suspended tenants', () => {
    const source = read('packages/jobs/src/lib/maintenanceJobFanout.ts');
    expect(source).toMatch(/unscoped[^;]*tenants[^;]*\.whereNull\('suspended_at'\)/s);
  });

  it('T019: marketing tenant enumeration excludes suspended tenants', () => {
    const source = read('ee/temporal-workflows/src/activities/marketing-activities.ts');
    expect(source).toMatch(/listMarketingTenantIds[\s\S]*?\.whereNull\('suspended_at'\)/);
  });

  it('T020: CE scheduled-jobs enumeration excludes suspended tenants', () => {
    const source = read('server/src/lib/jobs/initializeScheduledJobs.ts');
    expect(source).toMatch(/__scheduled_jobs_tenant_enumeration__[\s\S]*?\.whereNull\('suspended_at'\)/);
  });

  it('T021: Entra schedule loader joins tenants and excludes suspended; sync activity re-checks per run', () => {
    const schedules = read('ee/temporal-workflows/src/schedules/setupSchedules.ts');
    expect(schedules).toContain(".join('tenants as t', 's.tenant', 't.tenant')");
    expect(schedules).toContain(".whereNull('t.suspended_at')");

    const activities = read('ee/temporal-workflows/src/activities/entra-sync-activities.ts');
    expect(activities).toContain('isTenantSuspended(await getAdminConnection(), input.tenantId)');
    expect(activities).toContain('return { mappings: [] }');
  });

  it('T022: time-period chain skips suspended tenants while keeping the chain armed', () => {
    const source = read('server/src/lib/initializeApp.ts');
    const existsCheck = source.indexOf('tenant no longer exists, ending job chain');
    const suspendedSkip = source.indexOf('tenant suspended, skipping run (chain continues)');
    const jobRecordCreate = source.indexOf("jobService.createJob('createNextTimePeriods'");

    expect(existsCheck).toBeGreaterThan(-1);
    expect(suspendedSkip).toBeGreaterThan(existsCheck);
    expect(suspendedSkip).toBeLessThan(jobRecordCreate);

    // The startup enumeration must NOT filter: the chain stays armed and the
    // per-run skip is the gate, so win-back resumes without a restart.
    const enumIdx = source.indexOf('__time_period_tenant_enumeration__');
    const enumSlice = source.slice(enumIdx, source.indexOf('select(', enumIdx));
    expect(enumSlice).not.toContain("whereNull('suspended_at')");
  });

  it('T023: billing-cycle creation excludes suspended tenants at each run', () => {
    const source = read('server/src/lib/initializeApp.ts');
    expect(source).toMatch(/__billing_cycle_tenant_enumeration__[\s\S]*?\.whereNull\('suspended_at'\)/);
  });

  it('T025: RMM reconciler treats suspended tenants as ineligible so polls converge off', () => {
    const source = read('packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts');
    expect(source).toContain(".join('tenants as t', 'rmm_integrations.tenant', 't.tenant')");
    expect(source).toContain("'t.suspended_at as tenant_suspended_at'");
    expect(source).toMatch(/eligible\s*=[\s\S]*?!row\.tenant_suspended_at/);
  });
});
