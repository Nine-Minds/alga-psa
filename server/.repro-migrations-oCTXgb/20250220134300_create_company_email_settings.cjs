/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('company_email_settings', table => {
    table.uuid('tenant').notNullable();
    table.uuid('company_id').notNullable();
    table.text('email_suffix').notNullable();
    table.boolean('self_registration_enabled').defaultTo(false);
    table.uuid('user_id').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    // Primary key
    table.primary(['tenant', 'company_id', 'email_suffix']);

    // Foreign key to tenants table
    table.foreign('tenant')
      .references('tenant')
      .inTable('tenants')
      .onDelete('CASCADE');

    // Foreign key to companies table
    table.foreign(['tenant', 'company_id'])
      .references(['tenant', 'company_id'])
      .inTable('companies')
      .onDelete('CASCADE');

    // Foreign key to users table
    table.foreign(['tenant', 'user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users')
      .onDelete('CASCADE');

    // Index for tenant-wide email suffix searches with registration status
    table.index(['tenant', 'email_suffix', 'self_registration_enabled']);
    
    // Index for tenant-company lookups
    table.index(['tenant', 'company_id']);
    
    // Index for user audit trail
    table.index(['tenant', 'user_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('company_email_settings');
};
