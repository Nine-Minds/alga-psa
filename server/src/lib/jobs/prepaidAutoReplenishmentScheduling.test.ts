import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveCeMaintenanceSchedules } from '@alga-psa/types';

const subscriberSource = readFileSync(
  resolve(__dirname, '../eventBus/subscribers/prepaidBalanceAlertSubscriber.ts'),
  'utf8',
);
const handlerSource = readFileSync(
  resolve(__dirname, '../../../../packages/jobs/src/lib/handlers/prepaidBalanceAlertScanHandler.ts'),
  'utf8',
);
const jobsIndexSource = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
const initializeSource = readFileSync(resolve(__dirname, 'initializeScheduledJobs.ts'), 'utf8');
const registerSource = readFileSync(resolve(__dirname, 'registerAllHandlers.ts'), 'utf8');
const fanoutSource = readFileSync(resolve(__dirname, '../../../../packages/jobs/src/lib/maintenanceJobFanout.ts'), 'utf8');
// setupSchedules applies the schedule policies; the cron catalog lives beside it.
const temporalSource = [
  readFileSync(resolve(__dirname, '../../../../ee/temporal-workflows/src/schedules/setupSchedules.ts'), 'utf8'),
  readFileSync(resolve(__dirname, '../../../../packages/types/src/constants/maintenanceFanoutSchedules.ts'), 'utf8'),
].join('\n');

describe('prepaid auto-replenishment wiring contract', () => {
  it('composes with the existing alert scan and owns the action in the server subscriber', () => {
    expect(subscriberSource).toContain('replenishOpenPrepaidBalanceAlerts');
    // release-v1-5-feature was retired in dba55c91ab; replenishment is now generally available.
    expect(handlerSource).toContain('PREPAID_BALANCE_ALERT_SCAN_REQUESTED');
    expect(handlerSource).not.toContain('server/src');
  });

  it('keeps all four maintenance wiring points on the maintenance fan-out rail', () => {
    expect(registerSource).toContain("name: PREPAID_BALANCE_ALERT_SCAN_JOB");
    expect(registerSource).toContain('PREPAID_BALANCE_ALERT_SCAN_JOB');
    // CE schedules the scan through the global maintenance fan-out catalog; the
    // per-tenant wrapper is gone.
    expect(resolveCeMaintenanceSchedules({})).toContainEqual({ jobName: 'prepaid-balance-alert-scan', cron: '0 9 * * *' });
    expect(initializeSource).toContain('convergeCeMaintenanceSchedules(');
    expect(initializeSource).toContain('isEnterpriseWorkflowEdition()');
    expect(fanoutSource).toContain('[PREPAID_BALANCE_ALERT_SCAN_JOB]');
    expect(temporalSource).toContain("'prepaid-balance-alert-scan'");
    expect(temporalSource).toContain('ScheduleOverlapPolicy.SKIP');
    expect(temporalSource).toContain("catchupWindow: '1m'");
  });
});
