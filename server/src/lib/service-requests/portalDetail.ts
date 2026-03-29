import type { Knex } from 'knex';
import { getServiceRequestVisibilityProvider } from './providers/registry';
import type { ServiceRequestDefinitionShape } from './domain';
import type { ServiceRequestPortalCatalogContext } from './portalCatalog';
import { resolveStaticDefaultValues } from './basicFormBuilder';
import { getServiceRequestFormBehaviorProvider } from './providers/registry';

interface PublishedDefinitionRow {
  tenant: string;
  definition_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  sort_order: number;
  linked_service_id: string | null;
  visibility_provider: string;
  visibility_config: Record<string, unknown> | null;
}

interface DefinitionVersionRow {
  version_id: string;
  version_number: number;
  name: string;
  description: string | null;
  icon: string | null;
  form_schema_snapshot: Record<string, unknown>;
  execution_provider: string;
  execution_config: Record<string, unknown> | null;
  form_behavior_provider: string;
  form_behavior_config: Record<string, unknown> | null;
}

export interface ServiceRequestPortalDefinitionDetail {
  definitionId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  description: string | null;
  icon: string | null;
  formSchema: Record<string, unknown>;
  initialValues: Record<string, string | boolean | null>;
  visibleFieldKeys: string[];
  executionProvider: string;
  executionConfig: Record<string, unknown>;
  formBehaviorProvider: string;
  formBehaviorConfig: Record<string, unknown>;
}

export async function getVisiblePublishedServiceRequestDefinitionDetail(
  knex: Knex,
  context: ServiceRequestPortalCatalogContext,
  definitionId: string
): Promise<ServiceRequestPortalDefinitionDetail | null> {
  const definition = (await knex('service_request_definitions')
    .where({
      tenant: context.tenant,
      definition_id: definitionId,
      lifecycle_state: 'published',
    })
    .first(
      'tenant',
      'definition_id',
      'name',
      'description',
      'icon',
      'category_id',
      'sort_order',
      'linked_service_id',
      'visibility_provider',
      'visibility_config'
    )) as PublishedDefinitionRow | undefined;

  if (!definition) {
    return null;
  }

  const visibilityProvider = getServiceRequestVisibilityProvider(definition.visibility_provider);
  if (!visibilityProvider) {
    return null;
  }

  const definitionForVisibility: Pick<ServiceRequestDefinitionShape, 'tenant' | 'metadata' | 'linkedServiceId'> = {
    tenant: definition.tenant,
    metadata: {
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      categoryId: definition.category_id,
      sortOrder: definition.sort_order,
    },
    linkedServiceId: definition.linked_service_id,
  };

  const canAccess = await visibilityProvider.canAccessDefinition(
    {
      tenant: context.tenant,
      requesterUserId: context.requesterUserId,
      clientId: context.clientId,
      contactId: context.contactId ?? null,
    },
    definitionForVisibility,
    definition.visibility_config ?? {}
  );
  if (!canAccess) {
    return null;
  }

  const latestVersion = (await knex('service_request_definition_versions')
    .where({
      tenant: context.tenant,
      definition_id: definitionId,
    })
    .orderBy('version_number', 'desc')
    .first(
      'version_id',
      'version_number',
      'name',
      'description',
      'icon',
      'form_schema_snapshot',
      'execution_provider',
      'execution_config',
      'form_behavior_provider',
      'form_behavior_config'
    )) as DefinitionVersionRow | undefined;

  if (!latestVersion) {
    return null;
  }

  const formBehaviorProvider = getServiceRequestFormBehaviorProvider(
    latestVersion.form_behavior_provider
  );
  if (!formBehaviorProvider) {
    return null;
  }

  const staticInitialValues = resolveStaticDefaultValues(latestVersion.form_schema_snapshot);
  const dynamicInitialValues = formBehaviorProvider.resolveInitialValues
    ? await formBehaviorProvider.resolveInitialValues(
        {
          tenant: context.tenant,
          requesterUserId: context.requesterUserId,
          clientId: context.clientId,
          contactId: context.contactId ?? null,
        },
        latestVersion.form_behavior_config ?? {}
      )
    : {};
  const resolvedInitialValues = {
    ...staticInitialValues,
    ...dynamicInitialValues,
  } as Record<string, string | boolean | null>;

  const visibleFieldKeys = formBehaviorProvider.resolveVisibleFieldKeys
    ? await formBehaviorProvider.resolveVisibleFieldKeys(
        {
          tenant: context.tenant,
          requesterUserId: context.requesterUserId,
          clientId: context.clientId,
          contactId: context.contactId ?? null,
        },
        latestVersion.form_schema_snapshot,
        resolvedInitialValues,
        latestVersion.form_behavior_config ?? {}
      )
    : Array.isArray((latestVersion.form_schema_snapshot as any)?.fields)
      ? ((latestVersion.form_schema_snapshot as any).fields as any[])
          .map((field) => (typeof field?.key === 'string' ? field.key : null))
          .filter((fieldKey): fieldKey is string => !!fieldKey)
      : [];

  return {
    definitionId,
    versionId: latestVersion.version_id,
    versionNumber: latestVersion.version_number,
    title: latestVersion.name,
    description: latestVersion.description,
    icon: latestVersion.icon,
    formSchema: latestVersion.form_schema_snapshot,
    initialValues: resolvedInitialValues,
    visibleFieldKeys,
    executionProvider: latestVersion.execution_provider,
    executionConfig: latestVersion.execution_config ?? {},
    formBehaviorProvider: latestVersion.form_behavior_provider,
    formBehaviorConfig: latestVersion.form_behavior_config ?? {},
  };
}
