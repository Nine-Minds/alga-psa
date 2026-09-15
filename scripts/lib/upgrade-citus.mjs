import assert from 'node:assert/strict';

export const UPGRADE_DISTRIBUTED_TABLES = ['tenants', 'users', 'clients', 'tickets', 'contracts'];
// The pinned v1.5.0 migration chain leaves these billing tables local. Record
// their actual layout rather than claiming their operations exercise shards.
export const UPGRADE_OBSERVED_TABLES = [...UPGRADE_DISTRIBUTED_TABLES, 'usage_tracking', 'time_entries'];

export function verifyUpgradeDistribution(rows) {
  for (const table of UPGRADE_OBSERVED_TABLES) {
    const matches = rows.filter(row => row.table_name === table);
    assert.equal(matches.length, 1, `Missing or duplicate Citus metadata for ${table}`);
    if (!UPGRADE_DISTRIBUTED_TABLES.includes(table)) continue;
    assert.equal(matches[0].partmethod, 'h', `${table} must be hash distributed`);
    assert.equal(matches[0].distribution_column, 'tenant', `${table} must be distributed by tenant`);
  }
  return rows;
}

export async function captureUpgradeDistribution(db) {
  const { rows } = await db.raw(`
    SELECT c.relname AS table_name, p.partmethod,
           column_to_column_name(p.logicalrelid, p.partkey) AS distribution_column
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_dist_partition p ON p.logicalrelid = c.oid
    WHERE n.nspname = 'public' AND c.relname = ANY(?::text[])
    ORDER BY c.relname
  `, [UPGRADE_OBSERVED_TABLES]);
  return verifyUpgradeDistribution(rows);
}
