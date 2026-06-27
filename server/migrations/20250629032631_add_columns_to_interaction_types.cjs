const MIGRATION_TENANT = 'migration:20250629032631_add_columns_to_interaction_types';
const INTERACTION_TYPE_ORDER_BACKFILL_REASON = 'discover tenants with interaction types for display order backfill';
const INTERACTION_TYPE_SCHEMA_CHECK_REASON = 'schema constraint existence check for interaction type display order unique constraint';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);

  // Check and add columns individually to handle partial migration failures
  const hasSystemTypeId = await knex.schema.hasColumn('interaction_types', 'system_type_id');
  const hasDisplayOrder = await knex.schema.hasColumn('interaction_types', 'display_order');
  const hasColor = await knex.schema.hasColumn('interaction_types', 'color');
  const hasIsRequest = await knex.schema.hasColumn('interaction_types', 'is_request');
  const hasCreatedBy = await knex.schema.hasColumn('interaction_types', 'created_by');
  
  await knex.schema.alterTable('interaction_types', function(table) {
    // Add system_type_id to track which system type this was imported from
    if (!hasSystemTypeId) {
      table.uuid('system_type_id').nullable();
    }
    
    // Add display_order for sorting
    if (!hasDisplayOrder) {
      table.integer('display_order');
    }
    
    // Add color column to match system_interaction_types
    if (!hasColor) {
      table.text('color').nullable();
    }
    
    // Add is_request flag
    if (!hasIsRequest) {
      table.boolean('is_request').defaultTo(false);
    }
    
    // Add created_by to track who created it
    if (!hasCreatedBy) {
      table.uuid('created_by').nullable();
    }
    
    // Add foreign key for system_type_id (only if column was just added)
    if (!hasSystemTypeId) {
      table.foreign('system_type_id').references('type_id').inTable('system_interaction_types').onDelete('SET NULL');
    }
  });

  // Add display_order to system_interaction_types table
  const hasSystemDisplayOrder = await knex.schema.hasColumn('system_interaction_types', 'display_order');
  if (!hasSystemDisplayOrder) {
    await knex.schema.alterTable('system_interaction_types', function(table) {
      table.integer('display_order');
    });
  }

  // Update existing interaction_types with sequential order numbers per tenant
  const tenants = await migrationDb.unscoped('interaction_types', INTERACTION_TYPE_ORDER_BACKFILL_REASON)
    .distinct('tenant')
    .pluck('tenant');
  for (const tenantId of tenants) {
    const db = tenantDb(knex, tenantId);
    const tenantTypes = await db.table('interaction_types')
      .orderBy('type_name');
    
    for (let i = 0; i < tenantTypes.length; i++) {
      await db.table('interaction_types')
        .where('type_id', tenantTypes[i].type_id)
        .update({ display_order: i + 1 });
    }
  }

  // Update existing system_interaction_types with sequential order numbers
  const systemTypes = await migrationDb.table('system_interaction_types').orderBy('type_name');
  for (let i = 0; i < systemTypes.length; i++) {
    await migrationDb.table('system_interaction_types')
      .where('type_id', systemTypes[i].type_id)
      .update({ display_order: i + 1 });
  }

  // Check if unique constraint already exists before adding it
  const constraintExists = await migrationDb.unscoped('information_schema.table_constraints', INTERACTION_TYPE_SCHEMA_CHECK_REASON)
    .select('constraint_name')
    .where('table_name', 'interaction_types')
    .andWhere('constraint_name', 'interaction_types_tenant_display_order_unique');

  if (constraintExists.length === 0) {
    await knex.schema.alterTable('interaction_types', function(table) {
      table.unique(['tenant', 'display_order']);
    });
  }
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
