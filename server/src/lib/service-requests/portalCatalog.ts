import type { Knex } from 'knex';
import { getServiceRequestVisibilityProvider } from './providers/registry';
import type { ServiceRequestDefinitionShape } from './domain';

interface PortalCatalogDefinitionRow {
  definition_id: string;
}

interface PortalCatalogDefinitionVersionRow {
  definition_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category_id: string | null;
  category_name_snapshot: string | null;
  sort_order: number;
  linked_service_id: string | null;
  visibility_provider: string;
  visibility_config: Record<string, unknown> | null;
}

export interface ServiceRequestPortalCatalogItem {
  definitionId: string;
  title: string;
  description: string | null;
  icon: string | null;
  categoryId: string | null;
  categoryName: string | null;
  sortOrder: number;
}

export interface ServiceRequestPortalCatalogGroup {
  category: string;
  items: ServiceRequestPortalCatalogItem[];
}

export interface ServiceRequestPortalCatalogContext {
  tenant: string;
  requesterUserId: string;
  clientId: string;
  contactId?: string | null;
}

export async function listVisibleServiceRequestCatalogItems(
  knex: Knex,
  context: ServiceRequestPortalCatalogContext
): Promise<ServiceRequestPortalCatalogItem[]> {
  const definitionRows = (await knex('service_request_definitions as definition')
    .where('definition.tenant', context.tenant)
    .whereNot('definition.lifecycle_state', 'archived')
    .whereExists(function publishedVersionExists() {
      this.select(knex.raw('1'))
        .from('service_request_definition_versions as version')
        .whereRaw('version.tenant = definition.tenant')
        .andWhereRaw('version.definition_id = definition.definition_id');
    })
    .select('definition.definition_id')) as PortalCatalogDefinitionRow[];

  if (definitionRows.length === 0) {
    return [];
  }

  const versionRows = (await knex('service_request_definition_versions')
    .where({ tenant: context.tenant })
    .whereIn(
      'definition_id',
      definitionRows.map((row) => row.definition_id)
    )
    .orderBy([
      { column: 'definition_id', order: 'asc' },
      { column: 'version_number', order: 'desc' },
    ])
    .select(
      'definition_id',
      'name',
      'description',
      'icon',
      'category_id',
      'category_name_snapshot',
      'sort_order',
      'linked_service_id',
      'visibility_provider',
      'visibility_config'
    )) as PortalCatalogDefinitionVersionRow[];

  const latestVersionByDefinitionId = new Map<string, PortalCatalogDefinitionVersionRow>();
  for (const row of versionRows) {
    if (!latestVersionByDefinitionId.has(row.definition_id)) {
      latestVersionByDefinitionId.set(row.definition_id, row);
    }
  }

  const visible: ServiceRequestPortalCatalogItem[] = [];

  for (const definitionRow of definitionRows) {
    const row = latestVersionByDefinitionId.get(definitionRow.definition_id);
    if (!row) {
      continue;
    }

    const visibilityProvider = getServiceRequestVisibilityProvider(row.visibility_provider);
    if (!visibilityProvider) {
      continue;
    }

    const definitionForVisibility: Pick<
      ServiceRequestDefinitionShape,
      'tenant' | 'metadata' | 'linkedServiceId'
    > = {
      tenant: context.tenant,
      metadata: {
        name: row.name,
        description: row.description,
        icon: row.icon,
        categoryId: row.category_id,
        sortOrder: row.sort_order,
      },
      linkedServiceId: row.linked_service_id,
    };

    const canAccess = await visibilityProvider.canAccessDefinition(
      {
        tenant: context.tenant,
        requesterUserId: context.requesterUserId,
        clientId: context.clientId,
        contactId: context.contactId ?? null,
      },
      definitionForVisibility,
      row.visibility_config ?? {}
    );

    if (!canAccess) {
      continue;
    }

    visible.push({
      definitionId: definitionRow.definition_id,
      title: row.name,
      description: row.description,
      icon: row.icon,
      categoryId: row.category_id,
      categoryName: row.category_name_snapshot,
      sortOrder: row.sort_order,
    });
  }

  return visible.sort((left, right) => {
    const leftCategory = left.categoryName ?? 'Other Services';
    const rightCategory = right.categoryName ?? 'Other Services';
    if (leftCategory !== rightCategory) {
      return leftCategory.localeCompare(rightCategory);
    }
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.title.localeCompare(right.title);
  });
}

export function groupServiceRequestCatalogItemsByCategory(
  items: ServiceRequestPortalCatalogItem[]
): ServiceRequestPortalCatalogGroup[] {
  const grouped = new Map<string, ServiceRequestPortalCatalogItem[]>();

  for (const item of items) {
    const category = item.categoryName ?? 'Other Services';
    const existing = grouped.get(category);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(category, [item]);
    }
  }

  return [...grouped.entries()].map(([category, groupedItems]) => ({
    category,
    items: groupedItems,
  }));
}
