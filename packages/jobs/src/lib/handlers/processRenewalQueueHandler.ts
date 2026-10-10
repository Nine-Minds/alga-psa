import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { normalizeClientContract } from '@shared/billingClients/clientContracts';
import {
  buildRenewalTicketIdempotencyKey,
  createRenewalTicket,
  normalizeOptionalUuid,
  resolveRenewalTicketRouting,
} from '@shared/billingClients/renewalTicket';
import type { RenewalWorkItemStatus } from '@alga-psa/types';
import type { Knex } from 'knex';

export interface RenewalQueueProcessorJobData extends Record<string, unknown> {
  tenantId: string;
  horizonDays?: number;
}

const DEFAULT_RENEWAL_PROCESSING_HORIZON_DAYS = 90;
const DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY = 'create_ticket' as const;
const KNOWN_RENEWAL_STATUSES: RenewalWorkItemStatus[] = [
  'pending',
  'renewing',
  'non_renewing',
  'snoozed',
  'completed',
];
const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10);
const addDays = (base: Date, days: number): Date => {
  const shifted = new Date(base);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
};
const isKnownRenewalStatus = (value: unknown): value is RenewalWorkItemStatus =>
  typeof value === 'string' && KNOWN_RENEWAL_STATUSES.includes(value as RenewalWorkItemStatus);
const isDateOnly = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const normalizeOptionalDateOnly = (value: unknown): string | null => {
  if (!isDateOnly(value)) return null;
  return value;
};
const resolveOptionalRenewalDueDateActionPolicy = (value: unknown): 'queue_only' | 'create_ticket' | null => (
  value === 'queue_only' || value === 'create_ticket'
    ? value
    : null
);
const resolveRenewalDueDateActionPolicy = (value: unknown): 'queue_only' | 'create_ticket' => (
  resolveOptionalRenewalDueDateActionPolicy(value) ??
    DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY
);
const resolveUseTenantRenewalDefaults = (value: unknown): boolean => (
  typeof value === 'boolean'
    ? value
    : true
);
function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string) {
  return tenantDb(conn, tenant).table(table);
}

export async function processRenewalQueueHandler(data: RenewalQueueProcessorJobData): Promise<void> {
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : '';
  if (!tenantId) {
    throw new Error('Tenant ID is required for renewal queue processing job');
  }

  const horizonDays =
    Number.isInteger(data.horizonDays) && (data.horizonDays as number) > 0
      ? Math.trunc(data.horizonDays as number)
      : DEFAULT_RENEWAL_PROCESSING_HORIZON_DAYS;

  const { knex } = await createTenantKnex();
  const schema = knex.schema as any;
  const [
    hasDecisionDueDateColumn,
    hasStatusColumn,
    hasRenewalModeColumn,
    hasNoticePeriodDaysColumn,
    hasRenewalTermMonthsColumn,
    hasRenewalCycleStartColumn,
    hasRenewalCycleEndColumn,
    hasRenewalCycleKeyColumn,
    hasSnoozedUntilColumn,
    hasCreatedTicketIdColumn,
    hasCreatedDraftContractIdColumn,
    hasDefaultRenewalModeColumn,
    hasDefaultNoticePeriodColumn,
    hasTenantDueDateActionPolicyColumn,
    hasContractDueDateActionPolicyColumn,
    hasUseTenantRenewalDefaultsColumn,
    hasTenantRenewalTicketBoardColumn,
    hasTenantRenewalTicketStatusColumn,
    hasTenantRenewalTicketPriorityColumn,
    hasTenantRenewalTicketAssigneeColumn,
    hasContractRenewalTicketBoardColumn,
    hasContractRenewalTicketStatusColumn,
    hasContractRenewalTicketPriorityColumn,
    hasContractRenewalTicketAssigneeColumn,
    hasAutomationErrorColumn,
    hasLastActionColumn,
    hasLastActionByColumn,
    hasLastActionAtColumn,
    hasTicketsTable,
  ] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'decision_due_date') ?? false,
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_mode') ?? false,
    schema?.hasColumn?.('client_contracts', 'notice_period_days') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_term_months') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_cycle_start') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_cycle_end') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_cycle_key') ?? false,
    schema?.hasColumn?.('client_contracts', 'snoozed_until') ?? false,
    schema?.hasColumn?.('client_contracts', 'created_ticket_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'created_draft_contract_id') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'default_renewal_mode') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'default_notice_period_days') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'renewal_due_date_action_policy') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_due_date_action_policy') ?? false,
    schema?.hasColumn?.('client_contracts', 'use_tenant_renewal_defaults') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_board_id') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_status_id') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_priority') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'renewal_ticket_assignee_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_ticket_board_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_ticket_status_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_ticket_priority') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_ticket_assignee_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'automation_error') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false,
    schema?.hasTable?.('tickets') ?? false,
  ]);

  const missingRenewalSchema: string[] = [];
  if (!hasDecisionDueDateColumn) missingRenewalSchema.push('client_contracts.decision_due_date');
  if (!hasStatusColumn) missingRenewalSchema.push('client_contracts.status');
  if (!hasRenewalModeColumn) missingRenewalSchema.push('client_contracts.renewal_mode');
  if (!hasNoticePeriodDaysColumn) missingRenewalSchema.push('client_contracts.notice_period_days');
  if (!hasRenewalTermMonthsColumn) missingRenewalSchema.push('client_contracts.renewal_term_months');
  if (!hasRenewalCycleStartColumn) missingRenewalSchema.push('client_contracts.renewal_cycle_start');
  if (!hasRenewalCycleEndColumn) missingRenewalSchema.push('client_contracts.renewal_cycle_end');
  if (!hasRenewalCycleKeyColumn) missingRenewalSchema.push('client_contracts.renewal_cycle_key');
  if (!hasSnoozedUntilColumn) missingRenewalSchema.push('client_contracts.snoozed_until');
  if (!hasCreatedTicketIdColumn) missingRenewalSchema.push('client_contracts.created_ticket_id');
  if (!hasCreatedDraftContractIdColumn) missingRenewalSchema.push('client_contracts.created_draft_contract_id');
  if (!hasTenantDueDateActionPolicyColumn) missingRenewalSchema.push('default_billing_settings.renewal_due_date_action_policy');
  if (!hasContractDueDateActionPolicyColumn) missingRenewalSchema.push('client_contracts.renewal_due_date_action_policy');
  if (!hasUseTenantRenewalDefaultsColumn) missingRenewalSchema.push('client_contracts.use_tenant_renewal_defaults');
  if (!hasDefaultRenewalModeColumn) missingRenewalSchema.push('default_billing_settings.default_renewal_mode');
  if (!hasDefaultNoticePeriodColumn) missingRenewalSchema.push('default_billing_settings.default_notice_period_days');
  if (!hasTenantRenewalTicketBoardColumn) missingRenewalSchema.push('default_billing_settings.renewal_ticket_board_id');
  if (!hasTenantRenewalTicketStatusColumn) missingRenewalSchema.push('default_billing_settings.renewal_ticket_status_id');
  if (!hasTenantRenewalTicketPriorityColumn) missingRenewalSchema.push('default_billing_settings.renewal_ticket_priority');
  if (!hasTenantRenewalTicketAssigneeColumn) missingRenewalSchema.push('default_billing_settings.renewal_ticket_assignee_id');
  if (!hasContractRenewalTicketBoardColumn) missingRenewalSchema.push('client_contracts.renewal_ticket_board_id');
  if (!hasContractRenewalTicketStatusColumn) missingRenewalSchema.push('client_contracts.renewal_ticket_status_id');
  if (!hasContractRenewalTicketPriorityColumn) missingRenewalSchema.push('client_contracts.renewal_ticket_priority');
  if (!hasContractRenewalTicketAssigneeColumn) missingRenewalSchema.push('client_contracts.renewal_ticket_assignee_id');
  if (!hasAutomationErrorColumn) missingRenewalSchema.push('client_contracts.automation_error');
  if (!hasLastActionColumn) missingRenewalSchema.push('client_contracts.last_action');
  if (!hasLastActionByColumn) missingRenewalSchema.push('client_contracts.last_action_by');
  if (!hasLastActionAtColumn) missingRenewalSchema.push('client_contracts.last_action_at');
  if (!hasTicketsTable) missingRenewalSchema.push('tickets (table)');

  if (missingRenewalSchema.length > 0) {
    throw new Error(
      `Renewal schema is not ready. Missing required columns: ${missingRenewalSchema.join(', ')}. ` +
      'Run the latest server database migrations, then retry renewal queue processing.'
    );
  }

  const today = toDateOnly(new Date());
  const horizonDate = toDateOnly(addDays(new Date(), horizonDays));
  const defaultSelections: string[] = [
    'dbs.default_renewal_mode as tenant_default_renewal_mode',
    'dbs.default_notice_period_days as tenant_default_notice_period_days',
    'dbs.renewal_due_date_action_policy as tenant_renewal_due_date_action_policy',
    'dbs.renewal_ticket_board_id as tenant_renewal_ticket_board_id',
    'dbs.renewal_ticket_status_id as tenant_renewal_ticket_status_id',
    'dbs.renewal_ticket_priority as tenant_renewal_ticket_priority',
    'dbs.renewal_ticket_assignee_id as tenant_renewal_ticket_assignee_id',
  ];

  const db = tenantDb(knex, tenantId);
  const contractQuery = db.table('client_contracts as cc');
  db.tenantJoin(contractQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
  db.tenantJoin(contractQuery, 'clients as cl', 'cc.client_id', 'cl.client_id', { type: 'left' });
  db.tenantJoin(contractQuery, 'default_billing_settings as dbs', 'cc.tenant', 'dbs.tenant', { type: 'left' });
  contractQuery
    .where({
      'cc.is_active': true,
      'c.status': 'active',
    })
    .select(['cc.*', 'c.status as contract_status', 'c.contract_name', 'cl.client_name', ...defaultSelections]);

  const candidateRows = await contractQuery;
  let eligibleRows = 0;
  let upsertedCount = 0;
  let normalizedStatusCount = 0;
  let newCycleCount = 0;
  let queueOnlyPolicyCount = 0;
  let createTicketPolicyCount = 0;
  let contractOverridePolicyCount = 0;
  let createdTicketCount = 0;
  let ticketCreationSkippedMissingDefaultsCount = 0;
  let routingOverrideAppliedCount = 0;
  let duplicateTicketSkipCount = 0;
  let duplicateCycleSkipCount = 0;
  let automationErrorCount = 0;
  const nowIso = new Date().toISOString();
  const processedCycleKeys = new Set<string>();

  for (const row of candidateRows) {
    const normalized = normalizeClientContract(row as any) as unknown as Record<string, unknown>;
    const decisionDueDate = normalizeOptionalDateOnly(normalized.decision_due_date);
    if (!decisionDueDate || decisionDueDate < today || decisionDueDate > horizonDate) {
      continue;
    }
    eligibleRows += 1;
    const tenantDueDateActionPolicy = resolveRenewalDueDateActionPolicy(
      (row as any).tenant_renewal_due_date_action_policy
    );
    const useTenantRenewalDefaults = resolveUseTenantRenewalDefaults((row as any).use_tenant_renewal_defaults);
    const contractOverrideDueDateActionPolicy =
      resolveOptionalRenewalDueDateActionPolicy((row as any).renewal_due_date_action_policy);
    const effectiveDueDateActionPolicy = useTenantRenewalDefaults
      ? tenantDueDateActionPolicy
      : contractOverrideDueDateActionPolicy ?? tenantDueDateActionPolicy;
    if (!useTenantRenewalDefaults && contractOverrideDueDateActionPolicy) {
      contractOverridePolicyCount += 1;
    }

    if (effectiveDueDateActionPolicy === 'queue_only') {
      queueOnlyPolicyCount += 1;
    } else {
      createTicketPolicyCount += 1;
    }

    const currentStatus = (row as any).status;
    const previousCycleKey =
      typeof (row as any).renewal_cycle_key === 'string'
        ? ((row as any).renewal_cycle_key as string)
        : null;
    const nextCycleKey =
      typeof normalized.renewal_cycle_key === 'string'
        ? (normalized.renewal_cycle_key as string)
        : null;
    const cycleChanged =
      typeof nextCycleKey === 'string' &&
      nextCycleKey.length > 0 &&
      previousCycleKey !== nextCycleKey;
    const dedupeCycleKey = nextCycleKey ?? decisionDueDate;
    const cycleDedupeIdentity = `${(row as any).client_contract_id}:${dedupeCycleKey}`;
    if (processedCycleKeys.has(cycleDedupeIdentity)) {
      duplicateCycleSkipCount += 1;
      continue;
    }
    processedCycleKeys.add(cycleDedupeIdentity);

    const shouldNormalizeStatus = !isKnownRenewalStatus(currentStatus) || cycleChanged;
    const updates: Record<string, unknown> = {};

    if ((row as any).decision_due_date !== decisionDueDate) {
      updates.decision_due_date = decisionDueDate;
    }
    const nextCycleStart = normalizeOptionalDateOnly(normalized.renewal_cycle_start);
    const previousCycleStart = normalizeOptionalDateOnly((row as any).renewal_cycle_start);
    if (nextCycleStart !== previousCycleStart) {
      updates.renewal_cycle_start = nextCycleStart;
    }
    const nextCycleEnd = normalizeOptionalDateOnly(normalized.renewal_cycle_end);
    const previousCycleEnd = normalizeOptionalDateOnly((row as any).renewal_cycle_end);
    if (nextCycleEnd !== previousCycleEnd) {
      updates.renewal_cycle_end = nextCycleEnd;
    }
    if (nextCycleKey !== previousCycleKey) {
      updates.renewal_cycle_key = nextCycleKey;
    }
    const existingPolicy = resolveOptionalRenewalDueDateActionPolicy((row as any).renewal_due_date_action_policy);
    if (existingPolicy !== effectiveDueDateActionPolicy) {
      updates.renewal_due_date_action_policy = effectiveDueDateActionPolicy;
    }

    if (shouldNormalizeStatus) {
      updates.status = 'pending';
      updates.snoozed_until = null;
      if (!isKnownRenewalStatus(currentStatus) || currentStatus !== 'pending') {
        normalizedStatusCount += 1;
      }
    }

    if (cycleChanged) {
      updates.created_ticket_id = null;
      updates.created_draft_contract_id = null;
      newCycleCount += 1;
    }

    const hasExistingLinkedTicket = Boolean(normalizeOptionalUuid((row as any).created_ticket_id));
    const shouldCreateTicketAtDueDate =
      !hasExistingLinkedTicket
      && effectiveDueDateActionPolicy === 'create_ticket'
      && decisionDueDate <= today;
    if (shouldCreateTicketAtDueDate) {
      let ticketAutomationError: string | null = null;
      const routing = resolveRenewalTicketRouting(row as Record<string, unknown>, useTenantRenewalDefaults);
      const { clientId, boardId, statusId, priorityId } = routing;
      if (routing.overrideApplied) {
        routingOverrideAppliedCount += 1;
      }

      if (clientId && boardId && statusId && priorityId) {
        const cycleKey = typeof nextCycleKey === 'string' && nextCycleKey.length > 0
          ? nextCycleKey
          : decisionDueDate;
        const idempotencyKey = buildRenewalTicketIdempotencyKey({
          tenantId,
          clientContractId: (row as any).client_contract_id,
          cycleKey,
        });
        let createdTicketId: string | null = null;
        try {
          const existingTicket = await tenantScopedTable(knex, 'tickets', tenantId)
            .whereRaw("(attributes::jsonb ->> 'idempotency_key') = ?", [idempotencyKey])
            .first('ticket_id');
          const existingTicketId = normalizeOptionalUuid(existingTicket?.ticket_id);
          if (existingTicketId) {
            createdTicketId = existingTicketId;
            duplicateTicketSkipCount += 1;
          }
        } catch (error) {
          logger.warn('Failed idempotency lookup before renewal ticket creation', {
            tenantId,
            clientContractId: (row as any).client_contract_id,
            idempotencyKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (!createdTicketId) {
          try {
            createdTicketId = await withTransaction(knex, async (trx: Knex.Transaction) => (
              await createRenewalTicket(trx, tenantId, {
                row: row as Record<string, unknown>,
                normalized,
                decisionDueDate,
                cycleKey,
                routing,
                actor: { type: 'system' },
              })
            ).ticketId);
          } catch (error) {
            ticketAutomationError = error instanceof Error ? error.message : String(error);
            logger.error('Renewal automation ticket creation failed', {
              tenantId,
              clientContractId: (row as any).client_contract_id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (createdTicketId) {
          updates.created_ticket_id = createdTicketId;
          updates.automation_error = null;
          updates.last_action = 'system_ticket_automation_linked';
          updates.last_action_by = null;
          updates.last_action_at = nowIso;
          createdTicketCount += 1;
        } else {
          updates.automation_error = ticketAutomationError ?? 'Renewal ticket automation failed';
          automationErrorCount += 1;
        }
      } else {
        ticketCreationSkippedMissingDefaultsCount += 1;
        updates.automation_error = 'Missing renewal ticket routing defaults for create_ticket policy';
        automationErrorCount += 1;
      }
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    await tenantScopedTable(knex, 'client_contracts', tenantId)
      .where({
        client_contract_id: (row as any).client_contract_id,
      })
      .update({
        ...updates,
        updated_at: nowIso,
      });
    upsertedCount += 1;
  }

  logger.info('Renewal queue processing completed', {
    tenantId,
    horizonDays,
    scannedRows: candidateRows.length,
    eligibleRows,
    upsertedCount,
    normalizedStatusCount,
    newCycleCount,
    queueOnlyPolicyCount,
    createTicketPolicyCount,
    contractOverridePolicyCount,
    createdTicketCount,
    ticketCreationSkippedMissingDefaultsCount,
    routingOverrideAppliedCount,
    duplicateTicketSkipCount,
    duplicateCycleSkipCount,
    automationErrorCount,
  });
}
