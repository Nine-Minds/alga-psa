import assert from 'node:assert/strict';

export const UPGRADE_DISTRIBUTED_TABLES = ['tenants', 'users', 'clients', 'tickets', 'contracts', 'usage_tracking', 'time_entries'];

export function verifyUpgradeDistribution(rows) {
  for (const table of UPGRADE_DISTRIBUTED_TABLES) {
    const matches = rows.filter(row => row.table_name === table);
    assert.equal(matches.length, 1, `Missing or duplicate Citus metadata for ${table}`);
    assert.equal(matches[0].partmethod, 'h', `${table} must be hash distributed`);
    assert.equal(matches[0].distribution_column, 'tenant', `${table} must be distributed by tenant`);
  }
  return rows;
}

export async function captureUpgradeDistribution(db) {
  const { rows } = await db.raw(`
    SELECT c.relname AS table_name, p.partmethod,
           column_to_column_name(p.logicalrelid, p.partkey) AS distribution_column
    FROM pg_dist_partition p
    JOIN pg_class c ON c.oid = p.logicalrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(?::text[])
    ORDER BY c.relname
  `, [UPGRADE_DISTRIBUTED_TABLES]);
  return verifyUpgradeDistribution(rows);
}
