/**
 * Provenance for tenant email templates the branding tool wrote.
 *
 * A row the tool wrote is a derived view of a system template: while the tenant
 * has not edited it, the resolver serves the *current* system template in the
 * row's palette and brand decoration instead of the frozen body. These columns
 * record what the row was derived from:
 *
 *   derived_from_system_id  system_email_templates.id the row was derived from
 *   derived_palette         the palette tokens the apply used for this row
 *   derived_snapshot_hash   sha256 of subject\0html\0text as written, so any
 *                           later edit is detectable and cuts the derivation
 *
 * All three are null for rows the tenant owns (and for every existing row until
 * the backfill stamps the ones that provably are untouched derivations).
 * Nullable, no default: existing rows keep their behaviour exactly.
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

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const additions = [
    ['derived_from_system_id', (table) => table.integer('derived_from_system_id').nullable()],
    ['derived_palette', (table) => table.jsonb('derived_palette').nullable()],
    ['derived_snapshot_hash', (table) => table.text('derived_snapshot_hash').nullable()],
  ];

  for (const [column, add] of additions) {
    if (!(await knex.schema.hasColumn('tenant_email_templates', column))) {
      await knex.schema.alterTable('tenant_email_templates', add);
    }
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_tenant_email_templates_derived_from_system_id ON tenant_email_templates (derived_from_system_id)',
  );
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);
  await knex.raw('DROP INDEX IF EXISTS idx_tenant_email_templates_derived_from_system_id');
  for (const column of ['derived_snapshot_hash', 'derived_palette', 'derived_from_system_id']) {
    if (await knex.schema.hasColumn('tenant_email_templates', column)) {
      await knex.schema.alterTable('tenant_email_templates', (table) => table.dropColumn(column));
    }
  }
};

exports.config = { transaction: false };
