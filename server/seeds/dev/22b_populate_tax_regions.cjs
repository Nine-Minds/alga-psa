'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  // Get the first tenant ID
  const tenantInfo = await knex('tenants').select('tenant').first();
  if (!tenantInfo) {
    console.warn('[SEED 22b_populate_tax_regions] No tenant found, skipping tax region population.');
    return;
  }
  const tenantId = tenantInfo.tenant;

  // Define the tax regions to insert
  const regionsToInsert = [
    {
      tenant: tenantId,
      region_code: 'US-NY',
      region_name: 'New York',
      is_active: true,
    },
    {
      tenant: tenantId,
      region_code: 'US-FL', // Add Florida as well, since tax_rates seed uses it
      region_name: 'Florida',
      is_active: true,
    },
    // Add other necessary regions here if needed
  ];

  console.log(`[SEED 22b_populate_tax_regions] Populating tax regions for tenant ${tenantId}...`);

  // Insert the regions, ignoring conflicts in case they somehow already exist
  await knex('tax_regions')
    .insert(regionsToInsert)
    .onConflict(['tenant', 'region_code'])
    .ignore();

  console.log(`[SEED 22b_populate_tax_regions] Finished populating tax regions.`);
};