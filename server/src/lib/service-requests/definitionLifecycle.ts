import type { Knex } from 'knex';

export interface ServiceRequestDefinitionListItem {
  tenant: string;
  definition_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  sort_order: number;
  linked_service_id: string | null;
  lifecycle_state: 'draft' | 'published' | 'archived';
}

export async function archiveServiceRequestDefinition(
  knex: Knex,
  tenant: string,
  definitionId: string,
  archivedBy?: string | null
): Promise<void> {
  await knex('service_request_definitions').where({ tenant, definition_id: definitionId }).update({
    lifecycle_state: 'archived',
    updated_by: archivedBy ?? null,
    updated_at: knex.fn.now(),
  });
}

export async function unarchiveServiceRequestDefinition(
  knex: Knex,
  tenant: string,
  definitionId: string,
  updatedBy?: string | null
): Promise<void> {
  await knex('service_request_definitions').where({ tenant, definition_id: definitionId }).update({
    lifecycle_state: 'draft',
    updated_by: updatedBy ?? null,
    updated_at: knex.fn.now(),
  });
}

export async function listPublishedServiceRequestDefinitions(
  knex: Knex,
  tenant: string
): Promise<ServiceRequestDefinitionListItem[]> {
  return (await knex('service_request_definitions')
    .where({ tenant, lifecycle_state: 'published' })
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'name', order: 'asc' }])
    .select(
      'tenant',
      'definition_id',
      'name',
      'description',
      'icon',
      'category_id',
      'sort_order',
      'linked_service_id',
      'lifecycle_state'
    )) as ServiceRequestDefinitionListItem[];
}

export async function createDraftFromLatestPublishedVersion(
  knex: Knex,
  tenant: string,
  definitionId: string,
  updatedBy?: string | null
): Promise<void> {
  const latestVersion = await knex('service_request_definition_versions')
    .where({ tenant, definition_id: definitionId })
    .orderBy('version_number', 'desc')
    .first();

  if (!latestVersion) {
    throw new Error('No published version found for definition');
  }

  await knex('service_request_definitions').where({ tenant, definition_id: definitionId }).update({
    name: latestVersion.name,
    description: latestVersion.description,
    icon: latestVersion.icon,
    category_id: latestVersion.category_id,
    sort_order: latestVersion.sort_order,
    linked_service_id: latestVersion.linked_service_id,
    form_schema: latestVersion.form_schema_snapshot,
    execution_provider: latestVersion.execution_provider,
    execution_config: latestVersion.execution_config,
    form_behavior_provider: latestVersion.form_behavior_provider,
    form_behavior_config: latestVersion.form_behavior_config,
    visibility_provider: latestVersion.visibility_provider,
    visibility_config: latestVersion.visibility_config,
    lifecycle_state: 'draft',
    updated_by: updatedBy ?? null,
    updated_at: knex.fn.now(),
  });
}
