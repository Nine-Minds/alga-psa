import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const jobsIndexSource = readFileSync(
  new URL('../index.ts', import.meta.url),
  'utf8'
);
const scheduledInitSource = readFileSync(
  new URL('../initializeScheduledJobs.ts', import.meta.url),
  'utf8'
);
const registerHandlersSource = readFileSync(
  new URL('../registerAllHandlers.ts', import.meta.url),
  'utf8'
);
const renewalHandlerSource = readFileSync(
  new URL('../handlers/processRenewalQueueHandler.ts', import.meta.url),
  'utf8'
);

describe('renewal queue scheduling wiring', () => {
  it('adds a scheduled renewal queue processor handler that scans active contracts in a due window', () => {
    expect(renewalHandlerSource).toContain('export interface RenewalQueueProcessorJobData extends Record<string, unknown> {');
    expect(renewalHandlerSource).toContain('const DEFAULT_RENEWAL_PROCESSING_HORIZON_DAYS = 90;');
    expect(renewalHandlerSource).toContain('export async function processRenewalQueueHandler(data: RenewalQueueProcessorJobData): Promise<void> {');
    expect(renewalHandlerSource).toContain("throw new Error('Tenant ID is required for renewal queue processing job');");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'decision_due_date') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'status') ?? false");
    expect(renewalHandlerSource).toContain("'c.status': 'active',");
    expect(renewalHandlerSource).toContain(".andWhere('cc.decision_due_date', '<=', horizonDate)");
  });

  it('registers and schedules renewal queue processing in the jobs module', () => {
    expect(jobsIndexSource).toContain("import { processRenewalQueueHandler, RenewalQueueProcessorJobData } from './handlers/processRenewalQueueHandler';");
    expect(jobsIndexSource).toContain("jobScheduler.registerJobHandler<RenewalQueueProcessorJobData>(");
    expect(jobsIndexSource).toContain("'process-renewal-queue',");
    expect(jobsIndexSource).toContain('export const scheduleRenewalQueueProcessingJob = async (');
    expect(jobsIndexSource).toContain('return await scheduler.scheduleRecurringJob<RenewalQueueProcessorJobData>(');
    expect(registerHandlersSource).toContain("import {\n  processRenewalQueueHandler,\n  RenewalQueueProcessorJobData,\n} from './handlers/processRenewalQueueHandler';");
    expect(registerHandlersSource).toContain("name: 'process-renewal-queue',");
    expect(registerHandlersSource).toContain('await processRenewalQueueHandler(data);');
    expect(registerHandlersSource).toContain("'process-renewal-queue',");
  });

  it('hooks renewal queue processing into tenant scheduled-job initialization', () => {
    expect(scheduledInitSource).toContain('scheduleRenewalQueueProcessingJob');
    expect(scheduledInitSource).toContain("const cron = '0 5 * * *';");
    expect(scheduledInitSource).toContain('const renewalQueueJobId = await scheduleRenewalQueueProcessingJob(tenantId, 90, cron);');
  });
});
