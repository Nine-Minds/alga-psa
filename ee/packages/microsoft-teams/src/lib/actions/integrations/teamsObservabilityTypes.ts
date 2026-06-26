import { Buffer } from 'node:buffer';

import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

import type {
  TeamsDeliveryErrorCode,
  TeamsDeliveryDestinationType,
  TeamsDeliveryStatus,
} from '../../notifications/teamsDeliveryRecorder';
import type {
  TeamsAuditActionId,
  TeamsAuditResultStatus,
  TeamsAuditSurface,
} from '../../teams/actions/teamsAuditRecorder';

export interface TeamsDeliveryObservabilityRow {
  tenant: string;
  delivery_id: string;
  internal_notification_id: string | null;
  category: string | null;
  destination_type: TeamsDeliveryDestinationType;
  destination_id: string;
  attempt_number: number;
  idempotency_key: string;
  provider_message_id: string | null;
  status: TeamsDeliveryStatus;
  error_code: TeamsDeliveryErrorCode | null;
  error_message: string | null;
  retryable: boolean | null;
  provider_request_id: string | null;
  sent_at: string | Date | null;
  delivered_at: string | Date | null;
  responded_at: string | Date | null;
  created_at: string | Date;
}

export interface TeamsAuditObservabilityRow {
  tenant: string;
  event_id: string;
  actor_user_id: string | null;
  microsoft_user_id: string | null;
  surface: TeamsAuditSurface;
  action_id: TeamsAuditActionId;
  target_type: string | null;
  target_id: string | null;
  idempotency_key: string | null;
  payload_hash: string | null;
  result_status: TeamsAuditResultStatus;
  error_code: string | null;
  created_at: string | Date;
}

export interface ListTeamsDeliveriesParams {
  status?: TeamsDeliveryStatus;
  category?: string;
  since?: string;
  limit?: number;
  cursor?: string;
}

export interface ListTeamsAuditEventsParams {
  surface?: TeamsAuditSurface;
  action_id?: TeamsAuditActionId | string;
  actor_user_id?: string;
  result_status?: TeamsAuditResultStatus;
  since?: string;
  limit?: number;
  cursor?: string;
}

export interface TeamsObservabilityPage<Row> {
  rows: Row[];
  nextCursor: string | null;
}

export interface CursorTuple {
  createdAt: string;
  id: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DELIVERY_STATUSES: readonly TeamsDeliveryStatus[] = ['skipped', 'sent', 'delivered', 'failed'];
const AUDIT_SURFACES: readonly TeamsAuditSurface[] = ['bot', 'message_extension', 'quick_action', 'tab'];
const AUDIT_RESULT_STATUSES: readonly TeamsAuditResultStatus[] = ['success', 'failure'];

function normalizeLimit(value: unknown): number {
  if (!Number.isInteger(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Number(value), 1), MAX_LIMIT);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function validateSince(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) {
    throw new Error('Invalid since timestamp');
  }
  return new Date(timestamp).toISOString();
}

function normalizeDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid row created_at timestamp');
  }
  return date.toISOString();
}

export function encodeTeamsObservabilityCursor(createdAt: string | Date, id: string): string {
  return Buffer.from(JSON.stringify([normalizeDate(createdAt), id]), 'utf8').toString('base64');
}

export function decodeTeamsObservabilityCursor(cursor: string | undefined | null): CursorTuple | null {
  const normalized = normalizeOptionalString(cursor);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      throw new Error('Unexpected cursor shape');
    }

    const [createdAt, id] = parsed;
    if (typeof createdAt !== 'string' || typeof id !== 'string' || !id.trim()) {
      throw new Error('Unexpected cursor values');
    }

    return {
      createdAt: normalizeDate(createdAt),
      id,
    };
  } catch {
    throw new Error('Malformed Teams observability cursor');
  }
}

async function assertTeamsReadPermission(user: unknown, knex: any): Promise<void> {
  if (!(await hasPermission(user as any, 'system_settings', 'read', knex))) {
    throw new Error('Forbidden');
  }
}

function applyCursor(query: any, idColumn: string, cursor: CursorTuple | null): void {
  if (!cursor) {
    return;
  }

  query.andWhere((builder: any) => {
    builder
      .where('created_at', '<', cursor.createdAt)
      .orWhere((tieBuilder: any) => {
        tieBuilder.where('created_at', '=', cursor.createdAt).andWhere(idColumn, '<', cursor.id);
      });
  });
}

function buildPage<Row extends { created_at: string | Date }>(
  rows: Row[],
  limit: number,
  idColumn: keyof Row
): TeamsObservabilityPage<Row> {
  const visibleRows = rows.slice(0, limit);
  const lastRow = visibleRows[visibleRows.length - 1];
  return {
    rows: visibleRows,
    nextCursor: rows.length > limit && lastRow
      ? encodeTeamsObservabilityCursor(lastRow.created_at, String(lastRow[idColumn]))
      : null,
  };
}

export async function listTeamsDeliveriesImpl(
  user: unknown,
  { tenant }: { tenant: string },
  params: ListTeamsDeliveriesParams = {}
): Promise<TeamsObservabilityPage<TeamsDeliveryObservabilityRow>> {
  const { knex } = await createTenantKnex(tenant);
  await assertTeamsReadPermission(user, knex);

  const limit = normalizeLimit(params.limit);
  const cursor = decodeTeamsObservabilityCursor(params.cursor);
  const since = validateSince(params.since);
  const status = DELIVERY_STATUSES.includes(params.status as TeamsDeliveryStatus) ? params.status : undefined;
  const category = normalizeOptionalString(params.category);

  const query = tenantDb(knex, tenant).table<TeamsDeliveryObservabilityRow>('teams_notification_deliveries')
    .where({ tenant })
    .modify((builder: any) => {
      if (status) {
        builder.andWhere('status', status);
      }
      if (category) {
        builder.andWhere('category', category);
      }
      if (since) {
        builder.andWhere('created_at', '>=', since);
      }
      applyCursor(builder, 'delivery_id', cursor);
    })
    .orderBy('created_at', 'desc')
    .orderBy('delivery_id', 'desc')
    .limit(limit + 1);

  const rows = await query;
  return buildPage(rows, limit, 'delivery_id');
}

export async function listTeamsAuditEventsImpl(
  user: unknown,
  { tenant }: { tenant: string },
  params: ListTeamsAuditEventsParams = {}
): Promise<TeamsObservabilityPage<TeamsAuditObservabilityRow>> {
  const { knex } = await createTenantKnex(tenant);
  await assertTeamsReadPermission(user, knex);

  const limit = normalizeLimit(params.limit);
  const cursor = decodeTeamsObservabilityCursor(params.cursor);
  const since = validateSince(params.since);
  const surface = AUDIT_SURFACES.includes(params.surface as TeamsAuditSurface) ? params.surface : undefined;
  const resultStatus = AUDIT_RESULT_STATUSES.includes(params.result_status as TeamsAuditResultStatus)
    ? params.result_status
    : undefined;
  const actionId = normalizeOptionalString(params.action_id);
  const actorUserId = normalizeOptionalString(params.actor_user_id);

  const query = tenantDb(knex, tenant).table<TeamsAuditObservabilityRow>('teams_audit_events')
    .where({ tenant })
    .modify((builder: any) => {
      if (surface) {
        builder.andWhere('surface', surface);
      }
      if (actionId) {
        builder.andWhere('action_id', actionId);
      }
      if (actorUserId) {
        builder.andWhere('actor_user_id', actorUserId);
      }
      if (resultStatus) {
        builder.andWhere('result_status', resultStatus);
      }
      if (since) {
        builder.andWhere('created_at', '>=', since);
      }
      applyCursor(builder, 'event_id', cursor);
    })
    .orderBy('created_at', 'desc')
    .orderBy('event_id', 'desc')
    .limit(limit + 1);

  const rows = await query;
  return buildPage(rows, limit, 'event_id');
}
