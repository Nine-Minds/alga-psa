/**
 * Ticket Template interfaces
 *
 * Templates define pre-configured ticket structures for common scenarios
 * like ITIL workflows (New Hire, Change Request, etc.)
 */

/**
 * Template type
 * - 'itil': Pre-built ITIL templates (New Hire, Change Request, etc.)
 * - 'custom': User-created templates
 */
export type TicketTemplateType = 'itil' | 'custom';

/**
 * Default values for standard ticket fields
 */
export interface TicketDefaultValues {
  title?: string;
  description?: string;
  priority_id?: string;
  status_id?: string;
  assigned_to?: string;
  category_id?: string;
  subcategory_id?: string;
  /** ITIL impact level (1-5) */
  itil_impact?: number;
  /** ITIL urgency level (1-5) */
  itil_urgency?: number;
}

/**
 * Field layout configuration for templates
 */
export interface TemplateFieldLayout {
  /** Group IDs to show (order matters, others hidden) */
  visible_groups?: string[];
  /** Field IDs to hide */
  hidden_fields?: string[];
}

/**
 * ITIL-specific configuration for templates
 */
export interface ITILTemplateConfig {
  /** Default impact level (1-5) */
  default_impact?: number;
  /** Default urgency level (1-5) */
  default_urgency?: number;
  /** Checklist items to include with the ticket */
  checklist_items?: string[];
  /** Suggested resolution steps */
  suggested_resolution_steps?: string[];
  /** ITIL category (Incident, Problem, Change, Service Request) */
  itil_category?: string;
}

/**
 * Full ticket template definition
 */
export interface ITicketTemplate {
  template_id: string;
  tenant: string;
  name: string;
  description?: string;
  template_type: TicketTemplateType;
  /** Associated board ID (optional) */
  board_id?: string;
  /** Associated category ID (optional) */
  category_id?: string;
  /** Default values for standard ticket fields */
  default_values: TicketDefaultValues;
  /** Default values for custom fields (field_id -> value) */
  custom_field_defaults: Record<string, any>;
  /** Field names/IDs that are required for this template */
  required_fields: string[];
  /** Field layout configuration */
  field_layout: TemplateFieldLayout;
  /** ITIL-specific configuration (for ITIL templates) */
  itil_config?: ITILTemplateConfig | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a ticket template
 */
export interface CreateTicketTemplateInput {
  name: string;
  description?: string;
  template_type?: TicketTemplateType;
  board_id?: string | null;
  category_id?: string | null;
  default_values?: TicketDefaultValues;
  custom_field_defaults?: Record<string, any>;
  required_fields?: string[];
  field_layout?: TemplateFieldLayout;
  itil_config?: ITILTemplateConfig | null;
  display_order?: number;
}

/**
 * Input for updating a ticket template
 */
export interface UpdateTicketTemplateInput {
  name?: string;
  description?: string;
  template_type?: TicketTemplateType;
  board_id?: string | null;
  category_id?: string | null;
  default_values?: TicketDefaultValues;
  custom_field_defaults?: Record<string, any>;
  required_fields?: string[];
  field_layout?: TemplateFieldLayout;
  itil_config?: ITILTemplateConfig | null;
  is_active?: boolean;
  display_order?: number;
}

/**
 * Filters for querying templates
 */
export interface TicketTemplateFilters {
  board_id?: string;
  category_id?: string;
  template_type?: TicketTemplateType;
  is_active?: boolean;
}

/**
 * Data returned when applying a template to a ticket form
 */
export interface AppliedTemplateData {
  /** Default values to pre-fill in the form */
  default_values: TicketDefaultValues;
  /** Custom field values to pre-fill */
  custom_field_defaults: Record<string, any>;
  /** Fields that should be marked as required */
  required_fields: string[];
  /** Field layout configuration */
  field_layout: TemplateFieldLayout;
  /** ITIL configuration if applicable */
  itil_config?: ITILTemplateConfig | null;
}

/**
 * Pre-defined ITIL template definitions for seeding
 */
export interface ITILTemplateDefinition {
  name: string;
  description: string;
  itil_category: string;
  default_values: TicketDefaultValues;
  checklist_items?: string[];
  suggested_resolution_steps?: string[];
  custom_fields?: {
    name: string;
    type: 'text' | 'date' | 'picklist' | 'boolean';
    required: boolean;
    options?: string[];
  }[];
}
