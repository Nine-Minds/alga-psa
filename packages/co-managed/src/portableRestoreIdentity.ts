import { randomUUID } from 'node:crypto';
import { validatePortableRecordSection, validatePortableRecordReferences,
  type PortableRecordSchema, type PortableRecords } from './portableRecordValidation';

type IdentityValue = string | number;
type IdentityType = 'uuid' | 'text' | 'integer';
export interface PortableRestoreIdentityDomain {
  table: string;
  column: string;
  /** Local UUIDs allocate. Global catalogs use mappings resolved against the
   * destination's semantic definitions. Natural text/integer keys may preserve. */
  strategy: 'allocate' | 'preserve' | 'provided';
  destinationBySource?: Readonly<Record<string, IdentityValue>>;
}
export interface PortableRestoreQualifiedActor {
  table: string;
  tenantColumn: string;
  userColumn: string;
  localUsers: readonly [table: string, column: string];
}
export interface PortableRestoreIdentitySchema extends PortableRecordSchema {
  identityDomains: readonly PortableRestoreIdentityDomain[];
  qualifiedActors?: readonly PortableRestoreQualifiedActor[];
}
export interface PortableRestoreIdentityMap {
  table: string;
  column: string;
  valueType: IdentityType;
  mappings: Array<{ source: IdentityValue; destination: IdentityValue }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const address = (table: string, column: string) => JSON.stringify([table, column]);
const typeAt = (schema: PortableRecordSchema, table: string, column: string): IdentityType => schema.valueTypes?.[table]?.[column] ?? 'uuid';
function normalized(value: unknown, type: IdentityType): IdentityValue {
  if (type === 'integer' && Number.isSafeInteger(value)) return value as number;
  if (type === 'text' && typeof value === 'string' && value.length) return value;
  if (type === 'uuid' && typeof value === 'string' && uuid.test(value)) return value.toLowerCase();
  throw new Error('Invalid portable restore identity');
}

/** Pure internal transformation of an already authenticated complete manifest.
 * The trusted restore adapter supplies explicit identity/reference metadata.
 * This function does not create a destination, users, sessions, permissions or
 * trust, authorize an import, or rewrite arbitrary authored JSON/notes. */
export function remapCoManagedPortableIdentity(input: unknown, inputSchema: PortableRestoreIdentitySchema, options: {
  sourceTenant: string;
  destinationTenant: string;
  allocateUuid?: () => string;
}): { sourceTenant: string; destinationTenant: string; records: PortableRecords; domains: PortableRestoreIdentityMap[] } {
  const sourceTenant = normalized(options.sourceTenant, 'uuid') as string;
  const destinationTenant = normalized(options.destinationTenant, 'uuid') as string;
  if (sourceTenant === destinationTenant) throw new Error('Portable restore requires an isolated destination tenant');
  // The allocator is an internal injection point. Snapshot input and metadata
  // first so even an injected allocator cannot change the transformation terms.
  const schema = structuredClone(inputSchema), records = structuredClone(input) as PortableRecords;
  validatePortableRecordSection(records, schema);
  validatePortableRecordReferences(records, schema.references ?? [], schema.valueTypes, true);
  const allocate = options.allocateUuid ?? randomUUID;
  const domains = new Map<string, PortableRestoreIdentityDomain>();
  const aliases = new Map<string, readonly [string, string]>();
  const claimed = new Set<string>();
  const checkColumn = (table: string, column: string) => {
    if (!Object.hasOwn(schema.columns, table) || !schema.columns[table].includes(column)) throw new Error('Unknown portable restore identity column');
  };
  for (const domain of schema.identityDomains) {
    checkColumn(domain.table, domain.column);
    const key = address(domain.table, domain.column);
    if (domains.has(key) || !['allocate', 'preserve', 'provided'].includes(domain.strategy)) throw new Error('Ambiguous portable restore identity domain');
    if (domain.strategy === 'allocate' && typeAt(schema, domain.table, domain.column) !== 'uuid') throw new Error('Only local UUID identities can allocate');
    domains.set(key, domain); claimed.add(key);
  }
  for (const [table, column, parent, parentColumn] of schema.references ?? []) {
    checkColumn(table, column); checkColumn(parent, parentColumn);
    const key = address(table, column);
    if (claimed.has(key)) throw new Error('Ambiguous portable restore identity reference');
    if (typeAt(schema, table, column) !== typeAt(schema, parent, parentColumn)) throw new Error('Portable restore reference types do not match');
    aliases.set(key, [parent, parentColumn]); claimed.add(key);
  }
  const resolved = new Map<string, string>();
  const resolveDomain = (table: string, column: string, visited = new Set<string>()): string => {
    const key = address(table, column);
    if (domains.has(key)) return key;
    if (resolved.has(key)) return resolved.get(key)!;
    if (visited.has(key)) throw new Error('Portable restore reference has no identity root');
    visited.add(key);
    const target = aliases.get(key);
    if (!target) throw new Error('Portable restore identity mapping is missing');
    const root = resolveDomain(target[0], target[1], visited); resolved.set(key, root); return root;
  };
  for (const [table, column] of aliases.values()) resolveDomain(table, column);
  for (const [table, columns] of Object.entries(schema.columns)) {
    for (const column of schema.identities?.[table] ?? columns.slice(0, 1)) resolveDomain(table, column);
  }
  for (const actor of schema.qualifiedActors ?? []) {
    checkColumn(actor.table, actor.tenantColumn); checkColumn(actor.table, actor.userColumn);
    for (const column of [actor.tenantColumn, actor.userColumn]) {
      const key = address(actor.table, column);
      if (claimed.has(key)) throw new Error('Qualified historical identity cannot also be a local reference');
      claimed.add(key);
    }
    const root = domains.get(resolveDomain(...actor.localUsers))!;
    if (typeAt(schema, root.table, root.column) !== 'uuid') throw new Error('Historical actors require a local UUID user domain');
  }

  const maps = new Map<string, Map<IdentityValue, IdentityValue>>();
  const sourceIds = new Set<string>([sourceTenant, destinationTenant]);
  const allocated = new Set<string>();
  for (const domain of domains.values()) {
    const type = typeAt(schema, domain.table, domain.column);
    if (type === 'uuid') for (const row of records[domain.table]) sourceIds.add(normalized(row[domain.column], type) as string);
    if (type === 'uuid' && domain.strategy === 'provided' && domain.destinationBySource) {
      for (const value of Object.values(domain.destinationBySource)) sourceIds.add(normalized(value, type) as string);
    }
  }
  for (const actor of schema.qualifiedActors ?? []) for (const row of records[actor.table]) {
    sourceIds.add(normalized(row[actor.tenantColumn], 'uuid') as string);
    if (row[actor.userColumn] !== null) sourceIds.add(normalized(row[actor.userColumn], 'uuid') as string);
  }
  const output: PortableRestoreIdentityMap[] = [];
  for (const [key, domain] of domains) {
    const type = typeAt(schema, domain.table, domain.column);
    const sources = new Set(records[domain.table].map(row => normalized(row[domain.column], type)));
    const provided = new Map<IdentityValue, IdentityValue>();
    if (domain.strategy === 'provided') {
      if (!domain.destinationBySource || typeof domain.destinationBySource !== 'object' || Array.isArray(domain.destinationBySource)) throw new Error('Destination catalog mapping is required');
      for (const [raw, destination] of Object.entries(domain.destinationBySource)) {
        const source = normalized(type === 'integer' ? Number(raw) : raw, type);
        if (provided.has(source) || !sources.has(source)) throw new Error('Unexpected destination catalog mapping');
        provided.set(source, normalized(destination, type));
      }
      if (provided.size !== sources.size) throw new Error('Destination catalog mapping is incomplete');
    } else if (domain.destinationBySource !== undefined) throw new Error('Unexpected destination catalog mapping');
    const mapping = new Map<IdentityValue, IdentityValue>(), destinations = new Set<IdentityValue>();
    for (const source of sources) {
      const destination = domain.strategy === 'allocate' ? normalized(allocate(), 'uuid')
        : domain.strategy === 'preserve' ? source : provided.get(source)!;
      if (destinations.has(destination)) throw new Error('Portable restore identities collide');
      if (type === 'uuid' && (destination === sourceTenant || destination === destinationTenant)) throw new Error('Portable restore identity collides with a tenant namespace');
      if (domain.strategy === 'allocate') {
        if (sourceIds.has(destination as string) || allocated.has(destination as string)) throw new Error('Portable restore allocated identity collides');
        allocated.add(destination as string);
      }
      mapping.set(source, destination); destinations.add(destination);
    }
    maps.set(key, mapping);
    output.push({ table: domain.table, column: domain.column, valueType: type,
      mappings: [...mapping].map(([source, destination]) => ({ source, destination })) });
  }
  const lookup = (table: string, column: string, value: unknown): IdentityValue => {
    const root = resolveDomain(table, column), domain = domains.get(root)!;
    const source = normalized(value, typeAt(schema, domain.table, domain.column));
    const result = maps.get(root)!.get(source);
    if (result === undefined) throw new Error('Portable restore reference mapping is missing');
    return result;
  };
  for (const actor of schema.qualifiedActors ?? []) for (const row of records[actor.table]) {
    const tenant = normalized(row[actor.tenantColumn], 'uuid');
    const user = row[actor.userColumn] === null ? null : normalized(row[actor.userColumn], 'uuid');
    if (tenant !== sourceTenant || user === null) continue;
    const users = maps.get(resolveDomain(...actor.localUsers))!;
    if (!users.has(user)) continue; // Deleted local authors remain an inert original pair.
    row[actor.tenantColumn] = destinationTenant; row[actor.userColumn] = users.get(user)!;
  }
  // Every lookup reads source values; no guessed *_id scanning or recursive
  // substitutions can rewrite a foreign actor, a note, or a workflow literal.
  for (const [key, domain] of domains) for (const row of records[domain.table]) {
    row[domain.column] = maps.get(key)!.get(normalized(row[domain.column], typeAt(schema, domain.table, domain.column)))!;
  }
  for (const [table, column, parent, parentColumn] of schema.references ?? []) for (const row of records[table]) {
    if (row[column] !== null) row[column] = lookup(parent, parentColumn, row[column]);
  }
  validatePortableRecordSection(records, schema);
  validatePortableRecordReferences(records, schema.references ?? [], schema.valueTypes, true);
  return { sourceTenant, destinationTenant, records, domains: output };
}
