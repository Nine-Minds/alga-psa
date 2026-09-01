import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const initializeSource = readFileSync(resolve(__dirname, 'initializeScheduledJobs.ts'), 'utf8');
const jobsIndexSource = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
const registerSource = readFileSync(resolve(__dirname, 'registerAllHandlers.ts'), 'utf8');
const fanoutSource = readFileSync(resolve(__dirname, '../../../../packages/jobs/src/lib/maintenanceJobFanout.ts'), 'utf8');
const temporalSource = readFileSync(resolve(__dirname, '../../../../ee/temporal-workflows/src/schedules/setupSchedules.ts'), 'utf8');

describe('prepaid-balance-alert-scan scheduling contract', () => {
  it('uses the separate job name and never overloads expiring-credits-notification', () => {
    expect(registerSource).toContain("name: PREPAID_BALANCE_ALERT_SCAN_JOB");
    expect(jobsIndexSource).toContain('PREPAID_BALANCE_ALERT_SCAN_JOB');
    expect(jobsIndexSource).toContain('schedulePrepaidBalanceAlertScanJob');
    expect(fanoutSource).toContain('[PREPAID_BALANCE_ALERT_SCAN_JOB]');
  });

  it('schedules a CE per-tenant singleton at 0 9 * * *', () => {
    expect(jobsIndexSource).toContain("'0 9 * * *'");
    expect(jobsIndexSource).toContain('schedulePrepaidBalanceAlertScanJob');
    expect(initializeSource).toContain('schedulePrepaidBalanceAlertScanJob(tenantId, cron)');
    expect(initializeSource).toContain("const cron = '0 9 * * *'");
  });

  it('CE skips scheduling on enterprise-workflow editions', () => {
    expect(jobsIndexSource).toContain('isEnterpriseWorkflowEdition()');
    expect(jobsIndexSource).toContain('return null; // EE runs this as a global Temporal Schedule (maintenanceJobWorkflow)');
  });

  it('leaves expiring-credits-notification scheduling untouched', () => {
    // The new block is additive; the pre-existing expiring-credits block is intact.
    expect(initializeSource).toContain('scheduleExpiringCreditsNotificationJob(tenantId, undefined, cron)');
    expect(jobsIndexSource).toContain("'expiring-credits-notification'");
  });

  it('EE defines one 09:00 UTC global maintenance fanout with overlap SKIP and a short catch-up window', () => {
    const lines = temporalSource.split('\n');
    const idx = lines.findIndex((line) => line.includes("'prepaid-balance-alert-scan'"));
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx]).toContain("cron: '0 9 * * *'");
    // The schedule is created through the maintenance-fanout loop (one global
    // schedule), not per tenant.
    expect(lines[idx - 1]).toContain('{ jobName:');
    expect(temporalSource).toContain('maintenance-fanout:');
    // Overlap + catch-up conventions are applied to every maintenance schedule.
    expect(temporalSource).toContain('ScheduleOverlapPolicy.SKIP');
    expect(temporalSource).toContain('catchupWindow: \'1m\'');
  });
});
