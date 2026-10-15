import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveCeMaintenanceSchedules, MAINTENANCE_FANOUT_SCHEDULES } from '@alga-psa/types';

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
  new URL('../../../../../packages/jobs/src/lib/handlers/processRenewalQueueHandler.ts', import.meta.url),
  'utf8'
);
const renewalTicketSource = readFileSync(
  new URL('../../../../../shared/billingClients/renewalTicket.ts', import.meta.url),
  'utf8'
);
const temporalRunnerSource = readFileSync(
  new URL('../../../../../packages/jobs/src/lib/jobs/runners/TemporalJobRunner.ts', import.meta.url),
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
    expect(renewalHandlerSource).toContain("await tenantScopedTable(knex, 'client_contracts', tenantId)");
    expect(renewalHandlerSource).toContain('.update({');
    expect(renewalHandlerSource).toContain('upsertedCount += 1;');
  });

  it('T252: computes and persists decision_due_date plus renewal cycle boundaries for eligible contracts', () => {
    expect(renewalHandlerSource).toContain('const decisionDueDate = normalizeOptionalDateOnly(normalized.decision_due_date);');
    expect(renewalHandlerSource).toContain('const nextCycleStart = normalizeOptionalDateOnly(normalized.renewal_cycle_start);');
    expect(renewalHandlerSource).toContain('const nextCycleEnd = normalizeOptionalDateOnly(normalized.renewal_cycle_end);');
    expect(renewalHandlerSource).toContain('updates.decision_due_date = decisionDueDate;');
    expect(renewalHandlerSource).toContain('updates.renewal_cycle_start = nextCycleStart;');
    expect(renewalHandlerSource).toContain('updates.renewal_cycle_end = nextCycleEnd;');
    expect(renewalHandlerSource).toContain('updates.renewal_cycle_key = nextCycleKey;');
    expect(renewalHandlerSource).toContain("await tenantScopedTable(knex, 'client_contracts', tenantId)");
    expect(renewalHandlerSource).toContain('client_contract_id: (row as any).client_contract_id,');
  });

  it('respects tenant default due-date action policy during scheduled processing', () => {
    expect(renewalHandlerSource).toContain('const DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY = \'create_ticket\' as const;');
    expect(renewalHandlerSource).toContain('const resolveRenewalDueDateActionPolicy = (value: unknown): \'queue_only\' | \'create_ticket\' => (');
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('default_billing_settings', 'renewal_due_date_action_policy') ?? false");
    expect(renewalHandlerSource).toContain("'dbs.renewal_due_date_action_policy as tenant_renewal_due_date_action_policy'");
    expect(renewalHandlerSource).toContain('const tenantDueDateActionPolicy = resolveRenewalDueDateActionPolicy(');
    expect(renewalHandlerSource).toContain('const effectiveDueDateActionPolicy = useTenantRenewalDefaults');
    expect(renewalHandlerSource).toContain('queueOnlyPolicyCount += 1;');
    expect(renewalHandlerSource).toContain('createTicketPolicyCount += 1;');
  });

  it('respects contract-level due-date action policy override during scheduled processing', () => {
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'use_tenant_renewal_defaults') ?? false");
    expect(renewalHandlerSource).toContain('const resolveUseTenantRenewalDefaults = (value: unknown): boolean => (');
    expect(renewalHandlerSource).toContain('const resolveOptionalRenewalDueDateActionPolicy = (value: unknown): \'queue_only\' | \'create_ticket\' | null => (');
    expect(renewalHandlerSource).toContain('const useTenantRenewalDefaults = resolveUseTenantRenewalDefaults((row as any).use_tenant_renewal_defaults);');
    expect(renewalHandlerSource).toContain('const contractOverrideDueDateActionPolicy =');
    expect(renewalHandlerSource).toContain('const effectiveDueDateActionPolicy = useTenantRenewalDefaults');
    expect(renewalHandlerSource).toContain('contractOverrideDueDateActionPolicy ?? tenantDueDateActionPolicy;');
    expect(renewalHandlerSource).toContain('contractOverridePolicyCount += 1;');
    expect(renewalHandlerSource).toContain('updates.renewal_due_date_action_policy = effectiveDueDateActionPolicy;');
  });

  it('creates internal renewal tickets at due date when effective policy is create_ticket', () => {
    expect(renewalHandlerSource).toContain('const shouldCreateTicketAtDueDate =');
    expect(renewalHandlerSource).toContain("effectiveDueDateActionPolicy === 'create_ticket'");
    expect(renewalHandlerSource).toContain('decisionDueDate <= today;');
    expect(renewalHandlerSource).toContain('await createRenewalTicket(trx, tenantId, {');
    expect(renewalHandlerSource).toContain("actor: { type: 'system' },");
    expect(renewalHandlerSource).toContain('updates.created_ticket_id = createdTicketId;');
    expect(renewalHandlerSource).toContain('createdTicketCount += 1;');
  });

  it('creates renewal tickets through the shared service in an owned withTransaction frame, not the workflow runtime', () => {
    expect(renewalHandlerSource).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    expect(renewalHandlerSource).toContain('await withTransaction(knex, async (trx: Knex.Transaction) =>');
    expect(renewalHandlerSource).not.toContain('@alga-psa/workflows/runtime');
    expect(renewalHandlerSource).not.toContain('TicketModel');
    expect(renewalHandlerSource).not.toContain('workflow_runs');
    expect(renewalHandlerSource).not.toContain('knex.transaction(');
    expect(renewalTicketSource).toContain('createTicketWithSideEffects(trx, tenant, {');
    expect(renewalTicketSource).toContain('notificationSuppression: { suppressContactNotifications: true }');
  });

  it('populates renewal ticket title with client and contract context', () => {
    expect(renewalTicketSource).toContain('export const buildRenewalTicketTitle = (row: Record<string, unknown>, decisionDueDate: string): string => {');
    expect(renewalTicketSource).toContain("typeof row.client_name === 'string' && row.client_name.trim().length > 0");
    expect(renewalTicketSource).toContain("typeof row.contract_name === 'string' && row.contract_name.trim().length > 0");
    expect(renewalTicketSource).toContain('return `Renewal Decision Due ${decisionDueDate}: ${clientName} / ${contractName}`;');
    expect(renewalTicketSource).toContain('title: buildRenewalTicketTitle(row, decisionDueDate),');
  });

  it('populates renewal ticket description with due date and renewal settings context', () => {
    expect(renewalTicketSource).toContain('export const buildRenewalTicketDescription = (');
    expect(renewalTicketSource).toContain("typeof normalized.effective_renewal_mode === 'string'");
    expect(renewalTicketSource).toContain("typeof normalized.effective_notice_period_days === 'number'");
    expect(renewalTicketSource).toContain('`Decision due date: ${decisionDueDate}`');
    expect(renewalTicketSource).toContain('`Renewal mode: ${renewalMode}`');
    expect(renewalTicketSource).toContain('`Notice period (days): ${noticePeriod}`');
    expect(renewalTicketSource).toContain('description: buildRenewalTicketDescription(row, normalized, decisionDueDate),');
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
    expect(renewalHandlerSource).toContain('resolveRenewalTicketRouting(row as Record<string, unknown>, useTenantRenewalDefaults)');
    expect(renewalTicketSource).toContain('(useTenantDefaults ? tenant[key] : (contract[key] ?? tenant[key]))');
  });

  it('persists created ticket id on renewal work item after successful ticket creation', () => {
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'created_ticket_id') ?? false");
    expect(renewalHandlerSource).toContain('updates.created_ticket_id = createdTicketId;');
    expect(renewalHandlerSource).toContain("await tenantScopedTable(knex, 'client_contracts', tenantId)");
    expect(renewalHandlerSource).toContain('...updates,');
  });

  it('audits ticket automation linkage with system actor metadata and timestamp', () => {
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'last_action') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false");
    expect(renewalHandlerSource).toContain("schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false");
    expect(renewalHandlerSource).toContain("updates.last_action = 'system_ticket_automation_linked';");
    expect(renewalHandlerSource).toContain('updates.last_action_by = null;');
    expect(renewalHandlerSource).toContain('updates.last_action_at = nowIso;');
  });

  it('uses tenant/client-contract/cycle idempotency key for renewal ticket creation', () => {
    expect(renewalTicketSource).toContain('export const buildRenewalTicketIdempotencyKey = (params: {');
    expect(renewalTicketSource).toContain('}): string => `renewal-ticket:${params.tenantId}:${params.clientContractId}:${params.cycleKey}`;');
    expect(renewalHandlerSource).toContain('const idempotencyKey = buildRenewalTicketIdempotencyKey({');
    expect(renewalTicketSource).toContain('idempotency_key: idempotencyKey,');
  });

  it('T253: creates or links at most one ticket per tenant/client-contract/cycle key under create_ticket policy', () => {
    expect(renewalHandlerSource).toContain("effectiveDueDateActionPolicy === 'create_ticket'");
    expect(renewalHandlerSource).toContain('const cycleKey = typeof nextCycleKey === \'string\' && nextCycleKey.length > 0');
    expect(renewalHandlerSource).toContain('const idempotencyKey = buildRenewalTicketIdempotencyKey({');
    expect(renewalHandlerSource).toContain('tenantId,');
    expect(renewalHandlerSource).toContain('clientContractId: (row as any).client_contract_id,');
    expect(renewalHandlerSource).toContain('cycleKey,');
    expect(renewalHandlerSource).toContain("whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
    expect(renewalHandlerSource).toContain('if (existingTicketId) {');
    expect(renewalHandlerSource).toContain('createdTicketId = existingTicketId;');
    expect(renewalHandlerSource).toContain('duplicateTicketSkipCount += 1;');
    expect(renewalHandlerSource).toContain('updates.created_ticket_id = createdTicketId;');
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

  it('registers renewal queue processing as a maintenance job and schedules it from the shared catalog', () => {
    expect(registerHandlersSource).toContain("import {\n  processRenewalQueueHandler,\n  RenewalQueueProcessorJobData,\n} from '@alga-psa/jobs/handlers/processRenewalQueueHandler';");
    expect(registerHandlersSource).toContain("name: 'process-renewal-queue',");
    expect(registerHandlersSource).toContain('await processRenewalQueueHandler(data);');
    expect(registerHandlersSource).toContain("'process-renewal-queue',");
    expect(jobsIndexSource).not.toContain('scheduleRenewalQueueProcessingJob');
    expect(resolveCeMaintenanceSchedules({})).toContainEqual({ jobName: 'process-renewal-queue', cron: '0 5 * * *' });
    expect(MAINTENANCE_FANOUT_SCHEDULES).toContainEqual({ jobName: 'process-renewal-queue', cron: '0 5 * * *' });
  });

  it('hooks renewal queue processing into CE initialization via schedule convergence, not per-tenant scheduling', () => {
    expect(scheduledInitSource).toContain('convergeCeMaintenanceSchedules(');
    expect(scheduledInitSource).not.toContain('scheduleRenewalQueueProcessingJob');
  });

  it('uses shared renewal processing core logic in both pg-boss and Temporal adapter registration paths', () => {
    expect(registerHandlersSource).toContain('await processRenewalQueueHandler(data);');
    expect(initializeJobRunnerSource).toContain('await registerAllJobHandlers({');
    expect(initializeJobRunnerSource).toContain('runner.registerHandler(registered.config);');
  });

  it('keeps queue-creation payload parity between pg-boss and Temporal scheduling paths', () => {
    expect(temporalRunnerSource).toContain('jobName,');
    expect(temporalRunnerSource).toContain('tenantId: data.tenantId,');
    expect(temporalRunnerSource).toContain('data,');
    expect(temporalRunnerSource).toContain("workflowType: 'genericJobWorkflow',");
  });

  it('keeps ticket idempotency behavior parity because both runners execute the same renewal handler core', () => {
    expect(renewalTicketSource).toContain('export const buildRenewalTicketIdempotencyKey = (params: {');
    expect(renewalHandlerSource).toContain("whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
    expect(renewalHandlerSource).toContain('const existingTicketId = normalizeOptionalUuid(existingTicket?.ticket_id);');
    expect(renewalHandlerSource).toContain('duplicateTicketSkipCount += 1;');
    expect(registerHandlersSource).toContain('await processRenewalQueueHandler(data);');
  });

  it('honors JobRunnerFactory runtime selection without adding edition-specific forks to renewal business logic', () => {
    expect(jobRunnerFactorySource).toContain('private determineRunnerType(');
    expect(jobRunnerFactorySource).toContain('const envType = process.env.JOB_RUNNER_TYPE?.toLowerCase();');
    expect(jobRunnerFactorySource).toContain("if (envType === 'temporal' || envType === 'pgboss') {");
    expect(jobRunnerFactorySource).toContain("if (runnerType === 'temporal' && enterprise) {");
    expect(renewalHandlerSource).not.toContain('process.env.EDITION');
    expect(renewalHandlerSource).not.toContain('JOB_RUNNER_TYPE');
  });

  it('resolves edition via isEnterpriseEdition() so selection is immune to module init ordering', () => {
    // Edition is re-read via the function rather than the module-level
    // `isEnterprise` const (which can be read before the features module
    // finishes initializing).
    expect(jobRunnerFactorySource).toContain('const enterprise = isEnterpriseEdition();');
    expect(jobRunnerFactorySource).toContain("return enterprise ? 'temporal' : 'pgboss';");
    expect(jobRunnerFactorySource).toContain("if (runnerType === 'temporal' && enterprise) {");
  });

  it('refuses a baked/explicit JOB_RUNNER_TYPE=pgboss under Enterprise Edition', () => {
    // The image bakes .env.example (JOB_RUNNER_TYPE=pgboss) into /app/server/.env
    // and @next/env backfills the unset var; EE must ignore that stray default
    // and use Temporal rather than silently downgrading to pg-boss.
    expect(jobRunnerFactorySource).toContain("if (envType === 'pgboss' && enterprise) {");
    expect(jobRunnerFactorySource).toContain('JOB_RUNNER_TYPE=pgboss ignored in Enterprise Edition');
    // And the init log surfaces the raw env so a baked override is visible.
    expect(jobRunnerFactorySource).toContain('jobRunnerTypeEnv: process.env.JOB_RUNNER_TYPE ?? null,');
  });

  it('does NOT silently fall back to pg-boss when temporal bootstrap fails (EE must fail loudly)', () => {
    expect(jobRunnerFactorySource).toContain("if (runnerType === 'temporal' && enterprise) {");
    expect(jobRunnerFactorySource).toContain('return await this.createTemporalRunner(config);');
    // The silent fallback path and the dummy no-op runner are gone: a failed
    // Temporal bootstrap must propagate, not quietly degrade to PG Boss.
    expect(jobRunnerFactorySource).not.toContain('fallbackToPgBoss');
    expect(jobRunnerFactorySource).not.toContain('Falling back to PG Boss job runner');
    expect(jobRunnerFactorySource).not.toContain('DummyJobRunner');
    expect(jobRunnerFactorySource).toContain('refusing to fall back');
    expect(jobRunnerFactorySource).toContain('throw error;');
    expect(jobRunnerFactorySource).toContain("logger.error('Failed to load TemporalJobRunner:', error);");
    expect(jobRunnerFactorySource).toContain(
      "'TemporalJobRunner not available. Ensure EE modules are properly installed.'"
    );
  });

  it('preserves tenant-scoped execution semantics in both pg-boss and Temporal runtime paths', () => {
    expect(renewalHandlerSource).toContain("const tenantId = typeof data.tenantId === 'string' ? data.tenantId : '';");
    expect(renewalHandlerSource).toContain("throw new Error('Tenant ID is required for renewal queue processing job');");
    expect(renewalHandlerSource).toContain("const db = tenantDb(knex, tenantId);");
    expect(renewalHandlerSource).toContain("tenantDb(conn, tenant).table(table)");

    expect(temporalRunnerSource).toContain("throw new Error('tenantId is required in job data');");
    expect(temporalRunnerSource).toContain('tenantId: data.tenantId,');
    expect(temporalRunnerSource).toContain('tenantDb(conn, tenant).table(table)');
  });
});
