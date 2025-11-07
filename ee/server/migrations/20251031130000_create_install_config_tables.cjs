/** EE-only migration: tenant_extension_install config + secrets */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('tenant_extension_install_config', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('install_id').notNullable().references('id').inTable('tenant_extension_install').onDelete('CASCADE');
    t.string('tenant_id').notNullable();
    t.jsonb('config').notNullable().defaultTo('{}');
    t.jsonb('providers').notNullable().defaultTo('[]');
    t.string('version').notNullable().defaultTo(knex.raw("gen_random_uuid()::text"));
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['install_id']);
    t.index(['tenant_id']);
    t.index(['install_id', 'version']);
  });

  await knex.schema.createTable('tenant_extension_install_secrets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('install_id').notNullable().references('id').inTable('tenant_extension_install').onDelete('CASCADE');
    t.string('tenant_id').notNullable();
    t.text('ciphertext').notNullable();
    t.string('algorithm').notNullable().defaultTo('inline/base64');
    t.string('transit_key').nullable();
    t.string('transit_mount').nullable();
    t.string('version').nullable();
    t.timestamp('expires_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['install_id']);
    t.index(['tenant_id']);
    t.index(['install_id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('tenant_extension_install_secrets');
  await knex.schema.dropTableIfExists('tenant_extension_install_config');
};
