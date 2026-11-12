import type { Knex } from "knex";

/**
 * Canonical content of a table's rows: keys sorted within each row and rows
 * sorted by that serialization. Two snapshots compare equal exactly when they
 * hold the same multiset of rows. A SELECT without ORDER BY returns rows in
 * whatever order the plan and heap layout yield, which can differ between two
 * reads of unchanged data, so physical order is deliberately not part of it.
 */
export function fingerprintRows(rows: Record<string, unknown>[]): string {
  const serialized = rows.map((row) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(row).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
  );
  serialized.sort();
  return `[${serialized.join(",")}]`;
}

/** Fingerprints each existing table, restricted to the tenant where the table has a tenant column. */
export async function fingerprintTenantTables(
  db: Knex,
  tenant: string,
  tables: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of tables) {
    if (!(await db.schema.hasTable(table))) continue;
    const columns = await db(table).columnInfo();
    const query = db(table).select("*");
    if ("tenant" in columns) query.where({ tenant });
    result[table] = fingerprintRows(await query);
  }
  return result;
}
