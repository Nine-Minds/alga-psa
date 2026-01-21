import { TenantEntity } from './index';

export type CategoryType = 'custom' | 'itil';
export type PriorityType = 'custom' | 'itil';

export interface IBoard extends TenantEntity {
  board_id?: string;
  board_name?: string;
  is_inactive: boolean;
  is_default?: boolean;
  description?: string;
  display_order?: number;

  // Category type configuration
  category_type?: CategoryType;

  // Priority type configuration
  priority_type?: PriorityType;

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

  // Board manager for SLA notifications
  manager_user_id?: string | null;

  // SLA policy assignment (board-level SLA)
  sla_policy_id?: string | null;
}
