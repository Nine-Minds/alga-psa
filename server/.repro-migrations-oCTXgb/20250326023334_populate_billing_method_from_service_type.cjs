/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('Populating billing_method based on old service_type...');

  // Fetch all services with their old service_type and tenant
  const services = await knex('service_catalog').select('service_id', 'service_type', 'tenant');

  console.log(`Found ${services.length} services to update.`);

  // Update billing_method based on old service_type
  for (const service of services) {
    let billingMethod = null;

    switch (service.service_type) {
      case 'Fixed':
      case 'License':
        billingMethod = 'fixed';
        break;
      case 'Time':
      case 'Usage':
      case 'Product':
        billingMethod = 'per_unit';
        break;
      default:
        console.warn(`Unknown service_type '${service.service_type}' for service_id ${service.service_id}. Setting billing_method to NULL.`);
        // Keep billingMethod as null or decide on a default
        break;
    }

    if (billingMethod) {
      try {
        await knex('service_catalog')
          .where({ service_id: service.service_id, tenant: service.tenant }) // Include tenant for CitusDB
          .update({ billing_method: billingMethod });
      } catch (error) {
         console.error(`Error updating service ${service.service_id} (tenant: ${service.tenant}):`, error);
         // Decide if you want to throw the error and stop, or continue
         // throw error; 
      }
    }
  }
  console.log('Finished populating billing_method.');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Revert billing_method to NULL. A true rollback is complex as the original state isn't stored.
  console.log('Reverting billing_method population (setting to NULL)...');
  await knex('service_catalog')
    .update({ billing_method: null });
  console.log('Finished reverting billing_method population.');
};
