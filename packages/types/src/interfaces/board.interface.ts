import { TenantEntity } from './index';

export type CategoryType = 'custom' | 'itil';
export type PriorityType = 'custom' | 'itil';

/**
 * A ticket-list view document: what a board (or the tenant) stores as its
 * default arrangement of the list. Structural rather than imported from
 * @alga-psa/tickets so the types package keeps no dependency on it; the tickets
 * package's TicketViewSettings is the authoritative, catalog-keyed shape and is
 * assignable to this.
 */
export interface TicketViewSettings {
  columnVisibility?: Record<string, boolean>;
  columnOrder?: string[];
  tagsInlineUnderTitle?: boolean;
  densityLevel?: number;
  filters?: Record<string, unknown>;
}

export interface IBoard extends TenantEntity {
  board_id?: string;
  board_name?: string;
  is_inactive: boolean;
  is_default?: boolean;
  description?: string;
  display_order?: number;
  default_priority_id?: string | null;

  // Category type configuration
  category_type?: CategoryType;

  // Priority type configuration
  priority_type?: PriorityType;

  // Board-level ticket-list view configuration.
  //
  // is_pinned: only pinned boards get a permanent tab on the tickets screen.
  // Unpinned boards stay fully reachable via All tickets + the board filter, and
  // a deep link to one renders a transient tab for that visit.
  //
  // list_view_settings: the board's default ticket-list view (column visibility
  // + order, density, captured filters incl. sort), resolved through
  // resolveTicketViewSettings over the tenant layer and the column catalog.
  // NULL means "inherit the tenant default" — reset writes NULL, not {}.
  is_pinned?: boolean;
  list_view_settings?: TicketViewSettings | null;

  // SUPERSEDED — the display_* block below is dead configuration.
  //
  // No UI reads any of these eleven columns; they survive only in this
  // interface. They are the column-per-setting pattern that produced a wide
  // table with an abandoned half, and list_view_settings above is their live
  // successor. Do not add to them and do not mistake them for live config.
  // Removing them is its own change with its own risk, so they stay for now.
  //
  // Display configuration for form fields
  display_contact_name_id?: boolean;
  display_priority?: boolean;
  display_severity?: boolean;
  display_urgency?: boolean;
  display_impact?: boolean;
  display_category?: boolean;
  display_subcategory?: boolean;
  display_assigned_to?: boolean;
  display_status?: boolean;
  display_due_date?: boolean;

  // ITIL-specific display configuration
  display_itil_impact?: boolean;
  display_itil_urgency?: boolean;

  // Default assignment configuration
  default_assigned_to?: string | null;
  default_assigned_team_id?: string | null;

  // Board manager for SLA notifications
  manager_user_id?: string | null;

  // SLA policy assignment (board-level SLA)
  sla_policy_id?: string | null;

  // Inbound reply reopen policy
  inbound_reply_reopen_enabled?: boolean;
  inbound_reply_reopen_cutoff_hours?: number;
  inbound_reply_reopen_status_id?: string | null;
  inbound_reply_ai_ack_suppression_enabled?: boolean;

  // Controls live timer + tracked intervals visibility in ticket details
  enable_live_ticket_timer?: boolean;
}
