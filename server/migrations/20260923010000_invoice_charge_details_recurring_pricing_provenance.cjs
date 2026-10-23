'use strict';

/**
 * Persist the effective recurring pricing provenance on invoice charge details.
 *
 * A recurring product/license/unit-service charge priced by a scheduled
 * quantity/price revision records the revision identity, version, price policy,
 * resolved unit rate, effective service-period boundary and (for catalog
 * policy) the inherited `service_prices` identity. Preview hands the same
 * sources to generation so a changed revision or catalog price refuses rather
 * than billing a different amount. Nullable and additive; legacy details keep
 * NULL and continue to read.
 *
 * Plan: docs/plans/2026-09-22-contract-products-quantity-price-changes-plan.md
 */

const DETAILS = 'invoice_charge_details';

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(DETAILS))) {
    return;
  }
  if (!(await hasColumn(knex, DETAILS, 'effective_pricing'))) {
    await knex.raw(`ALTER TABLE ${DETAILS} ADD COLUMN effective_pricing jsonb`);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(DETAILS))) {
    return;
  }
  if (await hasColumn(knex, DETAILS, 'effective_pricing')) {
    await knex.schema.alterTable(DETAILS, (t) => t.dropColumn('effective_pricing'));
  }
};

// Additive ALTER TABLE on a Citus-distributed table must not run in a transaction.
exports.config = { transaction: false };
