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

import type {
  TicketActivityChanges,
  TicketActivityRow,
} from './types';

export type TicketTimelineEntryType = 'activity' | 'comment';

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
}

export interface ReadTicketActivityOptions {
  /** Optional max number of activity rows returned (newest first). */
  limit?: number;
  /** Filter by event type. */
  eventTypes?: string[];
}

export async function readTicketActivity(
  knex: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
  opts: ReadTicketActivityOptions = {},
): Promise<TicketActivityRow[]> {
  if (!tenant) throw new Error('readTicketActivity requires tenant');
  if (!ticketId) throw new Error('readTicketActivity requires ticketId');

  let q = (knex as Knex)('ticket_audit_logs')
    .where({ tenant, ticket_id: ticketId })
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
  /** Sort order. Default 'desc' (newest first). */
  order?: 'asc' | 'desc';
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

  const activityRows = await readTicketActivity(knex, tenant, ticketId);

  let commentQuery = (knex as Knex)('comments')
    .where({ tenant, ticket_id: ticketId });
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

  const merged = [...activityEntries, ...commentEntries];
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
