import { createTenantKnex } from 'server/src/lib/db';
import logger from '@alga-psa/core/logger';
import { normalizeClientContract } from '@shared/billingClients/clientContracts';
import { initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime/init';
import { getActionRegistryV2 } from '@shared/workflow/runtime/registries/actionRegistry';
import { TicketModel } from '@shared/models/ticketModel';
import type { RenewalWorkItemStatus } from '@alga-psa/types';
import type { Knex } from 'knex';

export interface RenewalQueueProcessorJobData extends Record<string, unknown> {
  tenantId: string;
  horizonDays?: number;
}

const DEFAULT_RENEWAL_PROCESSING_HORIZON_DAYS = 90;
const DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY = 'create_ticket' as const;
const RENEWAL_TICKET_SOURCE = 'renewal_due_date_automation';
const RENEWAL_QUEUE_ACTION_STEP_PATH = 'jobs.process-renewal-queue';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
const normalizeOptionalUuid = (value: unknown): string | null => (
  typeof value === 'string' && UUID_PATTERN.test(value)
    ? value
    : null
);
const buildRenewalTicketTitle = (row: Record<string, unknown>, decisionDueDate: string): string => {
  const clientName = typeof row.client_name === 'string' && row.client_name.trim().length > 0
    ? row.client_name.trim()
    : 'Client';
  const contractName = typeof row.contract_name === 'string' && row.contract_name.trim().length > 0
    ? row.contract_name.trim()
    : 'Contract';
  return `Renewal Decision Due ${decisionDueDate}: ${clientName} / ${contractName}`;
};
const buildRenewalTicketDescription = (
  row: Record<string, unknown>,
  normalized: Record<string, unknown>,
  decisionDueDate: string
): string => {
  const renewalMode = typeof normalized.effective_renewal_mode === 'string'
    ? normalized.effective_renewal_mode
    : 'manual';
  const noticePeriod = typeof normalized.effective_notice_period_days === 'number'
    ? normalized.effective_notice_period_days
    : 'unknown';
  const cycleKey = typeof normalized.renewal_cycle_key === 'string'
    ? normalized.renewal_cycle_key
    : 'unknown';
  const contractId = typeof row.contract_id === 'string' ? row.contract_id : 'unknown';

  return [
    'Contract renewal decision is due.',
    `Decision due date: ${decisionDueDate}`,
    `Renewal mode: ${renewalMode}`,
    `Notice period (days): ${noticePeriod}`,
    `Renewal cycle: ${cycleKey}`,
    `Source contract: ${contractId}`,
  ].join('\n');
};
const buildRenewalTicketIdempotencyKey = (params: {
  tenantId: string;
  clientContractId: string;
  cycleKey: string;
}): string => `renewal-ticket:${params.tenantId}:${params.clientContractId}:${params.cycleKey}`;

const tryCreateRenewalTicketViaWorkflowAction = async (params: {
  knex: Knex;
  tenantId: string;
  runId: string | null;
  idempotencyKey: string;
  clientId: string;
  title: string;
  description: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  assignedTo: string | null;
  attributes: Record<string, unknown>;
}): Promise<string | null> => {
  if (!params.runId) {
    return null;
  }

  initializeWorkflowRuntimeV2();
  const ticketCreateAction = getActionRegistryV2().get('tickets.create', 1);
  if (!ticketCreateAction) {
    return null;
  }

  const actionInput = ticketCreateAction.inputSchema.parse({
    client_id: params.clientId,
    title: params.title,
    description: params.description,
    board_id: params.boardId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    assigned_to: params.assignedTo,
    attributes: params.attributes,
    idempotency_key: params.idempotencyKey,
  });

  const actionResult = await ticketCreateAction.handler(actionInput, {
    runId: params.runId,
    stepPath: RENEWAL_QUEUE_ACTION_STEP_PATH,
    tenantId: params.tenantId,
    idempotencyKey: params.idempotencyKey,
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: { source: RENEWAL_TICKET_SOURCE },
    knex: params.knex,
  });
  const validatedResult = ticketCreateAction.outputSchema.parse(actionResult);
  return validatedResult.ticket_id;
};

const createRenewalTicketDirectly = async (params: {
  trx: Knex.Transaction;
  tenantId: string;
  clientId: string;
  title: string;
  description: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  assignedTo: string | null;
  idempotencyKey: string;
  attributes: Record<string, unknown>;
}): Promise<string> => {
  const created = await TicketModel.createTicketWithRetry(
    {
      title: params.title,
      description: params.description,
      client_id: params.clientId,
      board_id: params.boardId,
      status_id: params.statusId,
      priority_id: params.priorityId,
      assigned_to: params.assignedTo ?? undefined,
      source: RENEWAL_TICKET_SOURCE,
      attributes: {
        ...params.attributes,
        idempotency_key: params.idempotencyKey,
      },
    },
    params.tenantId,
    params.trx
  );
  return created.ticket_id;
};

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
    hasTicketsTable,
    hasWorkflowRunsTable,
  ] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'decision_due_date') ?? false,
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
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
    schema?.hasTable?.('tickets') ?? false,
    schema?.hasTable?.('workflow_runs') ?? false,
  ]);

  if (!hasDecisionDueDateColumn || !hasStatusColumn) {
    logger.info('Skipping renewal queue processing because required columns are unavailable', {
      tenantId,
      hasDecisionDueDateColumn,
      hasStatusColumn,
    });
    return;
  }

  const today = toDateOnly(new Date());
  const horizonDate = toDateOnly(addDays(new Date(), horizonDays));
  const defaultSelections: string[] = [];
  if (hasDefaultRenewalModeColumn) {
    defaultSelections.push('dbs.default_renewal_mode as tenant_default_renewal_mode');
  }
  if (hasDefaultNoticePeriodColumn) {
    defaultSelections.push('dbs.default_notice_period_days as tenant_default_notice_period_days');
  }
  if (hasTenantDueDateActionPolicyColumn) {
    defaultSelections.push('dbs.renewal_due_date_action_policy as tenant_renewal_due_date_action_policy');
  }
  if (hasTenantRenewalTicketBoardColumn) {
    defaultSelections.push('dbs.renewal_ticket_board_id as tenant_renewal_ticket_board_id');
  }
  if (hasTenantRenewalTicketStatusColumn) {
    defaultSelections.push('dbs.renewal_ticket_status_id as tenant_renewal_ticket_status_id');
  }
  if (hasTenantRenewalTicketPriorityColumn) {
    defaultSelections.push('dbs.renewal_ticket_priority as tenant_renewal_ticket_priority');
  }
  if (hasTenantRenewalTicketAssigneeColumn) {
    defaultSelections.push('dbs.renewal_ticket_assignee_id as tenant_renewal_ticket_assignee_id');
  }

  let contractQuery = knex('client_contracts as cc')
    .join('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .leftJoin('clients as cl', function joinClients() {
      this.on('cc.client_id', '=', 'cl.client_id').andOn('cc.tenant', '=', 'cl.tenant');
    })
    .where({
      'cc.tenant': tenantId,
      'cc.is_active': true,
      'c.status': 'active',
    })
    .select(['cc.*', 'c.status as contract_status', 'c.contract_name', 'cl.client_name', ...defaultSelections]);

  if (defaultSelections.length > 0) {
    contractQuery = contractQuery.leftJoin('default_billing_settings as dbs', function joinDefaultBillingSettings() {
      this.on('cc.tenant', '=', 'dbs.tenant');
    });
  }

  const candidateRows = await contractQuery;
  const workflowRunIdForTenant = hasWorkflowRunsTable
    ? (
      await knex('workflow_runs')
        .where({ tenant_id: tenantId })
        .orderBy('updated_at', 'desc')
        .first('run_id')
    )?.run_id ?? null
    : null;
  let eligibleRows = 0;
  let upsertedCount = 0;
  let normalizedStatusCount = 0;
  let newCycleCount = 0;
  let queueOnlyPolicyCount = 0;
  let createTicketPolicyCount = 0;
  let contractOverridePolicyCount = 0;
  let createdTicketCount = 0;
  let workflowTicketCreateAttemptCount = 0;
  let workflowTicketCreateSuccessCount = 0;
  let workflowTicketCreateFallbackCount = 0;
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
    const useTenantRenewalDefaults = hasUseTenantRenewalDefaultsColumn
      ? resolveUseTenantRenewalDefaults((row as any).use_tenant_renewal_defaults)
      : true;
    const contractOverrideDueDateActionPolicy = hasContractDueDateActionPolicyColumn
      ? resolveOptionalRenewalDueDateActionPolicy((row as any).renewal_due_date_action_policy)
      : null;
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
      hasRenewalCycleKeyColumn && typeof (row as any).renewal_cycle_key === 'string'
        ? ((row as any).renewal_cycle_key as string)
        : null;
    const nextCycleKey =
      hasRenewalCycleKeyColumn && typeof normalized.renewal_cycle_key === 'string'
        ? (normalized.renewal_cycle_key as string)
        : null;
    const cycleChanged =
      hasRenewalCycleKeyColumn &&
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
    if (hasRenewalCycleStartColumn) {
      const nextCycleStart = normalizeOptionalDateOnly(normalized.renewal_cycle_start);
      const previousCycleStart = normalizeOptionalDateOnly((row as any).renewal_cycle_start);
      if (nextCycleStart !== previousCycleStart) {
        updates.renewal_cycle_start = nextCycleStart;
      }
    }
    if (hasRenewalCycleEndColumn) {
      const nextCycleEnd = normalizeOptionalDateOnly(normalized.renewal_cycle_end);
      const previousCycleEnd = normalizeOptionalDateOnly((row as any).renewal_cycle_end);
      if (nextCycleEnd !== previousCycleEnd) {
        updates.renewal_cycle_end = nextCycleEnd;
      }
    }
    if (hasRenewalCycleKeyColumn && nextCycleKey !== previousCycleKey) {
      updates.renewal_cycle_key = nextCycleKey;
    }
    if (hasContractDueDateActionPolicyColumn) {
      const existingPolicy = resolveOptionalRenewalDueDateActionPolicy((row as any).renewal_due_date_action_policy);
      if (existingPolicy !== effectiveDueDateActionPolicy) {
        updates.renewal_due_date_action_policy = effectiveDueDateActionPolicy;
      }
    }

    if (shouldNormalizeStatus) {
      updates.status = 'pending';
      if (hasSnoozedUntilColumn) {
        updates.snoozed_until = null;
      }
      if (!isKnownRenewalStatus(currentStatus) || currentStatus !== 'pending') {
        normalizedStatusCount += 1;
      }
    }

    if (cycleChanged) {
      if (hasCreatedTicketIdColumn) {
        updates.created_ticket_id = null;
      }
      if (hasCreatedDraftContractIdColumn) {
        updates.created_draft_contract_id = null;
      }
      newCycleCount += 1;
    }

    const hasExistingLinkedTicket = hasCreatedTicketIdColumn
      && Boolean(normalizeOptionalUuid((row as any).created_ticket_id));
    const shouldCreateTicketAtDueDate =
      hasCreatedTicketIdColumn
      && !hasExistingLinkedTicket
      && effectiveDueDateActionPolicy === 'create_ticket'
      && decisionDueDate <= today;
    if (shouldCreateTicketAtDueDate) {
      let ticketAutomationError: string | null = null;
      const clientId = normalizeOptionalUuid((row as any).client_id);
      const tenantBoardId = normalizeOptionalUuid((row as any).tenant_renewal_ticket_board_id);
      const tenantStatusId = normalizeOptionalUuid((row as any).tenant_renewal_ticket_status_id);
      const tenantPriorityId = normalizeOptionalUuid((row as any).tenant_renewal_ticket_priority);
      const tenantAssignedTo = normalizeOptionalUuid((row as any).tenant_renewal_ticket_assignee_id);
      const contractBoardId = hasContractRenewalTicketBoardColumn
        ? normalizeOptionalUuid((row as any).renewal_ticket_board_id)
        : null;
      const contractStatusId = hasContractRenewalTicketStatusColumn
        ? normalizeOptionalUuid((row as any).renewal_ticket_status_id)
        : null;
      const contractPriorityId = hasContractRenewalTicketPriorityColumn
        ? normalizeOptionalUuid((row as any).renewal_ticket_priority)
        : null;
      const contractAssignedTo = hasContractRenewalTicketAssigneeColumn
        ? normalizeOptionalUuid((row as any).renewal_ticket_assignee_id)
        : null;
      const boardId = useTenantRenewalDefaults ? tenantBoardId : (contractBoardId ?? tenantBoardId);
      const statusId = useTenantRenewalDefaults ? tenantStatusId : (contractStatusId ?? tenantStatusId);
      const priorityId = useTenantRenewalDefaults ? tenantPriorityId : (contractPriorityId ?? tenantPriorityId);
      const assignedTo = useTenantRenewalDefaults ? tenantAssignedTo : (contractAssignedTo ?? tenantAssignedTo);
      if (
        !useTenantRenewalDefaults
        && (
          contractBoardId !== null
          || contractStatusId !== null
          || contractPriorityId !== null
          || contractAssignedTo !== null
        )
      ) {
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
        const ticketTitle = buildRenewalTicketTitle(row as Record<string, unknown>, decisionDueDate);
        const ticketDescription = buildRenewalTicketDescription(
          row as Record<string, unknown>,
          normalized,
          decisionDueDate
        );
        const ticketAttributes = {
          renewal_cycle_key: cycleKey,
          decision_due_date: decisionDueDate,
          source_client_contract_id: (row as any).client_contract_id,
          idempotency_key: idempotencyKey,
        } as Record<string, unknown>;

        let createdTicketId: string | null = null;
        if (hasTicketsTable) {
          try {
            const existingTicket = await knex('tickets')
              .where({ tenant: tenantId })
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
        }

        if (!createdTicketId) {
          workflowTicketCreateAttemptCount += 1;
          try {
            createdTicketId = await tryCreateRenewalTicketViaWorkflowAction({
              knex,
              tenantId,
              runId: workflowRunIdForTenant,
              idempotencyKey,
              clientId,
              title: ticketTitle,
              description: ticketDescription,
              boardId,
              statusId,
              priorityId,
              assignedTo,
              attributes: ticketAttributes,
            });
            if (createdTicketId) {
              workflowTicketCreateSuccessCount += 1;
            }
          } catch (error) {
            logger.warn(
              'Workflow tickets.create action failed for renewal automation ticket creation; falling back to direct creation',
              {
                tenantId,
                clientContractId: (row as any).client_contract_id,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }

        if (!createdTicketId) {
          workflowTicketCreateFallbackCount += 1;
          try {
            createdTicketId = await knex.transaction(async (trx: Knex.Transaction) => (
              createRenewalTicketDirectly({
                trx,
                tenantId,
                clientId,
                title: ticketTitle,
                description: ticketDescription,
                boardId,
                statusId,
                priorityId,
                assignedTo,
                idempotencyKey,
                attributes: ticketAttributes,
              })
            ));
          } catch (error) {
            ticketAutomationError = error instanceof Error ? error.message : String(error);
            logger.error('Direct renewal automation ticket creation failed', {
              tenantId,
              clientContractId: (row as any).client_contract_id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (createdTicketId) {
          updates.created_ticket_id = createdTicketId;
          if (hasAutomationErrorColumn) {
            updates.automation_error = null;
          }
          createdTicketCount += 1;
        } else if (hasAutomationErrorColumn) {
          updates.automation_error = ticketAutomationError ?? 'Renewal ticket automation failed';
          automationErrorCount += 1;
        }
      } else {
        ticketCreationSkippedMissingDefaultsCount += 1;
        if (hasAutomationErrorColumn) {
          updates.automation_error = 'Missing renewal ticket routing defaults for create_ticket policy';
          automationErrorCount += 1;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    await knex('client_contracts')
      .where({
        tenant: tenantId,
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
    workflowTicketCreateAttemptCount,
    workflowTicketCreateSuccessCount,
    workflowTicketCreateFallbackCount,
    ticketCreationSkippedMissingDefaultsCount,
    routingOverrideAppliedCount,
    duplicateTicketSkipCount,
    duplicateCycleSkipCount,
    automationErrorCount,
  });
}
