exports.up = async function (knex) {
  await knex.raw(`
    UPDATE tenant_external_entity_mappings
    SET alga_entity_type = 'tax_code',
        updated_at = NOW()
    WHERE alga_entity_type = 'tax_region'
      AND integration_type IN ('quickbooks_online', 'quickbooks_csv');
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    UPDATE tenant_external_entity_mappings
    SET alga_entity_type = 'tax_region',
        updated_at = NOW()
    WHERE alga_entity_type = 'tax_code'
      AND integration_type IN ('quickbooks_online', 'quickbooks_csv');
  `);
};

