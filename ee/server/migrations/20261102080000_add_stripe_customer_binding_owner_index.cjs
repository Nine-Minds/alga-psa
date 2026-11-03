exports.up = async function up(knex) {
  await knex.raw(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS stripe_customer_bindings_owner_key
    ON stripe_customer_bindings (tenant, stripe_customer_external_id)`);
};

exports.down = async function down(knex) {
  const index = await knex.raw(`SELECT to_regclass('stripe_customer_bindings_owner_key') AS relation`);
  if (!index.rows[0].relation) return;
  const owned = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conindid = ?::regclass`, [index.rows[0].relation]);
  if (!owned.rows.length) await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS stripe_customer_bindings_owner_key`);
};

exports.config = { transaction: false };
