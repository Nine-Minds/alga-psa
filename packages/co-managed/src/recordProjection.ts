import {
  CO_MANAGED_ASSIGNEE_NAME_ALIASES,
  CO_MANAGED_PHASE_FIELD_SOURCE,
  CO_MANAGED_PROJECT_FIELD_SOURCE,
  CO_MANAGED_TASK_FIELD_SOURCE,
  isCoManagedResourceHidden,
  type CoManagedFieldSource,
} from './sharedWorkProjection';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { EXTENSION_TABLE_BY_ASSET_TYPE } from '@alga-psa/types';

/**
 * Declarative description of one record kind for policy redaction. Same shape as `CoManagedFieldSource`
 * (resource / identifier) plus the per-field alias tables a generic projector needs:
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

/** Builds a descriptor from an existing co-managed source, mapping its title/description onto the row's column names. */
export function recordSourceFromCoManaged(
  source: CoManagedFieldSource,
  columns: { title?: string; description?: string },
  rest: Pick<RedactableRecordSource, 'derived'> & Partial<Pick<RedactableRecordSource, 'fields' | 'children'>>,
): RedactableRecordSource {
  // Resource and identifier aliases (`projects`, `project_id`, ...) hide the WHOLE row here (suppression). Left in a
  // field's list they would also match every sibling path (`projects.description` => `projects`), so a field-level
  // redaction would wrongly take the title with it.
  const wholeRow = new Set([...source.resource, ...source.identifier]);
  const fieldOnly = (aliases: readonly string[]) => aliases.filter(alias => !wholeRow.has(alias));
  return {
    resource: source.resource,
    identifier: source.identifier,
    fields: {
      ...(columns.title ? { [columns.title]: fieldOnly(source.title) } : {}),
      ...(columns.description ? { [columns.description]: fieldOnly(source.description) } : {}),
      ...rest.fields,
    },
    derived: rest.derived,
    children: rest.children,
  };
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
  return isCoManagedResourceHidden(redactions, source.resource) || isCoManagedReadFieldHidden(redactions, identifierAliases);
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
      : isCoManagedReadFieldHidden(scoped, aliases);
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
    if (isCoManagedReadFieldHidden(scoped, recordFieldAliases(source, local))) return false;
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
const quoteItemSources = (...fields: string[]) => fields.flatMap(field => [field, `quote_items.${field}`]);

export const PROJECT_TASK_CHECKLIST_ITEM_SOURCE: RedactableRecordSource = {
  resource: ['task_checklist_items'],
  identifier: ids('checklist_item_id', 'task_checklist_items.checklist_item_id'),
  fields: {},
  derived: {},
};

/** Project phases use the shared canonical source aliases for description and parent/project identifiers. */
export const PROJECT_PHASE_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_PHASE_FIELD_SOURCE, { title: 'phase_name', description: 'description' }, { derived: {} },
);

export const PROJECT_STATUS_MAPPING_SOURCE: RedactableRecordSource = {
  resource: ['project_status_mappings'],
  identifier: ids('project_status_mapping_id', 'project_status_mappings.project_status_mapping_id'),
  fields: {},
  derived: {
    status_name: ids('custom_name', 'status_id', 'statuses', 'statuses.name', 'standard_status_id', 'standard_statuses', 'standard_statuses.name'),
    name: ids('custom_name', 'status_id', 'statuses', 'statuses.name', 'standard_status_id', 'standard_statuses', 'standard_statuses.name'),
    is_closed: ids('status_id', 'statuses', 'standard_status_id', 'standard_statuses'),
  },
};

const PROJECT_TASK_SERVICE_DEPENDENCIES: readonly (string | RecordFieldReference)[] = [
  'service_id', 'phase_id', 'project_id', 'projects.service_id',
  { source: PROJECT_PHASE_RECORD_SOURCE, field: 'service_id' },
];

/** Project task responses retain task column and relationship aliases across project-scoped endpoints. */
export const PROJECT_TASK_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_TASK_FIELD_SOURCE, { title: 'task_name', description: 'description' }, {
    derived: {
      assigned_user_name: ids('assigned_to', 'users', 'users.first_name', 'users.last_name'),
      status_name: ['project_status_mapping_id', { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'status_name' }],
      is_closed: ['project_status_mapping_id', { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'is_closed' }],
      phase_name: ['phase_id', { source: PROJECT_PHASE_RECORD_SOURCE, field: 'phase_name' }],
      project_name: ids('project_id', 'projects', 'projects.project_name'),
      client_id: ids('project_id', 'projects.client_id'),
      effective_service_id: PROJECT_TASK_SERVICE_DEPENDENCIES,
      service_source: PROJECT_TASK_SERVICE_DEPENDENCIES,
      service_name: [...PROJECT_TASK_SERVICE_DEPENDENCIES, 'service_catalog', 'service_catalog.service_name'],
    },
    children: { checklist_items: PROJECT_TASK_CHECKLIST_ITEM_SOURCE },
  });

export const PROJECT_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_PROJECT_FIELD_SOURCE, { title: 'project_name', description: 'description' }, {
    derived: {
      status_name: ids('status', 'statuses'),
      client_name: ids('client_id', 'clients', 'clients.client_name'),
      contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
      assigned_user_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
    },
    children: {
      tasks: PROJECT_TASK_RECORD_SOURCE,
      phases: PROJECT_PHASE_RECORD_SOURCE,
      status_mappings: PROJECT_STATUS_MAPPING_SOURCE,
    },
  });

/**
 * The ticket-side link endpoint returns a flattened row assembled from project,
 * phase, task and task-status records. Keep those copied values attached to
 * their owning descriptors so the retained project policy can redact or
 * suppress each source independently.
 */
export const TICKET_PROJECT_LINK_SOURCE: RedactableRecordSource = {
  policySource: PROJECT_RECORD_SOURCE,
  resource: ['project_ticket_links'],
  identifier: ids('link_id', 'project_ticket_links.link_id'),
  fields: {},
  derived: {
    project_id: [{ source: PROJECT_RECORD_SOURCE, field: 'project_id' }],
    project_name: ['project_id', { source: PROJECT_RECORD_SOURCE, field: 'project_name' }],
    project_number: ['project_id', { source: PROJECT_RECORD_SOURCE, field: 'project_number' }],
    phase_id: [{ source: PROJECT_PHASE_RECORD_SOURCE, field: 'phase_id' }],
    phase_name: ['phase_id', { source: PROJECT_PHASE_RECORD_SOURCE, field: 'phase_name' }],
    task_id: [{ source: PROJECT_TASK_RECORD_SOURCE, field: 'task_id' }],
    task_name: ['task_id', { source: PROJECT_TASK_RECORD_SOURCE, field: 'task_name' }],
    project_status_mapping_id: [
      'task_id',
      { source: PROJECT_TASK_RECORD_SOURCE, field: 'project_status_mapping_id' },
      { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'project_status_mapping_id' },
    ],
    status_name: [
      'task_id',
      { source: PROJECT_TASK_RECORD_SOURCE, field: 'project_status_mapping_id' },
      { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'status_name' },
    ],
    is_closed: [
      'task_id',
      { source: PROJECT_TASK_RECORD_SOURCE, field: 'project_status_mapping_id' },
      { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'is_closed' },
    ],
    task_updated_at: ['task_id', { source: PROJECT_TASK_RECORD_SOURCE, field: 'updated_at' }],
  },
};

export const TICKET_DOCUMENT_SOURCE: RedactableRecordSource = {
  resource: ['documents', 'document_associations'],
  identifier: ids(
    'document_id', 'documents.document_id',
    'document_associations.document_id', 'association_id', 'document_associations.association_id',
  ),
  fields: {},
  derived: {
    created_by_full_name: ids('created_by', 'users', 'users.first_name', 'users.last_name'),
    association_created_at: ids('document_associations.created_at'),
    type_name: ids(
      'type_id', 'documents.type_id', 'document_types', 'document_types.type_id', 'document_types.type_name',
      'shared_type_id', 'documents.shared_type_id', 'shared_document_types', 'shared_document_types.type_id',
      'shared_document_types.type_name',
    ),
    type_icon: ids(
      'type_id', 'documents.type_id', 'document_types', 'document_types.type_id', 'document_types.icon',
      'shared_type_id', 'documents.shared_type_id', 'shared_document_types', 'shared_document_types.type_id',
      'shared_document_types.icon',
    ),
  },
};

/** Storage metadata is another representation of the document, including the storage fallback fields. */
export const TICKET_DOCUMENT_DOWNLOAD_SOURCE: RedactableRecordSource = {
  policySource: TICKET_DOCUMENT_SOURCE,
  resource: [...TICKET_DOCUMENT_SOURCE.resource, 'external_files'],
  identifier: TICKET_DOCUMENT_SOURCE.identifier,
  fields: {
    fileName: ids('document_name', 'file_id', 'external_files.file_id', 'external_files.original_name'),
    mimeType: ids('mime_type', 'file_id', 'external_files.file_id', 'external_files.mime_type'),
  },
  derived: {},
};

function ticketDocumentVariantSource(fileIdField: string): RedactableRecordSource {
  return {
    ...TICKET_DOCUMENT_DOWNLOAD_SOURCE,
    fields: {
      fileId: ids(fileIdField, 'file_id', 'external_files.file_id'),
      mimeType: ids('mime_type', 'fileId', 'external_files.mime_type'),
    },
  };
}

export const TICKET_DOCUMENT_VARIANT_SOURCES = {
  thumbnail: ticketDocumentVariantSource('thumbnail_file_id'),
  preview: ticketDocumentVariantSource('preview_file_id'),
} as const;

/** Detached ticket comments retain the comment row's source, including rendered text derived from `note`. */
export const TICKET_COMMENT_SOURCE: RedactableRecordSource = {
  resource: ['comments'],
  identifier: ids('comment_id', 'comments.comment_id'),
  fields: {
    user_id: ids('created_by'),
    contact_id: ids('author_contact_id'),
  },
  derived: {
    comment_text: ids('note', 'comments.note'),
    comment_html: ids('note', 'comments.note'),
    markdown_content: ids('note', 'comments.note'),
    created_by: ids('user_id', 'users.user_id'),
    created_by_name: ids('user_id', 'users', 'users.first_name', 'users.last_name', 'users.email', 'contact_id', 'contacts', 'metadata'),
    created_by_avatar_url: ids('user_id', 'users'),
    author_contact_id: ids('contact_id', 'contacts.contact_name_id'),
    author_contact_name: ids('author_contact_id', 'contacts', 'contacts.full_name'),
    author_contact_email: ids('author_contact_id', 'contacts', 'contacts.email'),
    reactions: ids('comment_id', 'comment_reactions'),
    reaction_user_names: ids('comment_id', 'comment_reactions', 'users'),
    email_recipients: ids('metadata'),
  },
};

/** Detached material rows keep their table aliases and the joined service name dependency. */
export const TICKET_MATERIAL_SOURCE: RedactableRecordSource = {
  resource: ['ticket_materials'],
  identifier: ids('ticket_material_id', 'ticket_materials.ticket_material_id', 'values.ticket_materials.ticket_material_id'),
  fields: {},
  derived: {
    service_name: ids('service_id', 'service_catalog', 'service_catalog.service_name'),
    sku: ids('service_id', 'service_catalog', 'service_catalog.sku'),
  },
};

export const TICKET_CHECKLIST_ITEM_SOURCE: RedactableRecordSource = {
  resource: ['ticket_checklist_items'],
  identifier: ids('checklist_item_id', 'ticket_checklist_items.checklist_item_id', 'values.ticket_checklist_items.checklist_item_id'),
  fields: {},
  derived: {
    completed_by_name: ids('completed_by', 'users', 'users.first_name', 'users.last_name', 'users.username'),
  },
};

export const TICKET_EXTERNAL_LINK_SOURCE: RedactableRecordSource = {
  resource: ['external_entity_links'],
  identifier: ids('link_id', 'external_entity_links.link_id', 'values.external_entity_links.link_id'),
  fields: {},
  derived: {
    // These values are rendered from the external system definition and link identifiers, not independent fields.
    url: ids('system', 'external_id', 'external_parent_id', 'realm', 'tenant_external_systems'),
    display: ids('system', 'external_id', 'external_parent_id', 'realm', 'tenant_external_systems'),
    actor: ids('actor_id', 'users'),
  },
};

export const TICKET_WATCHER_SOURCE: RedactableRecordSource = {
  resource: ['ticket_watchers'],
  identifier: ids('entity_id', 'ticket_watchers.entity_id'),
  fields: {},
  derived: {
    name: ids('entity_type', 'entity_id', 'users', 'users.first_name', 'users.last_name', 'contacts', 'contacts.full_name'),
  },
};

export const TICKET_TIME_ENTRY_SOURCE: RedactableRecordSource = {
  resource: ['time_entries'],
  identifier: ids('entry_id', 'time_entries.entry_id'),
  fields: {},
  derived: {
    is_own: ids('user_id'),
    user_name: ids('user_id', 'users', 'users.first_name', 'users.last_name'),
    service_name: ids('service_id', 'service_catalog', 'service_catalog.service_name'),
  },
};

/** The stored watch list is a mirror of the same watcher records returned by the detached endpoint. */
const TICKET_ATTRIBUTES_SOURCE: RedactableRecordSource = {
  resource: ['tickets.attributes'],
  identifier: [],
  fields: {},
  derived: {},
  children: { watch_list: TICKET_WATCHER_SOURCE },
};

const TICKET_PRIMARY_AGENT_SOURCE: RedactableRecordSource = {
  resource: ['users'],
  // The primary agent object exists only because tickets.assigned_to exists. Hiding that source suppresses the
  // representation as a whole, including its copied user_id.
  identifier: ids('user_id', 'assigned_to', 'tickets.assigned_to', 'values.assigned_to', 'fields.tickets.assigned_to'),
  fields: {},
  derived: {
    first_name: ids('tickets.assigned_to', 'users.first_name'),
    last_name: ids('tickets.assigned_to', 'users.last_name'),
    email: ids('tickets.assigned_to', 'users.email'),
  },
};

const TICKET_ADDITIONAL_AGENT_SOURCE: RedactableRecordSource = {
  resource: ['ticket_resources'],
  identifier: ids('assignment_id', 'ticket_resources.assignment_id', 'additional_user_id', 'ticket_resources.additional_user_id', 'user_id', 'users.user_id'),
  fields: {},
  derived: {
    first_name: ids('additional_user_id', 'users.first_name'),
    last_name: ids('additional_user_id', 'users.last_name'),
    email: ids('additional_user_id', 'users.email'),
  },
};

/** Agent service response is an alternate ticket representation, projected under the ticket's original decision. */
export const TICKET_AGENT_RESPONSE_SOURCE: RedactableRecordSource = {
  resource: ['tickets'],
  identifier: ids('ticket_id', 'tickets.ticket_id'),
  fields: {},
  derived: {},
  children: {
    primary_agent: TICKET_PRIMARY_AGENT_SOURCE,
    additional_agents: TICKET_ADDITIONAL_AGENT_SOURCE,
  },
};

export const TICKET_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['tickets'],
  identifier: ids('ticket_id', 'tickets.ticket_id', 'ticket', 'ticketId'),
  fields: {},
  derived: {
    client_name: ids('client_id', 'clients', 'clients.client_name'),
    client_email: ids('client_id', 'location_id', 'client_locations'),
    client_phone: ids('client_id', 'location_id', 'client_locations'),
    location_name: ids('location_id', 'client_locations'),
    location_address: ids('location_id', 'client_locations'),
    contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
    contact_email: ids('contact_name_id', 'contacts'),
    contact_phone: ids('contact_name_id', 'contacts'),
    status_name: ids('status_id', 'statuses'),
    status_is_closed: ids('status_id', 'statuses'),
    priority_name: ids('priority_id', 'priorities'),
    category_name: ids('category_id', 'subcategory_id', 'categories'),
    subcategory_name: ids('subcategory_id'),
    board_name: ids('board_id'),
    entered_by_name: ids('entered_by'),
    description_html: ids('attributes'),
    assigned_to_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
    bundle_master_ticket_number: ids('master_ticket_id'),
    contact_avatar_url: ids('contact_name_id'),
    client_logo_url: ids('client_id'),
  },
  children: {
    attributes: TICKET_ATTRIBUTES_SOURCE,
    documents: TICKET_DOCUMENT_SOURCE,
    comments: TICKET_COMMENT_SOURCE,
    materials: TICKET_MATERIAL_SOURCE,
    checklist: TICKET_CHECKLIST_ITEM_SOURCE,
    external_links: TICKET_EXTERNAL_LINK_SOURCE,
    watchers: TICKET_WATCHER_SOURCE,
    time_entries: TICKET_TIME_ENTRY_SOURCE,
    // The service names its response keys `additional_agents` / `primary_agent`; these nested sources are also
    // used by the detached agents endpoint below.
    primary_agent: TICKET_PRIMARY_AGENT_SOURCE,
    additional_agents: TICKET_ADDITIONAL_AGENT_SOURCE,
  },
};

const TICKET_TIME_ENTRY_COUNT_DEPENDENCIES = ids(
  'entries.entry_id', 'entries.user_id',
);
const TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES = ids(
  ...TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
  'entries.start_time', 'entries.end_time', 'entries.billable_duration',
);

/** Ticket time-entry summaries are calculated from their visible entry set. */
export const TICKET_TIME_ENTRIES_RESPONSE_SOURCE: RedactableRecordSource = {
  policySource: TICKET_RECORD_SOURCE,
  resource: [],
  identifier: [],
  fields: {},
  derived: {
    ownTotalMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    ownEntryCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    othersTotalMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    othersEntryCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    othersVisibleMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    othersVisibleCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    othersHiddenMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    othersHiddenCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    totalMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
  },
  children: { entries: TICKET_TIME_ENTRY_SOURCE },
};

/** An external-link lookup is another ticket representation with one detached link. */
export const TICKET_EXTERNAL_LINK_LOOKUP_SOURCE: RedactableRecordSource = {
  ...TICKET_RECORD_SOURCE,
  policySource: TICKET_RECORD_SOURCE,
  children: { link: TICKET_EXTERNAL_LINK_SOURCE },
};

export const QUOTE_LINE_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['quote_items'],
  identifier: ids('quote_item_id', 'quote_items.quote_item_id'),
  fields: {},
  derived: {
    // Discount rows resolve against selected bases and their item/service targets before totals are persisted.
    total_price: ids('unit_price', 'quantity', 'discount_type', 'discount_percentage',
      'applies_to_item_id', 'applies_to_service_id', 'service_id', 'is_optional', 'is_selected', 'is_discount'),
    net_amount: ids('total_price', 'is_optional', 'is_selected', 'is_discount'),
    tax_amount: ids('total_price', 'tax_rate', 'is_taxable', 'tax_region', 'location_id', 'is_optional', 'is_selected', 'is_discount'),
  },
};

/** Quote-conversion preview lines preserve the quote-item source and its calculated price dependencies. */
export const QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE: RedactableRecordSource = {
  policySource: QUOTE_LINE_RECORD_SOURCE,
  resource: ['quote_items'],
  identifier: ids('quote_item_id', 'quote_items.quote_item_id'),
  fields: {
    // Discount preview rows can rebuild unit_price from allocated quote discount amounts.
    unit_price: quoteItemSources(
      'unit_price', 'quantity', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
      'discount_type', 'discount_percentage', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
  },
  derived: {
    // Preview prices can be copied, discounted, or rebuilt from allocated quote discounts.
    total_price: quoteItemSources(
      'unit_price', 'quantity', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
      'discount_type', 'discount_percentage', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
    location_name: ids('location_id', 'client_locations'),
    target: quoteItemSources('is_optional', 'is_selected', 'is_recurring', 'is_discount', 'service_id'),
    reason: quoteItemSources('description', 'service_name', 'service_id', 'is_optional', 'is_selected', 'is_recurring', 'is_discount'),
  },
};

/** A carried recurring discount is still derived from the quote item that funds it. */
export const QUOTE_CONVERSION_PREVIEW_DISCOUNT_SOURCE: RedactableRecordSource = {
  policySource: QUOTE_LINE_RECORD_SOURCE,
  resource: ['quote_items'],
  identifier: ids('quote_item_id', 'line_quote_item_id', 'quote_items.quote_item_id'),
  fields: {},
  derived: {
    description: quoteItemSources('description', 'service_name'),
    line_description: quoteItemSources('description', 'service_name'),
    discount_type: quoteItemSources(
      'discount_type', 'discount_percentage', 'unit_price', 'quantity', 'is_optional', 'is_selected',
      'is_recurring', 'is_discount', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
    amount: quoteItemSources(
      'unit_price', 'quantity', 'discount_type', 'discount_percentage', 'is_optional', 'is_selected',
      'is_recurring', 'is_discount', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
    percentage: quoteItemSources('discount_percentage', 'discount_type'),
    billing_frequency: quoteItemSources('billing_frequency'),
  },
};

const QUOTE_ACTIVITY_METADATA_SOURCE: RedactableRecordSource = {
  resource: [],
  identifier: [],
  fields: { comment: [] },
  derived: {},
};

/** Quote audit rows keep the activity table namespace; approval comments are copied into both metadata and description. */
export const QUOTE_ACTIVITY_SOURCE: RedactableRecordSource = {
  resource: ['quote_activities'],
  identifier: ids('activity_id', 'quote_activities.activity_id'),
  fields: {},
  derived: {
    metadata: ids('description', 'quote_activities.description'),
    description: ids('metadata', 'metadata.comment', 'quote_activities.metadata.comment'),
  },
  children: { metadata: QUOTE_ACTIVITY_METADATA_SOURCE },
};

/** Quotes are read under the kernel's `billing` resource, so a whole-`billing` redaction hides the quote too. */
export const QUOTE_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['quotes', 'billing'],
  identifier: ids('quote_id', 'quotes.quote_id', 'quote', 'quoteId'),
  fields: {},
  derived: {
    client_name: ids('client_id', 'clients', 'clients.client_name'),
    contact_name: ids('contact_id', 'contacts'),
    // Stored header amounts are aggregates of quote lines; resolve their declared line dependencies even on lists
    // that do not load the items. This also carries line-price redactions through total_amount -> subtotal -> lines.
    subtotal: ids('quote_items.total_price'),
    discount_total: ids('quote_items.total_price'),
    tax: ids('quote_items.tax_amount'),
    total_amount: ids('subtotal', 'discount_total', 'tax'),
    optional_subtotal: ids('quote_items.total_price'),
    optional_tax: ids('quote_items.tax_amount'),
    optional_total: ids('optional_subtotal', 'optional_tax'),
    accepted_by_name: ids('accepted_by'),
    display_quote_number: ids('quote_number', 'version'),
  },
  children: {
    items: QUOTE_LINE_RECORD_SOURCE,
    quote_items: QUOTE_LINE_RECORD_SOURCE,
    activities: QUOTE_ACTIVITY_SOURCE,
  },
};

/** Nested quote-conversion response shape, projected under the quote's original authorization decision. */
export const QUOTE_CONVERSION_PREVIEW_SOURCE: RedactableRecordSource = {
  ...QUOTE_RECORD_SOURCE,
  policySource: QUOTE_RECORD_SOURCE,
  derived: {
    ...QUOTE_RECORD_SOURCE.derived,
    available_actions: ids(
      ...quoteItemSources(
        'is_optional', 'is_selected', 'is_recurring', 'is_discount', 'service_id',
        'quantity', 'unit_price', 'discount_percentage', 'discount_type',
      ),
      'sales_orders',
    ),
    invoice_error: ids(
      ...quoteItemSources(
        'service_id', 'quantity', 'unit_price', 'discount_percentage', 'discount_type',
        'is_optional', 'is_selected', 'is_recurring', 'is_discount', 'applies_to_item_id', 'applies_to_service_id',
      ),
      'sales_orders.so_id', 'sales_orders.so_number',
    ),
    contract_blocked_reason: quoteItemSources(
      'description', 'service_id', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
    ),
    contract_blocked_item_description: ids('description', 'quote_items.description'),
    contract_monthly_before_discounts: quoteItemSources(
      'unit_price', 'quantity', 'billing_frequency', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
    ),
    contract_monthly_total: quoteItemSources(
      'unit_price', 'quantity', 'billing_frequency', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
      'discount_type', 'discount_percentage', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
  },
  children: {
    ...QUOTE_RECORD_SOURCE.children,
    contract_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    invoice_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    sales_order_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    excluded_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    contract_discounts: QUOTE_CONVERSION_PREVIEW_DISCOUNT_SOURCE,
    existing_sales_order: {
      resource: ['sales_orders'],
      identifier: ids('so_id', 'sales_orders.so_id'),
      fields: {},
      derived: {},
    },
  },
};

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

/**
 * Predicate-side counterpart of `projectRecordByRedactions`: true when `field` (a response key such as `description`
 * or the derived `client_name`) may take part in a search or filter for a reader with `redactions`. It resolves
 * through the very same aliases the projector uses (`recordFieldAliases`), so canonical aliases and derived fields
 * that depend on a hidden source are excluded exactly when the projector would omit or null them.
 *
 * Fails closed: a suppressed record kind, or any redaction entry that cannot be interpreted, makes the field
 * unreadable. Without this, `?search=` over a hidden column returns the row and confirms the substring exists.
 */
export function isRecordFieldReadable(
  redactions: readonly string[], source: RedactableRecordSource, field: string): boolean {
  return createRecordProjectionPolicy(redactions, source).readable(field, source);
}
