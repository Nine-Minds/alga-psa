/**
 * Read-model for the unified ticket timeline.
 *
 * - `readTicketActivity` returns the raw activity rows for a ticket.
 * - `buildUnifiedTicketTimeline` interleaves activity rows with comments so
 *   the UI can render a single chronological stream.
 *
 * Permission enforcement is the caller's responsibility — this module assumes
 * the caller has already verified the requesting user can read the ticket
 * (via the existing internal-ticket permission checks). The
 * `buildUnifiedTicketTimeline` helper is internal-only by design; the client
 * portal MUST NOT call it in v1.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import type {
  TicketActivityChanges,
  TicketActivityRow,
} from './types';

export type TicketTimelineEntryType = 'activity' | 'comment' | 'time_entry' | 'alert';

export interface TicketTimelineTimeEntry {
  entry_id: string;
  user_id: string | null;
  user_display_name: string | null;
  start_time: string;
  end_time: string | null;
  billable_duration: number;
  notes: string | null;
  work_date: string | null;
}

export interface TicketTimelineAlert {
  alert_id: string;
  severity: string | null;
  message: string | null;
  device_name: string | null;
  occurrence_count: number | null;
  triggered_at: string;
  resolved_at: string | null;
  alert_class: string | null;
  source_type: string | null;
}

export interface TicketTimelineEntry {
  /**
   * Logical row type. UI dispatches per type:
   *   - `activity` rows render via the activity formatter.
   *   - `comment`  rows render the existing comment surface (with author and body).
   */
  type: TicketTimelineEntryType;
  /** Stable sort key. `occurred_at` for activity, `created_at` for comments. */
  occurredAt: string;
  /** Stable secondary sort key, used to break ties on identical timestamps. */
  sortId: string;
  /** Raw activity row when `type === 'activity'`. */
  activity?: TicketActivityRow;
  /** Raw comment row when `type === 'comment'`. */
  comment?: Record<string, unknown>;
  /** Time entry summary when `type === 'time_entry'`. */
  timeEntry?: TicketTimelineTimeEntry;
  /** RMM alert summary when `type === 'alert'`. */
  alert?: TicketTimelineAlert;
}

export interface ReadTicketActivityOptions {
  /** Optional max number of activity rows returned (newest first). */
  limit?: number;
  /** Filter by event type. */
  eventTypes?: string[];
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function readTicketActivity(
  knex: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
  opts: ReadTicketActivityOptions = {},
): Promise<TicketActivityRow[]> {
  if (!tenant) throw new Error('readTicketActivity requires tenant');
  if (!ticketId) throw new Error('readTicketActivity requires ticketId');

  let q = tenantScopedTable(knex, 'ticket_audit_logs', tenant)
    .where({ ticket_id: ticketId })
    .orderBy([
      { column: 'occurred_at', order: 'desc' },
      { column: 'audit_id', order: 'desc' },
    ]);

  if (opts.eventTypes && opts.eventTypes.length > 0) {
    q = q.whereIn('event_type', opts.eventTypes);
  }
  if (typeof opts.limit === 'number' && opts.limit > 0) {
    q = q.limit(opts.limit);
  }

  const rows = (await q) as Array<Record<string, unknown>>;
  return rows.map((row) => normalizeActivityRow(row));
}

function normalizeActivityRow(row: Record<string, unknown>): TicketActivityRow {
  const changes = row.changes as TicketActivityChanges | string | null | undefined;
  const details = row.details as Record<string, unknown> | string | null | undefined;
  return {
    tenant: row.tenant as string,
    audit_id: row.audit_id as string,
    ticket_id: row.ticket_id as string,
    event_type: row.event_type as string,
    entity_type: row.entity_type as string,
    entity_id: (row.entity_id as string | null) ?? null,
    actor_type: row.actor_type as string,
    actor_user_id: (row.actor_user_id as string | null) ?? null,
    actor_contact_id: (row.actor_contact_id as string | null) ?? null,
    actor_display_name: (row.actor_display_name as string | null) ?? null,
    source: row.source as string,
    occurred_at:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : (row.occurred_at as string),
    changes:
      typeof changes === 'string' ? (JSON.parse(changes) as TicketActivityChanges) : (changes ?? {}),
    details:
      typeof details === 'string'
        ? (JSON.parse(details) as Record<string, unknown>)
        : (details ?? {}),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string),
  };
}

export interface BuildUnifiedTimelineOptions {
  /** Include internal notes in the merged timeline. Default true. */
  includeInternalNotes?: boolean;
  /** Include ticket-linked time entries in the merged timeline. Default false. */
  includeTimeEntries?: boolean;
  /** Include ticket-linked RMM alerts in the merged timeline. Default false. */
  includeAlerts?: boolean;
  /** Sort order. Default 'desc' (newest first). */
  order?: 'asc' | 'desc';
}

function normalizeRequiredIso(value: unknown, fieldName: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`${fieldName} is required`);
}

function normalizeNullableIso(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${fieldName} must be a string, Date, or null`);
}

function normalizeNullableDate(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  throw new Error(`${fieldName} must be a string, Date, or null`);
}

function normalizeRequiredNumber(value: unknown, fieldName: string): number {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} is required`);
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  return numericValue;
}

function normalizeNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  return numericValue;
}

export function mergeTimelineEntries(
  entries: TicketTimelineEntry[],
  order: 'asc' | 'desc' = 'desc',
): TicketTimelineEntry[] {
  const merged = [...entries];
  merged.sort((a, b) => {
    if (a.occurredAt === b.occurredAt) {
      return order === 'asc' ? a.sortId.localeCompare(b.sortId) : b.sortId.localeCompare(a.sortId);
    }
    return order === 'asc'
      ? a.occurredAt.localeCompare(b.occurredAt)
      : b.occurredAt.localeCompare(a.occurredAt);
  });

  return merged;
}

/**
 * Merge activity rows with comments for the same ticket.
 *
 * INTERNAL USE ONLY in v1. Do not call from the client portal.
 *
 * Tie-breaking: rows with identical `occurredAt` are deterministically
 * ordered by their sortId. Activity rows use `audit_id`, comments use
 * `comment_id`.
 */
export async function buildUnifiedTicketTimeline(
  knex: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
  opts: BuildUnifiedTimelineOptions = {},
): Promise<TicketTimelineEntry[]> {
  if (!tenant) throw new Error('buildUnifiedTicketTimeline requires tenant');
  if (!ticketId) throw new Error('buildUnifiedTicketTimeline requires ticketId');

  const order = opts.order ?? 'desc';
  const includeInternal = opts.includeInternalNotes ?? true;
  const includeTimeEntries = opts.includeTimeEntries ?? false;
  const includeAlerts = opts.includeAlerts ?? false;

  const activityRows = await readTicketActivity(knex, tenant, ticketId);

  let commentQuery = tenantScopedTable(knex, 'comments', tenant)
    .where({ ticket_id: ticketId });
  if (!includeInternal) {
    commentQuery = commentQuery.where((qb) =>
      qb.where('is_internal', false).orWhereNull('is_internal'),
    );
  }
  const commentRows = (await commentQuery) as Array<Record<string, unknown>>;

  const activityEntries: TicketTimelineEntry[] = activityRows.map((row) => ({
    type: 'activity',
    occurredAt: row.occurred_at,
    sortId: row.audit_id,
    activity: row,
  }));

  const commentEntries: TicketTimelineEntry[] = commentRows.map((row) => {
    const createdAt =
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string);
    return {
      type: 'comment',
      occurredAt: createdAt,
      sortId: (row.comment_id as string) ?? '',
      comment: row,
    };
  });

  let timeEntryEntries: TicketTimelineEntry[] = [];
  if (includeTimeEntries) {
    const timeEntryQuery = tenantScopedTable(knex, 'time_entries as te', tenant)
      .where({
        'te.work_item_id': ticketId,
        'te.work_item_type': 'ticket',
      })
      .select(
        'te.entry_id',
        'te.user_id',
        'te.start_time',
        'te.end_time',
        'te.billable_duration',
        'te.notes',
        'te.work_date',
        knex.raw(
          "NULLIF(TRIM(CONCAT_WS(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, ''))), '') AS user_display_name",
        ),
      );
    tenantDb(knex, tenant).tenantJoin(timeEntryQuery, 'users as u', 'te.user_id', 'u.user_id', { type: 'left' });

    const timeEntryRows = (await timeEntryQuery) as Array<Record<string, unknown>>;
    timeEntryEntries = timeEntryRows.map((row) => {
      const startTime = normalizeRequiredIso(row.start_time, 'time_entries.start_time');
      const timeEntry: TicketTimelineTimeEntry = {
        entry_id: row.entry_id as string,
        user_id: (row.user_id as string | null) ?? null,
        user_display_name: (row.user_display_name as string | null) ?? null,
        start_time: startTime,
        end_time: normalizeNullableIso(row.end_time, 'time_entries.end_time'),
        billable_duration: normalizeRequiredNumber(row.billable_duration, 'time_entries.billable_duration'),
        notes: (row.notes as string | null) ?? null,
        work_date: normalizeNullableDate(row.work_date, 'time_entries.work_date'),
      };
      return {
        type: 'time_entry',
        occurredAt: startTime,
        sortId: timeEntry.entry_id,
        timeEntry,
      };
    });
  }

  let alertEntries: TicketTimelineEntry[] = [];
  if (includeAlerts) {
    const alertRows = (await tenantScopedTable(knex, 'rmm_alerts', tenant)
      .where({ ticket_id: ticketId })
      .select(
        'alert_id',
        'severity',
        'message',
        'device_name',
        'occurrence_count',
        'triggered_at',
        'resolved_at',
        'alert_class',
        'source_type',
      )) as Array<Record<string, unknown>>;

    alertEntries = alertRows.map((row) => {
      const triggeredAt = normalizeRequiredIso(row.triggered_at, 'rmm_alerts.triggered_at');
      const alert: TicketTimelineAlert = {
        alert_id: row.alert_id as string,
        severity: (row.severity as string | null) ?? null,
        message: (row.message as string | null) ?? null,
        device_name: (row.device_name as string | null) ?? null,
        occurrence_count: normalizeNullableNumber(row.occurrence_count, 'rmm_alerts.occurrence_count'),
        triggered_at: triggeredAt,
        resolved_at: normalizeNullableIso(row.resolved_at, 'rmm_alerts.resolved_at'),
        alert_class: (row.alert_class as string | null) ?? null,
        source_type: (row.source_type as string | null) ?? null,
      };
      return {
        type: 'alert',
        occurredAt: triggeredAt,
        sortId: alert.alert_id,
        alert,
      };
    });
  }

  return mergeTimelineEntries(
    [...activityEntries, ...commentEntries, ...timeEntryEntries, ...alertEntries],
    order,
  );
}
