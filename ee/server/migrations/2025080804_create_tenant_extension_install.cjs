/** EE-only migration: tenant_extension_install */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('tenant_extension_install');
  if (exists) {
    return;
  }

  await knex.schema.createTable('tenant_extension_install', (t) => {
    t.uuid('id').primary();
    t.string('tenant_id').notNullable();
    t.uuid('registry_id').notNullable().references('id').inTable('extension_registry').onDelete('CASCADE');
    t.uuid('version_id').notNullable().references('id').inTable('extension_version');
    t.jsonb('granted_caps').notNullable().defaultTo('[]');
    t.jsonb('config').notNullable().defaultTo('{}');
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('installed_at').defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'registry_id']);
    t.index(['tenant_id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('tenant_extension_install');
};
