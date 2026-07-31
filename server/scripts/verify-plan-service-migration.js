#!/usr/bin/env node

/**
 * Script to verify the plan service configuration migration
 * 
 * This script checks:
 * 1. All plan services have been migrated to the new tables
 * 2. Configuration types match the original plan types
 * 3. All required data is present in the type-specific configuration tables
 * 
 * Usage: node scripts/verify-plan-service-migration.js
 */

const knex = require('knex');
const config = require('../knexfile.cjs');

async function verifyMigration() {
  console.log('Verifying plan service configuration migration...');
  const { tenantDb } = await import('@alga-psa/db');
  
  // Create knex instance
  const db = knex(config.development);
  
  try {
    // Get all tenants
    const tenants = await db('tenants').select('tenant');
    
    let totalPlans = 0;
    let totalOldServices = 0;
    let totalNewConfigurations = 0;
    let missingConfigurations = 0;
    let typeMismatches = 0;
    
    // Process each tenant separately
    for (const { tenant } of tenants) {
      console.log(`\nVerifying tenant: ${tenant}`);
      const tenantFacade = tenantDb(db, tenant);
      const legacyPlanTable = (table) =>
        tenantFacade
          .unscoped(table, 'legacy plan service migration verification reads retired plan service tables')
          .where({ tenant });
      
      // Get all billing plans for this tenant
      const plans = await tenantFacade.table('contract_lines')
        .select('*');
      
      totalPlans += plans.length;
      console.log(`Found ${plans.length} billing plans`);
      
      // Process each plan
      for (const plan of plans) {
        // Get original services
        const oldServices = await legacyPlanTable('plan_services')
          .where({
            'contract_line_id': plan.contract_line_id
          })
          .select('*');
        
        totalOldServices += oldServices.length;
        
        // Get new configurations
        const newConfigurations = await legacyPlanTable('plan_service_configuration')
          .where({
            'contract_line_id': plan.contract_line_id
          })
          .select('*');
        
        totalNewConfigurations += newConfigurations.length;
        
        console.log(`Plan ${plan.contract_line_name} (${plan.contract_line_id}): ${oldServices.length} old services, ${newConfigurations.length} new configurations`);
        
        // Check for missing configurations
        if (oldServices.length !== newConfigurations.length) {
          console.log(`  WARNING: Service count mismatch for plan ${plan.contract_line_name}`);
          missingConfigurations += Math.abs(oldServices.length - newConfigurations.length);
        }
        
        // Check configuration types
        for (const config of newConfigurations) {
          // Verify configuration type matches plan type
          if (plan.contract_line_type !== config.configuration_type) {
            console.log(`  WARNING: Type mismatch for service ${config.service_id} in plan ${plan.contract_line_name}`);
            console.log(`    Plan type: ${plan.contract_line_type}, Configuration type: ${config.configuration_type}`);
            typeMismatches++;
          }
          
          // Verify type-specific configuration exists
          let typeConfigExists = false;
          
          switch (config.configuration_type) {
            case 'Fixed':
              const fixedConfig = await legacyPlanTable('plan_service_fixed_config')
                .where({
                  'config_id': config.config_id
                })
                .first();
              typeConfigExists = !!fixedConfig;
              break;
              
            case 'Hourly':
              const hourlyConfig = await legacyPlanTable('plan_service_hourly_config')
                .where({
                  'config_id': config.config_id
                })
                .first();
              typeConfigExists = !!hourlyConfig;
              break;
              
            case 'Usage':
              const usageConfig = await legacyPlanTable('plan_service_usage_config')
                .where({
                  'config_id': config.config_id
                })
                .first();
              typeConfigExists = !!usageConfig;
              break;
              
            case 'Bucket':
              const bucketConfig = await legacyPlanTable('plan_service_bucket_config')
                .where({
                  'config_id': config.config_id
                })
                .first();
              typeConfigExists = !!bucketConfig;
              break;
          }
          
          if (!typeConfigExists) {
            console.log(`  WARNING: Missing type-specific configuration for service ${config.service_id} in plan ${plan.contract_line_name}`);
          }
        }
      }
    }
    
    // Print summary
    console.log('\n=== Migration Verification Summary ===');
    console.log(`Total plans: ${totalPlans}`);
    console.log(`Total old services: ${totalOldServices}`);
    console.log(`Total new configurations: ${totalNewConfigurations}`);
    
    if (missingConfigurations > 0) {
      console.log(`WARNING: ${missingConfigurations} configurations are missing`);
    } else {
      console.log('All services have been migrated successfully');
    }
    
    if (typeMismatches > 0) {
      console.log(`WARNING: ${typeMismatches} type mismatches found`);
    } else {
      console.log('All configuration types match the original plan types');
    }
    
    if (missingConfigurations === 0 && typeMismatches === 0) {
      console.log('\nMigration verification PASSED');
    } else {
      console.log('\nMigration verification FAILED');
    }
    
  } catch (error) {
    console.error('Error verifying migration:', error);
    process.exit(1);
  } finally {
    // Close the database connection
    await db.destroy();
  }
}

// Run the verification function
verifyMigration();
