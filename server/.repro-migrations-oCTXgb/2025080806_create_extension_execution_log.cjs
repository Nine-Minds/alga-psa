/** EE-only migration: extension_execution_log */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('extension_execution_log');
  if (exists) {
    return;
  }

  await knex.schema.createTable('extension_execution_log', (t) => {
    t.uuid('id').primary();
    t.string('tenant_id').notNullable();
    t.uuid('install_id').notNullable().references('id').inTable('tenant_extension_install');
    t.string('request_id').notNullable();
    t.string('extension_id').notNullable();
    t.string('version_id').notNullable();
    t.string('content_hash').notNullable();
    t.integer('status').notNullable();
    t.integer('duration_ms').notNullable();
    t.integer('memory_mb').defaultTo(null);
    t.integer('fuel').defaultTo(null);
    t.string('error_code').defaultTo(null);
    t.text('error_message').defaultTo(null);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'created_at']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('extension_execution_log');
};
