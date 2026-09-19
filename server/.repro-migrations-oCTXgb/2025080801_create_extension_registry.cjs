/** EE-only migration: extension_registry */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('extension_registry');
  if (exists) {
    return;
  }

  await knex.schema.createTable('extension_registry', (t) => {
    t.uuid('id').primary();
    t.string('publisher').notNullable();
    t.string('name').notNullable();
    t.string('display_name');
    t.text('description');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['publisher', 'name']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('extension_registry');
};
