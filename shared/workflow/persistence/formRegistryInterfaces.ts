/**
 * Interfaces for the Form Registry
 */

/**
 * Form definition interface
 */
export interface IFormDefinition {
  form_id: string;
  tenant: string;
  name: string;
  description?: string;
  version: string;
  status: FormStatus;
  category?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Form schema interface
 */
export interface IFormSchema {
  schema_id: string;
  form_id: string;
  tenant: string;
  json_schema: Record<string, any>;
  ui_schema?: Record<string, any>;
  default_values?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

/**
 * Form status enum
 */
export enum FormStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  ARCHIVED = 'archived'
}

/**
 * Form registration parameters
 */
export interface FormRegistrationParams {
  formId: string;
  name: string;
  description?: string;
  version: string;
  category?: string;
  status?: FormStatus;
  jsonSchema: Record<string, any>;
  uiSchema?: Record<string, any>;
  defaultValues?: Record<string, any>;
}

/**
 * Form update parameters
 */
export interface FormUpdateParams {
  name?: string;
  description?: string;
  version?: string;
  category?: string;
  status?: FormStatus;
  jsonSchema?: Record<string, any>;
  uiSchema?: Record<string, any>;
  defaultValues?: Record<string, any>;
}

/**
 * Form search parameters
 */
export interface FormSearchParams {
  tenant?: string;
  formId?: string;
  name?: string;
  category?: string;
  status?: FormStatus;
  tags?: string[];
  version?: string;
}

/**
 * Form validation result
 */
export interface FormValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Form with schema
 */
export interface FormWithSchema {
  definition: IFormDefinition;
  schema: IFormSchema;
  tags?: any[]; // Allow any type of tags (string[] or ITag[])
}