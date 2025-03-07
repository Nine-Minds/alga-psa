'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { getFormRegistry } from '@shared/workflow/core/formRegistry';
import { getFormValidationService } from '@shared/workflow/core/formValidationService';
import {
  FormRegistrationParams,
  FormUpdateParams,
  FormSearchParams,
  FormStatus,
  FormWithSchema,
  IFormDefinition
} from '@shared/workflow/persistence/formRegistryInterfaces';
import { createTag, findTagsByEntityId, findAllTagsByType, deleteTag } from '../tagActions';
import { ITag } from 'server/src/interfaces/tag.interfaces';

/**
 * Register a new form
 */
export async function registerFormAction(
  params: FormRegistrationParams,
  tags?: string[]
): Promise<string> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const userId = undefined; // We don't have access to userId from createTenantKnex
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    // Register the form
    const formId = await formRegistry.register(knex, tenant, params, userId);
    
    // Add tags if provided
    if (tags && tags.length > 0) {
      await Promise.all(
        tags.map(tagText =>
          createTag({
            tag_text: tagText,
            tagged_id: formId,
            tagged_type: 'workflow_form'
          })
        )
      );
    }
    
    return formId;
  } catch (error) {
    console.error('Error registering form:', error);
    throw error;
  }
}

/**
 * Get a form by ID and version
 */
export async function getFormAction(
  formId: string,
  version?: string
): Promise<FormWithSchema | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    // Get the form
    const form = await formRegistry.getForm(knex, tenant, formId, version);
    
    if (!form) {
      return null;
    }
    
    // Get tags
    const tags = await findTagsByEntityId(formId, 'workflow_form');
    
    return {
      ...form,
      tags // This is fine since FormWithSchema expects ITag[] for tags
    };
  } catch (error) {
    console.error(`Error getting form ${formId}:`, error);
    throw error;
  }
}

/**
 * Update a form
 */
export async function updateFormAction(
  formId: string,
  version: string,
  updates: FormUpdateParams,
  tags?: string[]
): Promise<boolean> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    // Update the form
    const success = await formRegistry.updateForm(knex, tenant, formId, version, updates);
    
    // Update tags if provided
    if (tags) {
      // Get existing tags
      const existingTags = await findTagsByEntityId(formId, 'workflow_form');
      
      // Delete existing tags
      await Promise.all(
        existingTags.map(tag => deleteTag(tag.tag_id))
      );
      
      // Add new tags
      await Promise.all(
        tags.map(tagText =>
          createTag({
            tag_text: tagText,
            tagged_id: formId,
            tagged_type: 'workflow_form'
          })
        )
      );
    }
    
    return success;
  } catch (error) {
    console.error(`Error updating form ${formId}:`, error);
    throw error;
  }
}

/**
 * Create a new version of a form
 */
export async function createNewVersionAction(
  formId: string,
  newVersion: string,
  updates: FormUpdateParams = {},
  tags?: string[]
): Promise<string> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    // Create new version
    const result = await formRegistry.createNewVersion(knex, tenant, formId, newVersion, updates);
    
    // Add tags if provided
    if (tags && tags.length > 0) {
      await Promise.all(
        tags.map(tagText =>
          createTag({
            tag_text: tagText,
            tagged_id: formId,
            tagged_type: 'workflow_form'
          })
        )
      );
    }
    
    return result;
  } catch (error) {
    console.error(`Error creating new version for form ${formId}:`, error);
    throw error;
  }
}

/**
 * Update form status
 */
export async function updateFormStatusAction(
  formId: string,
  version: string,
  status: FormStatus
): Promise<boolean> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    return formRegistry.updateStatus(knex, tenant, formId, version, status);
  } catch (error) {
    console.error(`Error updating status for form ${formId}:`, error);
    throw error;
  }
}

/**
 * Delete a form
 */
export async function deleteFormAction(
  formId: string,
  version: string
): Promise<boolean> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    // Delete the form
    const success = await formRegistry.deleteForm(knex, tenant, formId, version);
    
    // Delete tags
    const tags = await findTagsByEntityId(formId, 'workflow_form');
    await Promise.all(
      tags.map(tag => deleteTag(tag.tag_id))
    );
    
    return success;
  } catch (error) {
    console.error(`Error deleting form ${formId}:`, error);
    throw error;
  }
}

/**
 * Search for forms
 */
export async function searchFormsAction(
  searchParams: FormSearchParams,
  pagination: {
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ total: number; forms: IFormDefinition[]; tags?: Record<string, ITag[]> }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    // Search for forms
    const { total, forms } = await formRegistry.searchForms(
      knex,
      tenant,
      { ...searchParams, tenant },
      pagination
    );
    
    // Get tags for all forms
    const formIds = forms.map(form => form.form_id);
    const tags: Record<string, ITag[]> = {};
    
    if (formIds.length > 0) {
      const allTags = await Promise.all(
        formIds.map(id => findTagsByEntityId(id, 'workflow_form'))
      );
      
      formIds.forEach((id, index) => {
        tags[id] = allTags[index];
      });
    }
    
    return { total, forms, tags };
  } catch (error) {
    console.error('Error searching forms:', error);
    throw error;
  }
}

/**
 * Get all versions of a form
 */
export async function getAllVersionsAction(
  formId: string
): Promise<IFormDefinition[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    return formRegistry.getAllVersions(knex, tenant, formId);
  } catch (error) {
    console.error(`Error getting versions for form ${formId}:`, error);
    throw error;
  }
}

/**
 * Get all form categories
 */
export async function getAllCategoriesAction(): Promise<string[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    return formRegistry.getAllCategories(knex, tenant);
  } catch (error) {
    console.error('Error getting form categories:', error);
    throw error;
  }
}

/**
 * Get all form tags
 */
export async function getAllFormTagsAction(): Promise<string[]> {
  try {
    return findAllTagsByType('workflow_form');
  } catch (error) {
    console.error('Error getting form tags:', error);
    throw error;
  }
}

/**
 * Validate form data
 */
export async function validateFormDataAction(
  formId: string,
  data: Record<string, any>,
  version?: string
): Promise<{ valid: boolean; errors?: Array<{ path: string; message: string }> }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    return formRegistry.validateFormData(knex, tenant, formId, data, version);
  } catch (error) {
    console.error(`Error validating form data for ${formId}:`, error);
    throw error;
  }
}

/**
 * Compose a form from multiple form definitions
 */
export async function composeFormAction(
  baseFormId: string,
  extensionFormIds: string[],
  overrides: {
    name?: string;
    description?: string;
    category?: string;
    jsonSchema?: Record<string, any>;
    uiSchema?: Record<string, any>;
    defaultValues?: Record<string, any>;
  } = {},
  tags?: string[]
): Promise<string> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const userId = undefined; // We don't have access to userId from createTenantKnex
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    const formRegistry = getFormRegistry();
    
    // Compose the form
    const composedForm = await formRegistry.composeForm(
      knex,
      tenant,
      baseFormId,
      extensionFormIds,
      overrides
    );
    
    // Register the composed form
    const formId = await formRegistry.register(
      knex,
      tenant,
      {
        formId: composedForm.definition.form_id,
        name: composedForm.definition.name,
        description: composedForm.definition.description,
        version: composedForm.definition.version,
        category: composedForm.definition.category,
        status: FormStatus.DRAFT,
        jsonSchema: composedForm.schema.json_schema,
        uiSchema: composedForm.schema.ui_schema,
        defaultValues: composedForm.schema.default_values
      },
      userId
    );
    
    // Add tags if provided
    if (tags && tags.length > 0) {
      await Promise.all(
        tags.map(tagText =>
          createTag({
            tag_text: tagText,
            tagged_id: formId,
            tagged_type: 'workflow_form'
          })
        )
      );
    }
    
    return formId;
  } catch (error) {
    console.error('Error composing form:', error);
    throw error;
  }
}

/**
 * Generate a unique form ID
 */
export function generateFormIdAction(): string {
  const formRegistry = getFormRegistry();
  return formRegistry.generateFormId();
}