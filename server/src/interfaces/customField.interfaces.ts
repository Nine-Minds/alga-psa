/**
 * Custom Field / UDF (User Defined Field) interfaces
 *
 * These interfaces support custom fields for tickets, companies, and contacts.
 *
 * Storage pattern:
 * - Field definitions are stored in the `custom_fields` table
 * - Field values are stored in each entity's JSONB column under the 'custom_fields' key:
 *   - tickets.attributes.custom_fields
 *   - companies.properties.custom_fields
 *   - contacts.properties.custom_fields (mirrors companies.properties pattern)
 *
 * Note: contacts.properties was added to mirror companies.properties for consistency.
 * Both may benefit from a GIN index for JSONB queries once usage patterns are established.
 */

/**
 * Entity types that can have custom fields
 */
export type CustomFieldEntityType = 'ticket' | 'company' | 'contact';

/**
 * Supported field types for custom fields
 */
export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'picklist' | 'multi_picklist';

/**
 * Operators for conditional logic rules
 */
export type ConditionalLogicOperator = 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty';

/**
 * Conditional logic rule for showing/hiding a field based on another field's value
 */
export interface IConditionalLogic {
  field_id: string;
  operator: ConditionalLogicOperator;
  value?: string | number | boolean | string[] | null;
}

/**
 * Option for picklist field types
 */
export interface IPicklistOption {
  value: string;
  label: string;
  order: number;
}

/**
 * Custom field definition
 */
export interface ICustomField {
  field_id: string;
  tenant: string;
  entity_type: CustomFieldEntityType;
  name: string;
  type: CustomFieldType;
  default_value?: string | number | boolean | null;
  options?: IPicklistOption[];
  field_order: number;
  is_required: boolean;
  is_active: boolean;
  description?: string;
  conditional_logic?: IConditionalLogic | null;
  group_id?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a custom field
 */
export interface CreateCustomFieldInput {
  entity_type: CustomFieldEntityType;
  name: string;
  type: CustomFieldType;
  default_value?: string | number | boolean | null;
  options?: IPicklistOption[];
  field_order?: number;
  is_required?: boolean;
  description?: string;
  conditional_logic?: IConditionalLogic | null;
  group_id?: string | null;
}

/**
 * Input for updating a custom field
 */
export interface UpdateCustomFieldInput {
  name?: string;
  type?: CustomFieldType;
  default_value?: string | number | boolean | null;
  options?: IPicklistOption[];
  field_order?: number;
  is_required?: boolean;
  is_active?: boolean;
  description?: string;
  conditional_logic?: IConditionalLogic | null;
  group_id?: string | null;
}

/**
 * Custom field value (stored in entity's properties/attributes JSONB column)
 * Supports arrays for multi_picklist type
 */
export interface ICustomFieldValue {
  field_id: string;
  value: string | number | boolean | string[] | null;
}

/**
 * Map of field_id to value for storing/retrieving custom field values
 * Supports arrays for multi_picklist type
 */
export type CustomFieldValuesMap = Record<string, string | number | boolean | string[] | null>;

// =============================================================================
// Field Groups (for organizing custom fields into sections)
// =============================================================================

/**
 * Display style for field groups
 * - 'collapsible': Traditional collapsible section (default, backward compatible)
 * - 'tab': Horizontal tab in a tabbed interface (Halo-style)
 * - 'section': Always-visible section with header
 */
export type FieldGroupDisplayStyle = 'collapsible' | 'tab' | 'section';

/**
 * Custom field group definition
 */
export interface ICustomFieldGroup {
  group_id: string;
  tenant: string;
  entity_type: CustomFieldEntityType;
  name: string;
  description?: string | null;
  group_order: number;
  is_collapsed_by_default: boolean;
  /** Display style for UI rendering: 'collapsible' | 'tab' | 'section' */
  display_style: FieldGroupDisplayStyle;
  /** Optional icon identifier (Lucide icon name) for visual representation */
  icon?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a custom field group
 */
export interface CreateCustomFieldGroupInput {
  entity_type: CustomFieldEntityType;
  name: string;
  description?: string | null;
  group_order?: number;
  is_collapsed_by_default?: boolean;
  display_style?: FieldGroupDisplayStyle;
  icon?: string | null;
}

/**
 * Input for updating a custom field group
 */
export interface UpdateCustomFieldGroupInput {
  name?: string;
  description?: string | null;
  group_order?: number;
  is_collapsed_by_default?: boolean;
  display_style?: FieldGroupDisplayStyle;
  icon?: string | null;
}

/**
 * Input for bulk reordering fields
 */
export interface BulkFieldOrderInput {
  fieldId: string;
  order: number;
  groupId?: string | null;
}

// =============================================================================
// Per-Client Field Settings (for enabling/disabling fields per company)
// =============================================================================

/**
 * Company-specific custom field settings
 */
export interface ICompanyCustomFieldSetting {
  setting_id: string;
  tenant: string;
  company_id: string;
  field_id: string;
  is_enabled: boolean;
  override_default_value?: string | number | boolean | string[] | null;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating/updating company custom field settings
 */
export interface UpsertCompanyCustomFieldSettingInput {
  company_id: string;
  field_id: string;
  is_enabled: boolean;
  override_default_value?: string | number | boolean | string[] | null;
}
