exports.up = async function up(knex) {
  if (!await knex.schema.hasTable('co_managed_purchase_operations')) await knex.schema.createTable('co_managed_purchase_operations', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('operation_id').notNullable();
    table.integer('quantity').notNullable();
    table.text('state').notNullable().defaultTo('preparing');
    table.text('provider_reference').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'operation_id']);
    table.check('quantity >= 0 AND quantity <= 100000');
    table.check("state IN ('preparing', 'checkout', 'completed', 'expired')");
  });
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_managed_one_pending_purchase
    ON co_managed_purchase_operations (tenant) WHERE state IN ('preparing', 'checkout')`);
  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS installed");
  if (citus.rows[0].installed) {
    const distributed = await knex.raw("SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'co_managed_purchase_operations'::regclass");
    if (!distributed.rows.length) await knex.raw("SELECT create_distributed_table('co_managed_purchase_operations', 'tenant', colocate_with => 'tenants')");
  }
};
exports.down = async function down(knex) {
  if (await knex('co_managed_purchase_operations').first()) throw new Error('Cannot discard co-managed purchase history');
  await knex.schema.dropTable('co_managed_purchase_operations');
};
exports.config = { transaction: false };
