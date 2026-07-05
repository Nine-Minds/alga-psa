/**
 * Link sales orders back to the quote that created them.
 *
 * Quotes use the composite primary key (tenant, quote_id), so the FK is
 * tenant-qualified. The partial unique index enforces quote->SO idempotency
 * while still allowing manually-created sales orders with no quote link.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('sales_orders', (table) => {
    table.uuid('quote_id').nullable();
  });

  // No ON DELETE SET NULL: on a composite FK Postgres nulls BOTH columns, and
  // tenant is NOT NULL — a quote delete would fail with a confusing not-null
  // violation. The plain FK blocks deleting a quote with a linked SO, clearly.
  //
  // On Citus, sales_orders is a distributed table but `quotes` is not distributed,
  // so the FK is rejected ("referenced table must be a distributed or reference
  // table"). Add the FK only when it is valid; otherwise the quote link stays
  // logical and the unique index below still enforces quote->SO idempotency.
  // Mirrors server/migrations/20250613190110_add_location_to_tickets.cjs.
  const { rows: citusRows } = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  let canAddQuoteFk = true;
  if (Boolean(citusRows?.[0]?.enabled)) {
    const { rows } = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'quotes'::regclass) AS is_distributed");
    canAddQuoteFk = Boolean(rows?.[0]?.is_distributed);
  }
  if (canAddQuoteFk) {
    await knex.schema.alterTable('sales_orders', (table) => {
      table.foreign(['tenant', 'quote_id'], 'fk_sales_orders_quote')
        .references(['tenant', 'quote_id'])
        .inTable('quotes');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX idx_sales_orders_quote
    ON sales_orders (tenant, quote_id)
    WHERE quote_id IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS fk_sales_orders_quote');
  await knex.raw('DROP INDEX IF EXISTS idx_sales_orders_quote');
  await knex.schema.alterTable('sales_orders', (table) => {
    table.dropColumn('quote_id');
  });
};
