import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
const temporalSource = readFileSync(resolve(__dirname, '../../../../ee/temporal-workflows/src/schedules/setupSchedules.ts'), 'utf8');

describe('prepaid auto-replenishment wiring contract', () => {
  it('composes with the existing alert scan and owns the action in the server subscriber', () => {
    expect(subscriberSource).toContain('replenishOpenPrepaidBalanceAlerts');
    expect(subscriberSource).toContain('Feature flag disabled before replenishment');
    expect(handlerSource).toContain('PREPAID_BALANCE_ALERT_SCAN_REQUESTED');
    expect(handlerSource).not.toContain('server/src');
  });

  it('keeps all four maintenance wiring points on the existing singleton rail', () => {
    expect(registerSource).toContain("name: PREPAID_BALANCE_ALERT_SCAN_JOB");
    expect(registerSource).toContain('PREPAID_BALANCE_ALERT_SCAN_JOB');
    expect(jobsIndexSource).toContain('schedulePrepaidBalanceAlertScanJob');
    expect(jobsIndexSource).toContain('isEnterpriseWorkflowEdition()');
    expect(initializeSource).toContain('schedulePrepaidBalanceAlertScanJob(tenantId, cron)');
    expect(fanoutSource).toContain('[PREPAID_BALANCE_ALERT_SCAN_JOB]');
    expect(temporalSource).toContain("'prepaid-balance-alert-scan'");
    expect(temporalSource).toContain('ScheduleOverlapPolicy.SKIP');
    expect(temporalSource).toContain("catchupWindow: '1m'");
  });
});
