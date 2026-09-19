/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('service_types', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Corrected foreign key reference to 'tenant' column in 'tenants' table
    table.uuid('tenant_id').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.text('name').notNullable();
    table.uuid('standard_service_type_id').nullable().references('id').inTable('standard_service_types').onDelete('SET NULL');
    table.boolean('is_active').defaultTo(true);
    table.text('description').nullable();
    table.timestamps(true, true); // Adds created_at and updated_at columns

    // Ensure unique name per tenant
    table.unique(['tenant_id', 'name']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('service_types');
};
