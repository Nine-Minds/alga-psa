import { AUTOMATIC_DISCOUNT_MAPPING_ID } from '@alga-psa/types';

/** File-based QuickBooks adapters whose exports can create unmapped entities as new. */
export const QUICKBOOKS_FILE_ADAPTERS: readonly string[] = ['quickbooks_desktop', 'quickbooks_csv'];

export type UnmappedEntityType = 'client' | 'service' | 'discount';

export interface UnmappedQuickBooksEntity {
  algaEntityType: UnmappedEntityType;
  algaEntityId: string;
  algaName: string;
  /** 'product' for catalog products; null for services, clients and discounts. */
  itemKind: string | null;
  proposedName: string;
  maxNameLength: number;
}

export interface QuickBooksMappingDecision {
  algaEntityType: UnmappedEntityType;
  algaEntityId: string;
  externalName: string;
  /** 'create' adds it to QuickBooks as new; 'existing' links to a QuickBooks entry with this exact name. */
  mode: 'create' | 'existing';
}

const ERROR_ENTITY_TYPES: Record<string, UnmappedEntityType> = {
  missing_client_mapping: 'client',
  missing_service_mapping: 'service',
  missing_discount_mapping: 'discount'
};

// QuickBooks Desktop list-name limits (per ':'-separated segment); QuickBooks
// Online names allow 100 characters.
export function maxQuickBooksNameLength(adapterType: string, entityType: UnmappedEntityType): number {
  if (adapterType !== 'quickbooks_desktop') {
    return 100;
  }
  return entityType === 'client' ? 41 : 31;
}

/** A QuickBooks-safe default name: no separators or sub-list colons, cut to the limit. */
export function proposeQuickBooksName(algaName: string, maxLength: number): string {
  return algaName
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/:/g, '-')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

interface ErrorLike {
  code: string;
  resolution_state?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function collectUnmappedQuickBooksEntities(adapterType: string, errors: ErrorLike[]): UnmappedQuickBooksEntity[] {
  const byKey = new Map<string, UnmappedQuickBooksEntity>();
  for (const error of errors) {
    if (error.resolution_state && error.resolution_state !== 'open') continue;
    const entityType = ERROR_ENTITY_TYPES[error.code];
    if (!entityType) continue;

    const metadata = error.metadata ?? {};
    const algaEntityId =
      entityType === 'discount'
        ? AUTOMATIC_DISCOUNT_MAPPING_ID
        : typeof metadata.alga_entity_id === 'string'
          ? metadata.alga_entity_id
          : typeof metadata.service_id === 'string'
            ? metadata.service_id
            : typeof metadata.client_id === 'string'
              ? metadata.client_id
              : null;
    if (!algaEntityId) continue;

    const key = `${entityType}:${algaEntityId}`;
    if (byKey.has(key)) continue;

    const algaName =
      (typeof metadata.alga_name === 'string' && metadata.alga_name) ||
      (typeof metadata.service_name === 'string' && metadata.service_name) ||
      (typeof metadata.client_name === 'string' && metadata.client_name) ||
      (entityType === 'discount' ? 'Discount' : algaEntityId);
    const maxNameLength = maxQuickBooksNameLength(adapterType, entityType);

    byKey.set(key, {
      algaEntityType: entityType,
      algaEntityId,
      algaName,
      itemKind: typeof metadata.item_kind === 'string' ? metadata.item_kind : null,
      proposedName: proposeQuickBooksName(algaName, maxNameLength),
      maxNameLength
    });
  }
  return Array.from(byKey.values());
}

/** Returns a user-facing problem, or null when every decision can be saved. */
export function validateQuickBooksMappingDecisions(
  adapterType: string,
  pending: UnmappedQuickBooksEntity[],
  decisions: QuickBooksMappingDecision[]
): string | null {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return 'Choose how to handle at least one unmapped item.';
  }
  const pendingByKey = new Map(pending.map((entity) => [`${entity.algaEntityType}:${entity.algaEntityId}`, entity]));
  const createdNames = new Set<string>();
  const seen = new Set<string>();

  for (const decision of decisions) {
    const key = `${decision.algaEntityType}:${decision.algaEntityId}`;
    const entity = pendingByKey.get(key);
    if (!entity) {
      return 'One of the selected items is no longer unmapped for this batch. Refresh and try again.';
    }
    if (seen.has(key)) {
      return `"${entity.algaName}" was submitted twice.`;
    }
    seen.add(key);
    if (decision.mode !== 'create' && decision.mode !== 'existing') {
      return `Choose create or existing for "${entity.algaName}".`;
    }

    const name = typeof decision.externalName === 'string' ? decision.externalName.trim() : '';
    if (!name) {
      return `Enter a QuickBooks name for "${entity.algaName}".`;
    }
    if (/[\t\r\n"]/.test(name)) {
      return `The QuickBooks name for "${entity.algaName}" cannot contain tabs, line breaks or double quotes.`;
    }
    const maxLength = maxQuickBooksNameLength(adapterType, decision.algaEntityType);
    if (name.split(':').some((segment) => segment.length > maxLength)) {
      return `The QuickBooks name for "${entity.algaName}" is longer than ${maxLength} characters.`;
    }
    if (decision.mode === 'create') {
      // Customers and items are separate QuickBooks lists, so the same name may appear once in each.
      const nameKey = `${decision.algaEntityType === 'client' ? 'customer' : 'item'}:${name.toLowerCase()}`;
      if (createdNames.has(nameKey)) {
        return `"${name}" is used for more than one new QuickBooks entry.`;
      }
      createdNames.add(nameKey);
    }
  }
  return null;
}
