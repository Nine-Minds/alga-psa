/**
 * Seed to ensure tenant-specific service types exist based on standard types.
 * Moved from migration 20250326202048.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  // Fetch all tenant IDs (using the correct column name 'tenant')
  const tenants = await knex('tenants').select('tenant');

  // Fetch all standard service types
  const standardTypes = await knex('standard_service_types').select('id', 'name', 'billing_method');

  // Log fetched counts
  console.log(`[SEED 22a_ensure_tenant_service_types] Fetched ${tenants.length} tenants.`);
  console.log(`[SEED 22a_ensure_tenant_service_types] Fetched ${standardTypes.length} standard service types: ${standardTypes.map(st => st.name).join(', ')}`);

  if (!tenants.length || !standardTypes.length) {
    console.log('[SEED 22a_ensure_tenant_service_types] No tenants or standard service types found, skipping population.');
    return;
  }

  // Explicitly check and insert for each tenant and standard type
  console.log(`[SEED 22a_ensure_tenant_service_types] Processing ${tenants.length} tenants and ${standardTypes.length} standard types...`);
  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const tenant of tenants) {
    const tenantId = tenant.tenant;
    for (const stdType of standardTypes) {
      try {
        // Check if this service type already exists for this tenant
        const existingType = await knex('service_types')
          .where({ tenant_id: tenantId, name: stdType.name })
          .first();

        if (!existingType) {
          // Insert if it doesn't exist
          await knex('service_types').insert({
            tenant_id: tenantId,
            name: stdType.name,
            standard_service_type_id: stdType.id,
            is_active: true,
            billing_method: stdType.billing_method || 'per_unit', // Use the billing_method from standard type or default to 'per_unit'
          });
          insertedCount++;
          // console.log(`Inserted service type '${stdType.name}' for tenant ${tenantId}`);
        } else {
          // Skip if it already exists
          skippedCount++;
          // console.log(`Skipped existing service type '${stdType.name}' for tenant ${tenantId}`);
        }
      } catch (error) {
        console.error(`[SEED 22a] Error processing service type '${stdType.name}' for tenant ${tenantId}:`, error);
        errorCount++;
        // Decide if you want to throw or just log and continue
        // throw error; // Uncomment to halt on error
      }
    }
  }
  console.log(`[SEED 22a_ensure_tenant_service_types] Finished. Inserted: ${insertedCount}, Skipped/Existing: ${skippedCount}, Errors: ${errorCount}`);
};