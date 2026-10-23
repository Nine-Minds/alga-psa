/**
 * Per-RMM-organization people mode (FR-D3).
 *
 * `off` ignores the signed-in user entirely, `suggest` (the default, so nothing
 * auto-assigns until an MSP opts in) computes a match for the details page but
 * writes nothing on sync, and `auto` assigns matched devices during sync.
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('rmm_organization_mappings', 'contact_assignment_mode');
  if (hasColumn) return;

  await knex.schema.alterTable('rmm_organization_mappings', (table) => {
    table.text('contact_assignment_mode').notNullable().defaultTo('suggest');
  });

  await knex.raw(`
    ALTER TABLE rmm_organization_mappings
    ADD CONSTRAINT rmm_organization_mappings_contact_assignment_mode_check
    CHECK (contact_assignment_mode IN ('off', 'suggest', 'auto'))
  `);
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('rmm_organization_mappings', 'contact_assignment_mode');
  if (!hasColumn) return;
  await knex.raw(
    'ALTER TABLE rmm_organization_mappings DROP CONSTRAINT IF EXISTS rmm_organization_mappings_contact_assignment_mode_check'
  );
  await knex.schema.alterTable('rmm_organization_mappings', (table) => {
    table.dropColumn('contact_assignment_mode');
  });
};
