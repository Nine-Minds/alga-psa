/**
 * Convert tenant-less tax child tables to Citus reference tables.
 *
 * tax_rate_thresholds, tax_holidays and composite_tax_mappings have no `tenant`
 * column. Tenant isolation is derived through their parent `tax_rates` (which is
 * distributed by `tenant`) via the tenantDb parent-scoped facade
 * (`tenantDb().parentScopedTable(...)`). That facade scopes reads with a correlated
 * subquery against the parent, e.g.:
 *
 *     SELECT * FROM tax_rate_thresholds
 *     WHERE EXISTS (
 *       SELECT 1 FROM tax_rates
 *       WHERE tax_rates.tenant = $1 AND tax_rates.tax_rate_id = tax_rate_thresholds.tax_rate_id
 *     )
 *
 * While these children are plain LOCAL tables and the parent is distributed, Citus
 * rejects that join: "direct joins between distributed and local tables are not
 * supported". This made every quote/invoice tax calculation throw a Server
 * Components render error on save.
 *
 * Making the children reference tables (replicated to every worker) turns the join
 * into a legal reference<->distributed join, which Citus supports. Verified against
 * production with EXPLAIN on an existing reference<->distributed correlated EXISTS.
 *
 * Note: these tables carry no foreign keys in the distributed schema (a reference
 * table cannot hold an FK to a distributed table such as tax_rates/tax_components),
 * so none are recreated here. Referential integrity to tax_rates remains logical,
 * enforced through the parent-scoped facade — the same as before this migration.
 *
 * Companion of 20250805000021_fix_tax_tables_distribution.cjs, which converted
 * composite_tax_mappings but never covered tax_rate_thresholds / tax_holidays; on
 * long-lived databases the earlier conversion did not stick, so this migration is
 * written to be idempotent and to (re)assert the reference-table shape for all three.
 */
exports.config = { transaction: false };

const TABLES = ['tax_rate_thresholds', 'tax_holidays', 'composite_tax_mappings'];

async function citusEnabled(knex) {
  const res = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled`
  );
  return res.rows[0].enabled;
}

async function isReferenceTable(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition
       WHERE logicalrelid = ?::regclass AND partmethod = 'n'
     ) AS is_ref`,
    [table]
  );
  return res.rows[0].is_ref;
}

async function isInPgDistPartition(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
     ) AS present`,
    [table]
  );
  return res.rows[0].present;
}

exports.up = async function (knex) {
  if (!(await citusEnabled(knex))) {
    console.log('Citus not enabled, skipping tax child reference-table conversion');
    return;
  }

  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) {
      console.log(`  - ${table} does not exist, skipping`);
      continue;
    }

    if (await isReferenceTable(knex, table)) {
      console.log(`  - ${table} is already a reference table`);
      continue;
    }

    // If it was distributed some other way, undistribute before re-creating as reference.
    if (await isInPgDistPartition(knex, table)) {
      console.log(`  - ${table} is distributed (non-reference); undistributing first`);
      await knex.raw(`SELECT undistribute_table('${table}')`);
    }

    // Drop outbound foreign keys: a reference table cannot reference a distributed table.
    const fks = await knex.raw(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = ?::regclass AND contype = 'f'`,
      [table]
    );
    for (const fk of fks.rows) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fk.conname}`);
      console.log(`    ✓ dropped FK ${fk.conname} on ${table}`);
    }

    await knex.raw(`SELECT create_reference_table('${table}')`);
    console.log(`  ✓ ${table} converted to reference table`);
  }

  console.log('✓ tax child reference-table conversion complete');
};

exports.down = async function (knex) {
  if (!(await citusEnabled(knex))) {
    console.log('Citus not enabled, nothing to undo');
    return;
  }

  // Revert reference tables back to local tables. FKs are not restored (they did not
  // exist in the distributed schema this migration runs against).
  for (const table of TABLES.slice().reverse()) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await isReferenceTable(knex, table)) {
      await knex.raw(`SELECT undistribute_table('${table}')`);
      console.log(`  ✓ ${table} reverted to local table`);
    }
  }
};
