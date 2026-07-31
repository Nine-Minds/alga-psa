import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

export function publishOpportunityEventAfterCommit(
  trx: Knex.Transaction,
  tenant: string,
  eventType: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): void {
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
    eventType: eventType as never,
    payload,
    ctx: { tenantId: tenant, occurredAt },
    idempotencyKey,
  }), `${eventType} opportunity=${String(payload.opportunityId ?? 'unknown')}`);
}
