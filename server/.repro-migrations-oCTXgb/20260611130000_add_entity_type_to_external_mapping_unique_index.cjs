/**
 * Migration: include alga_entity_type in the external-mapping unique index.
 *
 * QBO entity ids are independent per-type sequences (Item 3, Term 3, TaxCode 3
 * and Customer 3 are all distinct records), so uniqueness on
 * (tenant, integration_type, external_entity_id, realm) rejects legitimate
 * mappings across types — e.g. mapping a customer whose QBO id equals an
 * already-mapped item's id. Scope the uniqueness to the entity type; the
 * real invariant is "one Alga entity per external entity of a given type".
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (tenant, integration_type, external_entity_id, COALESCE(external_realm_id, ''))
  `);
};

exports.config = { transaction: false };
