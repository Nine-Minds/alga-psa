/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Step 1: Populate standard_service_types.billing_method based on mapping
  await knex('standard_service_types').where({ name: 'Managed Services' }).whereNull('billing_method').update({ billing_method: 'fixed' });
  await knex('standard_service_types').where({ name: 'Project/Professional Services' }).whereNull('billing_method').update({ billing_method: 'per_unit' });
  await knex('standard_service_types').where({ name: 'Break-Fix and Reactive Support' }).whereNull('billing_method').update({ billing_method: 'per_unit' });
  await knex('standard_service_types').where({ name: 'Cloud and Hosting' }).whereNull('billing_method').update({ billing_method: 'fixed' });
  await knex('standard_service_types').where({ name: 'Hardware and Software' }).whereNull('billing_method').update({ billing_method: 'fixed' });
  await knex('standard_service_types').where({ name: 'Cybersecurity Services' }).whereNull('billing_method').update({ billing_method: 'fixed' });
  await knex('standard_service_types').where({ name: 'Telecommunications' }).whereNull('billing_method').update({ billing_method: 'fixed' });
  await knex('standard_service_types').where({ name: 'Backup and Disaster Recovery (BDR)' }).whereNull('billing_method').update({ billing_method: 'fixed' });
  await knex('standard_service_types').where({ name: 'User Support and Training' }).whereNull('billing_method').update({ billing_method: 'per_unit' });
  await knex('standard_service_types').where({ name: 'Hourly Time' }).whereNull('billing_method').update({ billing_method: 'per_unit' });
  await knex('standard_service_types').where({ name: 'Fixed Price' }).whereNull('billing_method').update({ billing_method: 'fixed' });
  await knex('standard_service_types').where({ name: 'Usage Based' }).whereNull('billing_method').update({ billing_method: 'per_unit' });
  
  // Fallback: Update any remaining standard service types with NULL billing_method
  await knex('standard_service_types').whereNull('billing_method').update({ billing_method: 'per_unit' });

  // Step 2: Add CHECK constraint to standard_service_types.billing_method
  await knex.raw(`
    ALTER TABLE standard_service_types
    ADD CONSTRAINT standard_service_types_billing_method_check CHECK (billing_method IN ('fixed', 'per_unit'));
  `);

  // Step 3: Make standard_service_types.billing_method NOT NULL and change type
  await knex.schema.alterTable('standard_service_types', (table) => {
    table.string('billing_method', 10).notNullable().alter();
  });

  // Step 4: Add billing_method column to service_types (initially nullable)
  await knex.schema.alterTable('service_types', (table) => {
    table.string('billing_method', 10).nullable(); // Add as nullable first
  });
  
  // Step 5: Populate billing_method for existing service_types
  await knex('service_types').whereNull('billing_method').update({ billing_method: 'per_unit' });
  
  // Step 6: Add constraint and make billing_method NOT NULL
  await knex.raw(`
    ALTER TABLE service_types
    ADD CONSTRAINT service_types_billing_method_check CHECK (billing_method IN ('fixed', 'per_unit'));
  `);
  
  await knex.schema.alterTable('service_types', (table) => {
    table.string('billing_method', 10).notNullable().alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop constraint and column from service_types
  await knex.raw('ALTER TABLE service_types DROP CONSTRAINT IF EXISTS service_types_billing_method_check;');
  await knex.schema.alterTable('service_types', (table) => {
    table.dropColumn('billing_method');
  });

  // Drop constraint and alter column back in standard_service_types
  await knex.raw('ALTER TABLE standard_service_types DROP CONSTRAINT IF EXISTS standard_service_types_billing_method_check;');
  await knex.schema.alterTable('standard_service_types', (table) => {
    // Alter back to nullable and original wider varchar for rollback safety
    table.string('billing_method', 255).nullable().alter();
  });
  // Note: Populated values are not automatically reverted to NULL on rollback.
};
