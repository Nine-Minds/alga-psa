/**
 * Migration file to create the extension storage tables
 */
exports.up = function(knex) {
  return knex.schema
    // Create extension_storage table
    .createTable('extension_storage', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('extension_id').notNullable().references('id').inTable('extensions').onDelete('CASCADE');
      table.uuid('tenant_id').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
      table.string('key').notNullable();
      table.jsonb('value').notNullable();
      table.timestamp('expires_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      
      // Add indexes
      table.index('extension_id');
      table.index('tenant_id');
      table.index('expires_at');
      
      // Unique constraint for key per extension and tenant
      table.unique(['extension_id', 'tenant_id', 'key']);
    })

    // Create extension_settings table
    .createTable('extension_settings', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('extension_id').notNullable().references('id').inTable('extensions').onDelete('CASCADE');
      table.uuid('tenant_id').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
      table.jsonb('settings').notNullable().defaultTo('{}');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      
      // Add indexes
      table.index('extension_id');
      table.index('tenant_id');
      
      // Unique constraint for settings per extension and tenant
      table.unique(['extension_id', 'tenant_id']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('extension_settings')
    .dropTableIfExists('extension_storage');
};