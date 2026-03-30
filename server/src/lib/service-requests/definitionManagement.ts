import type { Knex } from 'knex';
import {
  archiveServiceRequestDefinition,
  createDraftFromLatestPublishedVersion,
  unarchiveServiceRequestDefinition,
} from './definitionLifecycle';
import { listServiceRequestTemplateProviders } from './providers/registry';
import type { ServiceRequestTemplateDefinition } from './providers/contracts';

export interface ServiceRequestDefinitionManagementRow {
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
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

interface ServiceRequestDefinitionSourceRow extends ServiceRequestDefinitionManagementRow {
  form_schema: Record<string, unknown>;
  execution_provider: string;
  execution_config: Record<string, unknown>;
  form_behavior_provider: string;
  form_behavior_config: Record<string, unknown>;
  visibility_provider: string;
  visibility_config: Record<string, unknown>;
}

interface ServiceRequestDefinitionVersionSourceRow {
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  category_name_snapshot: string | null;
  sort_order: number;
  linked_service_id: string | null;
  linked_service_name_snapshot: string | null;
  form_schema_snapshot: Record<string, unknown>;
  execution_provider: string;
  execution_config: Record<string, unknown>;
  form_behavior_provider: string;
  form_behavior_config: Record<string, unknown>;
  visibility_provider: string;
  visibility_config: Record<string, unknown>;
}

export interface ServiceRequestTemplateOption {
  providerKey: string;
  providerDisplayName: string;
  templateId: string;
  templateName: string;
  templateDescription: string;
}

interface CreateDefinitionFromTemplateInput {
  knex: Knex;
  tenant: string;
  templateProviderKey: string;
  templateId: string;
  createdBy?: string | null;
}

interface CreateBlankDefinitionInput {
  knex: Knex;
  tenant: string;
  name?: string;
  createdBy?: string | null;
}

interface DuplicateDefinitionInput {
  knex: Knex;
  tenant: string;
  sourceDefinitionId: string;
  createdBy?: string | null;
}

interface SaveDraftDefinitionInput {
  knex: Knex;
  tenant: string;
  definitionId: string;
  updatedBy?: string | null;
  updates: Partial<
    Pick<
      ServiceRequestDefinitionSourceRow,
      | 'name'
      | 'description'
      | 'icon'
      | 'category_id'
      | 'sort_order'
      | 'linked_service_id'
      | 'linked_service_name_snapshot'
      | 'form_schema'
      | 'execution_provider'
      | 'execution_config'
      | 'form_behavior_provider'
      | 'form_behavior_config'
      | 'visibility_provider'
      | 'visibility_config'
    >
  >;
}

export interface LinkableServiceOption {
  service_id: string;
  service_name: string;
  description: string | null;
}

function jsonValueEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function definitionMatchesPublishedVersion(
  definition: ServiceRequestDefinitionSourceRow,
  version: ServiceRequestDefinitionVersionSourceRow
): boolean {
  return (
    definition.name === version.name &&
    definition.description === version.description &&
    definition.icon === version.icon &&
    definition.category_id === version.category_id &&
    definition.category_name_snapshot === version.category_name_snapshot &&
    definition.sort_order === version.sort_order &&
    definition.linked_service_id === version.linked_service_id &&
    definition.linked_service_name_snapshot === version.linked_service_name_snapshot &&
    definition.execution_provider === version.execution_provider &&
    definition.form_behavior_provider === version.form_behavior_provider &&
    definition.visibility_provider === version.visibility_provider &&
    jsonValueEquals(definition.form_schema, version.form_schema_snapshot) &&
    jsonValueEquals(definition.execution_config, version.execution_config) &&
    jsonValueEquals(definition.form_behavior_config, version.form_behavior_config) &&
    jsonValueEquals(definition.visibility_config, version.visibility_config)
  );
}

export async function listServiceRequestDefinitionsForManagement(
  knex: Knex,
  tenant: string
): Promise<ServiceRequestDefinitionManagementRow[]> {
  return (await knex('service_request_definitions')
    .where({ tenant })
    .orderBy([
      { column: 'sort_order', order: 'asc' },
      { column: 'updated_at', order: 'desc' },
      { column: 'name', order: 'asc' },
    ])
    .select(
      'tenant',
      'definition_id',
      'name',
      'description',
      'icon',
      'category_id',
      'category_name_snapshot',
      'sort_order',
      'linked_service_id',
      'linked_service_name_snapshot',
      'lifecycle_state',
      'created_at',
      'updated_at',
      'published_at'
    )) as ServiceRequestDefinitionManagementRow[];
}

export function listServiceRequestTemplateOptions(): ServiceRequestTemplateOption[] {
  return listServiceRequestTemplateProviders().flatMap((provider) =>
    provider.listTemplates().map((template) => ({
      providerKey: provider.key,
      providerDisplayName: provider.displayName,
      templateId: template.id,
      templateName: template.name,
      templateDescription: template.description,
    }))
  );
}

function findTemplateDefinition(
  templateProviderKey: string,
  templateId: string
): ServiceRequestTemplateDefinition {
  const provider = listServiceRequestTemplateProviders().find(
    (candidate) => candidate.key === templateProviderKey
  );
  if (!provider) {
    throw new Error(`Template provider not found: ${templateProviderKey}`);
  }

  const template = provider.listTemplates().find((candidate) => candidate.id === templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateProviderKey}/${templateId}`);
  }

  return template;
}

export async function createBlankServiceRequestDefinition({
  knex,
  tenant,
  name = 'Untitled Service Request',
  createdBy = null,
}: CreateBlankDefinitionInput): Promise<ServiceRequestDefinitionManagementRow> {
  const [created] = (await knex('service_request_definitions')
    .insert({
      tenant,
      name,
      description: null,
      icon: null,
      category_id: null,
      category_name_snapshot: null,
      sort_order: 0,
      linked_service_id: null,
      linked_service_name_snapshot: null,
      form_schema: { fields: [] },
      execution_provider: 'ticket-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'draft',
      created_by: createdBy,
      updated_by: createdBy,
    })
    .returning('*')) as ServiceRequestDefinitionManagementRow[];

  return created;
}

export async function createServiceRequestDefinitionFromTemplate({
  knex,
  tenant,
  templateProviderKey,
  templateId,
  createdBy = null,
}: CreateDefinitionFromTemplateInput): Promise<ServiceRequestDefinitionManagementRow> {
  const template = findTemplateDefinition(templateProviderKey, templateId);
  const draft = template.buildDraft();

  const [created] = (await knex('service_request_definitions')
    .insert({
      tenant,
      name: draft.metadata.name,
      description: draft.metadata.description ?? null,
      icon: draft.metadata.icon ?? null,
      category_id: draft.metadata.categoryId ?? null,
      category_name_snapshot: null,
      sort_order: draft.metadata.sortOrder ?? 0,
      linked_service_id: draft.linkedServiceId ?? null,
      linked_service_name_snapshot: null,
      form_schema: draft.formSchema,
      execution_provider: draft.providers.executionProvider,
      execution_config: draft.providers.executionConfig,
      form_behavior_provider: draft.providers.formBehaviorProvider,
      form_behavior_config: draft.providers.formBehaviorConfig,
      visibility_provider: draft.providers.visibilityProvider,
      visibility_config: draft.providers.visibilityConfig,
      lifecycle_state: 'draft',
      created_by: createdBy,
      updated_by: createdBy,
    })
    .returning('*')) as ServiceRequestDefinitionManagementRow[];

  return created;
}

export async function duplicateServiceRequestDefinition({
  knex,
  tenant,
  sourceDefinitionId,
  createdBy = null,
}: DuplicateDefinitionInput): Promise<ServiceRequestDefinitionManagementRow> {
  const source = (await knex('service_request_definitions')
    .where({ tenant, definition_id: sourceDefinitionId })
    .first()) as ServiceRequestDefinitionSourceRow | undefined;

  if (!source) {
    throw new Error('Source service request definition not found');
  }

  const [created] = (await knex('service_request_definitions')
    .insert({
      tenant,
      name: `${source.name} (Copy)`,
      description: source.description,
      icon: source.icon,
      category_id: source.category_id,
      category_name_snapshot: source.category_name_snapshot,
      sort_order: source.sort_order,
      linked_service_id: source.linked_service_id,
      linked_service_name_snapshot: source.linked_service_name_snapshot,
      form_schema: source.form_schema,
      execution_provider: source.execution_provider,
      execution_config: source.execution_config,
      form_behavior_provider: source.form_behavior_provider,
      form_behavior_config: source.form_behavior_config,
      visibility_provider: source.visibility_provider,
      visibility_config: source.visibility_config,
      lifecycle_state: 'draft',
      published_by: null,
      published_at: null,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .returning('*')) as ServiceRequestDefinitionManagementRow[];

  return created;
}

export async function saveServiceRequestDefinitionDraft({
  knex,
  tenant,
  definitionId,
  updatedBy = null,
  updates,
}: SaveDraftDefinitionInput): Promise<ServiceRequestDefinitionManagementRow> {
  return knex.transaction(async (trx) => {
    const existing = (await trx('service_request_definitions')
      .where({ tenant, definition_id: definitionId })
      .first()) as ServiceRequestDefinitionSourceRow | undefined;

    if (!existing) {
      throw new Error('Service request definition not found');
    }

    if (existing.lifecycle_state === 'published') {
      const latestVersion = (await trx('service_request_definition_versions')
        .where({ tenant, definition_id: definitionId })
        .orderBy('version_number', 'desc')
        .first(
          'name',
          'description',
          'icon',
          'category_id',
          'category_name_snapshot',
          'sort_order',
          'linked_service_id',
          'linked_service_name_snapshot',
          'form_schema_snapshot',
          'execution_provider',
          'execution_config',
          'form_behavior_provider',
          'form_behavior_config',
          'visibility_provider',
          'visibility_config'
        )) as ServiceRequestDefinitionVersionSourceRow | undefined;

      if (latestVersion && definitionMatchesPublishedVersion(existing, latestVersion)) {
        await createDraftFromLatestPublishedVersion(trx, tenant, definitionId, updatedBy);
      } else {
        await trx('service_request_definitions')
          .where({ tenant, definition_id: definitionId })
          .update({
            lifecycle_state: 'draft',
            updated_by: updatedBy,
            updated_at: trx.fn.now(),
          });
      }
    }

    const [saved] = (await trx('service_request_definitions')
      .where({ tenant, definition_id: definitionId })
      .update({
        ...updates,
        lifecycle_state: 'draft',
        updated_by: updatedBy,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as ServiceRequestDefinitionManagementRow[];

    return saved;
  });
}

export async function searchServiceCatalogForLinking(
  knex: Knex,
  tenant: string,
  query: string,
  limit: number = 20
): Promise<LinkableServiceOption[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  return (await knex('service_catalog')
    .where({ tenant })
    .andWhereILike('service_name', `%${trimmed}%`)
    .orderBy('service_name', 'asc')
    .limit(limit)
    .select('service_id', 'service_name', 'description')) as LinkableServiceOption[];
}

export async function setLinkedServiceForServiceRequestDefinitionDraft(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  linkedServiceId: string | null;
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const { knex, tenant, definitionId, linkedServiceId, updatedBy = null } = input;

  if (!linkedServiceId) {
    return saveServiceRequestDefinitionDraft({
      knex,
      tenant,
      definitionId,
      updatedBy,
      updates: {
        linked_service_id: null,
        linked_service_name_snapshot: null,
      },
    });
  }

  const service = await knex('service_catalog')
    .where({ tenant, service_id: linkedServiceId })
    .select('service_name')
    .first<{ service_name: string }>();

  if (!service) {
    throw new Error('Linked service not found');
  }

  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updatedBy,
    updates: {
      linked_service_id: linkedServiceId,
      linked_service_name_snapshot: service.service_name,
    },
  });
}

export async function archiveServiceRequestDefinitionFromManagement(
  knex: Knex,
  tenant: string,
  definitionId: string,
  archivedBy?: string | null
): Promise<void> {
  await archiveServiceRequestDefinition(knex, tenant, definitionId, archivedBy);
}

export async function unarchiveServiceRequestDefinitionFromManagement(
  knex: Knex,
  tenant: string,
  definitionId: string,
  updatedBy?: string | null
): Promise<void> {
  await unarchiveServiceRequestDefinition(knex, tenant, definitionId, updatedBy);
}
