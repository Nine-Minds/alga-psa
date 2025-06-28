/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add display_order to standard_service_types table
  await knex.schema.alterTable('standard_service_types', function(table) {
    table.integer('display_order').notNullable().defaultTo(0);
  });

  // Add order_number to service_types table (tenant-specific)
  await knex.schema.alterTable('service_types', function(table) {
    table.integer('order_number').notNullable().defaultTo(0);
  });

  // Update existing standard_service_types with sequential order numbers BEFORE adding unique constraint
  const standardTypes = await knex('standard_service_types').orderBy('name');
  for (let i = 0; i < standardTypes.length; i++) {
    await knex('standard_service_types')
      .where('id', standardTypes[i].id)
      .update({ display_order: (i + 1) * 10 });
  }

  // Update existing service_types with sequential order numbers per tenant BEFORE adding unique constraint
  const tenants = await knex('service_types').distinct('tenant').pluck('tenant');
  for (const tenantId of tenants) {
    const tenantTypes = await knex('service_types')
      .where('tenant', tenantId)
      .orderBy('name');
    
    for (let i = 0; i < tenantTypes.length; i++) {
      await knex('service_types')
        .where('id', tenantTypes[i].id)
        .update({ order_number: (i + 1) * 10 });
    }
  }

  // NOW add unique constraint for standard_service_types display_order
  await knex.schema.alterTable('standard_service_types', function(table) {
    table.unique(['display_order']);
  });

  // Add unique constraint for service_types order within a tenant
  await knex.schema.alterTable('service_types', function(table) {
    table.unique(['tenant', 'order_number']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove unique constraints first
  await knex.schema.alterTable('service_types', function(table) {
    table.dropUnique(['tenant', 'order_number']);
  });

  await knex.schema.alterTable('standard_service_types', function(table) {
    table.dropUnique(['display_order']);
  });

  // Remove columns
  await knex.schema.alterTable('service_types', function(table) {
    table.dropColumn('order_number');
  });

  await knex.schema.alterTable('standard_service_types', function(table) {
    table.dropColumn('display_order');
  });
};