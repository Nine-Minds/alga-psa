/**
 * Fix the opportunities -> contracts FK that blocks deletion of
 * opportunity-converted contracts.
 *
 * opportunities.converted_contract_id was created in
 * 20260712100000_create_opportunities_tables.cjs as a composite
 * FOREIGN KEY (tenant, converted_contract_id) REFERENCES
 * contracts (tenant, contract_id) with NO ACTION. Deleting a contract
 * that an opportunity points at therefore fails at the final `contracts`
 * delete with an unhandled FK violation
 * (opportunities_tenant_converted_contract_id_foreign).
 *
 * quotes.converted_contract_id and project_billing_configs.contract_id use
 * the column-targeted form (`ON DELETE SET NULL (col)`), which nulls only the
 * link column and preserves the referencing row's tenant. This migration
 * brings opportunities in line with them:
 * - PG 15+ on plain Postgres: ON DELETE SET NULL (converted_contract_id)
 * - Citus (or PG < 15): plain NO ACTION — Citus refuses SET NULL/SET DEFAULT
 *   when the distribution key is part of the FK, and the column-targeted
 *   form does not exist before PG 15.
 */

const CONSTRAINT_NAME = 'opportunities_tenant_converted_contract_id_foreign';

const isCitusEnabled = async (knex) => {
  const { rows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  return rows.length > 0;
};

const columnTargetedSetNullAvailable = async (knex) => {
  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  return versionRow.rows[0].v >= 150000 && !(await isCitusEnabled(knex));
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const onDelete = (await columnTargetedSetNullAvailable(knex))
    ? ' ON DELETE SET NULL (converted_contract_id)'
    : '';

  await knex.raw(`ALTER TABLE opportunities DROP CONSTRAINT "${CONSTRAINT_NAME}"`);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT "${CONSTRAINT_NAME}"
    FOREIGN KEY (tenant, converted_contract_id)
    REFERENCES contracts (tenant, contract_id)${onDelete}
  `);
};

/**
 * Restore the original constraint (plain NO ACTION, as created by
 * 20260712100000_create_opportunities_tables.cjs).
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE opportunities DROP CONSTRAINT "${CONSTRAINT_NAME}"`);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT "${CONSTRAINT_NAME}"
    FOREIGN KEY (tenant, converted_contract_id)
    REFERENCES contracts (tenant, contract_id)
  `);
};
