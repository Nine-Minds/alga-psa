/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Check if display_order column exists, if not add it
  const hasDisplayOrderColumn = await knex.schema.hasColumn('standard_service_types', 'display_order');
  if (!hasDisplayOrderColumn) {
    // Add column as nullable first
    await knex.schema.alterTable('standard_service_types', function(table) {
      table.integer('display_order');
    });
    
    // Set sequential values
    const standardTypes = await knex('standard_service_types').orderBy('name');
    for (let i = 0; i < standardTypes.length; i++) {
      await knex('standard_service_types')
        .where('id', standardTypes[i].id)
        .update({ display_order: i + 1 });
    }
    
    // Skip the NOT NULL constraint for now - can be added manually later
  } else {
    // Column exists, ensure no duplicates
    const standardTypes = await knex('standard_service_types').orderBy('name');
    for (let i = 0; i < standardTypes.length; i++) {
      await knex('standard_service_types')
        .where('id', standardTypes[i].id)
        .update({ display_order: i + 1 });
    }
  }

  // Check if order_number column exists, if not add it
  const hasOrderNumberColumn = await knex.schema.hasColumn('service_types', 'order_number');
  if (!hasOrderNumberColumn) {
    // Add column as nullable first
    await knex.schema.alterTable('service_types', function(table) {
      table.integer('order_number');
    });
    
    // Set sequential values per tenant
    const tenants = await knex('service_types').distinct('tenant').pluck('tenant');
    for (const tenantId of tenants) {
      const tenantTypes = await knex('service_types')
        .where('tenant', tenantId)
        .orderBy('name');
      
      for (let i = 0; i < tenantTypes.length; i++) {
        await knex('service_types')
          .where('id', tenantTypes[i].id)
          .update({ order_number: i + 1 });
      }
    }
    
    // Skip the NOT NULL constraint for now - can be added manually later
  } else {
    // Column exists, ensure no duplicates per tenant
    const tenants = await knex('service_types').distinct('tenant').pluck('tenant');
    for (const tenantId of tenants) {
      const tenantTypes = await knex('service_types')
        .where('tenant', tenantId)
        .orderBy('name');
      
      for (let i = 0; i < tenantTypes.length; i++) {
        await knex('service_types')
          .where('id', tenantTypes[i].id)
          .update({ order_number: i + 1 });
      }
    }
  }

  // Check if unique constraint already exists for standard_service_types before adding it
  const standardConstraintExists = await knex.raw(`
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_name = 'standard_service_types' 
    AND constraint_name = 'standard_service_types_display_order_unique'
  `);

  if (standardConstraintExists.rows.length === 0) {
    await knex.schema.alterTable('standard_service_types', function(table) {
      table.unique(['display_order']);
    });
  }

  // Check if unique constraint already exists for service_types before adding it
  const serviceTypesConstraintExists = await knex.raw(`
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_name = 'service_types' 
    AND constraint_name = 'service_types_tenant_order_number_unique'
  `);

  if (serviceTypesConstraintExists.rows.length === 0) {
    await knex.schema.alterTable('service_types', function(table) {
      table.unique(['tenant', 'order_number']);
    });
  }
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
