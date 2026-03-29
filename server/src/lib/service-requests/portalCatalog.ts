import type { Knex } from 'knex';
import { getServiceRequestVisibilityProvider } from './providers/registry';
import type { ServiceRequestDefinitionShape } from './domain';

interface PortalCatalogDefinitionRow {
  tenant: string;
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
  const rows = (await knex('service_request_definitions')
    .where({
      tenant: context.tenant,
      lifecycle_state: 'published',
    })
    .orderBy([
      { column: 'category_name_snapshot', order: 'asc', nulls: 'last' },
      { column: 'sort_order', order: 'asc' },
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
      'visibility_provider',
      'visibility_config'
    )) as PortalCatalogDefinitionRow[];

  const visible: ServiceRequestPortalCatalogItem[] = [];

  for (const row of rows) {
    const visibilityProvider = getServiceRequestVisibilityProvider(row.visibility_provider);
    if (!visibilityProvider) {
      continue;
    }

    const definitionForVisibility: Pick<
      ServiceRequestDefinitionShape,
      'tenant' | 'metadata' | 'linkedServiceId'
    > = {
      tenant: row.tenant,
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
      definitionId: row.definition_id,
      title: row.name,
      description: row.description,
      icon: row.icon,
      categoryId: row.category_id,
      categoryName: row.category_name_snapshot,
      sortOrder: row.sort_order,
    });
  }

  return visible;
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
