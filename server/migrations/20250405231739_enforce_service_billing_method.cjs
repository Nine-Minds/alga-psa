/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Step 1: Add new nullable FK columns
  await knex.schema.alterTable('service_catalog', (table) => {
    table.uuid('standard_service_type_id').nullable().references('id').inTable('standard_service_types').onDelete('SET NULL');
    table.uuid('custom_service_type_id').nullable().references('id').inTable('service_types').onDelete('SET NULL'); // FK to service_types
  });

  // Step 2: Populate new FK columns based on old service_type_id
  await knex.raw(`
    UPDATE service_catalog s
    SET standard_service_type_id = s.service_type_id
    FROM standard_service_types sst
    WHERE s.service_type_id = sst.id;
  `);
  await knex.raw(`
    UPDATE service_catalog s
    SET custom_service_type_id = s.service_type_id
    FROM service_types st
    WHERE s.service_type_id = st.id AND s.tenant = st.tenant_id; -- Ensure tenant match for custom types
  `);

  // Step 3: Populate NULL billing_method (using the same logic as before, just in case)
  await knex.raw(`
    UPDATE service_catalog s
    SET billing_method = sst.billing_method
    FROM standard_service_types sst
    WHERE s.standard_service_type_id = sst.id AND s.billing_method IS NULL;
  `);
  await knex.raw(`
    UPDATE service_catalog s
    SET billing_method = st.billing_method
    FROM service_types st
    WHERE s.custom_service_type_id = st.id AND s.tenant = st.tenant_id AND s.billing_method IS NULL;
  `);
  // Fallback update if any billing_method is still NULL - this is critical to prevent NOT NULL constraint violation
  await knex('service_catalog').whereNull('billing_method').update({ billing_method: 'per_unit' });


  // Step 3.5: Verify that all services have exactly one FK populated
  // If a service has neither FK populated, we'll set standard_service_type_id to a default value
  // This ensures the CHECK constraint in the next step won't fail
  await knex.raw(`
    UPDATE service_catalog
    SET standard_service_type_id = (SELECT id FROM standard_service_types WHERE name = 'Managed Services' LIMIT 1)
    WHERE standard_service_type_id IS NULL AND custom_service_type_id IS NULL;
  `);

  // Step 4: Add CHECK constraint to ensure exactly one FK is populated
  await knex.raw(`
    ALTER TABLE service_catalog
    ADD CONSTRAINT service_catalog_check_one_type_id
    CHECK (
      (standard_service_type_id IS NOT NULL AND custom_service_type_id IS NULL)
      OR
      (standard_service_type_id IS NULL AND custom_service_type_id IS NOT NULL)
    );
  `);

  // Step 5: Add CHECK constraint to services.billing_method and make it NOT NULL
  await knex.raw(`
    ALTER TABLE service_catalog
    ADD CONSTRAINT service_catalog_billing_method_check CHECK (billing_method IN ('fixed', 'per_unit'));
  `);
  
  await knex.schema.alterTable('service_catalog', (table) => {
    table.string('billing_method', 10).notNullable().alter();
  });

  // Step 6: Drop the old service_type_id column
  await knex.schema.alterTable('service_catalog', (table) => {
    table.dropColumn('service_type_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Step 1: Add service_type_id column back (nullable initially)
  await knex.schema.alterTable('service_catalog', (table) => {
    table.uuid('service_type_id').nullable();
  });

  // Step 2: Populate service_type_id from the two FK columns
  await knex.raw(`
    UPDATE service_catalog
    SET service_type_id = COALESCE(standard_service_type_id, custom_service_type_id);
  `);

  // Step 3: Drop the CHECK constraint
  await knex.raw(`
    ALTER TABLE service_catalog
    DROP CONSTRAINT IF EXISTS service_catalog_check_one_type_id;
  `);

  // Step 4: Drop the foreign key constraints and columns
  await knex.schema.alterTable('service_catalog', (table) => {
    table.dropForeign('standard_service_type_id');
    table.dropForeign('custom_service_type_id');
    table.dropColumn('standard_service_type_id');
    table.dropColumn('custom_service_type_id');
  });

  // Step 5: Drop the CHECK constraint and make billing_method nullable again
  await knex.raw(`
    ALTER TABLE service_catalog
    DROP CONSTRAINT IF EXISTS service_catalog_billing_method_check;
  `);
  
  await knex.schema.alterTable('service_catalog', (table) => {
    table.string('billing_method', 10).nullable().alter();
  });

  // Step 6: Make service_type_id NOT NULL (assuming it was originally)
  // If the original column could be null, remove .notNullable()
  await knex.schema.alterTable('service_catalog', (table) => {
    table.uuid('service_type_id').notNullable().alter();
  });
};
