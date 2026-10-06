import type { Knex } from 'knex';
import {
  createTicketWithSideEffects,
  type CreateTicketActor,
} from '@alga-psa/shared/services/tickets/createTicketWithSideEffects';

export const RENEWAL_TICKET_SOURCE = 'renewal_due_date_automation';
export const RENEWAL_TICKET_MANUAL_RETRY_SOURCE = 'renewal_due_date_manual_retry';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const normalizeOptionalUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;

export const buildRenewalTicketIdempotencyKey = (params: {
  tenantId: string;
  clientContractId: string;
  cycleKey: string;
}): string => `renewal-ticket:${params.tenantId}:${params.clientContractId}:${params.cycleKey}`;

export const buildRenewalTicketTitle = (row: Record<string, unknown>, decisionDueDate: string): string => {
  const clientName =
    typeof row.client_name === 'string' && row.client_name.trim().length > 0 ? row.client_name.trim() : 'Client';
  const contractName =
    typeof row.contract_name === 'string' && row.contract_name.trim().length > 0
      ? row.contract_name.trim()
      : 'Contract';
  return `Renewal Decision Due ${decisionDueDate}: ${clientName} / ${contractName}`;
};

export const buildRenewalTicketDescription = (
  row: Record<string, unknown>,
  normalized: Record<string, unknown>,
  decisionDueDate: string,
): string => {
  const renewalMode =
    typeof normalized.effective_renewal_mode === 'string' ? normalized.effective_renewal_mode : 'manual';
  const noticePeriod =
    typeof normalized.effective_notice_period_days === 'number' ? normalized.effective_notice_period_days : 'unknown';
  const cycleKey = typeof normalized.renewal_cycle_key === 'string' ? normalized.renewal_cycle_key : 'unknown';
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

export interface RenewalTicketRouting {
  clientId: string | null;
  boardId: string | null;
  statusId: string | null;
  priorityId: string | null;
  assignedTo: string | null;
  /** True when contract-level routing was consulted and at least one override value is set. */
  overrideApplied: boolean;
}

/**
 * Board/status/priority/assignee for a renewal ticket: tenant defaults, or the contract's
 * overrides (falling back to tenant defaults per field) when the contract opts out of them.
 */
export function resolveRenewalTicketRouting(
  row: Record<string, unknown>,
  useTenantDefaults: boolean,
): RenewalTicketRouting {
  const tenant = {
    boardId: normalizeOptionalUuid(row.tenant_renewal_ticket_board_id),
    statusId: normalizeOptionalUuid(row.tenant_renewal_ticket_status_id),
    priorityId: normalizeOptionalUuid(row.tenant_renewal_ticket_priority),
    assignedTo: normalizeOptionalUuid(row.tenant_renewal_ticket_assignee_id),
  };
  const contract = {
    boardId: normalizeOptionalUuid(row.renewal_ticket_board_id),
    statusId: normalizeOptionalUuid(row.renewal_ticket_status_id),
    priorityId: normalizeOptionalUuid(row.renewal_ticket_priority),
    assignedTo: normalizeOptionalUuid(row.renewal_ticket_assignee_id),
  };
  const pick = (key: keyof typeof tenant) => (useTenantDefaults ? tenant[key] : (contract[key] ?? tenant[key]));
  return {
    clientId: normalizeOptionalUuid(row.client_id),
    boardId: pick('boardId'),
    statusId: pick('statusId'),
    priorityId: pick('priorityId'),
    assignedTo: pick('assignedTo'),
    overrideApplied: !useTenantDefaults && Object.values(contract).some((value) => value !== null),
  };
}

export interface CreateRenewalTicketParams {
  row: Record<string, unknown>;
  normalized: Record<string, unknown>;
  decisionDueDate: string;
  cycleKey: string;
  routing: RenewalTicketRouting;
  actor: CreateTicketActor;
  /** Defaults to the scheduled-automation source. */
  source?: string;
}

/**
 * Creates the renewal-decision ticket through the shared creation service so TICKET_CREATED and
 * TICKET_ASSIGNED publish after commit. `trx` must come from `withTransaction`: a raw
 * `knex.transaction` silently drops the after-commit hooks.
 *
 * Contact-facing mail is always suppressed: renewal tickets are internal work items.
 */
export async function createRenewalTicket(
  trx: Knex.Transaction,
  tenant: string,
  params: CreateRenewalTicketParams,
): Promise<{ ticketId: string; ticketNumber: string }> {
  const { row, normalized, decisionDueDate, cycleKey, routing, actor } = params;
  const { clientId, boardId, statusId, priorityId, assignedTo } = routing;
  if (!clientId || !boardId || !statusId || !priorityId) {
    throw new Error('Missing renewal ticket routing defaults for create_ticket policy');
  }
  const clientContractId = String(row.client_contract_id);
  const idempotencyKey = buildRenewalTicketIdempotencyKey({ tenantId: tenant, clientContractId, cycleKey });

  return createTicketWithSideEffects(trx, tenant, {
    actor,
    ticket: {
      title: buildRenewalTicketTitle(row, decisionDueDate),
      description: buildRenewalTicketDescription(row, normalized, decisionDueDate),
      client_id: clientId,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      assigned_to: assignedTo ?? undefined,
      source: params.source ?? RENEWAL_TICKET_SOURCE,
      attributes: {
        renewal_cycle_key: cycleKey,
        decision_due_date: decisionDueDate,
        source_client_contract_id: clientContractId,
        idempotency_key: idempotencyKey,
      },
    },
    notificationSuppression: { suppressContactNotifications: true },
  });
}
