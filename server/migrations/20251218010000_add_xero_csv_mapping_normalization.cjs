/**
 * Migration: Add xero_csv to mapping type normalization
 *
 * This migration ensures that xero_csv mappings use the normalized entity types
 * (client instead of company, tax_code instead of tax_region) consistent with
 * other accounting adapters.
 */

exports.up = async function (knex) {
  // Normalize company -> client for xero_csv
  await knex.raw(`
    UPDATE tenant_external_entity_mappings m
    SET alga_entity_type = 'client',
        updated_at = NOW()
    WHERE m.alga_entity_type = 'company'
      AND m.integration_type = 'xero_csv'
      AND EXISTS (
        SELECT 1
        FROM clients c
        WHERE c.tenant = m.tenant
          AND c.client_id::text = m.alga_entity_id
      );
  `);

  // Normalize tax_region -> tax_code for xero_csv and xero
  await knex.raw(`
    UPDATE tenant_external_entity_mappings
    SET alga_entity_type = 'tax_code',
        updated_at = NOW()
    WHERE alga_entity_type = 'tax_region'
      AND integration_type IN ('xero', 'xero_csv');
  `);
};

exports.down = async function (knex) {
  // Revert client -> company for xero_csv
  await knex.raw(`
    UPDATE tenant_external_entity_mappings m
    SET alga_entity_type = 'company',
        updated_at = NOW()
    WHERE m.alga_entity_type = 'client'
      AND m.integration_type = 'xero_csv'
      AND EXISTS (
        SELECT 1
        FROM clients c
        WHERE c.tenant = m.tenant
          AND c.client_id::text = m.alga_entity_id
      );
  `);

  // Revert tax_code -> tax_region for xero_csv and xero
  await knex.raw(`
    UPDATE tenant_external_entity_mappings
    SET alga_entity_type = 'tax_region',
        updated_at = NOW()
    WHERE alga_entity_type = 'tax_code'
      AND integration_type IN ('xero', 'xero_csv');
  `);
};

