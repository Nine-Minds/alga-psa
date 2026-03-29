import type { Knex } from 'knex';
import {
  archiveServiceRequestDefinition,
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
