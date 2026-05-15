import { z } from 'zod';

/**
 * Canonical list of selectable fields for ticket-event webhook payloads.
 * Users pick a subset; whatever they leave out gets stripped before delivery.
 *
 * `ticket_id` is intentionally not in this list. It is an always-required
 * correlation key that consumers can never turn off.
 *
 * `comment` and `changes` are group toggles: selecting them includes the
 * entire sub-object when present for the event.
 *
 * `comments` includes the full thread for the ticket, fetched fresh per event.
 */
export const WEBHOOK_TICKET_PAYLOAD_FIELDS = [
  'ticket_number',
  'title',
  'url',
  'status_id',
  'status_name',
  'is_closed',
  'previous_status_id',
  'previous_status_name',
  'priority_id',
  'priority_name',
  'client_id',
  'client_name',
  'contact_name_id',
  'contact_name',
  'contact_email',
  'assigned_to',
  'assigned_to_name',
  'assigned_team_id',
  'board_id',
  'board_name',
  'category_id',
  'subcategory_id',
  'entered_at',
  'updated_at',
  'closed_at',
  'due_date',
  'tags',
  'comment',
  'changes',
  'comments',
] as const;

export type WebhookTicketPayloadField = (typeof WEBHOOK_TICKET_PAYLOAD_FIELDS)[number];

/**
 * Combined project/project-task selectable fields. Both project-level and
 * task-level events use the `project` entity allowlist.
 *
 * `project_id` is always retained through ALWAYS_INCLUDED_KEYS_BY_ENTITY.
 * `task_id` is selectable and task subscribers also retain it via
 * applyPayloadAllowlist(..., extraAlwaysIncluded:['task_id']).
 */
export const WEBHOOK_PROJECT_PAYLOAD_FIELDS = [
  'project_name',
  'wbs_code',
  'description',
  'status_id',
  'status_name',
  'is_closed',
  'previous_status_id',
  'previous_status_name',
  'client_id',
  'client_name',
  'contact_name_id',
  'contact_name',
  'contact_email',
  'assigned_to',
  'assigned_to_name',
  'start_date',
  'end_date',
  'budgeted_hours',
  'url',
  'changes',
  'phases',
  'task_counts',
  'task_id',
  'phase_id',
  'phase_name',
  'task_name',
  'estimated_hours',
  'actual_hours',
  'due_date',
  'priority_id',
  'priority_name',
  'tags',
] as const;

export type WebhookProjectPayloadField = (typeof WEBHOOK_PROJECT_PAYLOAD_FIELDS)[number];

/**
 * Per-entity selectable payload field registry. New entities are added here so
 * validation, OpenAPI docs, UI controls, and runtime projection stay aligned.
 */
export const WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY = {
  ticket: WEBHOOK_TICKET_PAYLOAD_FIELDS,
  project: WEBHOOK_PROJECT_PAYLOAD_FIELDS,
} as const satisfies Record<string, readonly string[]>;

export type WebhookPayloadEntity = keyof typeof WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY;
export type SupportedPayloadField =
  (typeof WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY)[WebhookPayloadEntity][number];

/**
 * Per-entity always-required correlation keys. These never get stripped
 * regardless of the user's allowlist.
 */
export const ALWAYS_INCLUDED_KEYS_BY_ENTITY = {
  ticket: ['ticket_id'],
  project: ['project_id'],
} as const satisfies Record<WebhookPayloadEntity, readonly string[]>;

/**
 * Per-webhook payload field configuration:
 *   null              - full payload for every entity (default).
 *   {}                - same as null (no per-entity overrides).
 *   { ticket: null }  - full payload for that entity (explicit).
 *   { ticket: [] }    - required-only (ticket_id + envelope) for that entity.
 *   { ticket: [a,b] } - only those fields (plus required) for that entity.
 *
 * Entities not present in the map fall back to "full payload".
 */
export const payloadFieldsByEntitySchema = z
  .record(z.string(), z.array(z.string()).nullable())
  .nullable()
  .superRefine((value, ctx) => {
    if (!value) return;
    for (const [entity, fields] of Object.entries(value)) {
      const allowed =
        (WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY as Record<string, readonly string[]>)[entity];
      if (!allowed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [entity],
          message: `Unknown webhook entity "${entity}"`,
        });
        continue;
      }
      if (fields === null) continue;
      const allowedSet = new Set(allowed);
      for (const field of fields) {
        if (!allowedSet.has(field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entity],
            message: `Unknown field "${field}" for entity "${entity}"`,
          });
        }
      }
    }
  });

/**
 * Derive the entity portion of a public event type ("ticket.created" -> "ticket").
 */
export function webhookEntityForEventType(publicEventType: string): string {
  const dot = publicEventType.indexOf('.');
  return dot > 0 ? publicEventType.slice(0, dot) : publicEventType;
}

/**
 * Project a fully-built webhook payload down to a per-subscriber field
 * allowlist for the given entity. Returns the original payload unchanged
 * when `allowedFields` is null (the default: no filtering, full payload).
 */
export function applyPayloadAllowlist<T extends Record<string, unknown>>(
  entity: string,
  payload: T,
  allowedFields: string[] | null,
  extraAlwaysIncluded: string[] = [],
): T {
  if (allowedFields === null) {
    return payload;
  }

  const allowed = new Set<string>(allowedFields);
  for (const key of ALWAYS_INCLUDED_KEYS_BY_ENTITY[entity as WebhookPayloadEntity] ?? []) {
    allowed.add(key);
  }
  for (const key of extraAlwaysIncluded) {
    allowed.add(key);
  }

  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (allowed.has(key)) {
      projected[key] = payload[key];
    }
  }

  return projected as T;
}
