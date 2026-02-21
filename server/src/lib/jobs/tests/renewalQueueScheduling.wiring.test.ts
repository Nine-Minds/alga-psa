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
const initializeJobRunnerSource = readFileSync(
  new URL('../initializeJobRunner.ts', import.meta.url),
  'utf8'
);
const renewalHandlerSource = readFileSync(
  new URL('../handlers/processRenewalQueueHandler.ts', import.meta.url),
  'utf8'
);
const temporalRunnerSource = readFileSync(
  new URL('../../../../../ee/server/src/lib/jobs/runners/TemporalJobRunner.ts', import.meta.url),
  'utf8'
);
const jobRunnerFactorySource = readFileSync(
  new URL('../JobRunnerFactory.ts', import.meta.url),
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
    expect(renewalHandlerSource).toContain('normalizeClientContract');
    expect(renewalHandlerSource).toContain("'c.status': 'active',");
    expect(renewalHandlerSource).toContain('if (!decisionDueDate || decisionDueDate < today || decisionDueDate > horizonDate) {');
  });

  it('upserts eligible renewal-cycle work item state for newly due contracts', () => {
    expect(renewalHandlerSource).toContain('const cycleChanged =');
    expect(renewalHandlerSource).toContain('const updates: Record<string, unknown> = {};');
    expect(renewalHandlerSource).toContain('updates.decision_due_date = decisionDueDate;');
    expect(renewalHandlerSource).toContain("updates.status = 'pending';");
    expect(renewalHandlerSource).toContain('updates.renewal_cycle_key = nextCycleKey;');
    expect(renewalHandlerSource).toContain('updates.created_ticket_id = null;');
    expect(renewalHandlerSource).toContain('updates.created_draft_contract_id = null;');
    expect(renewalHandlerSource).toContain("await knex('client_contracts')");
    expect(renewalHandlerSource).toContain('.update({');
    expect(renewalHandlerSource).toContain('upsertedCount += 1;');
  });

  it('respects tenant default due-date action policy during scheduled processing', () => {
    expect(renewalHandlerSource).toContain('const DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY = \'create_ticket\' as const;');
    expect(renewalHandlerSource).toContain('const resolveRenewalDueDateActionPolicy = (value: unknown): \'queue_only\' | \'create_ticket\' => (');
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('default_billing_settings', 'renewal_due_date_action_policy') ?? false");
    expect(renewalHandlerSource).toContain("defaultSelections.push('dbs.renewal_due_date_action_policy as tenant_renewal_due_date_action_policy');");
    expect(renewalHandlerSource).toContain('const tenantDueDateActionPolicy = resolveRenewalDueDateActionPolicy(');
    expect(renewalHandlerSource).toContain('const effectiveDueDateActionPolicy = useTenantRenewalDefaults');
    expect(renewalHandlerSource).toContain('queueOnlyPolicyCount += 1;');
    expect(renewalHandlerSource).toContain('createTicketPolicyCount += 1;');
  });

  it('respects contract-level due-date action policy override during scheduled processing', () => {
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'use_tenant_renewal_defaults') ?? false");
    expect(renewalHandlerSource).toContain('const resolveUseTenantRenewalDefaults = (value: unknown): boolean => (');
    expect(renewalHandlerSource).toContain('const resolveOptionalRenewalDueDateActionPolicy = (value: unknown): \'queue_only\' | \'create_ticket\' | null => (');
    expect(renewalHandlerSource).toContain('const useTenantRenewalDefaults = hasUseTenantRenewalDefaultsColumn');
    expect(renewalHandlerSource).toContain('const contractOverrideDueDateActionPolicy = hasContractDueDateActionPolicyColumn');
    expect(renewalHandlerSource).toContain('const effectiveDueDateActionPolicy = useTenantRenewalDefaults');
    expect(renewalHandlerSource).toContain('contractOverrideDueDateActionPolicy ?? tenantDueDateActionPolicy;');
    expect(renewalHandlerSource).toContain('contractOverridePolicyCount += 1;');
    expect(renewalHandlerSource).toContain('updates.renewal_due_date_action_policy = effectiveDueDateActionPolicy;');
  });

  it('creates internal renewal tickets at due date when effective policy is create_ticket', () => {
    expect(renewalHandlerSource).toContain('const shouldCreateTicketAtDueDate =');
    expect(renewalHandlerSource).toContain("effectiveDueDateActionPolicy === 'create_ticket'");
    expect(renewalHandlerSource).toContain('decisionDueDate <= today;');
    expect(renewalHandlerSource).toContain('createRenewalTicketDirectly({');
    expect(renewalHandlerSource).toContain('updates.created_ticket_id = createdTicketId;');
    expect(renewalHandlerSource).toContain('createdTicketCount += 1;');
  });

  it('calls workflow runtime tickets.create action for renewal ticket creation path', () => {
    expect(renewalHandlerSource).toContain("import { initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime/init';");
    expect(renewalHandlerSource).toContain("import { getActionRegistryV2 } from '@shared/workflow/runtime/registries/actionRegistry';");
    expect(renewalHandlerSource).toContain('const tryCreateRenewalTicketViaWorkflowAction = async (params: {');
    expect(renewalHandlerSource).toContain('initializeWorkflowRuntimeV2();');
    expect(renewalHandlerSource).toContain("const ticketCreateAction = getActionRegistryV2().get('tickets.create', 1);");
    expect(renewalHandlerSource).toContain('const actionInput = ticketCreateAction.inputSchema.parse({');
    expect(renewalHandlerSource).toContain('const actionResult = await ticketCreateAction.handler(actionInput, {');
    expect(renewalHandlerSource).toContain("stepPath: RENEWAL_QUEUE_ACTION_STEP_PATH,");
  });

  it('populates renewal ticket title with client and contract context', () => {
    expect(renewalHandlerSource).toContain('const buildRenewalTicketTitle = (row: Record<string, unknown>, decisionDueDate: string): string => {');
    expect(renewalHandlerSource).toContain("const clientName = typeof row.client_name === 'string' && row.client_name.trim().length > 0");
    expect(renewalHandlerSource).toContain("const contractName = typeof row.contract_name === 'string' && row.contract_name.trim().length > 0");
    expect(renewalHandlerSource).toContain('return `Renewal Decision Due ${decisionDueDate}: ${clientName} / ${contractName}`;');
    expect(renewalHandlerSource).toContain('const ticketTitle = buildRenewalTicketTitle(row as Record<string, unknown>, decisionDueDate);');
  });

  it('populates renewal ticket description with due date and renewal settings context', () => {
    expect(renewalHandlerSource).toContain('const buildRenewalTicketDescription = (');
    expect(renewalHandlerSource).toContain("const renewalMode = typeof normalized.effective_renewal_mode === 'string'");
    expect(renewalHandlerSource).toContain("const noticePeriod = typeof normalized.effective_notice_period_days === 'number'");
    expect(renewalHandlerSource).toContain('`Decision due date: ${decisionDueDate}`');
    expect(renewalHandlerSource).toContain('`Renewal mode: ${renewalMode}`');
    expect(renewalHandlerSource).toContain('`Notice period (days): ${noticePeriod}`');
    expect(renewalHandlerSource).toContain('const ticketDescription = buildRenewalTicketDescription(');
  });

  it('populates renewal ticket routing fields from effective renewal ticket defaults', () => {
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_board_id') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_status_id') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_priority') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_assignee_id') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'renewal_ticket_board_id') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'renewal_ticket_status_id') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'renewal_ticket_priority') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'renewal_ticket_assignee_id') ?? false");
    expect(renewalHandlerSource).toContain('const boardId = useTenantRenewalDefaults ? tenantBoardId : (contractBoardId ?? tenantBoardId);');
    expect(renewalHandlerSource).toContain('const statusId = useTenantRenewalDefaults ? tenantStatusId : (contractStatusId ?? tenantStatusId);');
    expect(renewalHandlerSource).toContain('const priorityId = useTenantRenewalDefaults ? tenantPriorityId : (contractPriorityId ?? tenantPriorityId);');
    expect(renewalHandlerSource).toContain('const assignedTo = useTenantRenewalDefaults ? tenantAssignedTo : (contractAssignedTo ?? tenantAssignedTo);');
  });

  it('persists created ticket id on renewal work item after successful ticket creation', () => {
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'created_ticket_id') ?? false");
    expect(renewalHandlerSource).toContain('updates.created_ticket_id = createdTicketId;');
    expect(renewalHandlerSource).toContain("await knex('client_contracts')");
    expect(renewalHandlerSource).toContain('...updates,');
  });

  it('uses tenant/client-contract/cycle idempotency key for renewal ticket creation', () => {
    expect(renewalHandlerSource).toContain('const buildRenewalTicketIdempotencyKey = (params: {');
    expect(renewalHandlerSource).toContain('): string => `renewal-ticket:${params.tenantId}:${params.clientContractId}:${params.cycleKey}`;');
    expect(renewalHandlerSource).toContain('const idempotencyKey = buildRenewalTicketIdempotencyKey({');
    expect(renewalHandlerSource).toContain('idempotency_key: params.idempotencyKey,');
    expect(renewalHandlerSource).toContain('idempotency_key: params.idempotencyKey,');
  });

  it('skips duplicate ticket creation when idempotent renewal cycle already has linked ticket', () => {
    expect(renewalHandlerSource).toContain("schema?.hasTable?.('tickets') ?? false");
    expect(renewalHandlerSource).toContain("whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
    expect(renewalHandlerSource).toContain('const existingTicketId = normalizeOptionalUuid(existingTicket?.ticket_id);');
    expect(renewalHandlerSource).toContain('createdTicketId = existingTicketId;');
    expect(renewalHandlerSource).toContain('duplicateTicketSkipCount += 1;');
  });

  it('records automation_error on work item when renewal ticket creation fails', () => {
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'automation_error') ?? false");
    expect(renewalHandlerSource).toContain("updates.automation_error = ticketAutomationError ?? 'Renewal ticket automation failed';");
    expect(renewalHandlerSource).toContain("updates.automation_error = 'Missing renewal ticket routing defaults for create_ticket policy';");
    expect(renewalHandlerSource).toContain('automationErrorCount += 1;');
    expect(renewalHandlerSource).toContain('updates.automation_error = null;');
  });

  it('supports queue-only due-date policy by skipping ticket creation', () => {
    expect(renewalHandlerSource).toContain("if (effectiveDueDateActionPolicy === 'queue_only') {");
    expect(renewalHandlerSource).toContain('queueOnlyPolicyCount += 1;');
    expect(renewalHandlerSource).toContain("&& effectiveDueDateActionPolicy === 'create_ticket'");
  });

  it('generates renewal queue entries for evergreen contracts via annual-cycle normalization', () => {
    expect(renewalHandlerSource).toContain('const normalized = normalizeClientContract(row as any) as unknown as Record<string, unknown>;');
    expect(renewalHandlerSource).toContain('const nextCycleStart = normalizeOptionalDateOnly(normalized.renewal_cycle_start);');
    expect(renewalHandlerSource).toContain('const nextCycleEnd = normalizeOptionalDateOnly(normalized.renewal_cycle_end);');
    expect(renewalHandlerSource).toContain('updates.renewal_cycle_key = nextCycleKey;');
    expect(renewalHandlerSource).toContain('if (!decisionDueDate || decisionDueDate < today || decisionDueDate > horizonDate) {');
  });

  it('rolls evergreen cycles forward to the next annual window after completion when cycle key advances', () => {
    expect(renewalHandlerSource).toContain('const previousCycleKey =');
    expect(renewalHandlerSource).toContain('const nextCycleKey =');
    expect(renewalHandlerSource).toContain('const cycleChanged =');
    expect(renewalHandlerSource).toContain('const shouldNormalizeStatus = !isKnownRenewalStatus(currentStatus) || cycleChanged;');
    expect(renewalHandlerSource).toContain("updates.status = 'pending';");
    expect(renewalHandlerSource).toContain('updates.renewal_cycle_key = nextCycleKey;');
    expect(renewalHandlerSource).toContain('if (cycleChanged) {');
    expect(renewalHandlerSource).toContain('newCycleCount += 1;');
  });

  it('prevents duplicate evergreen cycle entries for the same annual period during processing', () => {
    expect(renewalHandlerSource).toContain('let duplicateCycleSkipCount = 0;');
    expect(renewalHandlerSource).toContain('const processedCycleKeys = new Set<string>();');
    expect(renewalHandlerSource).toContain('const dedupeCycleKey = nextCycleKey ?? decisionDueDate;');
    expect(renewalHandlerSource).toContain('const cycleDedupeIdentity = `${(row as any).client_contract_id}:${dedupeCycleKey}`;');
    expect(renewalHandlerSource).toContain('if (processedCycleKeys.has(cycleDedupeIdentity)) {');
    expect(renewalHandlerSource).toContain('duplicateCycleSkipCount += 1;');
    expect(renewalHandlerSource).toContain('processedCycleKeys.add(cycleDedupeIdentity);');
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

  it('registers renewal queue scheduling in the on-prem pg-boss initialization path', () => {
    expect(scheduledInitSource).toContain('const renewalQueueJobId = await scheduleRenewalQueueProcessingJob(tenantId, 90, cron);');
    expect(scheduledInitSource).toContain('logger.info(`Scheduled renewal queue processing job for tenant ${tenantId} with job ID ${renewalQueueJobId}`);');
    expect(scheduledInitSource).toContain("logger.info('Renewal queue processing job already scheduled (singleton active)', {");
  });

  it('uses shared renewal processing core logic in both pg-boss and Temporal adapter registration paths', () => {
    expect(jobsIndexSource).toContain("import { processRenewalQueueHandler, RenewalQueueProcessorJobData } from './handlers/processRenewalQueueHandler';");
    expect(jobsIndexSource).toContain("jobScheduler.registerJobHandler<RenewalQueueProcessorJobData>(");
    expect(jobsIndexSource).toContain("'process-renewal-queue',");
    expect(jobsIndexSource).toContain('await processRenewalQueueHandler(job.data);');
    expect(registerHandlersSource).toContain("import {\n  processRenewalQueueHandler,\n  RenewalQueueProcessorJobData,\n} from './handlers/processRenewalQueueHandler';");
    expect(registerHandlersSource).toContain("name: 'process-renewal-queue',");
    expect(registerHandlersSource).toContain('await processRenewalQueueHandler(data);');
    expect(initializeJobRunnerSource).toContain('await registerAllJobHandlers({');
    expect(initializeJobRunnerSource).toContain('runner.registerHandler(registered.config);');
  });

  it('keeps queue-creation payload parity between pg-boss and Temporal scheduling paths', () => {
    expect(jobsIndexSource).toContain('export const scheduleRenewalQueueProcessingJob = async (');
    expect(jobsIndexSource).toContain("'process-renewal-queue',");
    expect(jobsIndexSource).toContain('{ tenantId, horizonDays }');
    expect(temporalRunnerSource).toContain('jobName,');
    expect(temporalRunnerSource).toContain('tenantId: data.tenantId,');
    expect(temporalRunnerSource).toContain('data,');
    expect(temporalRunnerSource).toContain("workflowType: 'genericJobWorkflow',");
  });

  it('keeps ticket idempotency behavior parity because both runners execute the same renewal handler core', () => {
    expect(renewalHandlerSource).toContain('const buildRenewalTicketIdempotencyKey = (params: {');
    expect(renewalHandlerSource).toContain("whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
    expect(renewalHandlerSource).toContain('const existingTicketId = normalizeOptionalUuid(existingTicket?.ticket_id);');
    expect(renewalHandlerSource).toContain('duplicateTicketSkipCount += 1;');
    expect(registerHandlersSource).toContain('await processRenewalQueueHandler(data);');
    expect(jobsIndexSource).toContain('await processRenewalQueueHandler(job.data);');
  });

  it('honors JobRunnerFactory runtime selection without adding edition-specific forks to renewal business logic', () => {
    expect(jobRunnerFactorySource).toContain('private determineRunnerType(');
    expect(jobRunnerFactorySource).toContain('const envType = process.env.JOB_RUNNER_TYPE?.toLowerCase();');
    expect(jobRunnerFactorySource).toContain("if (envType === 'temporal' || envType === 'pgboss') {");
    expect(jobRunnerFactorySource).toContain('if (runnerType === \'temporal\' && isEnterprise) {');
    expect(renewalHandlerSource).not.toContain('process.env.EDITION');
    expect(renewalHandlerSource).not.toContain('JOB_RUNNER_TYPE');
  });

  it('falls back gracefully to pg-boss when temporal bootstrap is unavailable', () => {
    expect(jobRunnerFactorySource).toContain("if (runnerType === 'temporal' && isEnterprise) {");
    expect(jobRunnerFactorySource).toContain('return await this.createTemporalRunner(config);');
    expect(jobRunnerFactorySource).toContain('if (');
    expect(jobRunnerFactorySource).toContain("runnerType === 'temporal' &&");
    expect(jobRunnerFactorySource).toContain('config?.fallbackToPgBoss !== false');
    expect(jobRunnerFactorySource).toContain("logger.warn('Falling back to PG Boss job runner');");
    expect(jobRunnerFactorySource).toContain('return await this.createPgBossRunner(config);');
    expect(jobRunnerFactorySource).toContain("logger.error('Failed to load TemporalJobRunner:', error);");
    expect(jobRunnerFactorySource).toContain(
      "'TemporalJobRunner not available. Ensure EE modules are properly installed.'"
    );
  });

  it('preserves tenant-scoped execution semantics in both pg-boss and Temporal runtime paths', () => {
    expect(jobsIndexSource).toContain('export const scheduleRenewalQueueProcessingJob = async (');
    expect(jobsIndexSource).toContain('tenantId: string,');
    expect(jobsIndexSource).toContain('{ tenantId, horizonDays }');

    expect(renewalHandlerSource).toContain("const tenantId = typeof data.tenantId === 'string' ? data.tenantId : '';");
    expect(renewalHandlerSource).toContain("throw new Error('Tenant ID is required for renewal queue processing job');");
    expect(renewalHandlerSource).toContain("'cc.tenant': tenantId,");
    expect(renewalHandlerSource).toContain(".where({ tenant_id: tenantId })");
    expect(renewalHandlerSource).toContain('tenant: tenantId,');

    expect(temporalRunnerSource).toContain("throw new Error('tenantId is required in job data');");
    expect(temporalRunnerSource).toContain('tenantId: data.tenantId,');
    expect(temporalRunnerSource).toContain('.where({ tenant: data.tenantId })');
  });
});
