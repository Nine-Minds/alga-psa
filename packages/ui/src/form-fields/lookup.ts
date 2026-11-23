/**
 * The descriptor a `lookup` element carries, and the rules that keep it safe.
 *
 * A lookup is a data-sourced choice: its option set is not authored, it is resolved on the
 * server from an entity table inside a scope derived from the requester. The element stores
 * only `{ entity, scope, filters? }`; the stored answer is the entity id.
 *
 * Pure and dependency-free: the editor, the schema normalizer and the server validator all read
 * it. Resolving the options themselves is the server's job (`lookupFields.ts`) and never lives here.
 */

export type FieldLookupEntity = 'contact' | 'user';
export type FieldLookupScope = 'requester-client' | 'tenant';

export interface FieldLookupDescriptor {
  entity: FieldLookupEntity;
  /** Derived from the requester at submit/render time; never from client input. */
  scope: FieldLookupScope;
  /** Optional equality filters on the entity row; keys are checked against the entity's allowlist. */
  filters?: Record<string, string | boolean>;
}

/** One server-resolved choice for a lookup. */
export interface FieldLookupOption {
  id: string;
  label: string;
  secondaryLabel?: string;
}

/**
 * Which scopes each entity may use. `contact` is requester-client only: a tenant-wide contact
 * universe would let the client portal read other clients' people. A new entity adds an entry
 * here, its filter keys below, and an adapter in the server's `lookupFields.ts`.
 */
export const LOOKUP_ENTITY_SCOPES: Record<FieldLookupEntity, readonly FieldLookupScope[]> = {
  contact: ['requester-client'],
  user: ['tenant'],
};

/** Allowlisted filter columns per entity (equality, scalar values only). */
export const LOOKUP_ENTITY_FILTER_KEYS: Record<FieldLookupEntity, readonly string[]> = {
  contact: ['role', 'is_client_admin', 'work_arrangement'],
  user: [],
};

export const LOOKUP_ENTITIES = Object.keys(LOOKUP_ENTITY_SCOPES) as FieldLookupEntity[];

export function isLookupEntity(value: unknown): value is FieldLookupEntity {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOOKUP_ENTITY_SCOPES, value);
}

/** The scope an entity uses unless told otherwise. */
export function defaultLookupScope(entity: FieldLookupEntity): FieldLookupScope {
  return LOOKUP_ENTITY_SCOPES[entity][0];
}

/** A new lookup starts valid (first entity, its default scope) so the author only has to change it. */
export function defaultLookupDescriptor(): FieldLookupDescriptor {
  const entity = LOOKUP_ENTITIES[0];
  return { entity, scope: defaultLookupScope(entity) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps the author's descriptor as written (including unknown entities and non-scalar filters)
 * so validation can reject it; only a missing scope is defaulted, from the entity.
 */
export function normalizeLookupDescriptor(raw: unknown): FieldLookupDescriptor | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const entity = raw.entity as FieldLookupEntity;
  const fallbackScope = isLookupEntity(entity) ? defaultLookupScope(entity) : undefined;
  const lookup = {
    entity,
    scope: (typeof raw.scope === 'string' ? raw.scope : fallbackScope) as FieldLookupScope,
  } as FieldLookupDescriptor;
  if (raw.filters !== undefined && raw.filters !== null) {
    lookup.filters = raw.filters as FieldLookupDescriptor['filters'];
  }
  return lookup;
}

/** Everything wrong with a lookup element, as sentences that continue `Field "<key>" …`. */
export function validateLookupElement(element: {
  options?: unknown;
  defaultValue?: unknown;
  lookup?: unknown;
}): string[] {
  const errors: string[] = [];
  if (Array.isArray(element.options) && element.options.length > 0) {
    errors.push('is a lookup and cannot have static options');
  }
  if (element.defaultValue !== undefined && element.defaultValue !== null && element.defaultValue !== '') {
    errors.push('is a lookup and cannot have a default value');
  }

  const lookup = element.lookup as Partial<FieldLookupDescriptor> | undefined;
  if (!lookup || typeof lookup.entity !== 'string' || !lookup.entity) {
    errors.push('is a lookup and requires an entity');
    return errors;
  }
  if (!isLookupEntity(lookup.entity)) {
    errors.push(`has unsupported lookup entity "${String(lookup.entity)}"`);
    return errors;
  }
  if (!LOOKUP_ENTITY_SCOPES[lookup.entity].includes(lookup.scope as FieldLookupScope)) {
    errors.push(`cannot use scope "${String(lookup.scope)}" for entity "${lookup.entity}"`);
  }
  if (lookup.filters !== undefined) {
    if (!isPlainObject(lookup.filters)) {
      errors.push('lookup filters must be an object');
      return errors;
    }
    const allowedKeys = LOOKUP_ENTITY_FILTER_KEYS[lookup.entity];
    for (const [filterKey, filterValue] of Object.entries(lookup.filters)) {
      if (!allowedKeys.includes(filterKey)) {
        errors.push(`lookup filter "${filterKey}" is not supported for ${lookup.entity}`);
      } else if (typeof filterValue !== 'string' && typeof filterValue !== 'boolean') {
        errors.push(`lookup filter "${filterKey}" must be a string or boolean`);
      }
    }
  }
  return errors;
}
