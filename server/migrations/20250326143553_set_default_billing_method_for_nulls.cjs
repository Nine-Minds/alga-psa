/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('Ensuring all services have a non-null billing_method (fixed/per_unit)...');

  // Fetch all services with their service_type and tenant, regardless of current billing_method
  const services = await knex('service_catalog').select('service_id', 'service_type', 'tenant');

  console.log(`Found ${services.length} services to check/update.`);
  let updatedCount = 0;
  let errorCount = 0;

  for (const service of services) {
    let targetBillingMethod;

    // Determine the target billing_method based on service_type
    switch (service.service_type) {
      case 'Time':
      case 'Usage':
      case 'Product':
        targetBillingMethod = 'per_unit';
        break;
      default:
        // All other types, including 'Fixed', 'License', and any unknown/legacy types, default to 'fixed'
        targetBillingMethod = 'fixed';
        break;
    }

    try {
      // Update the service with the determined billing_method
      // This ensures even rows potentially missed by the previous migration are corrected.
      const result = await knex('service_catalog')
        .where({ service_id: service.service_id, tenant: service.tenant }) // Include tenant for CitusDB
        .update({ billing_method: targetBillingMethod });
      
      if (result > 0) {
         updatedCount++;
      }
    } catch (error) {
       errorCount++;
       console.error(`Error updating service ${service.service_id} (tenant: ${service.tenant}) to ${targetBillingMethod}:`, error);
       // Log the error but continue processing other services
    }
  }

  console.log(`Finished processing services. Updated: ${updatedCount}, Errors: ${errorCount}.`);
  if (errorCount > 0) {
    console.warn('Some services encountered errors during update. Check logs for details.');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // This migration corrects/sets values based on existing data.
  // A direct rollback isn't practical as the original state (potentially mixed NULLs and values) isn't stored.
  // If rollback is needed, the previous state would need manual restoration or a different strategy.
  console.log('Skipping rollback for migration set_default_billing_method_for_nulls. Manual intervention required if needed.');
};
