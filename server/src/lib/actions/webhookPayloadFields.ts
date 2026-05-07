// Per-entity payload field registry. New entities (project, invoice, …)
// are added by extending this map; the schema validator and the UI both
// consume the same source of truth so additions are purely additive.
//
// `ticket_id` is intentionally not in the ticket list — it's an
// always-required correlation key the user can never strip.
//
// This module is intentionally NOT marked 'use server' so that the runtime
// object below can be exported. webhookActions.ts (a 'use server' file)
// imports the constant rather than re-exporting it.

export const WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY = {
  ticket: [
    'ticket_number', 'title', 'url',
    'status_id', 'status_name', 'is_closed', 'previous_status_id', 'previous_status_name',
    'priority_id', 'priority_name',
    'client_id', 'client_name',
    'contact_name_id', 'contact_name', 'contact_email',
    'assigned_to', 'assigned_to_name', 'assigned_team_id',
    'board_id', 'board_name',
    'category_id', 'subcategory_id',
    'entered_at', 'updated_at', 'closed_at', 'due_date',
    'tags',
    'comment',
    'changes',
    'comments',
  ],
} as const satisfies Record<string, readonly string[]>;

export type WebhookPayloadEntity = keyof typeof WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY;
export type SupportedPayloadField =
  (typeof WEBHOOK_PAYLOAD_FIELDS_BY_ENTITY)[WebhookPayloadEntity][number];
