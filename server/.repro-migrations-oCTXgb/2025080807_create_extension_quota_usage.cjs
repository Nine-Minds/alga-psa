/** EE-only migration: extension_quota_usage */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('extension_quota_usage');
  if (exists) {
    return;
  }

  await knex.schema.createTable('extension_quota_usage', (t) => {
    t.uuid('id').primary();
    t.string('tenant_id').notNullable();
    t.uuid('install_id').notNullable().references('id').inTable('tenant_extension_install');
    t.string('metric').notNullable(); // e.g., executions, egress_bytes
    t.bigInteger('value').notNullable().defaultTo(0);
    t.timestamp('window_start').notNullable();
    t.timestamp('window_end').notNullable();
    t.unique(['tenant_id', 'install_id', 'metric', 'window_start', 'window_end']);
    t.index(['tenant_id', 'metric']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('extension_quota_usage');
};
