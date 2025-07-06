/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add msp and client boolean fields to permissions table
  await knex.schema.alterTable('permissions', function(table) {
    // MSP portal access flag
    table.boolean('msp')
      .defaultTo(true)
      .notNullable()
      .comment('Permission is available in MSP portal');
    
    // Client portal access flag
    table.boolean('client')
      .defaultTo(false)
      .notNullable()
      .comment('Permission is available in Client portal');
    
    // Add indexes for performance when filtering
    table.index(['msp'], 'idx_permissions_msp');
    table.index(['client'], 'idx_permissions_client');
  });

  // Add msp and client boolean fields to roles table
  await knex.schema.alterTable('roles', function(table) {
    // MSP portal access flag
    table.boolean('msp')
      .defaultTo(true)
      .notNullable()
      .comment('Role is available in MSP portal');
    
    // Client portal access flag
    table.boolean('client')
      .defaultTo(false)
      .notNullable()
      .comment('Role is available in Client portal');
    
    // Add indexes for performance when filtering
    table.index(['msp'], 'idx_roles_msp');
    table.index(['client'], 'idx_roles_client');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop from permissions table
  await knex.schema.alterTable('permissions', function(table) {
    // Drop indexes first
    table.dropIndex(['msp'], 'idx_permissions_msp');
    table.dropIndex(['client'], 'idx_permissions_client');
    
    // Drop columns
    table.dropColumn('msp');
    table.dropColumn('client');
  });

  // Drop from roles table
  await knex.schema.alterTable('roles', function(table) {
    // Drop indexes first
    table.dropIndex(['msp'], 'idx_roles_msp');
    table.dropIndex(['client'], 'idx_roles_client');
    
    // Drop columns
    table.dropColumn('msp');
    table.dropColumn('client');
  });
};