// Step 2 of 2 for admitting 'co_managed' in tenants.product_code (step 1 is
// 20261028100000_create_co_management_foundation, which adds the new CHECK
// NOT VALID). VALIDATE takes SHARE UPDATE EXCLUSIVE for one scan while reads
// and writes continue; the superseded two-value constraint is then dropped and
// the new one takes its name, so later `DROP CONSTRAINT IF EXISTS
// tenants_product_code_check` migrations keep working.
//
// Idempotent: a no-op when the new constraint is absent (already renamed, or
// step 1 found the live constraint already admitting 'co_managed').
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
    // migration-lint: allow 3 - drops the superseded two-value product check only after its replacement validated
    await run(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${OLD}`);
    await run(`ALTER TABLE tenants RENAME CONSTRAINT ${NEXT} TO ${OLD}`);
  });
};

exports.down = async function down() {
  // Forward-only: a validated constraint is never re-narrowed here; the
  // foundation migration's down restores the two-value check.
};
