import { randomUUID } from 'node:crypto';

export type FakeRow = Record<string, any>;
export type FakeTables = Record<string, FakeRow[]>;

const PRIMARY_KEYS: Record<string, string> = {
  quotes: 'quote_id',
  quote_items: 'quote_item_id',
  quote_activities: 'activity_id',
};

type Predicate = (row: FakeRow) => boolean;

/**
 * A tiny in-memory stand-in for the knex surface the quote models and scope layer use. It really filters rows
 * (where / whereIn / whereNotNull), so ownership checks are exercised against data rather than canned answers.
 */
class FakeBuilder implements PromiseLike<any> {
  private predicates: Predicate[] = [];
  private columns: string[] = [];
  private aggregate: string | null = null;
  private pending: { kind: 'insert' | 'update'; payload: any } | null = null;

  constructor(private readonly tables: FakeTables, private readonly table: string) {
    this.tables[table] ??= [];
  }

  private get rows(): FakeRow[] {
    return this.tables[this.table];
  }

  private matching(): FakeRow[] {
    return this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
  }

  where(first: any, second?: any, third?: any) {
    if (typeof first === 'function') return this;
    if (first && typeof first === 'object') {
      for (const [key, value] of Object.entries(first)) {
        this.predicates.push((row) => row[key] === value);
      }
      return this;
    }
    const column = String(first).replace(/^\w+\./, '');
    if (third !== undefined) {
      const op = second as string;
      this.predicates.push((row) => {
        if (op === '<=') return row[column] <= third;
        if (op === '<') return row[column] < third;
        if (op === '>=') return row[column] >= third;
        if (op === '>') return row[column] > third;
        return row[column] === third;
      });
      return this;
    }
    this.predicates.push((row) => row[column] === second);
    return this;
  }

  andWhere(...args: [any, any?, any?]) {
    return this.where(...args);
  }

  whereIn(column: string, values: any[]) {
    this.predicates.push((row) => values.includes(row[column]));
    return this;
  }

  whereNotNull(column: string) {
    this.predicates.push((row) => row[column] !== null && row[column] !== undefined);
    return this;
  }

  select(...columns: any[]) {
    this.columns = columns.flat().filter((column) => typeof column === 'string');
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  forUpdate() {
    return this;
  }

  max(expression: string) {
    this.aggregate = expression.split(' as ')[0];
    return this;
  }

  insert(payload: FakeRow | FakeRow[]) {
    this.pending = { kind: 'insert', payload };
    return this;
  }

  update(payload: FakeRow) {
    this.pending = { kind: 'update', payload };
    return this;
  }

  returning() {
    return this;
  }

  private project(row: FakeRow, columns: string[]): FakeRow {
    if (columns.length === 0) return { ...row };
    return Object.fromEntries(columns.map((column) => [column, row[column]]));
  }

  private execute(): any[] {
    if (this.pending?.kind === 'insert') {
      const payloads = Array.isArray(this.pending.payload) ? this.pending.payload : [this.pending.payload];
      const inserted = payloads.map((payload) => {
        const primaryKey = PRIMARY_KEYS[this.table];
        const row = { ...payload };
        if (primaryKey && !row[primaryKey]) row[primaryKey] = randomUUID();
        this.rows.push(row);
        return { ...row };
      });
      return inserted;
    }
    if (this.pending?.kind === 'update') {
      return this.matching().map((row) => {
        Object.assign(row, this.pending!.payload);
        return { ...row };
      });
    }
    return this.matching().map((row) => this.project(row, this.columns));
  }

  async first(...columns: any[]) {
    if (this.aggregate) {
      const values = this.matching().map((row) => Number(row[this.aggregate!])).filter((value) => !Number.isNaN(value));
      return { max: values.length > 0 ? Math.max(...values) : null };
    }
    const requested = columns.flat().filter((column) => typeof column === 'string');
    const row = this.matching()[0];
    return row ? this.project(row, requested.length > 0 ? requested : this.columns) : undefined;
  }

  async pluck(column: string) {
    return this.matching().map((row) => row[column]);
  }

  then<T1 = any, T2 = never>(
    onFulfilled?: ((value: any) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return Promise.resolve().then(() => this.execute()).then(onFulfilled, onRejected);
  }

  catch(onRejected: (reason: any) => any) {
    return this.then(undefined, onRejected);
  }
}

export function createFakeQuoteDb(tables: FakeTables) {
  const db: any = (table: string) => new FakeBuilder(tables, table);
  db.tables = tables;
  db.transaction = async (handler: (trx: any) => Promise<unknown>) => handler(db);
  return db as ((table: string) => FakeBuilder) & { tables: FakeTables };
}
