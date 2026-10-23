import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { TaggedEntityType } from '@alga-psa/types';
import TagMapping from '@alga-psa/tags/models/tagMapping';
import type { TicketWebhookInternalEvent as TicketWebhookInternalEventType } from './webhookEventMap';

const TICKET_WEBHOOK_CACHE_TTL_MS = 60_000;
const TICKET_WEBHOOK_CACHE_MAX_ENTRIES = 256;
const TICKET_TAGGED_ENTITY_TYPE: TaggedEntityType = 'ticket';

type NormalizedWebhookChange = {
  previous: unknown;
  new: unknown;
};

type TicketWebhookCommentPayload = {
  text: string;
  author: string | null;
  timestamp: string;
  is_internal: boolean;
  author_type?: string;
  contact_id?: string;
  contact_name?: string;
};

type TicketWebhookCommentsEntry = {
  comment_id: string;
  text: string;
  author: string | null;
  is_internal: boolean;
  is_resolution: boolean;
  author_type?: string;
  contact_id?: string;
  contact_name?: string;
  created_at: string;
  updated_at: string | null;
};

type CommentAuthorFields = Pick<TicketWebhookCommentPayload, 'author_type' | 'contact_id' | 'contact_name'>;

/**
 * Select list shared by the single-comment and full-thread lookups so both
 * report the author the same way. `contact_id` falls back to the author user's
 * linked contact for non-staff authors (portal comments record only user_id).
 */
const COMMENT_AUTHOR_SELECT = [
  'c.author_type',
  'c.contact_id as comment_contact_id',
  'u.contact_id as user_contact_id',
  'u.user_type as author_user_type',
];

function toCommentAuthorFields(
  row: { author_type?: unknown; comment_contact_id?: unknown; user_contact_id?: unknown; author_user_type?: unknown; comment_contact_name?: unknown; user_contact_name?: unknown },
): CommentAuthorFields {
  const fields: CommentAuthorFields = {};
  if (typeof row.author_type === 'string' && row.author_type.length > 0) {
    fields.author_type = row.author_type;
  }
  const viaUser = !row.comment_contact_id && row.author_user_type !== 'internal';
  const contactId = row.comment_contact_id ?? (viaUser ? row.user_contact_id : null);
  const contactName = row.comment_contact_id ? row.comment_contact_name : (viaUser ? row.user_contact_name : null);
  if (typeof contactId === 'string' && contactId.length > 0) {
    fields.contact_id = contactId;
    if (typeof contactName === 'string' && contactName.length > 0) {
      fields.contact_name = contactName;
    }
  }
  return fields;
}

export type TicketWebhookPayload = {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  status_id: string | null;
  status_name: string | null;
  priority_id: string | null;
  priority_name: string | null;
  client_id: string | null;
  client_name: string | null;
  contact_name_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_team_id: string | null;
  board_id: string | null;
  board_name: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  is_closed: boolean;
  /** Current response state of the ticket (awaiting_client / awaiting_internal / null). */
  response_state?: string | null;
  entered_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  due_date: string | null;
  tags: string[];
  url: string;
  suppress_contact_notifications: boolean;
  suppress_internal_notifications: boolean;
  previous_status_id?: string | null;
  previous_status_name?: string | null;
  /** Only on ticket.response_state_changed. */
  previous_response_state?: string | null;
  new_response_state?: string | null;
  changes?: Record<string, NormalizedWebhookChange>;
  comment?: TicketWebhookCommentPayload;
  /**
   * Full thread for this ticket. Only populated when the subscriber
   * requested the `comments` field. Ordered oldest → newest.
   */
  comments?: TicketWebhookCommentsEntry[];
};

type CachedTicketWebhookPayload = Omit<
  TicketWebhookPayload,
  | 'changes'
  | 'comment'
  | 'suppress_contact_notifications'
  | 'suppress_internal_notifications'
  // response_state is mutated by comments/status changes in the same transaction
  // as the event, so it is never cached; it is read fresh on every build.
  | 'response_state'
>;

type TicketWebhookRow = {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  status_id: string | null;
  status_name: string | null;
  priority_id: string | null;
  priority_name: string | null;
  client_id: string | null;
  client_name: string | null;
  contact_name_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_team_id: string | null;
  board_id: string | null;
  board_name: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  is_closed: boolean | null;
  entered_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  due_date: string | null;
};

const ticketWebhookCache = new Map<
  string,
  { value: CachedTicketWebhookPayload; expiresAt: number }
>();

export type TicketWebhookSourceEvent = {
  eventType: TicketWebhookInternalEventType;
  timestamp?: string;
  payload: {
    tenantId: string;
    ticketId: string;
    occurredAt?: string;
    changes?: unknown;
    comment?: unknown;
    [key: string]: unknown;
  };
};

export async function buildTicketWebhookPayload(
  internalEvent: TicketWebhookSourceEvent,
  knex: Knex
): Promise<TicketWebhookPayload> {
  const tenantId = internalEvent.payload.tenantId;
  const ticketId = internalEvent.payload.ticketId;

  if (!tenantId || !ticketId) {
    throw new Error('Ticket webhook payload requires payload.tenantId and payload.ticketId');
  }

  const basePayload = await getCachedTicketWebhookPayload(knex, tenantId, ticketId);
  const payload: TicketWebhookPayload = {
    ...basePayload,
    response_state: await fetchCurrentResponseState(knex, tenantId, ticketId),
    tags: [...basePayload.tags],
    suppress_contact_notifications: internalEvent.payload.suppressContactNotifications === true,
    suppress_internal_notifications: internalEvent.payload.suppressInternalNotifications === true,
  };

  if (internalEvent.eventType === 'TICKET_STATUS_CHANGED') {
    const previousStatusId = resolvePreviousStatusId(internalEvent);
    if (previousStatusId) {
      payload.previous_status_id = previousStatusId;
      payload.previous_status_name = await fetchStatusName(knex, tenantId, previousStatusId);
    }
  }

  const changes = normalizeChanges((internalEvent.payload as { changes?: unknown }).changes);
  if (changes && internalEvent.eventType === 'TICKET_UPDATED') {
    payload.changes = changes;
  }

  if (internalEvent.eventType === 'TICKET_RESPONSE_STATE_CHANGED') {
    const eventPayload = internalEvent.payload as {
      previousState?: unknown;
      previousResponseState?: unknown;
      newState?: unknown;
      newResponseState?: unknown;
    };
    payload.previous_response_state = asResponseState(eventPayload.previousState ?? eventPayload.previousResponseState);
    payload.new_response_state = asResponseState(eventPayload.newState ?? eventPayload.newResponseState);
    // The event is authoritative for its own transition, even if a later
    // change has already moved the row on.
    payload.response_state = payload.new_response_state;
  }

  const comment = normalizeCommentPayload(internalEvent);
  if (comment) {
    // The consumer-side schema parse can strip top-level `commentId`, but keeps `comment.id`.
    const eventPayload = internalEvent.payload as { commentId?: unknown; comment?: { id?: unknown } | null };
    const commentId = eventPayload.commentId ?? eventPayload.comment?.id;
    if (typeof commentId === 'string' && commentId.length > 0) {
      Object.assign(comment, await fetchCommentAuthorFields(knex, tenantId, commentId));
    }
    payload.comment = comment;
  }

  return payload;
}

function asResponseState(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function fetchCurrentResponseState(
  knex: Knex,
  tenantId: string,
  ticketId: string
): Promise<string | null> {
  const row = await tenantDb(knex, tenantId)
    .table('tickets')
    .select('response_state')
    .where({ ticket_id: ticketId })
    .first();
  return asResponseState(row?.response_state);
}

async function fetchCommentAuthorFields(
  knex: Knex,
  tenantId: string,
  commentId: string
): Promise<CommentAuthorFields> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('comments as c');
  db.tenantJoin(query, 'users as u', 'c.user_id', 'u.user_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as cco', 'c.contact_id', 'cco.contact_name_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as uco', 'u.contact_id', 'uco.contact_name_id', { type: 'left' });

  const row = await query
    .select(...COMMENT_AUTHOR_SELECT, 'cco.full_name as comment_contact_name',
      'uco.full_name as user_contact_name')
    .where({ 'c.comment_id': commentId })
    .first();

  return row ? toCommentAuthorFields(row) : {};
}

export function clearTicketWebhookPayloadCache(): void {
  ticketWebhookCache.clear();
}

async function getCachedTicketWebhookPayload(
  knex: Knex,
  tenantId: string,
  ticketId: string
): Promise<CachedTicketWebhookPayload> {
  const cacheKey = `${tenantId}:${ticketId}`;
  const now = Date.now();
  const cached = ticketWebhookCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await fetchTicketWebhookPayload(knex, tenantId, ticketId);
  ticketWebhookCache.set(cacheKey, {
    value,
    expiresAt: now + TICKET_WEBHOOK_CACHE_TTL_MS,
  });

  if (ticketWebhookCache.size > TICKET_WEBHOOK_CACHE_MAX_ENTRIES) {
    for (const [key, entry] of ticketWebhookCache) {
      if (entry.expiresAt <= now) {
        ticketWebhookCache.delete(key);
      }
    }
  }

  return value;
}

async function fetchTicketWebhookPayload(
  knex: Knex,
  tenantId: string,
  ticketId: string
): Promise<CachedTicketWebhookPayload> {
  const [ticket, tags] = await Promise.all([
    fetchTicketWebhookRow(knex, tenantId, ticketId),
    fetchTicketTags(knex, tenantId, ticketId),
  ]);

  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found for tenant ${tenantId}`);
  }

  return {
    ticket_id: ticket.ticket_id,
    ticket_number: ticket.ticket_number ?? null,
    title: ticket.title ?? null,
    status_id: ticket.status_id ?? null,
    status_name: ticket.status_name ?? null,
    priority_id: ticket.priority_id ?? null,
    priority_name: ticket.priority_name ?? null,
    client_id: ticket.client_id ?? null,
    client_name: ticket.client_name ?? null,
    contact_name_id: ticket.contact_name_id ?? null,
    contact_name: ticket.contact_name ?? null,
    contact_email: ticket.contact_email ?? null,
    assigned_to: ticket.assigned_to ?? null,
    assigned_to_name: ticket.assigned_to_name ?? null,
    assigned_team_id: ticket.assigned_team_id ?? null,
    board_id: ticket.board_id ?? null,
    board_name: ticket.board_name ?? null,
    category_id: ticket.category_id ?? null,
    subcategory_id: ticket.subcategory_id ?? null,
    is_closed: Boolean(ticket.is_closed),
    entered_at: ticket.entered_at ?? null,
    updated_at: ticket.updated_at ?? null,
    closed_at: ticket.closed_at ?? null,
    due_date: ticket.due_date ?? null,
    tags,
    url: buildTicketUrl(ticket.ticket_id),
  };
}

async function fetchTicketWebhookRow(
  knex: Knex,
  tenantId: string,
  ticketId: string
): Promise<TicketWebhookRow | undefined> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('tickets as t');
  db.tenantJoin(query, 'clients as c', 't.client_id', 'c.client_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as co', 't.contact_name_id', 'co.contact_name_id', { type: 'left' });
  db.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
  db.tenantJoin(query, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
  db.tenantJoin(query, 'users as au', 't.assigned_to', 'au.user_id', { type: 'left' });
  db.tenantJoin(query, 'boards as b', 't.board_id', 'b.board_id', { type: 'left' });

  return query
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.status_id',
      's.name as status_name',
      't.priority_id',
      'p.priority_name',
      't.client_id',
      'c.client_name',
      't.contact_name_id',
      'co.full_name as contact_name',
      'co.email as contact_email',
      't.assigned_to',
      knex.raw(
        "NULLIF(TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))), '') as assigned_to_name"
      ),
      't.assigned_team_id',
      't.board_id',
      'b.board_name',
      't.category_id',
      't.subcategory_id',
      knex.raw('COALESCE(t.is_closed, s.is_closed, false) as is_closed'),
      't.entered_at',
      't.updated_at',
      't.closed_at',
      't.due_date'
    )
    .where({
      't.ticket_id': ticketId,
    })
    .first();
}

async function fetchTicketTags(
  knex: Knex,
  tenantId: string,
  ticketId: string
): Promise<string[]> {
  const tags = await TagMapping.getByEntity(knex, tenantId, ticketId, TICKET_TAGGED_ENTITY_TYPE);
  return tags.map((tag) => tag.tag_text).filter(Boolean);
}

async function fetchStatusName(
  knex: Knex,
  tenantId: string,
  statusId: string
): Promise<string | null> {
  const row = await tenantDb(knex, tenantId).table('statuses')
    .select('name')
    .where({
      status_id: statusId,
    })
    .first<{ name: string | null }>();

  return row?.name ?? null;
}

/**
 * Fetch the full comment thread for a ticket. Used by the webhook subscriber
 * when at least one matching webhook has the `comments` field selected.
 *
 * Lives outside the per-ticket payload cache because comments change on
 * every TICKET_COMMENT_ADDED — caching them inside the 60s base payload
 * would let stale threads slip out for a full minute after each new entry.
 */
export async function fetchTicketCommentsForWebhook(
  knex: Knex,
  tenantId: string,
  ticketId: string,
): Promise<TicketWebhookCommentsEntry[]> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('comments as c');
  db.tenantJoin(query, 'users as u', 'c.user_id', 'u.user_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as cco', 'c.contact_id', 'cco.contact_name_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as uco', 'u.contact_id', 'uco.contact_name_id', { type: 'left' });

  const rows = await query
    .select(
      ...COMMENT_AUTHOR_SELECT,
      'cco.full_name as comment_contact_name',
      'uco.full_name as user_contact_name',
      'c.comment_id',
      'c.note',
      'c.markdown_content',
      'c.is_internal',
      'c.is_resolution',
      'c.created_at',
      'c.updated_at',
      knex.raw(
        "NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') as author_name",
      ),
    )
    .where({
      'c.ticket_id': ticketId,
    })
    .orderBy('c.created_at', 'asc');

  return rows.map((row: any) => ({
    comment_id: row.comment_id,
    text: typeof row.markdown_content === 'string' && row.markdown_content.length > 0
      ? row.markdown_content
      : (typeof row.note === 'string' ? row.note : ''),
    author: row.author_name ?? null,
    is_internal: Boolean(row.is_internal),
    is_resolution: Boolean(row.is_resolution),
    ...toCommentAuthorFields(row),
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    updated_at: row.updated_at
      ? (row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at))
      : null,
  }));
}

function normalizeChanges(
  changes: unknown
): Record<string, NormalizedWebhookChange> | undefined {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(changes).flatMap(([field, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    const candidate = value as { previous?: unknown; old?: unknown; new?: unknown };
    const previous = candidate.previous ?? candidate.old;

    if (!('new' in candidate)) {
      return [];
    }

    return [[field, { previous, new: candidate.new }] as const];
  });

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function normalizeCommentPayload(
  internalEvent: TicketWebhookSourceEvent
): TicketWebhookCommentPayload | undefined {
  if (internalEvent.eventType !== 'TICKET_COMMENT_ADDED') {
    return undefined;
  }

  const comment = (internalEvent.payload as { comment?: unknown }).comment;
  if (!comment || typeof comment !== 'object' || Array.isArray(comment)) {
    return undefined;
  }

  const candidate = comment as {
    content?: unknown;
    author?: unknown;
    isInternal?: unknown;
  };

  return {
    text: typeof candidate.content === 'string' ? candidate.content : '',
    author: typeof candidate.author === 'string' ? candidate.author : null,
    timestamp: resolveOccurredAt(internalEvent),
    is_internal: Boolean(candidate.isInternal),
  };
}

function resolvePreviousStatusId(internalEvent: TicketWebhookSourceEvent): string | undefined {
  const payload = internalEvent.payload as {
    previousStatusId?: unknown;
    changes?: {
      status_id?: {
        from?: unknown;
        previous?: unknown;
        old?: unknown;
      };
    };
  };

  if (typeof payload.previousStatusId === 'string' && payload.previousStatusId.length > 0) {
    return payload.previousStatusId;
  }

  const previousFromChanges =
    payload.changes?.status_id?.from
    ?? payload.changes?.status_id?.previous
    ?? payload.changes?.status_id?.old;

  if (typeof previousFromChanges === 'string' && previousFromChanges.length > 0) {
    return previousFromChanges;
  }

  return undefined;
}

function resolveOccurredAt(internalEvent: TicketWebhookSourceEvent): string {
  const payload = internalEvent.payload as { occurredAt?: unknown };

  if (typeof payload.occurredAt === 'string' && payload.occurredAt.length > 0) {
    return payload.occurredAt;
  }

  if (typeof internalEvent.timestamp === 'string' && internalEvent.timestamp.length > 0) {
    return internalEvent.timestamp;
  }

  return new Date().toISOString();
}

function buildTicketUrl(ticketId: string): string {
  const baseUrl = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${baseUrl}/msp/tickets/${ticketId}`;
}
