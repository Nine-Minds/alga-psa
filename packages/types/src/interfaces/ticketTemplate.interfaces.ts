/**
 * Ticket templates: a reusable starting point for a ticket (fields, description, tags, checklist,
 * custom fields). Not client-specific; status, assignment, client and contact are never templated.
 */

/** A checklist item as the template editor holds it (no completion state, no assignee). */
export interface TicketTemplateChecklistItemDraft {
  item_name: string;
  description: string | null;
  is_required: boolean;
  /** Checklist template the source ticket item came from; drives the replacement rule on create. */
  checklist_template_id: string | null;
}

export interface ITicketTemplateChecklistItem extends TicketTemplateChecklistItemDraft {
  template_item_id: string;
  order_number: number;
}

/** The editor's shape; also what the from-ticket loader returns. */
export interface TicketTemplateDraft {
  name: string;
  /** Admin's note about the template; never shown on tickets. */
  notes: string | null;
  title: string;
  /** Same format as `tickets.attributes.description` (serialized BlockNote JSON or plain text). */
  description: string | null;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  /** Tag text, resolved to ticket tag definitions when applied. */
  tags: string[];
  custom_fields: Record<string, unknown>;
  checklist: TicketTemplateChecklistItemDraft[];
}

export interface ITicketTemplate extends Omit<TicketTemplateDraft, 'checklist'> {
  tenant: string;
  template_id: string;
  is_active: boolean;
  /** Offered in the new-ticket picker. Templates created for a recurring schedule by migration are not (R5). */
  offer_for_manual_use: boolean;
  source_ticket_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  checklist: ITicketTemplateChecklistItem[];
}

/** A recurring schedule that uses a template (non-archived definitions only). */
export interface TicketTemplateScheduleRef {
  definition_id: string;
  name: string;
  is_active: boolean;
}

/** Counts shown next to a template: schedules that use it and tickets created from it. */
export interface TicketTemplateUsage {
  schedule_count: number;
  ticket_count: number;
}

export interface TicketTemplateReferenceProblem {
  /** Template saves only ever report the first four; the wider set is shared with recurring schedules. */
  field:
    | 'board_id' | 'category_id' | 'subcategory_id' | 'priority_id' | 'status_id' | 'assigned_to'
    | 'assigned_team_id' | 'additional_agent_ids' | 'contact_id' | 'location_id' | 'asset_ids';
  /** Actionable, user-facing English message. */
  message: string;
}

export interface TicketTemplateListItem {
  template_id: string;
  name: string;
  title: string;
  board_id: string | null;
  board_name: string | null;
  checklist_count: number;
  tag_count: number;
  is_active: boolean;
  offer_for_manual_use: boolean;
  schedule_count: number;
  ticket_count: number;
  updated_at: string;
}

/** Picker entry for Quick Add. */
export interface TicketTemplateOption {
  template_id: string;
  name: string;
  board_id: string | null;
}

/** Result of loading a template into the create-ticket form. */
export interface TicketTemplateForCreate {
  template_id: string;
  name: string;
  title: string;
  description: string;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  tags: {
    tag_id: string | null;
    tag_text: string;
    background_color: string | null;
    text_color: string | null;
    /** True when no ticket tag definition with this text exists yet. */
    is_new: boolean;
  }[];
  checklist: { item_name: string; is_required: boolean }[];
  custom_field_count: number;
  /** Dangling references that were dropped from the prefill (e.g. "Board no longer exists"). */
  warnings: string[];
}

export interface TicketTemplateDraftFromTicket {
  draft: TicketTemplateDraft;
  source_ticket_id: string;
  source_ticket_number: string;
  /** True when the description embeds images that point at the source ticket's documents (R2). */
  has_inline_images: boolean;
}
