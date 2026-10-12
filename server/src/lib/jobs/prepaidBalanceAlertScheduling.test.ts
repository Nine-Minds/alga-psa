import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MAINTENANCE_FANOUT_SCHEDULES, resolveCeMaintenanceSchedules } from '@alga-psa/types';

const initializeSource = readFileSync(resolve(__dirname, 'initializeScheduledJobs.ts'), 'utf8');
const ceCatalogSource = readFileSync(resolve(__dirname, '../../../../packages/types/src/constants/ceMaintenanceSchedules.ts'), 'utf8');
const convergeSource = readFileSync(resolve(__dirname, 'convergeCeMaintenanceSchedules.ts'), 'utf8');
const jobsIndexSource = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
const registerSource = readFileSync(resolve(__dirname, 'registerAllHandlers.ts'), 'utf8');
const fanoutSource = readFileSync(resolve(__dirname, '../../../../packages/jobs/src/lib/maintenanceJobFanout.ts'), 'utf8');
// setupSchedules applies the schedule policies; the cron catalog lives beside it.
const temporalSource = [
  readFileSync(resolve(__dirname, '../../../../ee/temporal-workflows/src/schedules/setupSchedules.ts'), 'utf8'),
  readFileSync(resolve(__dirname, '../../../../packages/types/src/constants/maintenanceFanoutSchedules.ts'), 'utf8'),
].join('\n');

describe('prepaid-balance-alert-scan scheduling contract', () => {
  it('uses the separate job name and never overloads expiring-credits-notification', () => {
    expect(registerSource).toContain("name: PREPAID_BALANCE_ALERT_SCAN_JOB");
    expect(fanoutSource).toContain('[PREPAID_BALANCE_ALERT_SCAN_JOB]');
  });

  it('schedules one global CE fan-out schedule at 0 9 * * *, the same cron as EE', () => {
    expect(resolveCeMaintenanceSchedules({})).toContainEqual({ jobName: 'prepaid-balance-alert-scan', cron: '0 9 * * *' });
    expect(MAINTENANCE_FANOUT_SCHEDULES).toContainEqual({ jobName: 'prepaid-balance-alert-scan', cron: '0 9 * * *' });
    expect(ceCatalogSource).toContain("'prepaid-balance-alert-scan'");
    // The legacy per-tenant wrapper is gone; convergence owns the schedule.
    expect(jobsIndexSource).not.toContain('schedulePrepaidBalanceAlertScanJob');
    expect(initializeSource).not.toContain('schedulePrepaidBalanceAlertScanJob');
    expect(initializeSource).toContain('convergeCeMaintenanceSchedules(');
  });

  it('CE convergence skips non-pg-boss (enterprise/Temporal) runners', () => {
    expect(convergeSource).toContain("runner.getRunnerType() !== 'pgboss'");
    expect(convergeSource).toContain("return 'temporal-authority'");
    expect(initializeSource).toContain('isEnterpriseWorkflowEdition()');
  });

  it('leaves expiring-credits-notification scheduling on the same CE fan-out path', () => {
    expect(resolveCeMaintenanceSchedules({})).toContainEqual({ jobName: 'expiring-credits-notification', cron: '0 9 * * *' });
    expect(registerSource).toContain("'expiring-credits-notification'");
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
