/**
 * Migration file to create the tables needed for the extension system
 */
exports.up = function(knex) {
  return knex.schema
    // Create the extensions table
    .createTable('extensions', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('name').notNullable();
      table.text('description');
      table.string('version').notNullable();
      table.jsonb('manifest').notNullable();
      table.string('main_entry_point');
      table.boolean('is_enabled').notNullable().defaultTo(false);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      
      // Add indexes
      table.index('tenant_id');
      table.unique(['tenant_id', 'name']);
    })

    // Create extension_permissions table
    .createTable('extension_permissions', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('extension_id').notNullable().references('id').inTable('extensions').onDelete('CASCADE');
      table.string('resource').notNullable();
      table.string('action').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      
      // Add indexes
      table.index('extension_id');
      table.unique(['extension_id', 'resource', 'action']);
    })

    // Create extension_files table
    .createTable('extension_files', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('extension_id').notNullable().references('id').inTable('extensions').onDelete('CASCADE');
      table.string('path').notNullable();
      table.string('content_hash');
      table.integer('size');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      
      // Add indexes
      table.index('extension_id');
      table.unique(['extension_id', 'path']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('extension_files')
    .dropTableIfExists('extension_permissions')
    .dropTableIfExists('extensions');
};