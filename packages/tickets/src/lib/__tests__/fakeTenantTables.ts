/**
 * Tiny in-memory stand-in for the tenant-scoped knex builder used by the
 * ticket assignment helpers. Supports only the operations those helpers call.
 */

export type FakeRow = Record<string, any>;
export type FakeTables = Record<string, FakeRow[]>;

// Joined queries filter on qualified columns ('users.is_inactive'); the fake
// stores flat rows, so match on the bare column name.
function columnName(key: string): string {
  return key.includes('.') ? key.split('.').pop()! : key;
}

function createBuilder(tables: FakeTables, table: string) {
  const criteria: FakeRow[] = [];
  let inFilter: { column: string; values: any[] } | null = null;
  let notInFilter: { column: string; values: any[] } | null = null;
  let orderByColumn: string | null = null;
  let orderByDirection: 'asc' | 'desc' = 'asc';

  const rows = () => (tables[table] ??= []);

  const matches = (row: FakeRow) => {
    const matchesCriteria = criteria.every((criterion) =>
      Object.entries(criterion).every(([key, value]) => row[columnName(key)] === value)
    );
    const matchesIn = !inFilter || inFilter.values.includes(row[columnName(inFilter.column)]);
    const matchesNotIn = !notInFilter || !notInFilter.values.includes(row[columnName(notInFilter.column)]);
    return matchesCriteria && matchesIn && matchesNotIn;
  };

  const selected = () => {
    const result = rows().filter(matches);
    if (orderByColumn) {
      result.sort((a, b) => {
        const left = a[orderByColumn!];
        const right = b[orderByColumn!];
        const comparison = left === right ? 0 : left > right ? 1 : -1;
        return orderByDirection === 'desc' ? -comparison : comparison;
      });
    }
    return result;
  };

  const builder: any = {
    where(criterion: FakeRow | string, value?: any) {
      criteria.push(typeof criterion === 'string' ? { [criterion]: value } : criterion);
      return builder;
    },
    andWhere(criterion: FakeRow | string, value?: any) {
      return builder.where(criterion, value);
    },
    whereIn(column: string, values: any[]) {
      inFilter = { column, values };
      return builder;
    },
    whereNotIn(column: string, values: any[]) {
      notInFilter = { column, values };
      return builder;
    },
    orderBy(column: string, direction: 'asc' | 'desc' = 'asc') {
      orderByColumn = column;
      orderByDirection = direction;
      return builder;
    },
    select() {
      return builder;
    },
    async first() {
      return selected()[0];
    },
    insert(payload: FakeRow | FakeRow[]) {
      const inserted = (Array.isArray(payload) ? payload : [payload]).map((row, index) => ({
        assignment_id: `assignment-${rows().length + index + 1}`,
        ...row,
      }));
      rows().push(...inserted);
      const result: any = Promise.resolve(inserted);
      result.returning = async () => inserted;
      return result;
    },
    update(values: FakeRow) {
      const updated = selected().map((row) => Object.assign(row, values));
      const result: any = Promise.resolve(updated.length);
      result.returning = async () => updated;
      return result;
    },
    async delete() {
      const doomed = new Set(selected());
      tables[table] = rows().filter((row) => !doomed.has(row));
      return doomed.size;
    },
    then(resolve: (rows: FakeRow[]) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve(selected()).then(resolve, reject);
    },
  };

  return builder;
}

/** Drop-in replacement for the `tenantDb` export of `@alga-psa/db`. */
export function createTenantDbMock(getTables: () => FakeTables) {
  return () => ({
    table: (table: string) => createBuilder(getTables(), table),
    tenantJoin: (query: any) => query,
  });
}
