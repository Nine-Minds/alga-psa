/**
 * Adds a logo variant discriminator so an entity can keep one logo per variant
 * (light "default" plus an optional "dark" one for dark surfaces).
 *
 * The column is NOT NULL DEFAULT 'default', which PG11+ applies as metadata only
 * (no table rewrite, no backfill). Every existing row and every insert path that
 * omits the column keeps reading/writing 'default', so the "single logo per
 * entity" invariant is unchanged for existing data.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE document_associations
    ADD COLUMN IF NOT EXISTS entity_logo_variant text NOT NULL DEFAULT 'default';
  `);

  await knex.raw('DROP INDEX IF EXISTS uq_document_associations_single_true_logo;');

  // Distribution column `tenant` stays leading so the unique index remains
  // Citus-safe on the distributed table.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_document_associations_single_true_logo
    ON document_associations (tenant, entity_id, entity_type, entity_logo_variant)
    WHERE is_entity_logo = TRUE;
  `);
};

exports.down = async function down(knex) {
  // Keep only the default-variant logos so the original single-logo index can be
  // recreated without collisions.
  await knex('document_associations')
    .where('is_entity_logo', true)
    .andWhereNot('entity_logo_variant', 'default')
    .update({ is_entity_logo: false });

  await knex.raw('DROP INDEX IF EXISTS uq_document_associations_single_true_logo;');

  await knex.raw(`
    CREATE UNIQUE INDEX uq_document_associations_single_true_logo
    ON document_associations (tenant, entity_id, entity_type)
    WHERE is_entity_logo = TRUE;
  `);

  await knex.raw(`
    ALTER TABLE document_associations
    DROP COLUMN IF EXISTS entity_logo_variant;
  `);
};
