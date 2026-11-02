// Step 3 of 3 for admitting 'co_managed' in tenants.product_code (see
// 20261028133000_validate_product_code_check). Validates the three-value
// constraint re-added under the original name, then drops the temporary
// constraint it replaces.
//
// Idempotent: a no-op once the temporary constraint is gone. The temporary
// constraint is only dropped after the original name carries 'co_managed' and
// has validated, so the column is never left unguarded.
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
    const live = await constraintDef(run, OLD);
    if (!live || !live.includes('co_managed')) {
      throw new Error(`${OLD} does not admit 'co_managed'; run 20261028133000_validate_product_code_check first`);
    }
    await run(`ALTER TABLE tenants VALIDATE CONSTRAINT ${OLD}`);
    // migration-lint: allow 3 - drops the temporary product check only after its replacement under the original name validated
    await run(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${NEXT}`);
  });
};

exports.down = async function down() {
  // Forward-only: the foundation migration's down restores the two-value check.
};
