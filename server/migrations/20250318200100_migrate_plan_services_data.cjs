/**
 * Migration to transfer data from plan_services to the new plan_service_configuration tables
 * This script follows CitusDB compatibility requirements:
 * - Process records in batches by tenant
 * - Use transactions to ensure data consistency
 * - Always include tenant in WHERE clauses
 */
exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  
  // Process each tenant separately
  for (const { tenant } of tenants) {
    console.log(`Migrating plan services for tenant: ${tenant}`);

    // Get all contract lines for this tenant
    const plans = await knex('billing_plans')
      .where({ tenant })
      .select('*');
    
    // Process each plan
    for (const plan of plans) {
      await knex.transaction(async (trx) => {
        // Get services for this plan
        const services = await trx('plan_services')
          .where({
            'plan_id': plan.plan_id,
            'tenant': tenant
          })
          .select('*');
        
        // Skip if no services found
        if (!services || services.length === 0) {
          console.log(`No services found for plan ${plan.plan_name} (${plan.plan_id})`);
          return;
        }
        
        console.log(`Migrating ${services.length} services for plan ${plan.plan_name} (${plan.plan_id})`);
        
        // Create configurations for each service
        for (const service of services) {
          // Get service details to determine appropriate configuration type
          const serviceDetails = await trx('service_catalog')
            .where({
              'service_id': service.service_id,
              'tenant': tenant
            })
            .first();
          
          if (!serviceDetails) {
            console.log(`Service ${service.service_id} not found, skipping`);
            continue;
          }
          
          // Determine configuration type based on plan type and service type
          let configurationType;
          
          // Map plan_type to configuration_type
          switch (plan.plan_type) {
            case 'Fixed':
              configurationType = 'Fixed';
              break;
            case 'Hourly':
              configurationType = 'Hourly';
              break;
            case 'Usage':
              configurationType = 'Usage';
              break;
            case 'Bucket':
              configurationType = 'Bucket';
              break;
            default:
              // Default to Fixed if unknown
              configurationType = 'Fixed';
          }
          
          // Insert base configuration
          const result = await trx('plan_service_configuration')
            .insert({
              plan_id: plan.plan_id,
              service_id: service.service_id,
              configuration_type: configurationType,
              custom_rate: service.custom_rate,
              quantity: service.quantity,
              tenant: tenant,
              created_at: new Date(),
              updated_at: new Date()
            })
            .returning('config_id');
          
          // Extract the config_id value from the result
          const configId = result[0].config_id || result[0];
          
          // Insert type-specific configuration
          switch (configurationType) {
            case 'Fixed':
              await trx('plan_service_fixed_config')
                .insert({
                  config_id: configId,
                  enable_proration: false, // Default value
                  billing_cycle_alignment: 'start', // Default value
                  tenant: tenant,
                  created_at: new Date(),
                  updated_at: new Date()
                });
              break;
              
            case 'Hourly':
              await trx('plan_service_hourly_config')
                .insert({
                  config_id: configId,
                  minimum_billable_time: 15, // Default value
                  round_up_to_nearest: 15, // Default value
                  enable_overtime: false, // Default value
                  tenant: tenant,
                  created_at: new Date(),
                  updated_at: new Date()
                });
              break;
              
            case 'Usage':
              await trx('plan_service_usage_config')
                .insert({
                  config_id: configId,
                  unit_of_measure: 'Unit', // Default value
                  enable_tiered_pricing: false, // Default value
                  minimum_usage: 0, // Default value
                  tenant: tenant,
                  created_at: new Date(),
                  updated_at: new Date()
                });
              
              // Check if there are service rate tiers to migrate
              const serviceTiers = await trx('service_rate_tiers')
                .where({
                  'service_id': service.service_id,
                  'tenant': tenant
                })
                .select('*');
              
              // Migrate service rate tiers if they exist
              if (serviceTiers && serviceTiers.length > 0) {
                // Update usage config to enable tiered pricing
                await trx('plan_service_usage_config')
                  .where({
                    'config_id': configId,
                    'tenant': tenant
                  })
                  .update({
                    enable_tiered_pricing: true,
                    updated_at: new Date()
                  });
                
                // Create plan service rate tiers
                for (const tier of serviceTiers) {
                  await trx('plan_service_rate_tiers')
                    .insert({
                      config_id: configId,
                      min_quantity: tier.min_quantity,
                      max_quantity: tier.max_quantity,
                      rate: tier.rate,
                      tenant: tenant,
                      created_at: new Date(),
                      updated_at: new Date()
                    });
                }
              }
              break;
              
            case 'Bucket':
              // For bucket plans, we need to get the bucket plan details
              const bucketPlan = await trx('bucket_plans')
                .where({
                  'plan_id': plan.plan_id,
                  'tenant': tenant
                })
                .first();
              
              await trx('plan_service_bucket_config')
                .insert({
                  config_id: configId,
                  total_hours: bucketPlan ? bucketPlan.total_hours : 0,
                  billing_period: bucketPlan ? bucketPlan.billing_period : 'monthly',
                  overage_rate: bucketPlan ? bucketPlan.overage_rate : 0,
                  allow_rollover: bucketPlan ? bucketPlan.allow_rollover : false,
                  tenant: tenant,
                  created_at: new Date(),
                  updated_at: new Date()
                });
              break;
          }
        }
      });
    }
  }
  
  console.log('Data migration completed successfully');
};

exports.down = async function(knex) {
  // This is a data migration, so the down function would be complex
  // and potentially destructive. It's safer to handle rollbacks manually
  // if needed, or restore from a backup.
  console.log('Warning: down migration not implemented for data migration');
};