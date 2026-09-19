'use strict';

/**
 * Billing profiles — explicit catalog-pricing decision (F138, F139, F141;
 * slice S5). This is the one authorised carve-out to the T013 gate (decision
 * D10), bounded by T052.
 *
 * Today an unresolved item bills at `service_catalog.default_rate`: no contract
 * rate, no rounding config, no minimums, no overtime, no pricing schedule. The
 * engine already distinguishes the two reasons an item is unresolved and writes
 * the distinction only to logs. They deserve opposite treatment:
 *
 *   no_match  (0 eligible lines)  — no contract covers the service. Catalog
 *                                   rate is honest; there is nothing else to
 *                                   bill at. Unchanged.
 *   ambiguous (>1 eligible line)  — a contract *does* cover it, so the customer
 *                                   has a negotiated rate and catalog pricing
 *                                   is simply wrong.
 *
 * So an ambiguous item is never billed at catalog rate silently. The biller
 * either assigns a contract line — after which it bills at contract pricing —
 * or explicitly chooses catalog pricing for that item, which is what these
 * columns record.
 *
 * The decision is persisted on the record rather than held in the generation
 * request because it is a judgement about *this item*, and it has to survive a
 * page reload, a different biller, and a second generation attempt. Storing the
 * actor and timestamp makes it auditable rather than merely effective.
 *
 * This plan is what *creates* most of the ambiguity it is guarding against:
 * parallel per-profile contracts each carrying the same service are exactly the
 * >1-eligible-line case.
 */

const TABLES = ['time_entries', 'usage_tracking'];

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

exports.up = async function up(knex) {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;

    if (!(await hasColumn(knex, table, 'catalog_pricing_acknowledged_at'))) {
      await knex.schema.alterTable(table, (t) => {
        t.timestamp('catalog_pricing_acknowledged_at', { useTz: true }).nullable();
      });
    }
    if (!(await hasColumn(knex, table, 'catalog_pricing_acknowledged_by'))) {
      await knex.schema.alterTable(table, (t) => {
        t.uuid('catalog_pricing_acknowledged_by').nullable();
      });
    }
  }
};

exports.down = async function down(knex) {
  for (const table of TABLES) {
    for (const column of [
      'catalog_pricing_acknowledged_by',
      'catalog_pricing_acknowledged_at',
    ]) {
      if (await hasColumn(knex, table, column)) {
        await knex.schema.alterTable(table, (t) => {
          t.dropColumn(column);
        });
      }
    }
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };
