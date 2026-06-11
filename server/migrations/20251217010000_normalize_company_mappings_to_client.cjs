const isCitusEnabled = async (knex) => {
  const { rows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  return rows.length > 0;
};

const ensureDistributed = async (knex, tableName, distributionColumn) => {
  if (!(await isCitusEnabled(knex))) return;
  const { rows } = await knex.raw(
    'SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass LIMIT 1',
    [tableName]
  );
  if (rows.length > 0) return;
  await knex.raw('SELECT create_distributed_table(?, ?)', [tableName, distributionColumn]);
};

exports.up = async function (knex) {
  // The UPDATE below joins against clients (distributed on fresh Citus
  // chains); Citus cannot join distributed and local tables, so distribute
  // the mappings table first. No-op on plain Postgres and on clusters that
  // already have it.
  await ensureDistributed(knex, 'tenant_external_entity_mappings', 'tenant');

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

