'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Helper function to generate region_code from original string
  const generateRegionCode = (regionString) => {
    if (!regionString) return null;
    // Simple generation: uppercase, replace non-alphanumeric with hyphen, collapse hyphens
    return regionString
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  await knex.transaction(async (trx) => {
    // --- Step 1: Collect all distinct original region strings per tenant ---
    // Read directly from the original columns before they are dropped by later migrations.
    const distinctRegions = new Map(); // Map<tenant, Set<originalRegionString>>

    const taxRateRegions = await trx('tax_rates')
      .select('tenant', 'region as original_region') // Use original column name
      .whereNotNull('region')
      .whereRaw("region <> ''")
      .distinctOn('tenant', 'region');

    const companyRegions = await trx('companies')
      .select('tenant', 'tax_region as original_region') // Use original column name
      .whereNotNull('tax_region')
      .whereRaw("tax_region <> ''")
      .distinctOn('tenant', 'tax_region');

    const serviceCatalogRegions = await trx('service_catalog')
      .select('tenant', 'tax_region as original_region') // Use original column name
      .whereNotNull('tax_region')
      .whereRaw("tax_region <> ''")
      .distinctOn('tenant', 'tax_region');

    const processRegions = (records) => {
      for (const record of records) {
        const tenant = record.tenant;
        const originalRegion = record.original_region?.trim();
        if (tenant && originalRegion) {
          if (!distinctRegions.has(tenant)) {
            distinctRegions.set(tenant, new Set());
          }
          distinctRegions.get(tenant).add(originalRegion);
        }
      }
    };

    processRegions(taxRateRegions);
    processRegions(companyRegions);
    processRegions(serviceCatalogRegions);

    // --- Step 2: Populate tax_regions table ---
    const regionsToInsert = [];
    for (const [tenant, originalRegionsSet] of distinctRegions.entries()) {
      for (const originalRegion of originalRegionsSet) {
        const regionCode = generateRegionCode(originalRegion);
        const regionName = originalRegion; // Use the trimmed original string as name

        if (regionCode) {
          regionsToInsert.push({
            region_code: regionCode,
            region_name: regionName,
            is_active: true, // Default to active
            tenant: tenant,
          });
        } else {
           console.warn(`Generated null region_code for tenant ${tenant}, original region "${originalRegion}"`);
        }
      }
    }

    if (regionsToInsert.length > 0) {
      console.log(`Populating tax_regions with ${regionsToInsert.length} entries...`);
      // Insert into tax_regions, ignoring conflicts on the primary key (tenant, region_code)
      // This handles cases where different original strings might normalize to the same code.
      // The first one encountered wins.
      await trx('tax_regions')
        .insert(regionsToInsert)
        .onConflict(['tenant', 'region_code'])
        .ignore();
    } else {
      console.log('No distinct regions found to populate tax_regions.');
    }
  }); // End transaction
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Basic rollback: Delete all data potentially added by this migration.
  // This assumes no manual additions happened between 'up' and 'down'.
  // It doesn't restore the previous state, just cleans up what this script did.
  console.log('Rolling back tax_regions population. Deleting all entries...');
  await knex('tax_regions').delete();
};