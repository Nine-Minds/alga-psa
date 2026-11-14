/** Pure validation of versioned record projections. This does not authorize
 * collection, authenticate a package, or imply that deferred sections exist. */
export type PortableRecordReference = readonly [table: string, column: string, parent: string, parentColumn: string];
export interface PortableRecordSchema {
  columns: Readonly<Record<string, readonly string[]>>;
  identities?: Readonly<Record<string, readonly string[]>>;
  valueTypes?: Readonly<Record<string, Readonly<Record<string, 'uuid' | 'text' | 'integer'>>>>;
  references?: readonly PortableRecordReference[];
  counts?: Readonly<Record<string, { min?: number; max?: number }>>;
}
export type PortableRecords = Record<string, Record<string, unknown>[]>;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) &&
  typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function valid(value: unknown, type = 'uuid'): boolean {
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'text') return typeof value === 'string' && value.length > 0;
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function key(value: unknown, type = 'uuid') {
  return type === 'uuid' && typeof value === 'string' ? value.toLowerCase() : value;
}

export function validatePortableRecordSection(input: unknown, schema: PortableRecordSchema): asserts input is PortableRecords {
  if (!object(input) || !sameKeys(input, Object.keys(schema.columns))) throw new Error('Incomplete portable record tables');
  const records = input as PortableRecords;
  for (const [table, columns] of Object.entries(schema.columns)) {
    const rows = records[table], limits = schema.counts?.[table];
    if (!Array.isArray(rows) || rows.length < (limits?.min ?? 0) || rows.length > Math.min(limits?.max ?? 100_000, 100_000)) throw new Error('Invalid portable record count');
    const identity = schema.identities?.[table] ?? columns.slice(0, 1);
    const ids = new Set<string>();
    for (const row of rows) {
      if (!object(row) || !sameKeys(row, columns)) throw new Error('Invalid portable record columns');
      if (!identity.length) continue;
      if (identity.some(column => !valid(row[column], schema.valueTypes?.[table]?.[column]))) throw new Error('Invalid portable record identity');
      const id = JSON.stringify(identity.map(column => key(row[column], schema.valueTypes?.[table]?.[column])));
      if (ids.has(id)) throw new Error('Duplicate portable workspace record identity');
      ids.add(id);
    }
  }
  validatePortableRecordReferences(records, schema.references ?? [], schema.valueTypes, false);
}

/** The assembler uses requireParents=true after combining all sections. UUID
 * normalization matches PostgreSQL identity semantics, including mixed case. */
export function validatePortableRecordReferences(records: PortableRecords, references: readonly PortableRecordReference[],
  valueTypes: PortableRecordSchema['valueTypes'] = {}, requireParents = true): void {
  const indexes = new Map<string, Set<unknown>>();
  for (const [table, column, parent, parentColumn] of references) {
    if (!Object.hasOwn(records, table)) throw new Error('Portable reference source is missing');
    const type = valueTypes?.[table]?.[column];
    if (records[table].some(row => row[column] !== null && !valid(row[column], type))) throw new Error('Invalid portable record reference');
    if (!Object.hasOwn(records, parent)) {
      if (requireParents) throw new Error('Portable reference section is missing');
      continue;
    }
    const indexKey = JSON.stringify([parent, parentColumn, type ?? 'uuid']);
    let ids = indexes.get(indexKey);
    if (!ids) {
      ids = new Set(records[parent].map(row => key(row[parentColumn], type)));
      indexes.set(indexKey, ids);
    }
    if (records[table].some(row => row[column] !== null && !ids.has(key(row[column], type)))) throw new Error('Portable record reference is missing');
  }
}
