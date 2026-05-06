import type { Knex } from 'knex';
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
};

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
  entered_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  due_date: string | null;
  tags: string[];
  url: string;
  changes?: Record<string, NormalizedWebhookChange>;
  comment?: TicketWebhookCommentPayload;
};

type CachedTicketWebhookPayload = Omit<TicketWebhookPayload, 'changes' | 'comment'>;

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
    tags: [...basePayload.tags],
  };

  const changes = normalizeChanges((internalEvent.payload as { changes?: unknown }).changes);
  if (changes && internalEvent.eventType === 'TICKET_UPDATED') {
    payload.changes = changes;
  }

  const comment = normalizeCommentPayload(internalEvent);
  if (comment) {
    payload.comment = comment;
  }

  return payload;
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
  return knex('tickets as t')
    .leftJoin('clients as c', function joinClients() {
      this.on('t.client_id', '=', 'c.client_id').andOn('t.tenant', '=', 'c.tenant');
    })
    .leftJoin('contacts as co', function joinContacts() {
      this.on('t.contact_name_id', '=', 'co.contact_name_id').andOn('t.tenant', '=', 'co.tenant');
    })
    .leftJoin('statuses as s', function joinStatuses() {
      this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
    })
    .leftJoin('priorities as p', function joinPriorities() {
      this.on('t.priority_id', '=', 'p.priority_id').andOn('t.tenant', '=', 'p.tenant');
    })
    .leftJoin('users as au', function joinAssignedUsers() {
      this.on('t.assigned_to', '=', 'au.user_id').andOn('t.tenant', '=', 'au.tenant');
    })
    .leftJoin('boards as b', function joinBoards() {
      this.on('t.board_id', '=', 'b.board_id').andOn('t.tenant', '=', 'b.tenant');
    })
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
      't.tenant': tenantId,
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
