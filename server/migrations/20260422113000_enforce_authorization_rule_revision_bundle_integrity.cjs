/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('authorization_bundle_revisions', (table) => {
    table.unique(
      ['tenant', 'bundle_id', 'revision_id'],
      'authorization_bundle_revisions_tenant_bundle_revision_unique'
    );
  });

  await knex.schema.alterTable('authorization_bundle_rules', (table) => {
    table.dropForeign(['tenant', 'revision_id']);
    table
      .foreign(['tenant', 'bundle_id', 'revision_id'])
      .references(['tenant', 'bundle_id', 'revision_id'])
      .inTable('authorization_bundle_revisions')
      .onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('authorization_bundle_rules', (table) => {
    table.dropForeign(['tenant', 'bundle_id', 'revision_id']);
    table
      .foreign(['tenant', 'revision_id'])
      .references(['tenant', 'revision_id'])
      .inTable('authorization_bundle_revisions')
      .onDelete('CASCADE');
  });

  await knex.schema.alterTable('authorization_bundle_revisions', (table) => {
    table.dropUnique(
      ['tenant', 'bundle_id', 'revision_id'],
      'authorization_bundle_revisions_tenant_bundle_revision_unique'
    );
  });
};
