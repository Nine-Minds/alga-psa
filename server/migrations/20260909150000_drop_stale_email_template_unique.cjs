/**
 * Migration: Drop the stale (tenant, name) unique constraint on tenant_email_templates.
 *
 * 20250916150719_add_language_to_email_templates replaced the per-name
 * uniqueness with (tenant, name, language_code), but dropped the old
 * constraint under the wrong name: the table was created with knex's
 * table.unique(['tenant', 'name']), which names the constraint
 * tenant_email_templates_tenant_name_unique, while the migration dropped
 * tenant_email_templates_tenant_name_key. The leftover two-column constraint
 * rejects every tenant template in a second language with a duplicate key
 * error, breaking both template customization and email branding apply for
 * non-default languages.
 */

const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

exports.up = async function (knex) {
  await ensureSequentialMode(knex);
  await knex.raw('ALTER TABLE tenant_email_templates DROP CONSTRAINT IF EXISTS tenant_email_templates_tenant_name_unique');
};

exports.down = async function (knex) {
  // Intentionally left blank: restoring the (tenant, name) constraint would
  // fail wherever per-language rows now exist, and the intended uniqueness
  // (tenant, name, language_code) is owned by 20250916150719.
};

exports.config = { transaction: false };
