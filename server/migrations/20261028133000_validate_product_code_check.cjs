// Step 2 of 3 for admitting 'co_managed' in tenants.product_code (step 1 is
// 20261028130000_create_co_management_foundation, which adds the new CHECK
// NOT VALID under a temporary name). VALIDATE takes SHARE UPDATE EXCLUSIVE for
// one scan while reads and writes continue; the superseded two-value constraint
// is then replaced by a NOT VALID three-value constraint under the original
// name, so later `DROP CONSTRAINT IF EXISTS tenants_product_code_check`
// migrations keep working. Step 3 (20261028134000) validates it and drops the
// temporary constraint.
//
// The original name is re-added rather than renamed onto because Citus refuses
// RENAME CONSTRAINT on distributed tables, and `tenants` is distributed. The
// validated temporary constraint guards writes while the re-added one is
// still NOT VALID.
//
// Idempotent: a no-op when the temporary constraint is absent (sequence already
// finished, or step 1 found the live constraint already admitting 'co_managed'),
// and the original name is only replaced while it still lacks 'co_managed'.
const OLD = 'tenants_product_code_check';
const NEXT = 'tenants_product_code_check_co_managed';

async function onOneConnection(knex, work) {
  const connection = await knex.client.acquireConnection();
  const run = (sql, bindings) => knex.raw(sql, bindings ?? []).connection(connection);
  try {
    return await work(run);
  } finally {
    await knex.client.releaseConnection(connection);
  }
}

async function constraintDef(run, name) {
  const { rows } = await run(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ? AND conrelid = 'tenants'::regclass`,
    [name]
  );
  return rows.length ? rows[0].def : null;
}

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('tenants'))) return;
  await onOneConnection(knex, async (run) => {
    if ((await constraintDef(run, NEXT)) === null) return;
    await run(`ALTER TABLE tenants VALIDATE CONSTRAINT ${NEXT}`);
    const live = await constraintDef(run, OLD);
    if (live && live.includes('co_managed')) return;
    await run(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${OLD}`);
    await run(`
      ALTER TABLE tenants ADD CONSTRAINT ${OLD}
        CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk', 'co_managed')) NOT VALID
    `);
  });
};

exports.down = async function down() {
  // Forward-only: a validated constraint is never re-narrowed here; the
  // foundation migration's down restores the two-value check.
};
