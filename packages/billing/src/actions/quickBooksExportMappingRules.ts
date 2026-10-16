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

/** A user-facing validation problem, localized at the server-action boundary. */
export interface QuickBooksMappingProblem {
  message: string;
  /** Key under the msp/billing namespace. */
  key: string;
  params?: Record<string, string | number>;
}

const MESSAGE_KEY_PREFIX = 'errors.accountingExport.quickbooksMapping';
const problem = (
  key: string,
  message: string,
  params?: Record<string, string | number>
): QuickBooksMappingProblem => ({ key: `${MESSAGE_KEY_PREFIX}.${key}`, message, ...(params ? { params } : {}) });

/** Returns a user-facing problem, or null when every decision can be saved. */
export function validateQuickBooksMappingDecisions(
  adapterType: string,
  pending: UnmappedQuickBooksEntity[],
  decisions: QuickBooksMappingDecision[]
): QuickBooksMappingProblem | null {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return problem('noDecisions', 'Choose how to handle at least one unmapped item.');
  }
  const pendingByKey = new Map(pending.map((entity) => [`${entity.algaEntityType}:${entity.algaEntityId}`, entity]));
  const createdNames = new Set<string>();
  const mappedNames = new Set<string>();
  const seen = new Set<string>();

  for (const decision of decisions) {
    const key = `${decision.algaEntityType}:${decision.algaEntityId}`;
    const entity = pendingByKey.get(key);
    if (!entity) {
      return problem('stale', 'One of the selected items is no longer unmapped for this batch. Refresh and try again.');
    }
    const algaName = entity.algaName;
    if (seen.has(key)) {
      return problem('duplicateSubmission', `"${algaName}" was submitted twice.`, { algaName });
    }
    seen.add(key);
    if (decision.mode !== 'create' && decision.mode !== 'existing') {
      return problem('invalidMode', `Choose create or existing for "${algaName}".`, { algaName });
    }

    const name = typeof decision.externalName === 'string' ? decision.externalName.trim() : '';
    if (!name) {
      return problem('nameRequired', `Enter a QuickBooks name for "${algaName}".`, { algaName });
    }
    if (/[\t\r\n"]/.test(name)) {
      return problem(
        'nameInvalidCharacters',
        `The QuickBooks name for "${algaName}" cannot contain tabs, line breaks or double quotes.`,
        { algaName }
      );
    }
    const maxLength = maxQuickBooksNameLength(adapterType, decision.algaEntityType);
    if (name.split(':').some((segment) => segment.length > maxLength)) {
      return problem(
        'nameTooLong',
        `The QuickBooks name for "${algaName}" is longer than ${maxLength} characters.`,
        { algaName, maxLength }
      );
    }
    if (decision.mode === 'create') {
      // Customers and items are separate QuickBooks lists, so the same name may appear once in each.
      const nameKey = `${decision.algaEntityType === 'client' ? 'customer' : 'item'}:${name.toLowerCase()}`;
      if (createdNames.has(nameKey)) {
        return problem('duplicateNewName', `"${name}" is used for more than one new QuickBooks entry.`, { qbName: name });
      }
      createdNames.add(nameKey);
    }
    // Mappings are one Alga entity per QuickBooks name within an entity type
    // (idx_unique_external_mapping), whether the entry is new or existing.
    const mappedKey = `${decision.algaEntityType}:${name}`;
    if (mappedNames.has(mappedKey)) {
      return decision.algaEntityType === 'client'
        ? problem(
            'duplicateClientName',
            `"${name}" is chosen for more than one client. Each QuickBooks name can be mapped to only one.`,
            { qbName: name }
          )
        : problem(
            'duplicateItemName',
            `"${name}" is chosen for more than one item. Each QuickBooks name can be mapped to only one.`,
            { qbName: name }
          );
    }
    mappedNames.add(mappedKey);
  }
  return null;
}

export interface ExistingQuickBooksMappingRow {
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
}

/**
 * A decision whose QuickBooks name is already mapped to a different Alga
 * entity of the same type would violate idx_unique_external_mapping. Returns a
 * user-facing problem for the first such clash, or null.
 */
export function findQuickBooksNameConflict(
  pending: UnmappedQuickBooksEntity[],
  decisions: QuickBooksMappingDecision[],
  existing: ExistingQuickBooksMappingRow[],
  storedEntityType: (type: UnmappedEntityType) => string
): QuickBooksMappingProblem | null {
  for (const decision of decisions) {
    const name = decision.externalName.trim();
    const owner = existing.find(
      (row) =>
        row.alga_entity_type === storedEntityType(decision.algaEntityType) &&
        row.external_entity_id === name &&
        row.alga_entity_id !== decision.algaEntityId
    );
    if (owner) {
      const entity = pending.find(
        (item) => item.algaEntityType === decision.algaEntityType && item.algaEntityId === decision.algaEntityId
      );
      const params = { qbName: name, algaName: entity?.algaName ?? decision.algaEntityId };
      return decision.algaEntityType === 'client'
        ? problem(
            'nameTakenByClient',
            `"${name}" is already mapped to another client, so it cannot also be used for "${params.algaName}". Choose a different QuickBooks name, or change the existing mapping in the QuickBooks mappings.`,
            params
          )
        : problem(
            'nameTakenByItem',
            `"${name}" is already mapped to another item, so it cannot also be used for "${params.algaName}". Choose a different QuickBooks name, or change the existing mapping in the QuickBooks mappings.`,
            params
          );
    }
  }
  return null;
}
