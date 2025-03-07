/**
 * Form Registry
 * 
 * This service provides centralized management for form definitions across the workflow system.
 */
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import FormDefinitionModel from '../persistence/formDefinitionModel';
import FormSchemaModel from '../persistence/formSchemaModel';
import { getFormValidationService } from './formValidationService';
import {
  IFormDefinition,
  IFormSchema,
  FormStatus,
  FormRegistrationParams,
  FormUpdateParams,
  FormSearchParams,
  FormValidationResult,
  FormWithSchema
} from '../persistence/formRegistryInterfaces';

export class FormRegistry {
  /**
   * Register a new form definition
   */
  async register(
    knex: Knex,
    tenant: string,
    params: FormRegistrationParams,
    userId?: string
  ): Promise<string> {
    // Start a transaction
    return knex.transaction(async (trx) => {
      try {
        // Check if form already exists with this ID and version
        const existingForm = await FormDefinitionModel.getByIdAndVersion(
          trx,
          tenant,
          params.formId,
          params.version
        );
        
        if (existingForm) {
          throw new Error(`Form with ID ${params.formId} and version ${params.version} already exists`);
        }
        
        // Create form definition
        const formDefinition: Omit<IFormDefinition, 'tenant' | 'created_at' | 'updated_at'> = {
          form_id: params.formId,
          name: params.name,
          description: params.description,
          version: params.version,
          status: params.status || FormStatus.DRAFT,
          category: params.category,
          created_by: userId
        };
        
        await FormDefinitionModel.create(trx, tenant, formDefinition);
        
        // Create form schema
        const formSchema: Omit<IFormSchema, 'tenant' | 'schema_id' | 'created_at' | 'updated_at'> = {
          form_id: params.formId,
          json_schema: params.jsonSchema,
          ui_schema: params.uiSchema,
          default_values: params.defaultValues
        };
        
        await FormSchemaModel.create(trx, tenant, formSchema);
        
        return params.formId;
      } catch (error) {
        console.error('Error registering form:', error);
        throw error;
      }
    });
  }

  /**
   * Get a form definition by ID and version
   */
  async getForm(
    knex: Knex,
    tenant: string,
    formId: string,
    version?: string
  ): Promise<FormWithSchema | null> {
    try {
      let formDefinition: IFormDefinition | null;
      
      if (version) {
        // Get specific version
        formDefinition = await FormDefinitionModel.getByIdAndVersion(knex, tenant, formId, version);
      } else {
        // Get latest version
        formDefinition = await FormDefinitionModel.getLatestVersion(knex, tenant, formId);
      }
      
      if (!formDefinition) {
        return null;
      }
      
      // Get form schema
      const formSchema = await FormSchemaModel.getByFormId(knex, tenant, formId);
      
      if (!formSchema) {
        throw new Error(`Schema not found for form ${formId}`);
      }
      
      return {
        definition: formDefinition,
        schema: formSchema
      };
    } catch (error) {
      console.error(`Error getting form ${formId}:`, error);
      throw error;
    }
  }

  /**
   * Update a form definition
   */
  async updateForm(
    knex: Knex,
    tenant: string,
    formId: string,
    version: string,
    updates: FormUpdateParams
  ): Promise<boolean> {
    return knex.transaction(async (trx) => {
      try {
        // Check if form exists
        const existingForm = await FormDefinitionModel.getByIdAndVersion(trx, tenant, formId, version);
        
        if (!existingForm) {
          throw new Error(`Form with ID ${formId} and version ${version} not found`);
        }
        
        // Update form definition
        const definitionUpdates: Partial<Omit<IFormDefinition, 'form_id' | 'tenant' | 'version' | 'created_at' | 'updated_at'>> = {};
        
        if (updates.name !== undefined) definitionUpdates.name = updates.name;
        if (updates.description !== undefined) definitionUpdates.description = updates.description;
        if (updates.category !== undefined) definitionUpdates.category = updates.category;
        if (updates.status !== undefined) definitionUpdates.status = updates.status;
        
        if (Object.keys(definitionUpdates).length > 0) {
          await FormDefinitionModel.update(trx, tenant, formId, version, definitionUpdates);
        }
        
        // Update form schema if needed
        const schemaUpdates: Partial<Omit<IFormSchema, 'schema_id' | 'tenant' | 'form_id' | 'created_at' | 'updated_at'>> = {};
        
        if (updates.jsonSchema !== undefined) schemaUpdates.json_schema = updates.jsonSchema;
        if (updates.uiSchema !== undefined) schemaUpdates.ui_schema = updates.uiSchema;
        if (updates.defaultValues !== undefined) schemaUpdates.default_values = updates.defaultValues;
        
        if (Object.keys(schemaUpdates).length > 0) {
          await FormSchemaModel.update(trx, tenant, formId, schemaUpdates);
        }
        
        return true;
      } catch (error) {
        console.error(`Error updating form ${formId}:`, error);
        throw error;
      }
    });
  }

  /**
   * Create a new version of a form
   */
  async createNewVersion(
    knex: Knex,
    tenant: string,
    formId: string,
    newVersion: string,
    updates: FormUpdateParams = {}
  ): Promise<string> {
    return knex.transaction(async (trx) => {
      try {
        // Get the latest version of the form
        const latestForm = await this.getForm(trx, tenant, formId);
        
        if (!latestForm) {
          throw new Error(`Form with ID ${formId} not found`);
        }
        
        // Check if the new version already exists
        const existingVersion = await FormDefinitionModel.getByIdAndVersion(
          trx,
          tenant,
          formId,
          newVersion
        );
        
        if (existingVersion) {
          throw new Error(`Version ${newVersion} already exists for form ${formId}`);
        }
        
        // Create new form definition
        const formDefinition: Omit<IFormDefinition, 'tenant' | 'created_at' | 'updated_at'> = {
          form_id: formId,
          name: updates.name || latestForm.definition.name,
          description: updates.description || latestForm.definition.description,
          version: newVersion,
          status: updates.status || FormStatus.DRAFT, // New versions start as draft
          category: updates.category || latestForm.definition.category,
          created_by: latestForm.definition.created_by
        };
        
        await FormDefinitionModel.create(trx, tenant, formDefinition);
        
        // Create new form schema
        const formSchema: Omit<IFormSchema, 'tenant' | 'schema_id' | 'created_at' | 'updated_at'> = {
          form_id: formId,
          json_schema: updates.jsonSchema || latestForm.schema.json_schema,
          ui_schema: updates.uiSchema || latestForm.schema.ui_schema,
          default_values: updates.defaultValues || latestForm.schema.default_values
        };
        
        await FormSchemaModel.create(trx, tenant, formSchema);
        
        return formId;
      } catch (error) {
        console.error(`Error creating new version for form ${formId}:`, error);
        throw error;
      }
    });
  }

  /**
   * Update form status
   */
  async updateStatus(
    knex: Knex,
    tenant: string,
    formId: string,
    version: string,
    status: FormStatus
  ): Promise<boolean> {
    try {
      // Check if form exists
      const existingForm = await FormDefinitionModel.getByIdAndVersion(knex, tenant, formId, version);
      
      if (!existingForm) {
        throw new Error(`Form with ID ${formId} and version ${version} not found`);
      }
      
      // Update status
      return FormDefinitionModel.updateStatus(knex, tenant, formId, version, status);
    } catch (error) {
      console.error(`Error updating status for form ${formId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a form definition and its schema
   */
  async deleteForm(
    knex: Knex,
    tenant: string,
    formId: string,
    version: string
  ): Promise<boolean> {
    return knex.transaction(async (trx) => {
      try {
        // Check if form exists
        const existingForm = await FormDefinitionModel.getByIdAndVersion(trx, tenant, formId, version);
        
        if (!existingForm) {
          throw new Error(`Form with ID ${formId} and version ${version} not found`);
        }
        
        // Delete form schema
        await FormSchemaModel.delete(trx, tenant, formId);
        
        // Delete form definition
        await FormDefinitionModel.delete(trx, tenant, formId, version);
        
        return true;
      } catch (error) {
        console.error(`Error deleting form ${formId}:`, error);
        throw error;
      }
    });
  }

  /**
   * Search for forms
   */
  async searchForms(
    knex: Knex,
    tenant: string,
    searchParams: FormSearchParams,
    pagination: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ total: number; forms: IFormDefinition[] }> {
    try {
      return FormDefinitionModel.search(
        knex,
        tenant,
        {
          name: searchParams.name,
          category: searchParams.category,
          status: searchParams.status,
          formId: searchParams.formId
        },
        pagination
      );
    } catch (error) {
      console.error('Error searching forms:', error);
      throw error;
    }
  }

  /**
   * Get all versions of a form
   */
  async getAllVersions(
    knex: Knex,
    tenant: string,
    formId: string
  ): Promise<IFormDefinition[]> {
    try {
      return FormDefinitionModel.getAllVersions(knex, tenant, formId);
    } catch (error) {
      console.error(`Error getting versions for form ${formId}:`, error);
      throw error;
    }
  }

  /**
   * Get all forms by category
   */
  async getFormsByCategory(
    knex: Knex,
    tenant: string,
    category: string
  ): Promise<IFormDefinition[]> {
    try {
      return FormDefinitionModel.getByCategory(knex, tenant, category);
    } catch (error) {
      console.error(`Error getting forms for category ${category}:`, error);
      throw error;
    }
  }

  /**
   * Get all form categories
   */
  async getAllCategories(
    knex: Knex,
    tenant: string
  ): Promise<string[]> {
    try {
      return FormDefinitionModel.getAllCategories(knex, tenant);
    } catch (error) {
      console.error('Error getting form categories:', error);
      throw error;
    }
  }

  /**
   * Validate form data against a form schema
   */
  async validateFormData(
    knex: Knex,
    tenant: string,
    formId: string,
    data: Record<string, any>,
    version?: string
  ): Promise<FormValidationResult> {
    try {
      // Get form with schema
      const form = await this.getForm(knex, tenant, formId, version);
      
      if (!form) {
        throw new Error(`Form with ID ${formId}${version ? ` and version ${version}` : ''} not found`);
      }
      
      // Validate data against schema
      const validationService = getFormValidationService();
      return validationService.validate(form.schema.json_schema, data);
    } catch (error) {
      console.error(`Error validating form data for ${formId}:`, error);
      throw error;
    }
  }

  /**
   * Generate a unique form ID
   */
  generateFormId(): string {
    return `form-${uuidv4()}`;
  }

  /**
   * Compose a form from multiple form definitions
   * This allows for form inheritance and composition
   */
  async composeForm(
    knex: Knex,
    tenant: string,
    baseFormId: string,
    extensionFormIds: string[],
    overrides: {
      name?: string;
      description?: string;
      category?: string;
      jsonSchema?: Record<string, any>;
      uiSchema?: Record<string, any>;
      defaultValues?: Record<string, any>;
    } = {}
  ): Promise<FormWithSchema> {
    try {
      // Get base form
      const baseForm = await this.getForm(knex, tenant, baseFormId);
      
      if (!baseForm) {
        throw new Error(`Base form with ID ${baseFormId} not found`);
      }
      
      // Start with base form properties
      const composedDefinition: IFormDefinition = {
        ...baseForm.definition,
        form_id: this.generateFormId(),
        name: overrides.name || baseForm.definition.name,
        description: overrides.description || baseForm.definition.description,
        category: overrides.category || baseForm.definition.category,
        status: FormStatus.DRAFT,
        version: '1.0.0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      // Start with base form schema
      let composedJsonSchema = { ...baseForm.schema.json_schema };
      let composedUiSchema = baseForm.schema.ui_schema ? { ...baseForm.schema.ui_schema } : {};
      let composedDefaultValues = baseForm.schema.default_values ? { ...baseForm.schema.default_values } : {};
      
      // Apply extensions in order
      for (const extensionId of extensionFormIds) {
        const extensionForm = await this.getForm(knex, tenant, extensionId);
        
        if (!extensionForm) {
          throw new Error(`Extension form with ID ${extensionId} not found`);
        }
        
        // Merge JSON schema properties
        if (extensionForm.schema.json_schema.properties) {
          composedJsonSchema.properties = {
            ...composedJsonSchema.properties,
            ...extensionForm.schema.json_schema.properties
          };
        }
        
        // Merge required fields
        if (extensionForm.schema.json_schema.required) {
          composedJsonSchema.required = [
            ...(composedJsonSchema.required || []),
            ...extensionForm.schema.json_schema.required
          ];
        }
        
        // Merge UI schema
        if (extensionForm.schema.ui_schema) {
          composedUiSchema = {
            ...composedUiSchema,
            ...extensionForm.schema.ui_schema
          };
        }
        
        // Merge default values
        if (extensionForm.schema.default_values) {
          composedDefaultValues = {
            ...composedDefaultValues,
            ...extensionForm.schema.default_values
          };
        }
      }
      
      // Apply overrides
      if (overrides.jsonSchema) {
        composedJsonSchema = {
          ...composedJsonSchema,
          ...overrides.jsonSchema
        };
      }
      
      if (overrides.uiSchema) {
        composedUiSchema = {
          ...composedUiSchema,
          ...overrides.uiSchema
        };
      }
      
      if (overrides.defaultValues) {
        composedDefaultValues = {
          ...composedDefaultValues,
          ...overrides.defaultValues
        };
      }
      
      // Create composed schema
      const composedSchema: IFormSchema = {
        schema_id: `schema-${uuidv4()}`,
        form_id: composedDefinition.form_id,
        tenant,
        json_schema: composedJsonSchema,
        ui_schema: composedUiSchema,
        default_values: composedDefaultValues,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      return {
        definition: composedDefinition,
        schema: composedSchema
      };
    } catch (error) {
      console.error('Error composing form:', error);
      throw error;
    }
  }
}

// Singleton instance
let registryInstance: FormRegistry | null = null;

/**
 * Get the form registry instance
 */
export function getFormRegistry(): FormRegistry {
  if (!registryInstance) {
    registryInstance = new FormRegistry();
  }
  return registryInstance;
}