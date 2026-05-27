/**
 * Types and constants for the ticket activity / audit log feature.
 *
 * See ee/docs/plans/2026-05-25-ticket-audit-logs/PRD.md.
 *
 * Goals:
 * - Capture user-facing operational events on a ticket (not a compliance ledger).
 * - Stay aligned with the existing TICKET_* domain event names where practical
 *   so downstream consumers and operators see consistent vocabulary.
 */

/**
 * Event types written to `ticket_audit_logs.event_type`.
 *
 * Names mirror the existing domain event names in
 * `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts` where one
 * exists. A handful of names (DOCUMENT_*, INBOUND_*) cover activity-only
 * concerns that don't have a 1:1 event-bus event.
 */
export const TICKET_ACTIVITY_EVENT = {
  CREATED: 'TICKET_CREATED',
  UPDATED: 'TICKET_UPDATED',
  STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  CLOSED: 'TICKET_CLOSED',
  REOPENED: 'TICKET_REOPENED',
  PRIORITY_CHANGED: 'TICKET_PRIORITY_CHANGED',
  ASSIGNED: 'TICKET_ASSIGNED',
  UNASSIGNED: 'TICKET_UNASSIGNED',
  BOARD_MOVED: 'TICKET_BOARD_MOVED',
  RESPONSE_STATE_CHANGED: 'TICKET_RESPONSE_STATE_CHANGED',
  COMMENT_ADDED: 'TICKET_COMMENT_ADDED',
  COMMENT_UPDATED: 'TICKET_COMMENT_UPDATED',
  INTERNAL_NOTE_ADDED: 'TICKET_INTERNAL_NOTE_ADDED',
  CUSTOMER_REPLIED: 'TICKET_CUSTOMER_REPLIED',
  MESSAGE_ADDED: 'TICKET_MESSAGE_ADDED',
  DOCUMENT_ATTACHED: 'TICKET_DOCUMENT_ATTACHED',
  DOCUMENT_REMOVED: 'TICKET_DOCUMENT_REMOVED',
  INBOUND_EMAIL_RECEIVED: 'TICKET_INBOUND_EMAIL_RECEIVED',
  BUNDLE_REOPENED: 'TICKET_BUNDLE_REOPENED',
} as const;

export type TicketActivityEvent =
  (typeof TICKET_ACTIVITY_EVENT)[keyof typeof TICKET_ACTIVITY_EVENT];

/**
 * Entity associated with the activity row. Indicates what the entry is "about".
 */
export const TICKET_ACTIVITY_ENTITY = {
  TICKET: 'ticket',
  COMMENT: 'comment',
  DOCUMENT: 'document',
  EMAIL: 'email',
  SYSTEM: 'system',
} as const;

export type TicketActivityEntity =
  (typeof TICKET_ACTIVITY_ENTITY)[keyof typeof TICKET_ACTIVITY_ENTITY];

/**
 * Classification of the actor responsible for the event.
 */
export const TICKET_ACTIVITY_ACTOR = {
  USER: 'user',
  CONTACT: 'contact',
  SYSTEM: 'system',
  API: 'api',
  EMAIL_SENDER: 'email_sender',
  WORKFLOW: 'workflow',
} as const;

export type TicketActivityActor =
  (typeof TICKET_ACTIVITY_ACTOR)[keyof typeof TICKET_ACTIVITY_ACTOR];

/**
 * Origin of the mutation that produced the activity row.
 */
export const TICKET_ACTIVITY_SOURCE = {
  UI: 'ui',
  API: 'api',
  CLIENT_PORTAL: 'client_portal',
  INBOUND_EMAIL: 'inbound_email',
  WORKFLOW: 'workflow',
  SYSTEM: 'system',
} as const;

export type TicketActivitySource =
  (typeof TICKET_ACTIVITY_SOURCE)[keyof typeof TICKET_ACTIVITY_SOURCE];

/**
 * Fields the v1 timeline considers user-meaningful. Updates that touch only
 * fields outside this list are not surfaced as activity rows.
 */
export const CURATED_TICKET_FIELDS = [
  'title',
  'status_id',
  'priority_id',
  'assigned_to',
  'assigned_team_id',
  'board_id',
  'category_id',
  'subcategory_id',
  'client_id',
  'contact_name_id',
  'due_date',
  'response_state',
  'closed_at',
  'closed_by',
  'url',
] as const;

export type CuratedTicketField = (typeof CURATED_TICKET_FIELDS)[number];

/**
 * Structured per-field diff written to the `changes` JSONB column.
 *
 * `label` carries an optional resolved human-readable name (e.g., status name
 * for a status_id). The raw old/new IDs are always preserved so the UI can
 * render or re-resolve as needed.
 */
export interface TicketActivityFieldChange {
  old: unknown;
  new: unknown;
  oldLabel?: string | null;
  newLabel?: string | null;
}

export type TicketActivityChanges = Partial<
  Record<CuratedTicketField | string, TicketActivityFieldChange>
>;

export interface TicketActivityActorInfo {
  actorType: TicketActivityActor;
  userId?: string | null;
  contactId?: string | null;
  displayName?: string | null;
}

export interface WriteTicketActivityInput {
  tenant: string;
  ticketId: string;
  eventType: TicketActivityEvent | string;
  entityType: TicketActivityEntity | string;
  entityId?: string | null;
  actor: TicketActivityActorInfo;
  source: TicketActivitySource | string;
  occurredAt?: string | Date;
  changes?: TicketActivityChanges;
  details?: Record<string, unknown>;
}

export interface TicketActivityRow {
  tenant: string;
  audit_id: string;
  ticket_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  actor_contact_id: string | null;
  actor_display_name: string | null;
  source: string;
  occurred_at: string;
  changes: TicketActivityChanges;
  details: Record<string, unknown>;
  created_at: string;
}
