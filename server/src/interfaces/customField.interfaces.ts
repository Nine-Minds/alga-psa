/**
 * Custom Field / UDF (User Defined Field) interfaces
 *
 * These interfaces support custom fields for tickets, companies, and contacts.
 */

/**
 * Entity types that can have custom fields
 */
export type CustomFieldEntityType = 'ticket' | 'company' | 'contact';

/**
 * Supported field types for custom fields
 */
export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'picklist';

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
}

/**
 * Custom field value (stored in entity's properties/attributes JSONB column)
 */
export interface ICustomFieldValue {
  field_id: string;
  value: string | number | boolean | null;
}

/**
 * Map of field_id to value for storing/retrieving custom field values
 */
export type CustomFieldValuesMap = Record<string, string | number | boolean | null>;
