/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS authorization_bundle_revisions_single_draft_idx
    ON authorization_bundle_revisions (tenant, bundle_id)
    WHERE lifecycle_state = 'draft'
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS authorization_bundle_revisions_single_published_idx
    ON authorization_bundle_revisions (tenant, bundle_id)
    WHERE lifecycle_state = 'published'
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS authorization_bundle_revisions_single_published_idx');
  await knex.raw('DROP INDEX IF EXISTS authorization_bundle_revisions_single_draft_idx');
};
