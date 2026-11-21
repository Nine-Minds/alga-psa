'use strict';
const { distributeLocalTenantTables } = require('./utils/citusDistribution.cjs');

/**
 * catalog_price_books: a name, one effective date and a lifecycle for a group
 * of effective-dated service_prices rows (docs/plans/2026-11-18-pricebooks-csv-import.md §3.1).
 *
 * It is a label, not a rate source: billing keeps reading service_prices. "Active"
 * is derived (latest scheduled/superseded effective_date <= today) and is never stored.
 *
 * Citus: new table, so the primary key and every unique index lead with `tenant`.
 * Distributed and co-located with service_catalog, like service_prices
 * (20261112120000). Non-transactional because create_distributed_table() must not
 * run inside the migration batch transaction.
 */
const TABLE = 'catalog_price_books';
const PARENT = 'service_catalog';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('price_book_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.date('effective_date').notNullable();
      table.text('status').notNullable().defaultTo('draft');
      table.text('description').nullable();
      table.uuid('source_migration_job_id').nullable();
      table.uuid('copied_from_price_book_id').nullable();
      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.uuid('applied_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('applied_at', { useTz: true }).nullable();
      table.primary(['tenant', 'price_book_id']);
    });
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT catalog_price_books_status_check
      CHECK (status IN ('draft', 'scheduled', 'superseded', 'discarded'))
    `);
  }

  // One applied pricebook per date, so "the active pricebook" is never ambiguous.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS catalog_price_books_applied_date_unique
    ON ${TABLE} (tenant, effective_date)
    WHERE status IN ('scheduled', 'superseded')
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS catalog_price_books_name_unique
    ON ${TABLE} (tenant, lower(name))
    WHERE status <> 'discarded'
  `);

  await distributeLocalTenantTables(knex, { tables: [TABLE], colocateWith: PARENT });
};

// Forward-only: the table holds user data once in use.
exports.down = async function down(_knex) {};

exports.config = { transaction: false };
