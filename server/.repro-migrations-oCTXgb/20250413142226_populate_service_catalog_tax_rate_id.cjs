const BATCH_SIZE = 1000; // Process in batches to avoid memory issues

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('Starting data migration to populate service_catalog.tax_rate_id...');

  let offset = 0;
  let processedCount = 0;
  let updatedCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const services = await knex('service_catalog')
      .select('service_id', 'region_code', 'is_taxable', 'tenant')
      .orderBy('tenant') // Order for potentially better batching/locality
      .orderBy('service_id')
      .limit(BATCH_SIZE)
      .offset(offset);

    if (services.length === 0) {
      break; // No more services to process
    }

    console.log(`Processing batch of ${services.length} services (offset: ${offset})...`);

    for (const service of services) {
      let targetTaxRateId = null;

      if (service.is_taxable === true && service.region_code) {
        try {
          // Find active tax rates for the service's region and tenant, valid today
          const activeRates = await knex('tax_rates')
            .where({
              tenant: service.tenant,
              region_code: service.region_code,
              is_active: true
            })
            .andWhere('start_date', '<=', knex.fn.now())
            .andWhere(builder => {
              builder.whereNull('end_date').orWhere('end_date', '>=', knex.fn.now())
            })
            .select('tax_rate_id');

          if (activeRates.length === 1) {
            targetTaxRateId = activeRates[0].tax_rate_id;
          } else if (activeRates.length === 0) {
            console.warn(`Migration Warning: No active tax rate found for service_id: ${service.service_id}, tenant: ${service.tenant}, region_code: ${service.region_code}. Setting tax_rate_id to NULL.`);
            targetTaxRateId = null;
          } else {
            console.error(`Migration Error: Ambiguous tax rates found for service_id: ${service.service_id}, tenant: ${service.tenant}, region_code: ${service.region_code}. Found rates: ${activeRates.map(r => r.tax_rate_id).join(', ')}. Setting tax_rate_id to NULL.`);
            targetTaxRateId = null; // Set to NULL as per defined strategy
          }
        } catch (error) {
            console.error(`Error querying tax rates for service ${service.service_id}, tenant ${service.tenant}, region ${service.region_code}:`, error);
            // Decide how to handle query errors, e.g., skip update or set to NULL
            targetTaxRateId = null;
        }
      } else {
        // Service is not taxable or has no region code - set tax_rate_id to NULL
        targetTaxRateId = null;
      }

      // Update the service_catalog row only if the target ID is not null
      // Or always update to ensure NULLs are set correctly? Let's always update.
      try {
        const updateResult = await knex('service_catalog')
          .where({ tenant: service.tenant, service_id: service.service_id })
          .update({ tax_rate_id: targetTaxRateId });

        if (updateResult > 0 && targetTaxRateId !== null) {
            updatedCount++;
        }
      } catch (error) {
          console.error(`Error updating service ${service.service_id}, tenant ${service.tenant}:`, error);
          // Handle update errors if necessary
      }
    }

    processedCount += services.length;
    offset += BATCH_SIZE;
  }

  console.log(`Finished data migration. Processed ${processedCount} services. Updated ${updatedCount} services with a non-NULL tax_rate_id.`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Reversing the population logic precisely is complex.
  // The simplest rollback is to set all tax_rate_id back to NULL.
  console.log('Rolling back data migration: Setting service_catalog.tax_rate_id to NULL for all rows...');
  await knex('service_catalog').update({ tax_rate_id: null });
  console.log('Finished rolling back data migration.');
};
