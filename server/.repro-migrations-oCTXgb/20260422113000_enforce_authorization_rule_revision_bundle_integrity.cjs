/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const driftRows = await knex('authorization_bundle_rules as r')
    .join('authorization_bundle_revisions as rev', function joinRevision() {
      this.on('rev.tenant', '=', 'r.tenant').andOn('rev.revision_id', '=', 'r.revision_id');
    })
    .whereRaw('r.bundle_id <> rev.bundle_id')
    .count('* as count')
    .first();

  if (Number(driftRows?.count || 0) > 0) {
    throw new Error(
      'Cannot enforce authorization rule/revision bundle integrity because existing rule rows reference a different bundle than their revision. Repair the drifted rows before re-running migration 20260422113000.'
    );
  }

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
