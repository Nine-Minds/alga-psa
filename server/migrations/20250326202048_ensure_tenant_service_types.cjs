/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Fetch all tenant IDs (using the correct column name 'tenant')
  const tenants = await knex('tenants').select('tenant');
  
  // Fetch all standard service types
  const standardTypes = await knex('standard_service_types').select('id', 'name');

  if (!tenants.length || !standardTypes.length) {
    console.log('No tenants or standard service types found, skipping population.');
    return;
  }

  // Prepare data for insertion
  const serviceTypesToInsert = [];
  for (const tenant of tenants) {
    for (const stdType of standardTypes) {
      serviceTypesToInsert.push({
        tenant_id: tenant.tenant, // Access the tenant UUID using tenant.tenant
        name: stdType.name, // Use the standard name for the tenant-specific entry
        standard_service_type_id: stdType.id,
        is_active: true, // Default to active
      });
    }
  }

  // Insert the data, ignoring conflicts on (tenant_id, name)
  // Use standard insert with onConflict for handling duplicates
  if (serviceTypesToInsert.length > 0) {
    await knex('service_types')
      .insert(serviceTypesToInsert)
      .onConflict(['tenant_id', 'name']) // Use the unique constraint
      .ignore(); // Ignore rows that cause conflicts (equivalent to ON CONFLICT DO NOTHING)
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Reverting this specific data population is complex without potentially
  // deleting manually created tenant-specific types derived from standards.
  // A common strategy is to make data seeding/population migrations irreversible
  // or require manual cleanup if rollback is needed.
  console.warn('Rolling back ensure_tenant_service_types migration does not automatically delete the created service_types records.');
  // Optionally, you could delete service_types where standard_service_type_id is not null,
  // but this is risky if users have modified these records.
  // Example (use with caution):
  // await knex('service_types').whereNotNull('standard_service_type_id').del();
};
