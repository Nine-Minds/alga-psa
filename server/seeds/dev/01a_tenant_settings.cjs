exports.seed = function(knex) {
  // Initialize tenant_settings for all seeded tenants
  // Set onboarding_skipped to true since these are development/seed tenants
  // that don't need to go through the onboarding process
  
  // First, delete any existing tenant_settings entries to ensure clean state
  return knex('tenant_settings').del()
    .then(function () {
      // Get all existing tenants from the seed data
      return knex('tenants').select('tenant');
    })
    .then(function (tenants) {
      if (tenants && tenants.length > 0) {
        // Insert tenant_settings for each seeded tenant
        const tenantSettingsData = tenants.map(tenant => ({
          tenant: tenant.tenant,
          onboarding_completed: false,
          onboarding_skipped: true,  // Skip onboarding for seeded tenants
          onboarding_data: null,
          settings: null,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now()
        }));
        
        return knex('tenant_settings').insert(tenantSettingsData)
          .then(function() {
            console.log(`✓ Initialized tenant_settings for ${tenants.length} seeded tenant(s) with onboarding_skipped=true`);
          });
      } else {
        console.log('⚠ No tenants found, skipping tenant_settings initialization');
        return Promise.resolve();
      }
    });
};