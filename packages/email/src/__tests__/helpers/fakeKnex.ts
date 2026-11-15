/**
 * Minimal in-memory stand-in for the knex surface the on-wire Message-ID code uses
 * (where/whereIn/whereNotNull/whereRaw/orderBy/limit/select/first/forUpdate/update/transaction).
 * Every row carries a `tenant`; `tenantDb` is mocked as `conn(table).where({ tenant })`, so a query that
 * forgets the tenant would match another tenant's rows and fail the cross-tenant assertions.
 */
export type Row = Record<string, any>;
export type FakeTables = Record<string, Row[]>;

export function createFakeKnex(tables: FakeTables, rawFilters: Record<string, (row: Row) => boolean> = {}) {
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  function builder(table: string) {
    const predicates: Array<(row: Row) => boolean> = [];
    let order: Array<[string, 'asc' | 'desc']> = [];
    let max = Infinity;
    let selected: string[] = [];

    const matching = () => {
      let rows = (tables[table] ?? []).filter((row) => predicates.every((p) => p(row)));
      for (const [col, dir] of [...order].reverse()) {
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'asc' ? 1 : -1));
      }
      return rows.slice(0, max);
    };
    const project = (row: Row, cols: string[]) =>
      cols.length === 0 ? clone(row) : Object.fromEntries(cols.map((c) => [c, clone(row[c])]));

    const b: any = {
      where(arg: any, opOrVal?: any, val?: any) {
        if (typeof arg === 'object') {
          predicates.push((row) => Object.entries(arg).every(([k, v]) => row[k] === v));
        } else if (val !== undefined) {
          predicates.push((row) => (opOrVal === '>' ? row[arg] > val : row[arg] === val));
        } else {
          predicates.push((row) => row[arg] === opOrVal);
        }
        return b;
      },
      whereIn(col: string, values: any[]) {
        predicates.push((row) => values.includes(row[col]));
        return b;
      },
      whereNotNull(col: string) {
        predicates.push((row) => row[col] != null);
        return b;
      },
      whereRaw(sql: string) {
        const key = Object.keys(rawFilters).find((k) => sql.includes(k));
        if (!key) throw new Error(`fakeKnex: unsupported whereRaw: ${sql}`);
        predicates.push(rawFilters[key]);
        return b;
      },
      orderBy(col: string, dir: 'asc' | 'desc' = 'asc') {
        order.push([col, dir]);
        return b;
      },
      limit(n: number) {
        max = n;
        return b;
      },
      forUpdate: () => b,
      select(...cols: string[]) {
        selected = cols.flatMap((c) => c.split(',')).filter(Boolean);
        return b;
      },
      first(...cols: string[]) {
        const row = matching()[0];
        return Promise.resolve(row ? project(row, cols.length ? cols : selected) : undefined);
      },
      update(patch: Row) {
        const rows = matching();
        for (const row of rows) Object.assign(row, clone(patch));
        return Promise.resolve(rows.length);
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(matching().map((row) => project(row, selected))).then(resolve, reject);
      },
    };
    return b;
  }

  const knex: any = (table: string) => builder(table);
  knex.transaction = async (cb: (trx: any) => Promise<unknown>) => cb(knex);
  knex.raw = (sql: string, bindings?: unknown[]) => ({ sql, bindings });
  return knex;
}

export const tenantDbMock = (conn: any, tenant: string) => ({
  table: (table: string) => conn(table).where({ tenant }),
});
