/**
 * Minimal in-memory knex + tenantDb double for the co-managed domain tests.
 * There is no cheap real-Postgres harness for these tables yet (the L1a
 * migrations land with this card), so the domain code runs against this store.
 * It models exactly what the domain code uses: tenant scoping, equality/null
 * filters, ordering as a no-op, row-lock calls as no-ops (recorded), unique keys
 * (so a duplicate event is an error, as in Postgres) and transaction rollback.
 */
type Row = Record<string, any>;
const uniqueKeys: Record<string, string[]> = {
  co_management_relationship_events: ['tenant', 'relationship_id', 'revision', 'event_type'],
  co_managed_allocations: ['tenant', 'operation_id'],
  co_managed_provisioning_operations: ['tenant', 'operation_id'],
  co_management_relationships: ['tenant', 'relationship_id'],
  co_management_ticket_work: ['tenant', 'relationship_id', 'ticket_id'],
  co_management_ticket_handoffs: ['tenant', 'operation_id'],
  co_management_command_receipts: ['tenant', 'operation_id'],
  co_managed_ticket_references: ['tenant', 'customer_tenant', 'relationship_id', 'ticket_id'],
};
/** jsonb columns come back from Postgres as objects; the domain code writes them as JSON strings. */
const jsonColumns: Record<string, string[]> = {
  co_managed_meeting_creation_operations: ['approval_input', 'creation_target', 'provider_request', 'event_receipt'],
};
const insertDefaults: Record<string, Row> = {
  co_managed_meeting_creation_operations: { attempt_count: 0, event_receipt: null, provider_meeting_id: null, meeting_id: null, external_attempted_at: null, completed_at: null, last_error_code: null },
};
const decodeJson = (table: string, row: Row) => {
  for (const key of jsonColumns[table] ?? []) if (typeof row[key] === 'string') row[key] = JSON.parse(row[key]);
  return row;
};
const NOW = '2026-10-27T00:00:00.000Z';
const col = (name: string) => name.split('.').pop()!;

export class FakeStore {
  tables: Record<string, Row[]> = {};
  locks: string[] = [];
  rows(table: string) { return (this.tables[table] ??= []); }
  seed(table: string, ...rows: Row[]) { this.rows(table).push(...rows.map(row => ({ ...row }))); }
}

export function fakeDb(store: FakeStore): any {
  const raw = (sql: string) => ({ __raw: sql });
  const db: any = (table: string) => makeBuilder(store, table, undefined);
  db.isTransaction = true;
  db.fn = { now: () => NOW };
  db.raw = raw;
  db.transaction = async (work: (trx: any) => Promise<unknown>) => {
    const snapshot = structuredClone(store.tables);
    try { return await work(db); } catch (error) { store.tables = snapshot; throw error; }
  };
  db.from = db;
  return db;
}

function makeBuilder(store: FakeStore, table: string, tenant: string | undefined) {
  const name = table.split(' as ')[0];
  const filters: Array<(row: Row) => boolean> = [];
  if (tenant) filters.push(row => row.tenant === tenant);
  const selected = () => store.rows(name).filter(row => filters.every(f => f(row)));
  const builder: any = {
    where(a: any, b?: any, c?: any) {
      if (typeof a === 'function') return builder;
      if (c !== undefined) {
        const cmp: Record<string, (x: any, y: any) => boolean> = { '>': (x, y) => x > y, '<=': (x, y) => x <= y, '<': (x, y) => x < y, '>=': (x, y) => x >= y };
        // A raw SQL operand (clock_timestamp() etc.) is not interpreted: treat the bound as already reached.
        filters.push(row => c && typeof c === 'object' && '__raw' in c ? true : cmp[b](row[col(a)], c)); return builder;
      }
      if (typeof a === 'object') for (const [k, v] of Object.entries(a)) filters.push(row => row[col(k)] === v);
      else filters.push(row => row[col(a)] === b);
      return builder;
    },
    whereNot(a: string, b: unknown) { filters.push(row => row[col(a)] !== b); return builder; },
    whereNull(a: string) { filters.push(row => row[col(a)] == null); return builder; },
    whereNotNull(a: string) { filters.push(row => row[col(a)] != null); return builder; },
    whereIn(a: string, values: unknown[]) { filters.push(row => values.includes(row[col(a)])); return builder; },
    forUpdate() { store.locks.push(`${tenant}:${name}:update`); return builder; },
    forNoKeyUpdate() { store.locks.push(`${tenant}:${name}:no-key-update`); return builder; },
    forShare() { store.locks.push(`${tenant}:${name}:share`); return builder; },
    /** Raw SQL predicates are not interpreted; tests seed no rows that rely on them. */
    whereRaw() { return builder; },
    orderBy() { return builder; },
    select() { return builder; },
    async first() { const row = selected()[0]; return row ? { ...row } : undefined; },
    /** Awaitable (row count) and `.returning()`-able, like knex. */
    update(patch: Row) {
      const rows = selected();
      for (const row of rows) for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && '__raw' in v) { if (/revision \+ 1/.test(v.__raw)) row[k] = Number(row[k]) + 1; else row[k] = v.__raw; }
        else row[k] = v;
      }
      for (const row of rows) decodeJson(name, row);
      return Object.assign(Promise.resolve(rows.length), { returning: async () => rows.map(row => ({ ...row })) });
    },
    async del() {
      const rows = selected();
      store.tables[name] = store.rows(name).filter(row => !rows.includes(row));
      return rows.length;
    },
    insert(input: Row | Row[]) {
      const list = Array.isArray(input) ? input : [input];
      let onConflict: string[] | undefined, wantRows = false, done: Promise<unknown> | undefined;
      const run = () => {
        const inserted: Row[] = [];
        for (const item of list) {
          const key = onConflict ?? uniqueKeys[name];
          if (key && store.rows(name).some(row => key.every(k => row[k] === item[k]))) {
            if (onConflict) continue;
            throw new Error(`duplicate key value violates unique constraint on ${name}`);
          }
          const stored = decodeJson(name, { ...insertDefaults[name], ...item });
          store.rows(name).push(stored);
          inserted.push({ ...stored });
        }
        return wantRows ? inserted : inserted.length;
      };
      const op: any = {
        onConflict(cols: string[]) { onConflict = cols; return { ignore: () => op }; },
        returning() { wantRows = true; return op; },
        then(resolve: any, reject: any) {
          done ??= new Promise(res => res(run()));
          return done.then(resolve, reject);
        },
      };
      return op;
    },
    then(resolve: any, reject: any) { return Promise.resolve(selected().map(row => ({ ...row }))).then(resolve, reject); },
  };
  return builder;
}

/** Same surface as the real `tenantDb` for the calls the domain code makes. */
export function fakeTenantDb(db: any, tenant: string) {
  const store: FakeStore = db.__store;
  return {
    tenant,
    table: (table: string) => makeBuilder(store, table, tenant),
    unscoped: (table: string) => makeBuilder(store, table, undefined),
  };
}
export function createFake(): { store: FakeStore; db: any } {
  const store = new FakeStore();
  const db = fakeDb(store);
  db.__store = store;
  return { store, db };
}
