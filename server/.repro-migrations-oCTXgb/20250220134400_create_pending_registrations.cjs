/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('pending_registrations', table => {
      table.uuid('tenant').notNullable();
      table.uuid('registration_id').notNullable();
      table.text('email').notNullable();
      table.text('hashed_password').notNullable();
      table.text('first_name').notNullable();
      table.text('last_name').notNullable();
      table.uuid('company_id').notNullable();
      table.enum('status', ['PENDING_VERIFICATION', 'VERIFIED', 'COMPLETED', 'EXPIRED']).defaultTo('PENDING_VERIFICATION');
      table.integer('attempt_count').defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('completed_at', { useTz: true }).nullable();
      table.jsonb('metadata').defaultTo('{}');

      // Primary key
      table.primary(['tenant', 'registration_id']);

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

      // Indexes
      table.index(['tenant', 'email']);
      table.index(['tenant', 'status']);
      table.index(['tenant', 'email', 'status']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('pending_registrations');
};
