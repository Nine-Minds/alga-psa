/**
 * Single source of truth for the outbound webhook events Alga PSA delivers.
 *
 * Everything that lists, validates, subscribes to or delivers a public webhook
 * event name derives from WEBHOOK_EVENT_REGISTRY:
 *   - the REST zod enum (`webhookEventTypeSchema`) and the OpenAPI spec
 *   - the REST `GET /webhooks/events` listing and the admin `listWebhookEvents`
 *   - `SUPPORTED_WEBHOOK_EVENTS` and the retry envelope in deliveryRetry.ts
 *   - the internal -> public maps used by every webhook subscriber
 *
 * This module is pure data + pure helpers (no DB / event-bus imports) so it can
 * be imported from schemas, actions, subscribers and tests alike.
 *
 * Each entry carries:
 *   - `name`            public event name (what subscribers store and receive)
 *   - `entity`          payload-allowlist key (`payload_fields[entity]`)
 *   - `sourceEvents`    internal domain events (EventType) that produce it
 *   - `entityIdKeys`    payload keys an `event_filter.entity_ids` entry may match
 *                       (the entity's own id first, then any parent id)
 *
 * Legacy names: rows created before this registry may hold names that are no
 * longer advertised (time.entry.*, invoice.*, asset.*, system.*, workflow.*,
 * custom.event). They are never migrated and never deliver; see
 * `classifyEventTypes` / `assertEventTypesAllowed`.
 */

export type WebhookEntity = 'ticket' | 'project' | 'client' | 'contact' | 'client_location' | 'quote';

export interface WebhookEventDefinition {
  readonly name: string;
  readonly entity: WebhookEntity;
  readonly sourceEvents: readonly string[];
  readonly entityIdKeys: readonly string[];
}

const def = <const T extends WebhookEventDefinition>(d: T): T => d;

export const WEBHOOK_EVENT_REGISTRY = [
  // ---- ticket (unchanged) ------------------------------------------------
  def({ name: 'ticket.created', entity: 'ticket', sourceEvents: ['TICKET_CREATED'], entityIdKeys: ['ticket_id'] }),
  def({ name: 'ticket.updated', entity: 'ticket', sourceEvents: ['TICKET_UPDATED'], entityIdKeys: ['ticket_id'] }),
  def({ name: 'ticket.assigned', entity: 'ticket', sourceEvents: ['TICKET_ASSIGNED'], entityIdKeys: ['ticket_id'] }),
  def({ name: 'ticket.status_changed', entity: 'ticket', sourceEvents: ['TICKET_STATUS_CHANGED'], entityIdKeys: ['ticket_id'] }),
  def({ name: 'ticket.closed', entity: 'ticket', sourceEvents: ['TICKET_CLOSED'], entityIdKeys: ['ticket_id'] }),
  def({ name: 'ticket.comment.added', entity: 'ticket', sourceEvents: ['TICKET_COMMENT_ADDED'], entityIdKeys: ['ticket_id'] }),
  def({
    name: 'ticket.response_state_changed',
    entity: 'ticket',
    sourceEvents: ['TICKET_RESPONSE_STATE_CHANGED'],
    entityIdKeys: ['ticket_id'],
  }),

  // ---- project (unchanged) -----------------------------------------------
  def({ name: 'project.created', entity: 'project', sourceEvents: ['PROJECT_CREATED'], entityIdKeys: ['project_id'] }),
  def({ name: 'project.updated', entity: 'project', sourceEvents: ['PROJECT_UPDATED'], entityIdKeys: ['project_id'] }),
  def({ name: 'project.status_changed', entity: 'project', sourceEvents: ['PROJECT_STATUS_CHANGED'], entityIdKeys: ['project_id'] }),
  def({ name: 'project.assigned', entity: 'project', sourceEvents: ['PROJECT_ASSIGNED'], entityIdKeys: ['project_id'] }),
  def({ name: 'project.closed', entity: 'project', sourceEvents: ['PROJECT_CLOSED'], entityIdKeys: ['project_id'] }),
  // LEVERAGE: friction webhook-one-internal-event-one-public-name — PROJECT_CLOSED feeds both project.closed and
  // project.completed (deprecated alias). The delivery queue dedupes on (eventId, webhookId), so a subscriber on
  // both names loses one delivery. Left as-is: removing the alias is a separate compatibility decision.
  def({ name: 'project.completed', entity: 'project', sourceEvents: ['PROJECT_CLOSED'], entityIdKeys: ['project_id'] }),
  def({ name: 'project.task.created', entity: 'project', sourceEvents: ['PROJECT_TASK_CREATED'], entityIdKeys: ['task_id'] }),
  def({ name: 'project.task.updated', entity: 'project', sourceEvents: ['PROJECT_TASK_UPDATED'], entityIdKeys: ['task_id'] }),
  def({
    name: 'project.task.status_changed',
    entity: 'project',
    sourceEvents: ['PROJECT_TASK_STATUS_CHANGED'],
    entityIdKeys: ['task_id'],
  }),
  def({ name: 'project.task.assigned', entity: 'project', sourceEvents: ['PROJECT_TASK_ASSIGNED'], entityIdKeys: ['task_id'] }),
  def({ name: 'project.task.completed', entity: 'project', sourceEvents: ['PROJECT_TASK_COMPLETED'], entityIdKeys: ['task_id'] }),

  // ---- client ------------------------------------------------------------
  def({ name: 'client.created', entity: 'client', sourceEvents: ['CLIENT_CREATED'], entityIdKeys: ['client_id'] }),
  // CLIENT_STATUS_CHANGED is a real update of the client's status; CONTACT_PRIMARY_SET changes the client's
  // primary contact. Both are "the client changed" and neither gets a second public name.
  def({
    name: 'client.updated',
    entity: 'client',
    sourceEvents: ['CLIENT_UPDATED', 'CLIENT_STATUS_CHANGED', 'CONTACT_PRIMARY_SET'],
    entityIdKeys: ['client_id'],
  }),
  def({ name: 'client.deactivated', entity: 'client', sourceEvents: ['CLIENT_ARCHIVED'], entityIdKeys: ['client_id'] }),
  // CLIENT_MERGED => the source client is gone (client_id = sourceClientId).
  def({ name: 'client.deleted', entity: 'client', sourceEvents: ['CLIENT_DELETED', 'CLIENT_MERGED'], entityIdKeys: ['client_id'] }),

  // ---- contact -----------------------------------------------------------
  def({ name: 'contact.created', entity: 'contact', sourceEvents: ['CONTACT_CREATED'], entityIdKeys: ['contact_id', 'client_id'] }),
  def({ name: 'contact.updated', entity: 'contact', sourceEvents: ['CONTACT_UPDATED'], entityIdKeys: ['contact_id', 'client_id'] }),
  def({ name: 'contact.deactivated', entity: 'contact', sourceEvents: ['CONTACT_ARCHIVED'], entityIdKeys: ['contact_id', 'client_id'] }),
  def({ name: 'contact.deleted', entity: 'contact', sourceEvents: ['CONTACT_DELETED'], entityIdKeys: ['contact_id', 'client_id'] }),

  // ---- client location ---------------------------------------------------
  def({
    name: 'client_location.created',
    entity: 'client_location',
    sourceEvents: ['CLIENT_LOCATION_CREATED'],
    entityIdKeys: ['location_id', 'client_id'],
  }),
  def({
    name: 'client_location.updated',
    entity: 'client_location',
    sourceEvents: ['CLIENT_LOCATION_UPDATED'],
    entityIdKeys: ['location_id', 'client_id'],
  }),
  def({
    name: 'client_location.deactivated',
    entity: 'client_location',
    sourceEvents: ['CLIENT_LOCATION_DEACTIVATED'],
    entityIdKeys: ['location_id', 'client_id'],
  }),
  def({
    name: 'client_location.deleted',
    entity: 'client_location',
    sourceEvents: ['CLIENT_LOCATION_DELETED'],
    entityIdKeys: ['location_id', 'client_id'],
  }),
  def({ name: 'quote.sent', entity: 'quote', sourceEvents: ['QUOTE_SENT'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.viewed', entity: 'quote', sourceEvents: ['QUOTE_VIEWED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.approved', entity: 'quote', sourceEvents: ['QUOTE_APPROVED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.accepted', entity: 'quote', sourceEvents: ['QUOTE_ACCEPTED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.rejected', entity: 'quote', sourceEvents: ['QUOTE_REJECTED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.expired', entity: 'quote', sourceEvents: ['QUOTE_EXPIRED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.converted', entity: 'quote', sourceEvents: ['QUOTE_CONVERTED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.conversion_reverted', entity: 'quote', sourceEvents: ['QUOTE_CONVERSION_REVERTED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.superseded', entity: 'quote', sourceEvents: ['QUOTE_SUPERSEDED'], entityIdKeys: ['quote_id', 'client_id'] }),
  def({ name: 'quote.cancelled', entity: 'quote', sourceEvents: ['QUOTE_CANCELLED'], entityIdKeys: ['quote_id', 'client_id'] }),
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENT_REGISTRY)[number]['name'];

/** Tuple form for z.enum(); order follows the registry. */
export const WEBHOOK_EVENT_NAMES = WEBHOOK_EVENT_REGISTRY.map((e) => e.name) as unknown as readonly [
  WebhookEventName,
  ...WebhookEventName[],
];

const BY_NAME: ReadonlyMap<string, WebhookEventDefinition> = new Map(
  WEBHOOK_EVENT_REGISTRY.map((e) => [e.name, e]),
);

export function getWebhookEventDefinition(name: string): WebhookEventDefinition | undefined {
  return BY_NAME.get(name);
}

export function isRegisteredWebhookEvent(name: unknown): name is WebhookEventName {
  return typeof name === 'string' && BY_NAME.has(name);
}

export function webhookEventsForEntity(entity: WebhookEntity): WebhookEventDefinition[] {
  return WEBHOOK_EVENT_REGISTRY.filter((e) => e.entity === entity);
}

/** Registry entries fed by one internal domain event (empty when none). */
export function publicEventsForSource(entity: WebhookEntity, sourceEvent: string): WebhookEventName[] {
  return WEBHOOK_EVENT_REGISTRY.filter((e) => e.entity === entity && (e.sourceEvents as readonly string[]).includes(sourceEvent)).map(
    (e) => e.name,
  );
}

/** Internal -> public map for one entity, derived from the registry. */
export function internalToPublicMap(entity: WebhookEntity): Record<string, readonly WebhookEventName[]> {
  const map: Record<string, WebhookEventName[]> = {};
  for (const e of webhookEventsForEntity(entity)) {
    for (const source of e.sourceEvents) {
      (map[source] ??= []).push(e.name as WebhookEventName);
    }
  }
  return map;
}

/** Distinct internal events a subscriber for `entity` must listen to. */
export function sourceEventsForEntity(entity: WebhookEntity): string[] {
  return Object.keys(internalToPublicMap(entity));
}

/**
 * Event types that were once advertised and may still be stored on old
 * subscriptions. They are inert: nothing emits them, so a row holding one never
 * receives a delivery and never errors.
 */
export const LEGACY_WEBHOOK_EVENT_PREFIXES = ['time.entry.', 'invoice.', 'asset.', 'system.', 'workflow.'] as const;
export const LEGACY_WEBHOOK_EVENT_NAMES = ['custom.event'] as const;

export function isKnownLegacyWebhookEvent(name: string): boolean {
  return (
    (LEGACY_WEBHOOK_EVENT_NAMES as readonly string[]).includes(name) ||
    LEGACY_WEBHOOK_EVENT_PREFIXES.some((p) => name.startsWith(p))
  );
}

export interface ClassifiedEventTypes {
  /** Names in the registry (deliverable). */
  active: string[];
  /** Stored names that are not in the registry (inert). */
  inert: string[];
}

export function classifyEventTypes(eventTypes: readonly string[] | null | undefined): ClassifiedEventTypes {
  const active: string[] = [];
  const inert: string[] = [];
  for (const t of eventTypes ?? []) {
    (isRegisteredWebhookEvent(t) ? active : inert).push(t);
  }
  return { active, inert };
}

/**
 * Names a write is not allowed to introduce: not in the registry AND not
 * already stored on the row. On create `existing` is empty (every unknown name
 * is rejected); on update, legacy names that are already stored pass through.
 */
export function disallowedEventTypes(
  requested: readonly string[],
  existing: readonly string[] = [],
): string[] {
  const kept = new Set(existing);
  return requested.filter((t) => !isRegisteredWebhookEvent(t) && !kept.has(t));
}
