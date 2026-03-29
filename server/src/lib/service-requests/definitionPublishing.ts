import type { Knex } from 'knex';

export interface PublishServiceRequestDefinitionInput {
  knex: Knex;
  tenant: string;
  definitionId: string;
  publishedBy?: string | null;
}

export interface ServiceRequestDefinitionVersionRecord {
  tenant: string;
  version_id: string;
  definition_id: string;
  version_number: number;
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  sort_order: number;
  linked_service_id: string | null;
  form_schema_snapshot: Record<string, unknown>;
  execution_provider: string;
  execution_config: Record<string, unknown>;
  form_behavior_provider: string;
  form_behavior_config: Record<string, unknown>;
  visibility_provider: string;
  visibility_config: Record<string, unknown>;
  published_by: string | null;
  published_at: Date;
  created_at: Date;
}

type ServiceRequestDefinitionRow = {
  tenant: string;
  definition_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  sort_order: number;
  linked_service_id: string | null;
  form_schema: Record<string, unknown>;
  execution_provider: string;
  execution_config: Record<string, unknown>;
  form_behavior_provider: string;
  form_behavior_config: Record<string, unknown>;
  visibility_provider: string;
  visibility_config: Record<string, unknown>;
};

export async function publishServiceRequestDefinition(
  input: PublishServiceRequestDefinitionInput
): Promise<ServiceRequestDefinitionVersionRecord> {
  const { knex, tenant, definitionId, publishedBy = null } = input;

  return knex.transaction(async (trx) => {
    const definition = (await trx('service_request_definitions')
      .where({ tenant, definition_id: definitionId })
      .first()) as ServiceRequestDefinitionRow | undefined;

    if (!definition) {
      throw new Error('Service request definition not found');
    }

    const currentMaxVersion = await trx('service_request_definition_versions')
      .where({ tenant, definition_id: definitionId })
      .max<{ maxVersion: string | number | null }>('version_number as maxVersion')
      .first();

    const nextVersionNumber = Number(currentMaxVersion?.maxVersion ?? 0) + 1;

    const [createdVersion] = (await trx('service_request_definition_versions')
      .insert({
        tenant,
        definition_id: definitionId,
        version_number: nextVersionNumber,
        name: definition.name,
        description: definition.description,
        icon: definition.icon,
        category_id: definition.category_id,
        sort_order: definition.sort_order,
        linked_service_id: definition.linked_service_id,
        form_schema_snapshot: definition.form_schema,
        execution_provider: definition.execution_provider,
        execution_config: definition.execution_config,
        form_behavior_provider: definition.form_behavior_provider,
        form_behavior_config: definition.form_behavior_config,
        visibility_provider: definition.visibility_provider,
        visibility_config: definition.visibility_config,
        published_by: publishedBy,
      })
      .returning('*')) as ServiceRequestDefinitionVersionRecord[];

    await trx('service_request_definitions').where({ tenant, definition_id: definitionId }).update({
      lifecycle_state: 'published',
      published_by: publishedBy,
      published_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    return createdVersion;
  });
}
