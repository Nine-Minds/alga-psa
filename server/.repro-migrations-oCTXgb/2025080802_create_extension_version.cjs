/** EE-only migration: extension_version */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('extension_version');
  if (exists) {
    return;
  }

  await knex.schema.createTable('extension_version', (t) => {
    t.uuid('id').primary();
    t.uuid('registry_id').notNullable().references('id').inTable('extension_registry').onDelete('CASCADE');
    t.string('version').notNullable();
    t.string('runtime').notNullable();
    t.string('main_entry').notNullable();
    t.jsonb('api').notNullable().defaultTo('{}');
    t.jsonb('ui').defaultTo(null);
    t.jsonb('capabilities').notNullable().defaultTo('[]');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['registry_id', 'version']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('extension_version');
};
