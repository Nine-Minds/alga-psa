'use strict';

/**
 * Effective-date the catalog price.
 *
 * Plan: docs/plans/2026-09-12-catalog-price-changes-reach-existing-contracts.md (§0.2).
 *
 * `service_prices` held exactly one rate per (service, currency). Making the
 * catalog price effective-dated is what lets "raise this service on Nov 1" be a
 * single catalog row for every contract on it — no per-contract schedule rows.
 *
 * Existing rows are stamped `1970-01-01`, so "the row" and "the row effective
 * now" are the same row and every current reader's answer is unchanged. The
 * unique key widens to include the effective date; all rows today are unique on
 * the narrower key by construction, so no data is lost.
 */

const TABLE = 'service_prices';
const COLUMN = 'effective_date';
const OLD_UNIQUE = 'service_prices_tenant_service_id_currency_code_unique';
const NEW_UNIQUE = 'service_prices_tenant_service_id_currency_code_effective_unique';
const EFFECTIVE_INDEX = 'idx_service_prices_effective';

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

const hasConstraint = async (knex, tableName, constraintName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName],
  );
  return Boolean(result.rows?.[0]?.present);
};

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

  if (!(await hasColumn(knex, TABLE, COLUMN))) {
    // Legacy rows are effective from the epoch: every reader that does not yet
    // know about effective dating sees exactly the row it saw before.
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD COLUMN ${COLUMN} date NOT NULL DEFAULT '1970-01-01'
    `);
  }

  if (await hasConstraint(knex, TABLE, OLD_UNIQUE)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${OLD_UNIQUE}`);
  }

  if (!(await hasConstraint(knex, TABLE, NEW_UNIQUE))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${NEW_UNIQUE}
      UNIQUE (tenant, service_id, currency_code, ${COLUMN})
    `);
  }

  if (!(await hasIndex(knex, EFFECTIVE_INDEX))) {
    await knex.raw(`
      CREATE INDEX ${EFFECTIVE_INDEX}
      ON ${TABLE} (tenant, service_id, currency_code, ${COLUMN} DESC)
    `);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  if (await hasConstraint(knex, TABLE, NEW_UNIQUE)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${NEW_UNIQUE}`);
  }

  if (await hasIndex(knex, EFFECTIVE_INDEX)) {
    await knex.raw(`DROP INDEX ${EFFECTIVE_INDEX}`);
  }

  if (await hasColumn(knex, TABLE, COLUMN)) {
    // Refuse rather than silently pick a winner when the effective-dated data
    // cannot collapse back to one row per (service, currency).
    const duplicates = await knex.raw(
      `SELECT 1 FROM ${TABLE}
       GROUP BY tenant, service_id, currency_code
       HAVING COUNT(*) > 1
       LIMIT 1`,
    );
    if (duplicates.rows?.length) {
      throw new Error(
        `Cannot reverse ${TABLE} effective dating: multiple effective rows exist per (tenant, service, currency).`,
      );
    }
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
  }

  if (!(await hasConstraint(knex, TABLE, OLD_UNIQUE))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${OLD_UNIQUE}
      UNIQUE (tenant, service_id, currency_code)
    `);
  }
};

// ALTER TABLE ... ADD COLUMN / ADD CONSTRAINT on Citus-distributed tables must
// not run inside a transaction.
exports.config = { transaction: false };
