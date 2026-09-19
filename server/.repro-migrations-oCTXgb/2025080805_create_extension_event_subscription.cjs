/** EE-only migration: extension_event_subscription */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('extension_event_subscription');
  if (exists) {
    return;
  }

  await knex.schema.createTable('extension_event_subscription', (t) => {
    t.uuid('id').primary();
    t.string('tenant_id').notNullable();
    t.uuid('install_id').notNullable().references('id').inTable('tenant_extension_install').onDelete('CASCADE');
    t.string('topic').notNullable();
    t.string('handler').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'topic']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('extension_event_subscription');
};
