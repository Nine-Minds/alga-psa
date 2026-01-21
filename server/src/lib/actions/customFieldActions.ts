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
  CustomFieldValuesMap,
  ICustomFieldGroup,
  CreateCustomFieldGroupInput,
  UpdateCustomFieldGroupInput,
  ICompanyCustomFieldSetting,
  UpsertCompanyCustomFieldSettingInput,
  BulkFieldOrderInput,
  FieldGroupDisplayStyle
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

  // Parse JSONB fields
  return fields.map((field: any) => ({
    ...field,
    options: field.options ? (typeof field.options === 'string' ? JSON.parse(field.options) : field.options) : [],
    default_value: field.default_value ? (typeof field.default_value === 'string' ? JSON.parse(field.default_value) : field.default_value) : null,
    conditional_logic: field.conditional_logic ? (typeof field.conditional_logic === 'string' ? JSON.parse(field.conditional_logic) : field.conditional_logic) : null
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
    default_value: field.default_value ? (typeof field.default_value === 'string' ? JSON.parse(field.default_value) : field.default_value) : null,
    conditional_logic: field.conditional_logic ? (typeof field.conditional_logic === 'string' ? JSON.parse(field.conditional_logic) : field.conditional_logic) : null
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
    conditional_logic: input.conditional_logic ? JSON.stringify(input.conditional_logic) : null,
    group_id: input.group_id ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [created] = await knex('custom_fields')
    .insert(newField)
    .returning('*');

  return {
    ...created,
    options: created.options ? (typeof created.options === 'string' ? JSON.parse(created.options) : created.options) : [],
    default_value: created.default_value ? (typeof created.default_value === 'string' ? JSON.parse(created.default_value) : created.default_value) : null,
    conditional_logic: created.conditional_logic ? (typeof created.conditional_logic === 'string' ? JSON.parse(created.conditional_logic) : created.conditional_logic) : null
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
  if (input.conditional_logic !== undefined) updateData.conditional_logic = input.conditional_logic ? JSON.stringify(input.conditional_logic) : null;
  if (input.group_id !== undefined) updateData.group_id = input.group_id;

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
    default_value: updated.default_value ? (typeof updated.default_value === 'string' ? JSON.parse(updated.default_value) : updated.default_value) : null,
    conditional_logic: updated.conditional_logic ? (typeof updated.conditional_logic === 'string' ? JSON.parse(updated.conditional_logic) : updated.conditional_logic) : null
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
      case 'multi_picklist':
        if (field.options && field.options.length > 0) {
          const validValues = field.options.map(opt => opt.value);
          // Value should be an array for multi_picklist
          if (!Array.isArray(value)) {
            errors.push(`${field.name} must be a list of values`);
          } else {
            const invalidValues = value.filter(v => !validValues.includes(String(v)));
            if (invalidValues.length > 0) {
              errors.push(`${field.name} contains invalid values: ${invalidValues.join(', ')}`);
            }
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

// =============================================================================
// Custom Field Groups
// =============================================================================

/**
 * Get all custom field groups for an entity type
 */
export async function getCustomFieldGroups(
  entityType: CustomFieldEntityType
): Promise<ICustomFieldGroup[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const groups = await knex('custom_field_groups')
    .where({ tenant, entity_type: entityType })
    .orderBy('group_order', 'asc');

  return groups;
}

/**
 * Get a single custom field group by ID
 */
export async function getCustomFieldGroupById(groupId: string): Promise<ICustomFieldGroup | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const group = await knex('custom_field_groups')
    .where({ tenant, group_id: groupId })
    .first();

  return group || null;
}

/**
 * Create a new custom field group
 */
export async function createCustomFieldGroup(
  input: CreateCustomFieldGroupInput
): Promise<ICustomFieldGroup> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot create custom field groups');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Get max group_order for this entity type
  const maxOrderResult = await knex('custom_field_groups')
    .where({ tenant, entity_type: input.entity_type })
    .max('group_order as max_order')
    .first();

  const nextOrder = input.group_order ?? ((maxOrderResult?.max_order ?? -1) + 1);

  const newGroup = {
    tenant,
    entity_type: input.entity_type,
    name: input.name,
    description: input.description ?? null,
    group_order: nextOrder,
    is_collapsed_by_default: input.is_collapsed_by_default ?? false,
    display_style: input.display_style ?? 'collapsible',
    icon: input.icon ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [created] = await knex('custom_field_groups')
    .insert(newGroup)
    .returning('*');

  return created;
}

/**
 * Update a custom field group
 */
export async function updateCustomFieldGroup(
  groupId: string,
  input: UpdateCustomFieldGroupInput
): Promise<ICustomFieldGroup> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot update custom field groups');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const updateData: any = {
    updated_at: new Date().toISOString()
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.group_order !== undefined) updateData.group_order = input.group_order;
  if (input.is_collapsed_by_default !== undefined) updateData.is_collapsed_by_default = input.is_collapsed_by_default;
  if (input.display_style !== undefined) updateData.display_style = input.display_style;
  if (input.icon !== undefined) updateData.icon = input.icon;

  const [updated] = await knex('custom_field_groups')
    .where({ tenant, group_id: groupId })
    .update(updateData)
    .returning('*');

  if (!updated) {
    throw new Error('Custom field group not found');
  }

  return updated;
}

/**
 * Delete a custom field group
 * Fields in this group will have their group_id set to null
 */
export async function deleteCustomFieldGroup(groupId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'delete')) {
    throw new Error('Permission denied: Cannot delete custom field groups');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await knex('custom_field_groups')
    .where({ tenant, group_id: groupId })
    .delete();
}

/**
 * Reorder custom field groups
 */
export async function reorderCustomFieldGroups(
  entityType: CustomFieldEntityType,
  groupIds: string[]
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot reorder custom field groups');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    for (let i = 0; i < groupIds.length; i++) {
      await trx('custom_field_groups')
        .where({ tenant, group_id: groupIds[i], entity_type: entityType })
        .update({ group_order: i, updated_at: new Date().toISOString() });
    }
  });
}

// =============================================================================
// Company Custom Field Settings (Per-Client Templates)
// =============================================================================

/**
 * Get custom field settings for a company
 */
export async function getCompanyCustomFieldSettings(
  companyId: string
): Promise<ICompanyCustomFieldSetting[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const settings = await knex('company_custom_field_settings')
    .where({ tenant, company_id: companyId });

  return settings.map((setting: any) => ({
    ...setting,
    override_default_value: setting.override_default_value
      ? (typeof setting.override_default_value === 'string'
        ? JSON.parse(setting.override_default_value)
        : setting.override_default_value)
      : null
  }));
}

/**
 * Upsert a company custom field setting
 */
export async function upsertCompanyCustomFieldSetting(
  input: UpsertCompanyCustomFieldSettingInput
): Promise<ICompanyCustomFieldSetting> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'company', 'update')) {
    throw new Error('Permission denied: Cannot update company custom field settings');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const settingData = {
    tenant,
    company_id: input.company_id,
    field_id: input.field_id,
    is_enabled: input.is_enabled,
    override_default_value: input.override_default_value !== undefined
      ? JSON.stringify(input.override_default_value)
      : null,
    updated_at: new Date().toISOString()
  };

  // Try to update first
  const [updated] = await knex('company_custom_field_settings')
    .where({ tenant, company_id: input.company_id, field_id: input.field_id })
    .update(settingData)
    .returning('*');

  if (updated) {
    return {
      ...updated,
      override_default_value: updated.override_default_value
        ? (typeof updated.override_default_value === 'string'
          ? JSON.parse(updated.override_default_value)
          : updated.override_default_value)
        : null
    };
  }

  // Insert if not found
  const [created] = await knex('company_custom_field_settings')
    .insert({
      ...settingData,
      created_at: new Date().toISOString()
    })
    .returning('*');

  return {
    ...created,
    override_default_value: created.override_default_value
      ? (typeof created.override_default_value === 'string'
        ? JSON.parse(created.override_default_value)
        : created.override_default_value)
      : null
  };
}

/**
 * Delete a company custom field setting
 */
export async function deleteCompanyCustomFieldSetting(
  companyId: string,
  fieldId: string
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'company', 'update')) {
    throw new Error('Permission denied: Cannot delete company custom field settings');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await knex('company_custom_field_settings')
    .where({ tenant, company_id: companyId, field_id: fieldId })
    .delete();
}

/**
 * Get custom fields for a company, filtered by company settings
 * Returns only fields that are enabled for this company
 */
export async function getCustomFieldsForCompany(
  entityType: CustomFieldEntityType,
  companyId: string
): Promise<ICustomField[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Get all active fields for this entity type
  const allFields = await getCustomFieldsByEntity(entityType, false);

  // Get company settings
  const settings = await getCompanyCustomFieldSettings(companyId);
  const settingsMap = new Map(settings.map(s => [s.field_id, s]));

  // Filter fields based on company settings
  // Fields without settings are included by default
  return allFields.filter(field => {
    const setting = settingsMap.get(field.field_id);
    return !setting || setting.is_enabled;
  });
}

// =============================================================================
// Bulk Field Operations (for drag-drop reordering)
// =============================================================================

/**
 * Bulk update field order and optionally move fields between groups
 * Used for drag-and-drop reordering in the UI
 */
export async function bulkUpdateFieldOrder(
  entityType: CustomFieldEntityType,
  orders: BulkFieldOrderInput[]
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
    for (const item of orders) {
      const updateData: any = {
        field_order: item.order,
        updated_at: new Date().toISOString()
      };

      // If groupId is explicitly provided (even if null), update it
      if (item.groupId !== undefined) {
        updateData.group_id = item.groupId;
      }

      await trx('custom_fields')
        .where({ tenant, field_id: item.fieldId, entity_type: entityType })
        .update(updateData);
    }
  });
}

/**
 * Move a field to a different group (or ungrouped)
 * Also updates the field order within the new group
 */
export async function moveFieldToGroup(
  fieldId: string,
  targetGroupId: string | null,
  newOrder: number
): Promise<ICustomField> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot move custom fields');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const [updated] = await knex('custom_fields')
    .where({ tenant, field_id: fieldId })
    .update({
      group_id: targetGroupId,
      field_order: newOrder,
      updated_at: new Date().toISOString()
    })
    .returning('*');

  if (!updated) {
    throw new Error('Custom field not found');
  }

  return {
    ...updated,
    options: updated.options ? (typeof updated.options === 'string' ? JSON.parse(updated.options) : updated.options) : [],
    default_value: updated.default_value ? (typeof updated.default_value === 'string' ? JSON.parse(updated.default_value) : updated.default_value) : null,
    conditional_logic: updated.conditional_logic ? (typeof updated.conditional_logic === 'string' ? JSON.parse(updated.conditional_logic) : updated.conditional_logic) : null
  };
}

/**
 * Update the display style of a field group
 */
export async function updateFieldGroupDisplayStyle(
  groupId: string,
  displayStyle: FieldGroupDisplayStyle
): Promise<ICustomFieldGroup> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot update field group display style');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const [updated] = await knex('custom_field_groups')
    .where({ tenant, group_id: groupId })
    .update({
      display_style: displayStyle,
      updated_at: new Date().toISOString()
    })
    .returning('*');

  if (!updated) {
    throw new Error('Custom field group not found');
  }

  return updated;
}
