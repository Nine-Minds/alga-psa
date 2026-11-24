/**
 * The brand decoration a derived tenant email template was written with.
 *
 * Provenance (20261123090000) records the system template and palette a row was derived from.
 * The brand decoration — logo tag (variant, alt) and the "Powered by AlgaPSA" line — is part of
 * that derivation too: the resolver replays it instead of re-reading the tenant's current
 * settings, so a derived row sends with exactly the brand assets it was written with.
 *
 *   derived_decoration  jsonb  { logo?: { variant, alt }, hideAttribution: boolean }
 *                       — the options `decorateBrandedHtml` takes.
 *
 * Null on every existing row. A row stamped without it (development and review data only;
 * production was never backfilled) is not served as derived until the backfill re-stamps it.
 * Nullable, no default, no index: existing rows keep their behaviour exactly.
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('tenant_email_templates', 'derived_decoration'))) {
    await knex.schema.alterTable('tenant_email_templates', (table) => {
      table.jsonb('derived_decoration').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('tenant_email_templates', 'derived_decoration')) {
    await knex.schema.alterTable('tenant_email_templates', (table) => {
      table.dropColumn('derived_decoration');
    });
  }
};
