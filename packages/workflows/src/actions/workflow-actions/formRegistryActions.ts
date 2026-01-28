'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
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
import { createTag, findTagsByEntityId, findAllTagsByType, deleteTag } from '@alga-psa/tags/actions';
import type { ITag } from '@alga-psa/types';

/**
 * Register a new form
 */
export const registerFormAction = withAuth(async (
  user,
  { tenant },
  params: FormRegistrationParams,
  tags?: string[]
): Promise<string> => {
  try {
    const { knex } = await createTenantKnex();
    const userId = user?.user_id;

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
});

/**
 * Register a new system form definition
 */
export const registerSystemWorkflowFormDefinitionAction = withAuth(async (
  user,
  { tenant },
  params: FormRegistrationParams,
  tags?: string[]
): Promise<string> => {
  try {
    const { knex } = await createTenantKnex();
    const userId = user?.user_id;

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const formRegistry = getFormRegistry();

    // Register the system form
    // System forms are stored in a separate table and are not tenant-specific
    const [formId] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('system_workflow_form_definitions').insert({
        form_id: params.formId || formRegistry.generateFormId(),
        name: params.name,
        description: params.description,
        version: params.version,
        category: params.category,
        status: params.status,
        json_schema: JSON.stringify(params.jsonSchema),
        ui_schema: JSON.stringify(params.uiSchema),
        default_values: JSON.stringify(params.defaultValues),
        created_by: userId,
        updated_by: userId,
        tenant: null,
        form_type: 'system'
      }).returning('form_id');
    });

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
    console.error('Error registering system form definition:', error);
    throw error;
  }
});

/**
 * Get a form by ID and version
 */
export const getFormAction = withAuth(async (
  _user,
  { tenant },
  formId: string, // This is the task_definition_id
  version?: string
): Promise<FormWithSchema | null> => {
  try {
    const { knex } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const formRegistry = getFormRegistry();

    // Look up the task definition to get the actual form_id and form_type
    const taskDefinition = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('workflow_task_definitions')
        .select('form_id', 'form_type')
        .where({ task_definition_id: formId })
        .first();
    });

    if (!taskDefinition) {
      console.warn(`No task definition found for task_definition_id: ${formId}`);
      return null;
    }

    const actualFormId = taskDefinition.form_id;
    const formType = taskDefinition.form_type;

    let form: FormWithSchema | null = null;

    if (formType === 'system') {
      // Query system forms table using the retrieved actualFormId
      const systemForm = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('system_workflow_form_definitions')
          .where({ form_id: actualFormId })
          .modify(queryBuilder => {
            if (version) {
              queryBuilder.where({ version });
            } else {
              // If no version is specified, get the latest version
              queryBuilder.orderBy('created_at', 'desc').first();
            }
          })
          .first(); // Ensure we get only one record if version is not specified
      });

      if (systemForm) {
        form = {
          ...systemForm,
          // Ensure JSON fields are parsed
          json_schema: typeof systemForm.json_schema === 'string' ? JSON.parse(systemForm.json_schema) : systemForm.json_schema,
          ui_schema: typeof systemForm.ui_schema === 'string' ? JSON.parse(systemForm.ui_schema) : systemForm.ui_schema,
          default_values: typeof systemForm.default_values === 'string' ? JSON.parse(systemForm.default_values) : systemForm.default_values,
          tags: [] // Tags will be fetched separately
        };
      }
    } else {
      // Query tenant forms table using the retrieved actualFormId and tenant context
      form = await formRegistry.getForm(knex, tenant, actualFormId, version);
    }

    if (!form) {
      console.warn(`Form not found with form_id: ${actualFormId} (type: ${formType}, version: ${version})`);
      return null;
    }

    // Get tags (tags are associated with the actualFormId regardless of table)
    const tags = await findTagsByEntityId(actualFormId, 'workflow_form');

    return {
      ...form,
      tags
    };
  } catch (error) {
    console.error(`Error getting form for task_definition_id ${formId}:`, error);
    throw error;
  }
});

/**
 * Update a form
 */
export const updateFormAction = withAuth(async (
  _user,
  { tenant },
  formId: string,
  version: string,
  updates: FormUpdateParams,
  tags?: string[]
): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

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
});

/**
 * Create a new version of a form
 */
export const createNewVersionAction = withAuth(async (
  _user,
  { tenant },
  formId: string,
  newVersion: string,
  updates: FormUpdateParams = {},
  tags?: string[]
): Promise<string> => {
  try {
    const { knex } = await createTenantKnex();

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
});

/**
 * Update form status
 */
export const updateFormStatusAction = withAuth(async (
  _user,
  { tenant },
  formId: string,
  version: string,
  status: FormStatus
): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const formRegistry = getFormRegistry();

    return formRegistry.updateStatus(knex, tenant, formId, version, status);
  } catch (error) {
    console.error(`Error updating status for form ${formId}:`, error);
    throw error;
  }
});

/**
 * Delete a form
 */
export const deleteFormAction = withAuth(async (
  _user,
  { tenant },
  formId: string,
  version: string
): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

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
});

/**
 * Search for forms
 */
export const searchFormsAction = withAuth(async (
  _user,
  { tenant },
  searchParams: FormSearchParams,
  pagination: {
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ total: number; forms: IFormDefinition[]; tags?: Record<string, ITag[]> }> => {
  try {
    const { knex } = await createTenantKnex();

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
});

/**
 * Get all versions of a form
 */
export const getAllVersionsAction = withAuth(async (
  _user,
  { tenant },
  formId: string
): Promise<IFormDefinition[]> => {
  try {
    const { knex } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const formRegistry = getFormRegistry();

    return formRegistry.getAllVersions(knex, tenant, formId);
  } catch (error) {
    console.error(`Error getting versions for form ${formId}:`, error);
    throw error;
  }
});

/**
 * Get all form categories
 */
export const getAllCategoriesAction = withAuth(async (
  _user,
  { tenant }
): Promise<string[]> => {
  try {
    const { knex } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const formRegistry = getFormRegistry();

    return formRegistry.getAllCategories(knex, tenant);
  } catch (error) {
    console.error('Error getting form categories:', error);
    throw error;
  }
});

/**
 * Get all form tags
 */
export async function getAllFormTagsAction(): Promise<string[]> {
  try {
    const tags = await findAllTagsByType('workflow_form');
    return tags.map(tag => tag.tag_text);
  } catch (error) {
    console.error('Error getting form tags:', error);
    throw error;
  }
}

/**
 * Validate form data
 */
export const validateFormDataAction = withAuth(async (
  _user,
  { tenant },
  formId: string,
  data: Record<string, any>,
  version?: string
): Promise<{ valid: boolean; errors?: Array<{ path: string; message: string }> }> => {
  try {
    const { knex } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const formRegistry = getFormRegistry();

    return formRegistry.validateFormData(knex, tenant, formId, data, version);
  } catch (error) {
    console.error(`Error validating form data for ${formId}:`, error);
    throw error;
  }
});

/**
 * Compose a form from multiple form definitions
 */
export const composeFormAction = withAuth(async (
  user,
  { tenant },
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
): Promise<string> => {
  try {
    const { knex } = await createTenantKnex();
    const userId = user?.user_id;

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
});

/**
 * Generate a unique form ID
 */
export async function generateFormIdAction(): Promise<string> {
  const formRegistry = getFormRegistry();
  return formRegistry.generateFormId();
}
