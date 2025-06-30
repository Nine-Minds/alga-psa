/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Step 1: For any service_catalog entries that only have standard_service_type_id,
  // create a corresponding custom service type and update the reference
  const servicesWithStandardOnly = await knex('service_catalog')
    .whereNotNull('standard_service_type_id')
    .whereNull('custom_service_type_id');

  console.log(`Found ${servicesWithStandardOnly.length} services with only standard_service_type_id`);

  for (const service of servicesWithStandardOnly) {
    // Get the standard service type details
    const standardType = await knex('standard_service_types')
      .where('id', service.standard_service_type_id)
      .first();

    if (standardType) {
      // Check if a custom service type already exists for this tenant and standard type
      let customType = await knex('service_types')
        .where({
          tenant_id: service.tenant,
          standard_service_type_id: service.standard_service_type_id
        })
        .first();

      if (!customType) {
        // Create a new custom service type
        [customType] = await knex('service_types')
          .insert({
            tenant_id: service.tenant,
            name: standardType.name,
            billing_method: standardType.billing_method,
            standard_service_type_id: standardType.id,
            is_active: true,
            order_number: standardType.display_order || 0
          })
          .returning('*');
        
        console.log(`Created custom service type for tenant ${service.tenant}: ${customType.name}`);
      }

      // Update the service catalog to use the custom type
      await knex('service_catalog')
        .where('service_id', service.service_id)
        .update({
          custom_service_type_id: customType.id,
          standard_service_type_id: null
        });
    }
  }

  // Step 2: Drop the CHECK constraint
  await knex.raw(`
    ALTER TABLE service_catalog
    DROP CONSTRAINT IF EXISTS service_catalog_check_one_type_id;
  `);

  // Step 3: Drop the foreign key constraint and column
  await knex.schema.alterTable('service_catalog', (table) => {
    table.dropForeign('standard_service_type_id');
    table.dropColumn('standard_service_type_id');
  });

  // Step 4: Make custom_service_type_id non-nullable
  await knex.schema.alterTable('service_catalog', (table) => {
    table.uuid('custom_service_type_id').notNullable().alter();
  });

  console.log('Successfully removed standard_service_type_id from service_catalog');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Step 1: Add standard_service_type_id column back
  await knex.schema.alterTable('service_catalog', (table) => {
    table.uuid('standard_service_type_id').nullable()
      .references('id').inTable('standard_service_types').onDelete('SET NULL');
  });

  // Step 2: Make custom_service_type_id nullable again
  await knex.schema.alterTable('service_catalog', (table) => {
    table.uuid('custom_service_type_id').nullable().alter();
  });

  // Step 3: Restore data where possible (services linked to custom types that have standard_service_type_id)
  await knex.raw(`
    UPDATE service_catalog sc
    SET standard_service_type_id = st.standard_service_type_id
    FROM service_types st
    WHERE sc.custom_service_type_id = st.id
    AND st.standard_service_type_id IS NOT NULL;
  `);

  // Step 4: Restore the CHECK constraint
  await knex.raw(`
    ALTER TABLE service_catalog
    ADD CONSTRAINT service_catalog_check_one_type_id
    CHECK (
      (standard_service_type_id IS NOT NULL AND custom_service_type_id IS NULL)
      OR
      (standard_service_type_id IS NULL AND custom_service_type_id IS NOT NULL)
    );
  `);

  console.log('Reverted removal of standard_service_type_id from service_catalog');
};