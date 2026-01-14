'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import {
  ICustomField,
  CustomFieldEntityType,
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
  CustomFieldValuesMap
} from 'server/src/interfaces/customField.interfaces';

/**
 * Get all custom fields for a specific entity type
 */
export async function getCustomFieldsByEntity(
  entityType: CustomFieldEntityType,
  includeInactive: boolean = false
): Promise<ICustomField[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const query = knex('custom_fields')
    .where({ tenant, entity_type: entityType })
    .orderBy('field_order', 'asc');

  if (!includeInactive) {
    query.where('is_active', true);
  }

  const fields = await query;

  // Parse JSONB options field
  return fields.map((field: any) => ({
    ...field,
    options: field.options ? (typeof field.options === 'string' ? JSON.parse(field.options) : field.options) : [],
    default_value: field.default_value ? (typeof field.default_value === 'string' ? JSON.parse(field.default_value) : field.default_value) : null
  }));
}

/**
 * Get a single custom field by ID
 */
export async function getCustomFieldById(fieldId: string): Promise<ICustomField | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const field = await knex('custom_fields')
    .where({ tenant, field_id: fieldId })
    .first();

  if (!field) {
    return null;
  }

  return {
    ...field,
    options: field.options ? (typeof field.options === 'string' ? JSON.parse(field.options) : field.options) : [],
    default_value: field.default_value ? (typeof field.default_value === 'string' ? JSON.parse(field.default_value) : field.default_value) : null
  };
}

/**
 * Create a new custom field definition
 */
export async function createCustomField(input: CreateCustomFieldInput): Promise<ICustomField> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission - using 'settings' resource for admin operations
  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot create custom fields');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Get max field_order for this entity type
  const maxOrderResult = await knex('custom_fields')
    .where({ tenant, entity_type: input.entity_type })
    .max('field_order as max_order')
    .first();

  const nextOrder = input.field_order ?? ((maxOrderResult?.max_order ?? -1) + 1);

  const newField = {
    tenant,
    entity_type: input.entity_type,
    name: input.name,
    type: input.type,
    default_value: input.default_value !== undefined ? JSON.stringify(input.default_value) : null,
    options: input.options ? JSON.stringify(input.options) : null,
    field_order: nextOrder,
    is_required: input.is_required ?? false,
    is_active: true,
    description: input.description ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [created] = await knex('custom_fields')
    .insert(newField)
    .returning('*');

  return {
    ...created,
    options: created.options ? (typeof created.options === 'string' ? JSON.parse(created.options) : created.options) : [],
    default_value: created.default_value ? (typeof created.default_value === 'string' ? JSON.parse(created.default_value) : created.default_value) : null
  };
}

/**
 * Update a custom field definition
 */
export async function updateCustomField(
  fieldId: string,
  input: UpdateCustomFieldInput
): Promise<ICustomField> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot update custom fields');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const updateData: any = {
    updated_at: new Date().toISOString()
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.default_value !== undefined) updateData.default_value = JSON.stringify(input.default_value);
  if (input.options !== undefined) updateData.options = JSON.stringify(input.options);
  if (input.field_order !== undefined) updateData.field_order = input.field_order;
  if (input.is_required !== undefined) updateData.is_required = input.is_required;
  if (input.is_active !== undefined) updateData.is_active = input.is_active;
  if (input.description !== undefined) updateData.description = input.description;

  const [updated] = await knex('custom_fields')
    .where({ tenant, field_id: fieldId })
    .update(updateData)
    .returning('*');

  if (!updated) {
    throw new Error('Custom field not found');
  }

  return {
    ...updated,
    options: updated.options ? (typeof updated.options === 'string' ? JSON.parse(updated.options) : updated.options) : [],
    default_value: updated.default_value ? (typeof updated.default_value === 'string' ? JSON.parse(updated.default_value) : updated.default_value) : null
  };
}

/**
 * Delete (deactivate) a custom field
 * We soft-delete to preserve historical data
 */
export async function deleteCustomField(fieldId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'delete')) {
    throw new Error('Permission denied: Cannot delete custom fields');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await knex('custom_fields')
    .where({ tenant, field_id: fieldId })
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    });
}

/**
 * Permanently delete a custom field (use with caution)
 */
export async function permanentlyDeleteCustomField(fieldId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'delete')) {
    throw new Error('Permission denied: Cannot delete custom fields');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await knex('custom_fields')
    .where({ tenant, field_id: fieldId })
    .delete();
}

/**
 * Reorder custom fields for an entity type
 */
export async function reorderCustomFields(
  entityType: CustomFieldEntityType,
  fieldIds: string[]
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot reorder custom fields');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    for (let i = 0; i < fieldIds.length; i++) {
      await trx('custom_fields')
        .where({ tenant, field_id: fieldIds[i], entity_type: entityType })
        .update({ field_order: i, updated_at: new Date().toISOString() });
    }
  });
}

/**
 * Get custom field values for an entity
 * Returns values from the entity's properties/attributes column
 */
export async function getCustomFieldValues(
  entityType: CustomFieldEntityType,
  entityId: string
): Promise<CustomFieldValuesMap> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Determine table and column based on entity type
  const tableConfig = getTableConfig(entityType);

  const entity = await knex(tableConfig.table)
    .where({ tenant, [tableConfig.idColumn]: entityId })
    .select(tableConfig.propertiesColumn)
    .first();

  if (!entity) {
    return {};
  }

  const properties = entity[tableConfig.propertiesColumn];
  if (!properties) {
    return {};
  }

  // Parse if string, otherwise use as-is
  const parsed = typeof properties === 'string' ? JSON.parse(properties) : properties;

  // Extract custom_fields from properties (stored under 'custom_fields' key)
  return parsed.custom_fields || {};
}

/**
 * Save custom field values for an entity
 * Merges values into the entity's properties/attributes column
 */
export async function saveCustomFieldValues(
  entityType: CustomFieldEntityType,
  entityId: string,
  values: CustomFieldValuesMap
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const tableConfig = getTableConfig(entityType);

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get current properties
    const entity = await trx(tableConfig.table)
      .where({ tenant, [tableConfig.idColumn]: entityId })
      .select(tableConfig.propertiesColumn)
      .first();

    if (!entity) {
      throw new Error(`${entityType} not found`);
    }

    // Parse current properties
    let currentProperties = entity[tableConfig.propertiesColumn];
    if (typeof currentProperties === 'string') {
      currentProperties = JSON.parse(currentProperties);
    }
    currentProperties = currentProperties || {};

    // Merge custom field values under 'custom_fields' key
    const updatedProperties = {
      ...currentProperties,
      custom_fields: {
        ...(currentProperties.custom_fields || {}),
        ...values
      }
    };

    // Update the entity
    await trx(tableConfig.table)
      .where({ tenant, [tableConfig.idColumn]: entityId })
      .update({
        [tableConfig.propertiesColumn]: JSON.stringify(updatedProperties),
        updated_at: new Date().toISOString()
      });
  });
}

/**
 * Validate custom field values against field definitions
 * Returns array of validation errors (empty if valid)
 */
export async function validateCustomFieldValues(
  entityType: CustomFieldEntityType,
  values: CustomFieldValuesMap
): Promise<string[]> {
  const errors: string[] = [];

  // Get field definitions
  const fields = await getCustomFieldsByEntity(entityType, false);

  for (const field of fields) {
    const value = values[field.field_id];

    // Check required fields
    if (field.is_required && (value === undefined || value === null || value === '')) {
      errors.push(`${field.name} is required`);
      continue;
    }

    // Skip validation if no value provided for optional field
    if (value === undefined || value === null || value === '') {
      continue;
    }

    // Type validation
    switch (field.type) {
      case 'number':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          errors.push(`${field.name} must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${field.name} must be true or false`);
        }
        break;
      case 'date':
        if (isNaN(Date.parse(String(value)))) {
          errors.push(`${field.name} must be a valid date`);
        }
        break;
      case 'picklist':
        if (field.options && field.options.length > 0) {
          const validValues = field.options.map(opt => opt.value);
          if (!validValues.includes(String(value))) {
            errors.push(`${field.name} must be one of: ${validValues.join(', ')}`);
          }
        }
        break;
      // 'text' accepts any string value
    }
  }

  return errors;
}

/**
 * Helper to get table configuration for each entity type
 */
function getTableConfig(entityType: CustomFieldEntityType): {
  table: string;
  idColumn: string;
  propertiesColumn: string;
} {
  switch (entityType) {
    case 'ticket':
      return {
        table: 'tickets',
        idColumn: 'ticket_id',
        propertiesColumn: 'attributes'
      };
    case 'company':
      return {
        table: 'companies',
        idColumn: 'company_id',
        propertiesColumn: 'properties'
      };
    case 'contact':
      return {
        table: 'contacts',
        idColumn: 'contact_name_id',
        propertiesColumn: 'properties'
      };
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}
