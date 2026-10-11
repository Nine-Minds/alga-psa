/**
 * A chainable knex query-builder double that cannot be "missing a method".
 *
 * Every hand-rolled fake in this repo enumerates the builder methods its one
 * product path happens to call. When a shared helper starts calling one more --
 * `.forShare()` for a row lock, `.modify()` to apply a conditional lock -- every
 * one of those fakes breaks at once, in tests that have nothing to do with the
 * change. That is not a fixture problem repeated forty-eight times; it is a
 * missing layer. This is that layer.
 *
 * The builder is a Proxy: any method it does not explicitly implement returns
 * the builder, so chaining always works. Only the calls that must actually mean
 * something -- the row filters and the terminal operations -- are implemented.
 * A genuinely new *semantic* need still fails loudly, because the terminals are
 * real; only the fluent no-ops are absorbed.
 */

export type FakeRow = Record<string, any>;

export interface FakeQueryBuilderOptions {
  /** Rows this table contains. Filters narrow this set. */
  rows?: FakeRow[];
  /** Called with rows to insert. Return value is used for `returning`. */
  onInsert?: (rows: FakeRow[]) => FakeRow[] | void;
  /** Called with the patch and the rows the filters selected. */
  onUpdate?: (patch: FakeRow, selected: FakeRow[]) => number | void;
  /** Called with the rows the filters selected. */
  onDelete?: (selected: FakeRow[]) => number | void;
  /** Raw SQL predicate handlers, keyed by the exact SQL string. */
  rawPredicates?: Record<string, (row: FakeRow) => boolean>;
  /** Records every row-lock call, so a test can assert lock order. */
  onLock?: (kind: 'forShare' | 'forUpdate') => void;
}

/** Terminal calls that must resolve rather than continue the chain. */
const TERMINALS = new Set([
  'first', 'then', 'catch', 'finally', 'insert', 'update', 'del', 'delete',
  'count', 'pluck', 'returning', 'toSQL', 'toString',
]);

/** Filters that narrow the row set; everything else is a fluent no-op. */
const FILTERS = new Set(['where', 'andWhere', 'whereIn', 'whereNotIn', 'whereNull',
  'whereNotNull', 'whereRaw', 'orWhere', 'modify', 'forShare', 'forUpdate']);

function matches(row: FakeRow, field: string | FakeRow | ((builder: any) => void), value?: unknown): boolean {
  if (typeof field === 'string') {
    // knex accepts `where('a.b', v)`; fakes store the bare column.
    const column = field.split('.').at(-1)!;
    return row[column] === value;
  }
  if (field && typeof field === 'object') {
    return Object.entries(field).every(([key, expected]) => row[key.split('.').at(-1)!] === expected);
  }
  return true;
}

export interface FakeQueryBuilder {
  /** The rows the accumulated filters currently select. */
  readonly selected: FakeRow[];
  [method: string]: any;
}

export function fakeQueryBuilder(options: FakeQueryBuilderOptions = {}): FakeQueryBuilder {
  const all = options.rows ?? [];
  let predicates: Array<(row: FakeRow) => boolean> = [];
  let single = false;
  const selected = () => all.filter(row => predicates.every(p => p(row)));
  const resolution = () => (single ? selected()[0] : selected());

  const target: Record<string, any> = {};

  const impl: Record<string, any> = {
    where(field: any, value?: unknown) {
      if (typeof field === 'function') {
        // `where(builder => …)` — knex's grouped form. Apply it to a nested
        // builder over the same rows and intersect the result.
        const nested = fakeQueryBuilder({ ...options, rows: all });
        // knex passes the nested builder both as `this` and as the argument.
        field.call(nested, nested);
        const keep = new Set(nested.selected);
        predicates.push(row => keep.has(row));
        return proxy;
      }
      predicates.push(row => matches(row, field, value));
      return proxy;
    },
    andWhere(field: any, value?: unknown) { return impl.where(field, value); },
    whereIn(column: string, values: unknown[]) {
      const key = column.split('.').at(-1)!;
      predicates.push(row => values.includes(row[key]));
      return proxy;
    },
    whereNotIn(column: string, values: unknown[]) {
      const key = column.split('.').at(-1)!;
      predicates.push(row => !values.includes(row[key]));
      return proxy;
    },
    whereNull(column: string) {
      const key = column.split('.').at(-1)!;
      predicates.push(row => row[key] == null);
      return proxy;
    },
    whereNotNull(column: string) {
      const key = column.split('.').at(-1)!;
      predicates.push(row => row[key] != null);
      return proxy;
    },
    whereRaw(sql: string) {
      const handler = options.rawPredicates?.[sql];
      // An unmodelled raw predicate is a real gap: it silently changes which
      // rows the product selects, so it must not be absorbed.
      if (!handler) throw new Error(`fakeQueryBuilder: unmodelled whereRaw predicate: ${sql}`);
      predicates.push(handler);
      return proxy;
    },
    orWhere(field: any, value?: unknown) {
      const previous = predicates;
      predicates = [row => previous.every(p => p(row)) || matches(row, field, value)];
      return proxy;
    },
    /** knex's conditional-clause escape hatch; the callback gets this builder. */
    modify(callback: (builder: any, ...rest: any[]) => void, ...args: any[]) { callback(proxy, ...args); return proxy; },
    forShare() { options.onLock?.('forShare'); return proxy; },
    forUpdate() { options.onLock?.('forUpdate'); return proxy; },

    // knex's `first()` is a mode switch as much as a terminal: the builder it
    // returns resolves to one row, so code that calls `.first()` and awaits the
    // builder later (composed queries in a `Promise.all`) gets a row, not a list.
    async first(..._columns: unknown[]) { single = true; return selected()[0]; },
    async count() { return [{ count: String(selected().length) }]; },
    async pluck(column: string) { return selected().map(row => row[column]); },
    insert(rows: FakeRow | FakeRow[]) {
      const list = Array.isArray(rows) ? rows : [rows];
      const produced = options.onInsert?.(list) ?? list;
      const result: any = Promise.resolve(produced);
      result.returning = async () => produced;
      result.onConflict = () => ({ merge: async () => produced, ignore: async () => produced });
      return result;
    },
    update(patch: FakeRow) {
      const rows = selected();
      // knex resolves a bare `update(...)` to the row count and
      // `update(...).returning('*')` to the updated rows; one call has to serve
      // both, so the result is a promise that also carries `returning`.
      const result: any = Promise.resolve(options.onUpdate?.(patch, rows) ?? rows.length);
      result.returning = async (..._columns: unknown[]) => rows.map(row => ({ ...row, ...patch }));
      return result;
    },
    async del() { return options.onDelete?.(selected()) ?? selected().length; },
    async delete() { return impl.del(); },
    then(resolve: any, reject?: any) { return Promise.resolve(resolution()).then(resolve, reject); },
    catch(reject: any) { return Promise.resolve(resolution()).catch(reject); },
    finally(onFinally: any) { return Promise.resolve(resolution()).finally(onFinally); },
  };

  const proxy: any = new Proxy(target, {
    get(_t, property: string | symbol) {
      if (property === 'selected') return selected();
      if (typeof property !== 'string') return undefined;
      if (property in impl) return impl[property];
      if (TERMINALS.has(property)) return undefined;
      // Any other builder method -- select, orderBy, limit, join, groupBy,
      // distinct, clone, as, … -- does not change which rows a fake holds.
      // Absorb it so a new fluent call never breaks an unrelated test.
      return (..._args: unknown[]) => proxy;
    },
    has: () => true,
  });
  void FILTERS;
  return proxy;
}
