/** EE-only migration: extension_bundle */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('extension_bundle');
  if (exists) {
    return;
  }

  await knex.schema.createTable('extension_bundle', (t) => {
    t.uuid('id').primary();
    t.uuid('version_id').notNullable().references('id').inTable('extension_version').onDelete('CASCADE');
    t.string('content_hash').notNullable();
    t.text('signature');
    t.jsonb('precompiled').defaultTo(null); // target-triple -> path
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['version_id', 'content_hash']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('extension_bundle');
};
