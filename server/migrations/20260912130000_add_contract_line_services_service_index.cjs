'use strict';

/**
 * Index contract_line_services by (tenant, service_id).
 *
 * Plan: docs/plans/2026-09-12-catalog-price-changes-reach-existing-contracts.md (§1.5).
 *
 * "Which contract lines use this service?" is the hot path for both the "used on
 * N contracts" badge and the catalog price-change preview. The table is keyed on
 * (tenant, contract_line_id, service_id) today, so a lookup by service alone
 * cannot use the primary key.
 */

const TABLE = 'contract_line_services';
const INDEX = 'idx_contract_line_services_tenant_service';

const hasIndex = async (knex, indexName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?
    ) AS present`,
    [indexName],
  );
  return Boolean(result.rows?.[0]?.present);
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (!(await hasIndex(knex, INDEX))) {
    await knex.raw(`CREATE INDEX ${INDEX} ON ${TABLE} (tenant, service_id)`);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (await hasIndex(knex, INDEX)) {
    await knex.raw(`DROP INDEX ${INDEX}`);
  }
};

exports.config = { transaction: false };
