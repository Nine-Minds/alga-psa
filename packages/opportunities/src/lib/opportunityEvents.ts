import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';

export function publishOpportunityEventAfterCommit<T extends WorkflowCatalogEventType>(
  trx: Knex.Transaction,
  tenant: string,
  eventType: T,
  builtPayload: BuiltWorkflowPayload<T>,
  idempotencyKey: string,
): void {
  // Read-only view of the builder output, used for the occurredAt fallback chain and the log label.
  const payload = builtPayload as Record<string, unknown>;
  const occurredAt = typeof payload.changedAt === 'string'
    ? payload.changedAt
    : typeof payload.createdAt === 'string'
      ? payload.createdAt
      : typeof payload.stalledAt === 'string'
        ? payload.stalledAt
        : typeof payload.escalatedAt === 'string'
          ? payload.escalatedAt
          : typeof payload.overdueAt === 'string'
            ? payload.overdueAt
            : new Date().toISOString();

  registerAfterCommit(trx, () => publishWorkflowEvent({
    eventType,
    payload: builtPayload,
    ctx: { tenantId: tenant, occurredAt },
    idempotencyKey,
  }), `${eventType} opportunity=${String(payload.opportunityId ?? 'unknown')}`);
}
