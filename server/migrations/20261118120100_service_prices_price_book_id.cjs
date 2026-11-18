'use strict';
const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');

/**
 * service_prices.price_book_id stamps a row as part of a pricebook; NULL (every
 * existing row) is a one-off price change. service_prices.created_by attributes
 * the row to its writer. Both nullable, so nothing that reads rates changes.
 *
 * Non-transactional to match 20261118120000; every statement is guarded and
 * re-runnable.
 */
const TABLE = 'service_prices';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE)) || !(await knex.schema.hasTable('catalog_price_books'))) return;

  if (!(await knex.schema.hasColumn(TABLE, 'price_book_id'))) {
    await knex.schema.alterTable(TABLE, (table) => table.uuid('price_book_id').nullable());
  }
  if (!(await knex.schema.hasColumn(TABLE, 'created_by'))) {
    await knex.schema.alterTable(TABLE, (table) => table.uuid('created_by').nullable());
  }

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS service_prices_price_book_idx
    ON ${TABLE} (tenant, price_book_id)
    WHERE price_book_id IS NOT NULL
  `);

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: 'service_prices_price_book_fk',
    columns: ['tenant', 'price_book_id'],
    referencedTable: 'catalog_price_books',
    referencedColumns: ['tenant', 'price_book_id'],
  });
};

exports.down = async function down(_knex) {};

exports.config = { transaction: false };
