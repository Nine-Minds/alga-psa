import type { Knex } from 'knex';
import {
  listServiceRequestExecutionProviders,
  listServiceRequestFormBehaviorProviders,
  listServiceRequestVisibilityProviders,
} from './providers/registry';

export interface ServiceRequestDefinitionEditorData {
  definitionId: string;
  lifecycleState: 'draft' | 'published' | 'archived';
  basics: {
    name: string;
    description: string | null;
    icon: string | null;
    categoryId: string | null;
    categoryName: string | null;
    sortOrder: number;
    availableCategories: Array<{
      categoryId: string;
      categoryName: string;
    }>;
  };
  linkage: {
    linkedServiceId: string | null;
    linkedServiceName: string | null;
  };
  form: {
    schema: Record<string, unknown>;
  };
  execution: {
    executionProvider: string;
    executionConfig: Record<string, unknown>;
    formBehaviorProvider: string;
    formBehaviorConfig: Record<string, unknown>;
    visibilityProvider: string;
    visibilityConfig: Record<string, unknown>;
    availableExecutionProviders: Array<{
      key: string;
      displayName: string;
      executionMode: string;
    }>;
    availableFormBehaviorProviders: Array<{
      key: string;
      displayName: string;
    }>;
    availableVisibilityProviders: Array<{
      key: string;
      displayName: string;
    }>;
    showWorkflowExecutionConfigPanel: boolean;
    showAdvancedFormBehaviorConfigPanel: boolean;
  };
  publish: {
    publishedVersionNumber: number | null;
    publishedAt: Date | null;
    publishedBy: string | null;
    draftUpdatedAt: Date;
  };
}

interface ServiceRequestDefinitionEditorRow {
  definition_id: string;
  lifecycle_state: 'draft' | 'published' | 'archived';
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  category_name_snapshot: string | null;
  sort_order: number;
  linked_service_id: string | null;
  linked_service_name_snapshot: string | null;
  form_schema: Record<string, unknown>;
  execution_provider: string;
  execution_config: Record<string, unknown>;
  form_behavior_provider: string;
  form_behavior_config: Record<string, unknown>;
  visibility_provider: string;
  visibility_config: Record<string, unknown>;
  updated_at: Date;
}

interface ServiceRequestPublishedVersionRow {
  version_number: number;
  published_at: Date;
  published_by: string | null;
}

interface ServiceRequestCategoryRow {
  category_id: string;
  category_name: string;
}

export async function getServiceRequestDefinitionEditorData(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<ServiceRequestDefinitionEditorData | null> {
  const availableExecutionProviders = listServiceRequestExecutionProviders().map((provider) => ({
    key: provider.key,
    displayName: provider.displayName,
    executionMode: provider.executionMode,
  }));
  const availableFormBehaviorProviders = listServiceRequestFormBehaviorProviders().map((provider) => ({
    key: provider.key,
    displayName: provider.displayName,
  }));
  const availableVisibilityProviders = listServiceRequestVisibilityProviders().map((provider) => ({
    key: provider.key,
    displayName: provider.displayName,
  }));

  const definition = (await knex('service_request_definitions')
    .where({ tenant, definition_id: definitionId })
    .first()) as ServiceRequestDefinitionEditorRow | undefined;

  if (!definition) {
    return null;
  }

  const [availableCategories, categoryRow, serviceRow, latestPublishedVersion] = await Promise.all([
    knex('service_categories')
      .where({ tenant })
      .orderBy('category_name', 'asc')
      .select('category_id', 'category_name') as Promise<ServiceRequestCategoryRow[]>,
    definition.category_id
      ? knex('service_categories')
          .where({ tenant, category_id: definition.category_id })
          .select('category_name')
          .first<{ category_name: string }>()
      : Promise.resolve(undefined),
    definition.linked_service_id
      ? knex('service_catalog')
          .where({ tenant, service_id: definition.linked_service_id })
          .select('service_name')
          .first<{ service_name: string }>()
      : Promise.resolve(undefined),
    knex('service_request_definition_versions')
      .where({ tenant, definition_id: definitionId })
      .orderBy('version_number', 'desc')
      .select('version_number', 'published_at', 'published_by')
      .first<ServiceRequestPublishedVersionRow>(),
  ]);

  const workflowProviderKeys = new Set(['workflow-only', 'ticket-plus-workflow']);
  const availableExecutionProviderKeys = new Set(
    availableExecutionProviders.map((provider) => provider.key)
  );
  const availableFormBehaviorProviderKeys = new Set(
    availableFormBehaviorProviders.map((provider) => provider.key)
  );

  return {
    definitionId: definition.definition_id,
    lifecycleState: definition.lifecycle_state,
    basics: {
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      categoryId: definition.category_id,
      categoryName:
        categoryRow?.category_name ?? definition.category_name_snapshot ?? null,
      sortOrder: definition.sort_order,
      availableCategories: availableCategories.map((category) => ({
        categoryId: category.category_id,
        categoryName: category.category_name,
      })),
    },
    linkage: {
      linkedServiceId: definition.linked_service_id,
      linkedServiceName:
        serviceRow?.service_name ?? definition.linked_service_name_snapshot ?? null,
    },
    form: {
      schema: definition.form_schema,
    },
    execution: {
      executionProvider: definition.execution_provider,
      executionConfig: definition.execution_config,
      formBehaviorProvider: definition.form_behavior_provider,
      formBehaviorConfig: definition.form_behavior_config,
      visibilityProvider: definition.visibility_provider,
      visibilityConfig: definition.visibility_config,
      availableExecutionProviders,
      availableFormBehaviorProviders,
      availableVisibilityProviders,
      showWorkflowExecutionConfigPanel:
        workflowProviderKeys.has(definition.execution_provider) &&
        availableExecutionProviderKeys.has(definition.execution_provider),
      showAdvancedFormBehaviorConfigPanel:
        definition.form_behavior_provider === 'advanced' &&
        availableFormBehaviorProviderKeys.has('advanced'),
    },
    publish: {
      publishedVersionNumber: latestPublishedVersion?.version_number ?? null,
      publishedAt: latestPublishedVersion?.published_at ?? null,
      publishedBy: latestPublishedVersion?.published_by ?? null,
      draftUpdatedAt: definition.updated_at,
    },
  };
}
