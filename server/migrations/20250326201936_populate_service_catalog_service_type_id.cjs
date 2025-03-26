/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Fetch standard service type names for quick lookup
  const standardTypes = await knex('standard_service_types').select('id', 'name');
  const standardTypeNameSet = new Set(standardTypes.map(st => st.name));
  const standardTypeNameToIdMap = new Map(standardTypes.map(st => [st.name, st.id]));

  // Get all distinct tenant/old_service_type pairs from service_catalog that need processing
  const distinctOldTypes = await knex('service_catalog')
    .distinct('tenant', 'service_type')
    .whereNotNull('service_type')
    .whereNull('service_type_id');

  if (!distinctOldTypes.length) {
    console.log('No service_catalog entries need service_type_id population based on old service_type.');
    return;
  }

  // Group by tenant for processing
  const typesByTenant = distinctOldTypes.reduce((acc, { tenant, service_type }) => {
    if (!acc[tenant]) {
      acc[tenant] = [];
    }
    acc[tenant].push(service_type);
    return acc;
  }, {});

  let updatedCount = 0;
  let createdCustomCount = 0;
  let errorCount = 0;

  // Process each tenant
  for (const tenantId in typesByTenant) {
    const oldTypeNames = typesByTenant[tenantId];
    console.log(`Processing tenant ${tenantId} with old types: ${oldTypeNames.join(', ')}`);

    // Fetch existing service_types for this tenant to avoid redundant queries inside the loop
    const existingTenantTypes = await knex('service_types')
        .where('tenant_id', tenantId)
        .select('id', 'name', 'standard_service_type_id');
    const existingTenantTypeNameMap = new Map(existingTenantTypes.map(t => [t.name, t.id]));

    for (const oldTypeName of oldTypeNames) {
      let targetServiceTypeId = null;

      // Check if the old type name matches a standard type name
      if (standardTypeNameSet.has(oldTypeName)) {
        // It's a standard type. Find the corresponding tenant-specific record's ID.
        targetServiceTypeId = existingTenantTypeNameMap.get(oldTypeName);
        if (!targetServiceTypeId) {
          // This should ideally not happen if ensure_tenant_service_types ran correctly
          console.error(`Tenant-specific type for standard type "${oldTypeName}" not found for tenant ${tenantId}. Skipping update for this type.`);
          errorCount++;
          continue; // Skip to the next old type name
        }
      } else {
        // It's a custom type. Check if it already exists for the tenant.
        targetServiceTypeId = existingTenantTypeNameMap.get(oldTypeName);

        if (!targetServiceTypeId) {
          // Custom type doesn't exist yet, create it.
          console.log(`Creating custom service type "${oldTypeName}" for tenant ${tenantId}`);
          try {
            const [newCustomType] = await knex('service_types')
              .insert({
                tenant_id: tenantId,
                name: oldTypeName,
                standard_service_type_id: null, // Explicitly null for custom types
                is_active: true, // Default to active
              })
              .onConflict(['tenant_id', 'name']) // Handle potential race conditions or pre-existing
              .ignore() // If it exists, ignore the insert
              .returning('id'); // Get ID even if ignored (Postgres specific)

            if (newCustomType && newCustomType.id) {
               targetServiceTypeId = newCustomType.id;
               createdCustomCount++;
               // Add to map for subsequent lookups within this tenant's loop
               existingTenantTypeNameMap.set(oldTypeName, targetServiceTypeId);
            } else {
               // If insert was ignored, re-fetch the ID
               const existingCustomType = await knex('service_types')
                 .where({ tenant_id: tenantId, name: oldTypeName })
                 .first('id');
               if (existingCustomType) {
                 targetServiceTypeId = existingCustomType.id;
                 // Add to map
                 existingTenantTypeNameMap.set(oldTypeName, targetServiceTypeId);
               } else {
                 // Should not happen if insert/ignore/fetch logic is correct
                 console.error(`Failed to create or find custom service type "${oldTypeName}" for tenant ${tenantId}. Skipping update.`);
                 errorCount++;
                 continue; 
               }
            }
          } catch (insertError) {
            console.error(`Error creating custom service type "${oldTypeName}" for tenant ${tenantId}:`, insertError);
            errorCount++;
            continue; // Skip to the next old type name
          }
        }
      }

      // Update service_catalog entries for this tenant and old type name
      if (targetServiceTypeId) {
        try {
          const numUpdated = await knex('service_catalog')
            .where({
              tenant: tenantId,
              service_type: oldTypeName,
            })
            .whereNull('service_type_id') // Corrected: Use whereNull
            .update({ service_type_id: targetServiceTypeId });
          
          updatedCount += numUpdated;
          console.log(`Mapped ${numUpdated} service_catalog entries for tenant ${tenantId} from "${oldTypeName}" to service_type_id ${targetServiceTypeId}`);
        } catch (updateError) {
          console.error(`Error updating service_catalog for tenant ${tenantId}, type "${oldTypeName}":`, updateError);
          errorCount++;
        }
      }
    }
  }

  console.log(`Finished populating service_type_id. Total entries updated: ${updatedCount}. Custom types created: ${createdCustomCount}. Errors encountered: ${errorCount}.`);
  if (errorCount > 0) {
      console.warn(`There were ${errorCount} errors during the service_type_id population. Please review the logs.`);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Set the service_type_id back to null for all rows.
  // Reverting the exact previous state is complex.
  await knex('service_catalog')
    .update({ service_type_id: null });
  // Optionally, delete custom service types created by this migration
  // await knex('service_types').whereNull('standard_service_type_id').del(); // Use with caution!
  console.warn('Rolled back populate_service_catalog_service_type_id migration by setting service_type_id to NULL for all entries. Custom types created during the migration were NOT automatically deleted.');
};
