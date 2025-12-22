exports.up = async function (knex) {
  await knex.raw(`
    UPDATE tenant_external_entity_mappings m
    SET alga_entity_type = 'client',
        updated_at = NOW()
    WHERE m.alga_entity_type = 'company'
      AND m.integration_type IN ('quickbooks_online', 'xero', 'quickbooks_csv', 'quickbooks_desktop')
      AND EXISTS (
        SELECT 1
        FROM clients c
        WHERE c.tenant = m.tenant
          AND c.client_id::text = m.alga_entity_id
      );
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    UPDATE tenant_external_entity_mappings m
    SET alga_entity_type = 'company',
        updated_at = NOW()
    WHERE m.alga_entity_type = 'client'
      AND m.integration_type IN ('quickbooks_online', 'xero', 'quickbooks_csv', 'quickbooks_desktop')
      AND EXISTS (
        SELECT 1
        FROM clients c
        WHERE c.tenant = m.tenant
          AND c.client_id::text = m.alga_entity_id
      );
  `);
};

