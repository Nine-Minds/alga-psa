/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add missing columns to interaction_types table
  await knex.schema.alterTable('interaction_types', function(table) {
    // Add system_type_id to track which system type this was imported from
    table.uuid('system_type_id').nullable();
    
    // Add display_order for sorting
    table.integer('display_order').notNullable().defaultTo(0);
    
    // Add color column to match system_interaction_types
    table.text('color').nullable();
    
    // Add is_request flag
    table.boolean('is_request').defaultTo(false);
    
    // Add created_by to track who created it
    table.uuid('created_by').nullable();
    
    // Add foreign key for system_type_id
    table.foreign('system_type_id').references('type_id').inTable('system_interaction_types').onDelete('SET NULL');
  });

  // Add display_order to system_interaction_types table
  await knex.schema.alterTable('system_interaction_types', function(table) {
    table.integer('display_order').notNullable().defaultTo(0);
  });

  // Update existing interaction_types with sequential order numbers per tenant
  const tenants = await knex('interaction_types').distinct('tenant').pluck('tenant');
  for (const tenantId of tenants) {
    const tenantTypes = await knex('interaction_types')
      .where('tenant', tenantId)
      .orderBy('type_name');
    
    for (let i = 0; i < tenantTypes.length; i++) {
      await knex('interaction_types')
        .where({ type_id: tenantTypes[i].type_id, tenant: tenantId })
        .update({ display_order: i + 1 });
    }
  }

  // Update existing system_interaction_types with sequential order numbers
  const systemTypes = await knex('system_interaction_types').orderBy('type_name');
  for (let i = 0; i < systemTypes.length; i++) {
    await knex('system_interaction_types')
      .where('type_id', systemTypes[i].type_id)
      .update({ display_order: i + 1 });
  }

  // Add unique constraint for tenant + display_order
  await knex.schema.alterTable('interaction_types', function(table) {
    table.unique(['tenant', 'display_order']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove unique constraint
  await knex.schema.alterTable('interaction_types', function(table) {
    table.dropUnique(['tenant', 'display_order']);
  });

  // Remove columns from interaction_types
  await knex.schema.alterTable('interaction_types', function(table) {
    table.dropForeign(['system_type_id']);
    table.dropColumn('system_type_id');
    table.dropColumn('display_order');
    table.dropColumn('color');
    table.dropColumn('is_request');
    table.dropColumn('created_by');
  });

  // Remove display_order from system_interaction_types
  await knex.schema.alterTable('system_interaction_types', function(table) {
    table.dropColumn('display_order');
  });
};