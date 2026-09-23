/**
 * Consolidate clients.properties.tax_id into clients.tax_id_number.
 * Conflicting legacy UI values are retained as properties.legacy_tax_id while
 * tax_id_number remains canonical for billing, invoices, and integrations.
 */
const { tenantDb } = require('./utils/tenantDb.cjs');
const MIGRATION_TENANT = 'migration:20260923090000_consolidate_client_tax_id';
const TENANT_ENUMERATION_REASON = 'enumerate tenants to consolidate client tax IDs';

exports.consolidateTenant = async function consolidateTenant(knex, tenant) {
  const db = tenantDb(knex, tenant);
  // Preserve a prior legacy_tax_id too if this migration is applied to a row
  // where that audit key already exists; append the new conflict to an array.
  await db.table('clients').where({ tenant })
    .whereRaw("NULLIF(BTRIM(tax_id_number), '') IS NOT NULL")
    .whereRaw("NULLIF(BTRIM(properties->>'tax_id'), '') IS NOT NULL")
    .whereRaw("tax_id_number IS DISTINCT FROM properties->>'tax_id'")
    .update({ properties: knex.raw("jsonb_set(properties - 'tax_id', '{legacy_tax_id}', CASE WHEN jsonb_exists(properties, 'legacy_tax_id') THEN jsonb_build_array(properties->'legacy_tax_id', to_jsonb(properties->>'tax_id')) ELSE to_jsonb(properties->>'tax_id') END, true)") });
  await db.table('clients').where({ tenant })
    .whereRaw("NULLIF(BTRIM(tax_id_number), '') IS NULL")
    .whereRaw("NULLIF(BTRIM(properties->>'tax_id'), '') IS NOT NULL")
    .update({ tax_id_number: knex.raw("BTRIM(properties->>'tax_id')") });
  await db.table('clients').where({ tenant })
    .whereRaw("jsonb_exists(properties, 'tax_id')")
    .update({ properties: knex.raw("properties - 'tax_id'") });
};

exports.up = async function up(knex) {
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  for (const { tenant } of tenants) await exports.consolidateTenant(knex, tenant);
};

exports.down = async function down() {
  // Documented no-op: the legacy key cannot be reconstructed without restoring ambiguity.
};
