import type { Knex } from 'knex';

export interface ServiceRequestDefinitionListItem {
  tenant: string;
  definition_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  category_name_snapshot: string | null;
  sort_order: number;
  linked_service_id: string | null;
  linked_service_name_snapshot: string | null;
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
    published_by: null,
    published_at: null,
    updated_by: updatedBy ?? null,
    updated_at: knex.fn.now(),
  });
}

export async function listPublishedServiceRequestDefinitions(
  knex: Knex,
  tenant: string
): Promise<ServiceRequestDefinitionListItem[]> {
  return (await knex('service_request_definitions as definition')
    .where('definition.tenant', tenant)
    .whereNot('definition.lifecycle_state', 'archived')
    .whereNotNull('definition.published_at')
    .whereExists(function publishedVersionExists() {
      this.select(knex.raw('1'))
        .from('service_request_definition_versions as version')
        .whereRaw('version.tenant = definition.tenant')
        .andWhereRaw('version.definition_id = definition.definition_id');
    })
    .orderBy([{ column: 'definition.sort_order', order: 'asc' }, { column: 'definition.name', order: 'asc' }])
    .select(
      'definition.tenant',
      'definition.definition_id',
      'definition.name',
      'definition.description',
      'definition.icon',
      'definition.category_id',
      'definition.category_name_snapshot',
      'definition.sort_order',
      'definition.linked_service_id',
      'definition.linked_service_name_snapshot',
      'definition.lifecycle_state'
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
    category_name_snapshot: latestVersion.category_name_snapshot,
    sort_order: latestVersion.sort_order,
    linked_service_id: latestVersion.linked_service_id,
    linked_service_name_snapshot: latestVersion.linked_service_name_snapshot,
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
