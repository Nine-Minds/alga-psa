/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('verification_tokens', table => {
      table.uuid('tenant').notNullable();
      table.uuid('token_id').notNullable();
      table.uuid('registration_id').notNullable();
      table.uuid('company_id').notNullable();
      table.text('token').notNullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('used_at', { useTz: true }).nullable();
      table.jsonb('metadata').defaultTo('{}');

      // Primary key
      table.primary(['tenant', 'token_id']);

      // Foreign key to tenants table
      table.foreign('tenant')
        .references('tenant')
        .inTable('tenants')
        .onDelete('CASCADE');

      // Foreign key to pending_registrations table
      table.foreign(['tenant', 'registration_id'])
        .references(['tenant', 'registration_id'])
        .inTable('pending_registrations')
        .onDelete('CASCADE');

      // Foreign key to companies table
      table.foreign(['tenant', 'company_id'])
        .references(['tenant', 'company_id'])
        .inTable('companies')
        .onDelete('CASCADE');

      // Indexes
      table.index(['tenant', 'token']);
      table.index(['tenant', 'registration_id']);
      table.index(['tenant', 'company_id']); // Index for company-specific queries
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('verification_tokens');
};
