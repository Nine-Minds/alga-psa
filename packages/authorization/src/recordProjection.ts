import { EXTENSION_TABLE_BY_ASSET_TYPE } from '@alga-psa/types';

function isResourceHidden(redactions: readonly string[], resources: readonly string[]): boolean {
  return redactions.some(redaction => {
    if (typeof redaction !== 'string') throw new TypeError('Invalid redaction decision');
    if (redaction === '*' || redaction === 'fields') return true;
    return resources.includes(redaction.startsWith('fields.') ? redaction.slice(7) : redaction);
  });
}

function isReadFieldHidden(redactions: readonly string[], names: readonly string[]): boolean {
  return redactions.some(redaction => {
    if (typeof redaction !== 'string') throw new TypeError('Invalid redaction decision');
    if (redaction === '*' || redaction === 'fields') return true;
    const path = redaction.startsWith('fields.') ? redaction.slice(7) : redaction;
    return names.some(name => path === name || path.startsWith(`${name}.`) || name.startsWith(`${path}.`));
  });
}

/**
 * Declarative description of one record kind for policy redaction: resource and identifier aliases,
 * plus the per-field alias tables a generic projector needs:
 *
 * - `resource`   aliases naming the whole resource (also the `table.` prefixes of its columns). Hidden => row suppressed.
 * - `identifier` aliases naming the identifier(s) that locate the row. Hidden => row suppressed.
 * - `fields`     EXTRA aliases for a field beyond the implicit `[name, values.name, <table>.name]`. Hidden => field omitted.
 * - `derived`    display values built from another source: field => source aliases or explicit source/field references.
 *                Dependencies follow other fields and child paths transitively; references retain the named source's scope.
 *                Hidden source (or hidden field) => field set to null, never dropped.
 * - `children`   nested arrays/objects projected with their own source, optionally selected by a parent discriminator.
 *                Suppressed array members are dropped; suppressed or unrecognized object variants become null.
 */
export interface RedactableRecordSource {
  readonly resource: readonly string[];
  readonly identifier: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly derived: Readonly<Record<string, readonly (string | RecordFieldReference)[]>>;
  readonly children?: Readonly<Record<string, RedactableRecordSource | RedactableRecordVariants>>;
  /** The original source of an alternate response shape (for example quote lines in a conversion preview). */
  readonly policySource?: RedactableRecordSource;
}

/** A value taken from a particular source, rather than from any representation of the same table. */
export interface RecordFieldReference {
  readonly source: RedactableRecordSource;
  readonly field: string;
}

/** A nested record's source selected by a discriminator on its parent (for example an asset's extension table). */
export interface RedactableRecordVariants {
  readonly discriminator: string;
  readonly variants: Readonly<Record<string, RedactableRecordSource>>;
}

function childSources(
  child: RedactableRecordSource | RedactableRecordVariants,
  parent?: Record<string, unknown>,
): readonly RedactableRecordSource[] {
  if (!('variants' in child)) return [child];
  // Dependency/predicate resolution without a row conservatively considers every declared variant.
  if (!parent) return Object.values(child.variants);
  const discriminator = parent[child.discriminator];
  return typeof discriminator === 'string' && Object.hasOwn(child.variants, discriminator)
    ? [child.variants[discriminator]]
    : [];
}


function recordFieldKey(source: RedactableRecordSource, alias: string): string | null {
  const table = source.resource.find(resource => alias.startsWith(`${resource}.`));
  return alias.startsWith('values.')
    ? alias.slice('values.'.length)
    : table
      ? alias.slice(table.length + 1)
      : alias.includes('.')
        ? null
        : alias;
}

/** Every spelling of a record field in its value and table namespaces. */
function recordFieldAliasForms(source: RedactableRecordSource, alias: string): readonly string[] {
  const field = recordFieldKey(source, alias);
  if (field === null) return [alias];
  return [alias, field, `values.${field}`, ...source.resource.map(resource => `${resource}.${field}`)];
}

function recordFieldDependencies(source: RedactableRecordSource, field: string): readonly (string | RecordFieldReference)[] {
  return [
    ...(Object.hasOwn(source.fields, field) ? source.fields[field] : []),
    ...(Object.hasOwn(source.derived, field) ? source.derived[field] : []),
  ];
}

function recordFieldLocalPath(source: RedactableRecordSource, alias: string): string {
  const field = recordFieldKey(source, alias);
  if (field !== null) return field;
  return alias.startsWith('values.') ? alias.slice('values.'.length) : alias;
}

function childRouteAliases(source: RedactableRecordSource, childKey: string, childSource: RedactableRecordSource): readonly string[] {
  const keys = Object.entries(source.children ?? {}).flatMap(([key, child]) =>
    childSources(child).includes(childSource) ? [key] : []);
  const routeKeys = keys.length > 0 ? keys : [childKey];
  return routeKeys.flatMap(key => [
    key,
    `values.${key}`,
    ...source.resource.map(resource => `${resource}.${key}`),
  ]);
}

/** Carries child field aliases into each parent response path that exposes that child. */
function composeChildAliases(
  source: RedactableRecordSource,
  childKey: string,
  childSource: RedactableRecordSource,
  nestedAliases: readonly string[],
): readonly string[] {
  const routes = childRouteAliases(source, childKey, childSource);
  return nestedAliases.flatMap(alias => {
    const localPath = recordFieldLocalPath(childSource, alias);
    return [alias, ...routes.map(route => `${route}.${localPath}`)];
  });
}

/** Adds the child-relative form of a nested alias while retaining its canonical spelling. */
function childScopedRedactions(
  redactions: readonly string[],
  source: RedactableRecordSource,
  childKey: string,
  childSource: RedactableRecordSource,
): readonly string[] {
  if (isRecordFieldExplicitlyHidden(redactions, recordFieldAliases(source, childKey))) return ['*'];
  const routes = childRouteAliases(source, childKey, childSource);
  const scoped = redactions.flatMap(redaction => {
    const path = redaction.startsWith('fields.') ? redaction.slice('fields.'.length) : redaction;
    return routes.flatMap(route => path.startsWith(`${route}.`) ? [path.slice(route.length + 1)] : []);
  });
  return scoped.length > 0 ? [...redactions, ...scoped] : redactions;
}

function isRecordFieldExplicitlyHidden(redactions: readonly string[], aliases: readonly string[]): boolean {
  return redactions.some(redaction => {
    if (redaction === '*' || redaction === 'fields') return true;
    const path = redaction.startsWith('fields.') ? redaction.slice('fields.'.length) : redaction;
    return aliases.includes(path);
  });
}

/** Resolve the dependency graph once per field, sharing its aliases with serialization and predicate guards. */
function resolveRecordFieldAliases(
  source: RedactableRecordSource, key: string, visiting: Map<RedactableRecordSource, Set<string>>,
): readonly string[] {
  const aliases = new Set<string>();
  const visit = (recordSource: RedactableRecordSource, field: string): void => {
    const fields = visiting.get(recordSource) ?? new Set<string>();
    if (fields.has(field)) return;
    fields.add(field);
    visiting.set(recordSource, fields);
    try {
      const pathSeparator = field.indexOf('.');
      if (pathSeparator > 0) {
        const childKey = field.slice(0, pathSeparator);
        const child = recordSource.children && Object.hasOwn(recordSource.children, childKey)
          ? recordSource.children[childKey]
          : undefined;
        if (child) {
          for (const childSource of childSources(child)) {
            const nestedAliases = resolveRecordFieldAliases(childSource, field.slice(pathSeparator + 1), visiting);
            composeChildAliases(recordSource, childKey, childSource, nestedAliases).forEach(alias => aliases.add(alias));
          }
          return;
        }
      }

      recordFieldAliasForms(recordSource, field).forEach(alias => aliases.add(alias));

      for (const dependency of recordFieldDependencies(recordSource, field)) {
        if (typeof dependency !== 'string') {
          visit(dependency.source, dependency.field);
          continue;
        }
        aliases.add(dependency);
        const ownField = recordFieldKey(recordSource, dependency);
        if (ownField !== null) {
          visit(recordSource, ownField);
          continue;
        }
        const separator = dependency.indexOf('.');
        const childKey = dependency.slice(0, separator);
        const child = recordSource.children && Object.hasOwn(recordSource.children, childKey)
          ? recordSource.children[childKey]
          : undefined;
        for (const childSource of child ? childSources(child) : []) {
          // A suppressed child cannot contribute to an aggregate, even when its numeric field itself is readable.
          // Do not add the resource root: that would make an unrelated sibling-field redaction hide the aggregate.
          const identifiers = childSource.identifier.flatMap(identifier => recordFieldAliasForms(childSource, identifier));
          composeChildAliases(recordSource, childKey, childSource, identifiers).forEach(alias => aliases.add(alias));
          const nestedAliases = resolveRecordFieldAliases(childSource, dependency.slice(separator + 1), visiting);
          composeChildAliases(recordSource, childKey, childSource, nestedAliases).forEach(alias => aliases.add(alias));
        }
      }
    } finally {
      fields.delete(field);
    }
  };
  visit(source, key);
  return [...aliases];
}

/** Every declared spelling of a field and its transitive source dependencies. */
export function recordFieldAliases(source: RedactableRecordSource, key: string): readonly string[] {
  return resolveRecordFieldAliases(source, key, new Map());
}

/** True when the row must not be served at all: the whole resource or an identifier is redacted. */
export function isRecordSuppressed(redactions: readonly string[], source: RedactableRecordSource): boolean {
  const identifierAliases = source.identifier.flatMap(identifier => recordFieldAliasForms(source, identifier));
  return isResourceHidden(redactions, source.resource) || isReadFieldHidden(redactions, identifierAliases);
}

/** One decision, retaining its source namespaces across nested, detached and alternate response shapes. */
export interface RecordProjectionPolicy {
  project<T extends Record<string, any>>(record: T, source: RedactableRecordSource): Partial<T> | null;
  readable(field: string, source: RedactableRecordSource): boolean;
}

/** Compose retained source-aware decisions so every policy must allow each serialized field. */
export function composeRecordProjectionPolicies(
  policies: readonly RecordProjectionPolicy[],
): RecordProjectionPolicy {
  if (policies.length === 0) {
    throw new Error('composeRecordProjectionPolicies requires at least one policy');
  }

  return {
    project<T extends Record<string, any>>(record: T, source: RedactableRecordSource): Partial<T> | null {
      let projected: Partial<T> | null = record;
      for (const policy of policies) {
        if (projected === null) return null;
        projected = policy.project(projected as T, source);
      }
      return projected;
    },
    readable: (field, source) => policies.every(policy => policy.readable(field, source)),
  };
}

function collectSourceRedactions(redactions: readonly string[], origin: RedactableRecordSource) {
  // Keep child suppression attached to its descriptor. Relationships and their parent both use `assets`,
  // so flattening a whole-child redaction into a table-wide rule would also suppress the parent.
  const scopes = new Map<RedactableRecordSource, Set<string>>();
  const pending = [{ source: origin, redactions }];
  while (pending.length > 0) {
    const next = pending.pop()!;
    const previous = scopes.get(next.source);
    if (previous && next.redactions.every(redaction => previous.has(redaction))) continue;
    const combined = new Set([...(previous ?? []), ...next.redactions]);
    scopes.set(next.source, combined);
    const scoped = [...combined];
    const suppressed = isRecordSuppressed(scoped, next.source);
    for (const [key, child] of Object.entries(next.source.children ?? {})) {
      for (const childSource of childSources(child)) {
        pending.push({
          source: childSource,
          redactions: suppressed ? ['*'] : childScopedRedactions(scoped, next.source, key, childSource),
        });
      }
    }
  }
  return scopes;
}

/** Compile the decision's source graph once; response shapes can then reuse it without losing parent-path rules. */
export function createRecordProjectionPolicy(
  redactions: readonly string[], origin: RedactableRecordSource,
): RecordProjectionPolicy {
  const sourceRedactions = [...redactions];
  // Resolve lazily so an invalid decision still fails closed inside readable(), while serialization throws.
  let scopes: ReturnType<typeof collectSourceRedactions> | undefined;
  const redactionsFor = (source: RedactableRecordSource): readonly string[] => {
    scopes ??= collectSourceRedactions(sourceRedactions, origin);
    const combined = new Set(sourceRedactions);
    const visited = new Set<RedactableRecordSource>();
    for (let current: RedactableRecordSource | undefined = source; current && !visited.has(current); current = current.policySource) {
      visited.add(current);
      scopes.get(current)?.forEach(redaction => combined.add(redaction));
    }
    return [...combined];
  };
  type VisitingFields = Map<RedactableRecordSource, Set<string>>;

  // Child paths carry their original scopes. Cross-source dependencies name their descriptor explicitly: table
  // aliases alone cannot distinguish unrelated representations such as an assignee and a comment author.
  const dependencyTarget = (dependency: string | RecordFieldReference, source: RedactableRecordSource) => {
    if (typeof dependency !== 'string') return dependency;
    const field = dependency;
    const local = recordFieldLocalPath(source, field);
    const first = local.split('.')[0];
    if (!local.includes('.') || Object.hasOwn(source.children ?? {}, first)) return { source, field: local };
    return null;
  };

  const dependenciesReadable = (
    field: string, source: RedactableRecordSource, inherited: readonly string[], visiting: VisitingFields,
  ): boolean => {
    const fields = visiting.get(source) ?? new Set<string>();
    // Cycles can express copied representations of the same value. Direct redactions are checked before this
    // guard, so revisiting an edge adds no information and cannot bypass a hidden member of the cycle.
    if (fields.has(field)) return true;
    fields.add(field);
    visiting.set(source, fields);
    try {
      return recordFieldDependencies(source, field).every(dependency => {
        const target = dependencyTarget(dependency, source);
        return !target || readable(target.field, target.source, target.source === source ? inherited : [], visiting);
      });
    } finally {
      fields.delete(field);
    }
  };

  const fieldReadable = (
    field: string, source: RedactableRecordSource, inherited: readonly string[], visiting: VisitingFields,
  ): boolean => {
    const scoped = [...new Set([...redactionsFor(source), ...inherited])];
    const aliases = recordFieldAliases(source, field);
    // Nested field decisions belong to the child. Only an explicit container decision or a declared dependency
    // hides the container itself; unrelated visible siblings must survive recursive projection.
    const hidden = Object.hasOwn(source.children ?? {}, field)
      ? isRecordFieldExplicitlyHidden(scoped, aliases)
      : isReadFieldHidden(scoped, aliases);
    return !hidden && dependenciesReadable(field, source, inherited, visiting);
  };

  const readable = (
    field: string, source: RedactableRecordSource, inherited: readonly string[], visiting: VisitingFields,
  ): boolean => {
    const scoped = [...new Set([...redactionsFor(source), ...inherited])];
    if (isRecordSuppressed(scoped, source)) return false;
    const local = recordFieldLocalPath(source, field);
    const separator = local.indexOf('.');
    const key = separator > 0 ? local.slice(0, separator) : local;
    const child = source.children && Object.hasOwn(source.children, key) ? source.children[key] : undefined;
    if (child && separator > 0) {
      if (!fieldReadable(key, source, inherited, visiting)) return false;
      return childSources(child).every(childSource => readable(
        local.slice(separator + 1), childSource, childScopedRedactions(scoped, source, key, childSource), visiting,
      ));
    }
    // A predicate over an entire container can inspect every descendant, even though serialization can retain
    // that container and strip individual children. Keep such predicates closed when any descendant is hidden.
    if (isReadFieldHidden(scoped, recordFieldAliases(source, local))) return false;
    return fieldReadable(local, source, inherited, visiting);
  };
  return {
    project: (record, source) => projectRecordWithPolicy(
      record, source, redactionsFor,
      (field, fieldSource, inherited) => fieldReadable(field, fieldSource, inherited, new Map()), [],
    ),
    readable(field, source) {
      try {
        return readable(field, source, [], new Map());
      } catch {
        return false;
      }
    },
  };
}

function projectRecordWithPolicy<T extends Record<string, any>>(
  record: T, source: RedactableRecordSource,
  redactionsFor: (source: RedactableRecordSource) => readonly string[],
  fieldReadable: (field: string, source: RedactableRecordSource, inherited: readonly string[]) => boolean,
  inherited: readonly string[],
): Partial<T> | null {
  const redactions = [...new Set([...redactionsFor(source), ...inherited])];
  if (isRecordSuppressed(redactions, source)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const child = source.children && Object.hasOwn(source.children, key) ? source.children[key] : undefined;
    if (!fieldReadable(key, source, inherited)) {
      if (Object.hasOwn(source.derived, key)) out[key] = null;
      continue;
    }
    const childSource = child ? childSources(child, record)[0] : undefined;
    if (child && !childSource) {
      // An unknown discriminator cannot identify the source aliases safely. Never return its raw data.
      out[key] = Array.isArray(value) ? [] : null;
    } else if (childSource && Array.isArray(value)) {
      const nestedRedactions = childScopedRedactions(redactions, source, key, childSource);
      out[key] = value.map(item => (item && typeof item === 'object' && !Array.isArray(item)
        ? projectRecordWithPolicy(item, childSource, redactionsFor, fieldReadable, nestedRedactions) : null)).filter(item => item !== null);
    } else if (childSource && value && typeof value === 'object') {
      const nestedRedactions = childScopedRedactions(redactions, source, key, childSource);
      out[key] = projectRecordWithPolicy(value as Record<string, any>, childSource, redactionsFor, fieldReadable, nestedRedactions);
    } else if (childSource) {
      // A declared child is a record, never an opaque scalar that can bypass its source policy.
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

/** Projects one record, omitting hidden fields, nulling hidden derived fields and suppressing hidden identifiers. */
export function projectRecordByRedactions<T extends Record<string, any>>(
  redactions: readonly string[], record: T, source: RedactableRecordSource,
): Partial<T> | null {
  return createRecordProjectionPolicy(redactions, source).project(record, source);
}

const ids = (...names: string[]) => names;

const ASSET_ROW_SOURCE: RedactableRecordSource = {
  resource: ['assets'],
  identifier: ids('asset_id', 'assets.asset_id', 'asset', 'assetId'),
  fields: {},
  derived: {
    client_name: ids('client_id', 'clients', 'clients.client_name'),
    vendor_name: ids('vendor_id', 'vendors'),
    contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
    warranty_status: ids('warranty_end_date'),
  },
};

const ASSET_CUSTODY_USER_SOURCE: RedactableRecordSource = {
  resource: ['users'],
  identifier: ids('user_id', 'users.user_id'),
  fields: {},
  derived: {},
};

const ASSET_CUSTODY_LOCATION_SOURCE: RedactableRecordSource = {
  resource: ['stock_locations'],
  identifier: ids('location_id', 'stock_locations.location_id'),
  fields: {},
  derived: {},
};

const ASSET_CUSTODY_TICKET_SOURCE: RedactableRecordSource = {
  resource: ['tickets'],
  identifier: ids('ticket_id', 'tickets.ticket_id'),
  fields: {},
  derived: {},
};

const ASSET_CUSTODY_CLIENT_SOURCE: RedactableRecordSource = {
  resource: ['clients'],
  identifier: ids('client_id', 'clients.client_id'),
  fields: {},
  derived: {},
};

/** Flattened relationship rows copy fields from the other asset in the relationship. */
export const ASSET_RELATIONSHIP_SOURCE: RedactableRecordSource = {
  resource: ['assets'],
  identifier: ids('related_asset_id', 'asset_id', 'assets.asset_id'),
  fields: {
    related_asset_name: recordFieldAliases(ASSET_ROW_SOURCE, 'name'),
  },
  derived: {},
};

export const ASSET_MAINTENANCE_SCHEDULE_SOURCE: RedactableRecordSource = {
  resource: ['asset_maintenance_schedules'],
  identifier: ids('schedule_id', 'asset_maintenance_schedules.schedule_id'),
  fields: {},
  derived: {
    created_by_name: ids('created_by', 'users', 'users.first_name', 'users.last_name'),
  },
};

/** Assignment history rows include a joined contact label. */
export const ASSET_ASSIGNMENT_SOURCE: RedactableRecordSource = {
  resource: ['asset_assignments'],
  identifier: ids('assignment_id', 'asset_assignments.assignment_id'),
  fields: {},
  derived: {
    contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
  },
};

/** Maintenance history contains free-form maintenance data and a joined performer label. */
export const ASSET_MAINTENANCE_HISTORY_SOURCE: RedactableRecordSource = {
  resource: ['asset_maintenance_history'],
  identifier: ids('history_id', 'asset_maintenance_history.history_id'),
  fields: {},
  derived: {
    performed_by_user_name: ids('performed_by', 'users', 'users.first_name', 'users.last_name'),
  },
};

const ASSET_EXTENSION_SOURCES: Readonly<Record<string, RedactableRecordSource>> = Object.fromEntries(
  Object.entries(EXTENSION_TABLE_BY_ASSET_TYPE).map(([type, table]) => [type, {
    resource: [table],
    identifier: ids('asset_id', `${table}.asset_id`),
    fields: {},
    derived: {},
  }]),
);

/** Asset document rows combine an association with document and external-file metadata. */
export const ASSET_DOCUMENT_SOURCE: RedactableRecordSource = {
  resource: ['documents', 'document_associations', 'external_files'],
  identifier: ids(
    'association_id',
    'document_associations.association_id',
    'document_id',
    'document_associations.document_id',
    'documents.document_id',
    'file_id',
    'external_files.file_id',
  ),
  fields: {},
  derived: {
    // The API filename prefers the uploaded file name and falls back to the document's own name.
    original_filename: ids('external_files.original_name', 'documents.document_name'),
    uploaded_at: ids('external_files.created_at', 'documents.entered_at', 'documents.updated_at'),
  },
};

export const ASSET_RECORD_SOURCE: RedactableRecordSource = {
  ...ASSET_ROW_SOURCE,
  derived: {
    ...ASSET_ROW_SOURCE.derived,
    extension_data: ids('asset_type'),
  },
  children: {
    extension_data: { discriminator: 'asset_type', variants: ASSET_EXTENSION_SOURCES },
    client: {
      resource: ['clients'],
      // The nested client is loaded through the asset's foreign key and copies its joined label. Compose the
      // parent aliases so hiding either representation also hides the same data inside the child record.
      identifier: [...ids('client_id', 'clients.client_id'), ...recordFieldAliases(ASSET_ROW_SOURCE, 'client_id')],
      fields: { client_name: recordFieldAliases(ASSET_ROW_SOURCE, 'client_name') },
      derived: {},
    },
    maintenance_schedules: ASSET_MAINTENANCE_SCHEDULE_SOURCE,
    relationships: ASSET_RELATIONSHIP_SOURCE,
    documents: ASSET_DOCUMENT_SOURCE,
  },
};

/** Custody episodes retain the asset policy and the ownership of joined holder labels. */
export const ASSET_CUSTODY_SOURCE: RedactableRecordSource = {
  policySource: ASSET_RECORD_SOURCE,
  resource: ['asset_custody'],
  identifier: [
    ...ids('custody_id', 'asset_custody.custody_id', 'asset_id', 'asset_custody.asset_id'),
    ...recordFieldAliases(ASSET_RECORD_SOURCE, 'asset_id'),
  ],
  fields: {},
  derived: {
    location_name: [
      'location_id', 'asset_custody.location_id',
      { source: ASSET_CUSTODY_LOCATION_SOURCE, field: 'name' },
    ],
    holder_name: [
      'holder_user_id', 'asset_custody.holder_user_id',
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'first_name' },
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'last_name' },
    ],
    ticket_number: [
      'ticket_id', 'asset_custody.ticket_id',
      { source: ASSET_CUSTODY_TICKET_SOURCE, field: 'ticket_number' },
    ],
  },
};

/** Custody events are independently suppressible and notes remain event-owned fields. */
export const ASSET_CUSTODY_EVENT_SOURCE: RedactableRecordSource = {
  policySource: ASSET_RECORD_SOURCE,
  resource: ['asset_custody_events'],
  identifier: [
    ...ids('event_id', 'asset_custody_events.event_id', 'custody_id', 'asset_custody_events.custody_id', 'asset_id', 'asset_custody_events.asset_id'),
    ...recordFieldAliases(ASSET_RECORD_SOURCE, 'asset_id'),
  ],
  fields: {},
  derived: {
    actor_name: [
      'actor_user_id',
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'first_name' },
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'last_name' },
    ],
    from_holder_name: [
      'from_holder_user_id',
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'first_name' },
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'last_name' },
    ],
    to_holder_name: [
      'to_holder_user_id',
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'first_name' },
      { source: ASSET_CUSTODY_USER_SOURCE, field: 'last_name' },
    ],
    from_location_name: [
      'from_location_id',
      { source: ASSET_CUSTODY_LOCATION_SOURCE, field: 'name' },
    ],
    to_location_name: [
      'to_location_id',
      { source: ASSET_CUSTODY_LOCATION_SOURCE, field: 'name' },
    ],
  },
};

/** Detached custody responses preserve the original asset, episode, and event decisions. */
export const ASSET_CUSTODY_RESPONSE_SOURCE: RedactableRecordSource = {
  policySource: ASSET_RECORD_SOURCE,
  resource: [],
  identifier: [],
  fields: {},
  derived: {},
  children: {
    open: ASSET_CUSTODY_SOURCE,
    episodes: ASSET_CUSTODY_SOURCE,
    events: ASSET_CUSTODY_EVENT_SOURCE,
  },
};

/** Custody writes copy the episode and event into a detached response envelope. */
export const ASSET_CUSTODY_MUTATION_RESPONSE_SOURCE: RedactableRecordSource = {
  ...ASSET_CUSTODY_RESPONSE_SOURCE,
  children: {
    custody: ASSET_CUSTODY_SOURCE,
    event: ASSET_CUSTODY_EVENT_SOURCE,
  },
};

/** Queue rows combine an episode with asset-owned and joined display values. */
export const ASSET_CUSTODY_QUEUE_SOURCE: RedactableRecordSource = {
  ...ASSET_CUSTODY_SOURCE,
  resource: [...ASSET_CUSTODY_SOURCE.resource, ...ASSET_RECORD_SOURCE.resource],
  fields: {
    ...ASSET_CUSTODY_SOURCE.fields,
    client_id: ids('client_id', 'asset_custody.client_id'),
  },
  derived: {
    ...ASSET_CUSTODY_SOURCE.derived,
    days_held: ['opened_at', 'asset_custody.opened_at'],
    asset_name: [{ source: ASSET_RECORD_SOURCE, field: 'name' }],
    asset_tag: [{ source: ASSET_RECORD_SOURCE, field: 'asset_tag' }],
    client_name: [
      'client_id', 'asset_custody.client_id',
      { source: ASSET_CUSTODY_CLIENT_SOURCE, field: 'client_name' },
    ],
  },
};

/** Stored block content is located by its own identity and the document it belongs to. */
export const DOCUMENT_BLOCK_CONTENT_SOURCE: RedactableRecordSource = {
  resource: ['document_block_content'],
  identifier: ids('content_id', 'document_id'),
  fields: {},
  derived: {},
};

const ASSET_NOTE_DOCUMENT_SOURCE: RedactableRecordSource = {
  ...ASSET_DOCUMENT_SOURCE,
  policySource: ASSET_DOCUMENT_SOURCE,
  // The note document is loaded through this asset reference, so hiding the
  // reference also suppresses the copied document identity and its contents.
  identifier: [...ASSET_DOCUMENT_SOURCE.identifier, ...recordFieldAliases(ASSET_RECORD_SOURCE, 'notes_document_id')],
};

/** Detached notes preserve the provenance of both their document and stored block content. */
export const ASSET_NOTE_RESPONSE_SOURCE: RedactableRecordSource = {
  policySource: ASSET_RECORD_SOURCE,
  resource: [],
  identifier: [],
  fields: {},
  derived: {
    blockData: ['document.document_id', { source: DOCUMENT_BLOCK_CONTENT_SOURCE, field: 'block_data' }],
    lastUpdated: [
      'document.document_id', 'document.updated_at',
      { source: DOCUMENT_BLOCK_CONTENT_SOURCE, field: 'updated_at' },
    ],
  },
  children: { document: ASSET_NOTE_DOCUMENT_SOURCE },
};
