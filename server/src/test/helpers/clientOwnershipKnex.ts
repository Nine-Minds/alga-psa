import { vi } from 'vitest';

// Stubs for the tenant table manifest's row -> client lookup, so unit tests run the real
// resolveRowClients / clientPath code against canned rows instead of mocking it away.
//
// resolveRowClients reads the client-owned table through tenantDb:
//   tenantDb(knex).table(table).whereIn(keyColumn, keys).select({ key, client_id })            (column)
//   tenantDb(knex).table(table).whereIn(keyColumn, keys).select({ key, discriminator, id })    (resolver)
// and a resolver kind then reads its client path through knex.queryBuilder():
//   knex.queryBuilder().from('<table> as p0')[.join(...)].where(...).whereIn(...).select({ id, client_id })

/** A thenable builder that answers every chained call with itself and resolves to `rows`. */
export function ownershipQuery<TRow>(rows: TRow[]) {
  const query = {
    select: vi.fn(() => query),
    where: vi.fn(() => query),
    andWhere: vi.fn(() => query),
    whereIn: vi.fn(() => query),
    join: vi.fn(() => query),
    then: (resolve: (value: TRow[]) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

export interface ClientPathRow {
  id: string;
  client_id: string | null;
}

/**
 * Give `knex` a `queryBuilder()` that serves client-path lookups: `from('<table> as p0')` resolves
 * to `rowsByTable[table]` (empty when the table is not listed). Returns the `from` spy.
 */
export function withClientPaths<TKnex extends object>(
  knex: TKnex,
  rowsByTable: Record<string, ClientPathRow[]>,
) {
  const from = vi.fn((tableExpression: string) => {
    const table = tableExpression.split(/\s+as\s+/i)[0].trim();
    return ownershipQuery(rowsByTable[table] ?? []);
  });
  Object.assign(knex, { queryBuilder: vi.fn(() => ({ from })) });
  return from;
}
