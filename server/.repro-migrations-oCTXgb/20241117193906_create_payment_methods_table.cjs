/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('payment_methods', function(table) {
    table.uuid('tenant').notNullable();
    table.uuid('payment_method_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('company_id').notNullable();
    table.enum('type', ['credit_card', 'bank_account']).notNullable();
    table.string('last4').notNullable();
    table.string('exp_month');
    table.string('exp_year');
    table.boolean('is_default').defaultTo(false);
    table.boolean('is_deleted').defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    // Primary key
    table.primary(['tenant', 'payment_method_id']);

    // Foreign keys
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');

    // Indexes
    table.index(['tenant', 'company_id', 'is_deleted']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('payment_methods');
};
