import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IRmaEvent, RmaEventType, RmaStatus } from '@alga-psa/types';

export interface RecordRmaEventInput {
  rmaId: string;
  eventType: RmaEventType;
  fromStatus: RmaStatus | null;
  toStatus: RmaStatus | null;
  actorUserId: string | null;
  occurredAt?: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  note?: string | null;
  payload?: Record<string, unknown>;
  documentIds?: string[];
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRmaEventRow(row: any): IRmaEvent {
  return {
    event_id: row.event_id,
    rma_id: row.rma_id,
    event_type: row.event_type,
    from_status: row.from_status ?? null,
    to_status: row.to_status ?? null,
    occurred_at: iso(row.occurred_at),
    recorded_at: iso(row.recorded_at),
    actor_user_id: row.actor_user_id ?? null,
    carrier: row.carrier ?? null,
    tracking_number: row.tracking_number ?? null,
    note: row.note ?? null,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    document_ids: Array.isArray(row.document_ids) ? row.document_ids : [],
  };
}

/** The single append-only RMA event writer, shared by inventory and custody transactions. */
export async function recordRmaEvent(trx: Knex.Transaction, tenant: string, input: RecordRmaEventInput): Promise<IRmaEvent> {
  const now = new Date().toISOString();
  const occurredAt = input.occurredAt ?? now;
  const [row] = await tenantDb(trx, tenant)
    .table('rma_events')
    .insert({
      tenant,
      rma_id: input.rmaId,
      event_type: input.eventType,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      occurred_at: occurredAt,
      recorded_at: now,
      actor_user_id: input.actorUserId,
      carrier: input.carrier ?? null,
      tracking_number: input.trackingNumber ?? null,
      note: input.note ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      document_ids: JSON.stringify(input.documentIds ?? []),
    })
    .returning('*');
  return mapRmaEventRow(row);
}
