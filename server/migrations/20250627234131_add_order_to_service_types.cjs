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
    
    // Ensure no NULL values remain (in case table was empty or new rows were added)
    const nullCount = await knex('standard_service_types')
      .whereNull('display_order')
      .count('* as count');
    
    if (nullCount[0].count > 0) {
      // Update any remaining NULL values
      const nullRows = await knex('standard_service_types')
        .whereNull('display_order')
        .orderBy('name');
      
      const maxOrder = await knex('standard_service_types')
        .max('display_order as max')
        .first();
      
      let nextOrder = (maxOrder.max || 0) + 1;
      for (const row of nullRows) {
        await knex('standard_service_types')
          .where('id', row.id)
          .update({ display_order: nextOrder++ });
      }
    }
    
    // Now make it NOT NULL
    await knex.schema.alterTable('standard_service_types', function(table) {
      table.integer('display_order').notNullable().alter();
    });
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
    
    // Ensure no NULL values remain
    const nullServiceTypes = await knex('service_types')
      .whereNull('order_number')
      .select('*');
    
    if (nullServiceTypes.length > 0) {
      // Group by tenant and assign order numbers
      const nullByTenant = {};
      for (const type of nullServiceTypes) {
        if (!nullByTenant[type.tenant]) {
          nullByTenant[type.tenant] = [];
        }
        nullByTenant[type.tenant].push(type);
      }
      
      for (const [tenantId, types] of Object.entries(nullByTenant)) {
        const maxOrder = await knex('service_types')
          .where('tenant', tenantId)
          .max('order_number as max')
          .first();
        
        let nextOrder = (maxOrder.max || 0) + 1;
        for (const type of types) {
          await knex('service_types')
            .where('id', type.id)
            .update({ order_number: nextOrder++ });
        }
      }
    }
    
    // Now make it NOT NULL
    await knex.schema.alterTable('service_types', function(table) {
      table.integer('order_number').notNullable().alter();
    });
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