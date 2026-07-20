/**
 * Migration: Drop contract_template_compare_view
 *
 * This view was a diagnostic helper for the contract-template hard cutover,
 * comparing legacy templates stored in contracts against the new
 * contract_templates rows. The cutover is complete, nothing in application
 * code queries it, and its sibling contract_template_lines_compare_view was
 * already dropped in 20251207130000. It also broke tenant deletion: the
 * deletion worker detected its tenant column and attempted a DELETE, which
 * fails on a UNION ALL view.
 */

exports.up = async function up(knex) {
  await knex.raw('DROP VIEW IF EXISTS contract_template_compare_view');
};

exports.down = async function down(knex) {
  const hasCompareView = await knex.raw(`
    SELECT EXISTS (
      SELECT FROM pg_views
      WHERE viewname = 'contract_template_compare_view'
    ) AS exists
  `);
  if (hasCompareView.rows[0].exists) {
    return;
  }

  const contractsTableExists = await knex.schema.hasTable('contracts');
  const hasLegacyTemplateFlag = contractsTableExists
    ? await knex.schema.hasColumn('contracts', 'is_template')
    : false;

  const legacyContractsSelect = contractsTableExists
    ? (hasLegacyTemplateFlag
        ? `
    SELECT
      'legacy'::text AS source,
      c.tenant,
      c.contract_id AS template_identifier,
      c.contract_name AS template_name,
      c.contract_description AS template_description,
      c.billing_frequency AS cadence,
      CASE WHEN c.is_active = true THEN 'active' ELSE 'inactive' END AS status,
      NULL::jsonb AS template_metadata,
      c.created_at,
      c.updated_at
    FROM contracts c
    WHERE c.is_template = true`
        : `
    SELECT
      'legacy'::text AS source,
      c.tenant,
      c.contract_id AS template_identifier,
      c.contract_name AS template_name,
      c.contract_description AS template_description,
      c.billing_frequency AS cadence,
      CASE WHEN c.is_active = true THEN 'active' ELSE 'inactive' END AS status,
      NULL::jsonb AS template_metadata,
      c.created_at,
      c.updated_at
    FROM contracts c
    WHERE 1 = 0`)
    : `
    SELECT
      'legacy'::text AS source,
      NULL::uuid AS tenant,
      NULL::uuid AS template_identifier,
      NULL::text AS template_name,
      NULL::text AS template_description,
      NULL::text AS cadence,
      NULL::text AS status,
      NULL::jsonb AS template_metadata,
      NULL::timestamptz AS created_at,
      NULL::timestamptz AS updated_at
    WHERE false`;

  await knex.raw(`
    CREATE VIEW contract_template_compare_view AS
    ${legacyContractsSelect}
    UNION ALL
    SELECT
      'new'::text AS source,
      t.tenant,
      t.template_id AS template_identifier,
      t.template_name,
      t.template_description,
      t.default_billing_frequency AS cadence,
      t.template_status AS status,
      t.template_metadata,
      t.created_at,
      t.updated_at
    FROM contract_templates t
  `);
};
