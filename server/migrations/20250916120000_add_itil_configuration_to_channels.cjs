/**
 * Migration to add ITIL configuration options to channels
 * This allows channels to use either custom or ITIL methodologies for categories and priorities
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Add ITIL flags to standard tables for marking ITIL-compliant data
    .alterTable('standard_priorities', function(table) {
      table.boolean('is_itil_standard').defaultTo(false).comment('Whether this is an ITIL standard priority');
      table.integer('itil_priority_level').nullable().comment('ITIL priority level (1-5) for mapping');

      table.index(['is_itil_standard']);
    })
    .alterTable('standard_categories', function(table) {
      table.boolean('is_itil_standard').defaultTo(false).comment('Whether this is an ITIL standard category');

      table.index(['is_itil_standard']);
    })
    .alterTable('standard_channels', function(table) {
      // Configuration for standard channel templates
      table.enum('category_type', ['custom', 'itil']).defaultTo('custom').comment('Type of categories: custom or ITIL');
      table.enum('priority_type', ['custom', 'itil']).defaultTo('custom').comment('Type of priorities: custom or ITIL');

      table.index(['category_type']);
      table.index(['priority_type']);
    })
    // Add ITIL configuration to tenant channels (distributed table)
    .alterTable('channels', function(table) {
      // Category and Priority type configuration
      table.enum('category_type', ['custom', 'itil']).defaultTo('custom').comment('Type of categories: custom or ITIL');
      table.enum('priority_type', ['custom', 'itil']).defaultTo('custom').comment('Type of priorities: custom or ITIL');

      // ITIL-specific display configuration
      table.boolean('display_itil_impact').defaultTo(false).comment('Show ITIL Impact field in forms');
      table.boolean('display_itil_urgency').defaultTo(false).comment('Show ITIL Urgency field in forms');

      // Add indexes with tenant column for Citus distribution
      table.index(['tenant', 'category_type']);
      table.index(['tenant', 'priority_type']);
    })
    // Mark tenant priorities and categories that came from ITIL standards (distributed tables)
    .alterTable('priorities', function(table) {
      table.boolean('is_from_itil_standard').defaultTo(false).comment('Whether copied from ITIL standard');
      table.integer('itil_priority_level').nullable().comment('ITIL priority level (1-5) if from ITIL standard');

      // Index with tenant for Citus
      table.index(['tenant', 'is_from_itil_standard']);
    })
    .alterTable('categories', function(table) {
      table.boolean('is_from_itil_standard').defaultTo(false).comment('Whether copied from ITIL standard');

      // Index with tenant for Citus
      table.index(['tenant', 'is_from_itil_standard']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    // Remove from tenant tables
    .alterTable('categories', function(table) {
      table.dropIndex(['tenant', 'is_from_itil_standard']);
      table.dropColumn('is_from_itil_standard');
    })
    .alterTable('priorities', function(table) {
      table.dropIndex(['tenant', 'is_from_itil_standard']);
      table.dropColumn('is_from_itil_standard');
      table.dropColumn('itil_priority_level');
    })
    .alterTable('channels', function(table) {
      table.dropIndex(['tenant', 'category_type']);
      table.dropIndex(['tenant', 'priority_type']);

      table.dropColumn('category_type');
      table.dropColumn('priority_type');
      table.dropColumn('display_itil_impact');
      table.dropColumn('display_itil_urgency');
    })
    // Remove from standard tables
    .alterTable('standard_channels', function(table) {
      table.dropIndex(['category_type']);
      table.dropIndex(['priority_type']);

      table.dropColumn('category_type');
      table.dropColumn('priority_type');
    })
    .alterTable('standard_categories', function(table) {
      table.dropIndex(['is_itil_standard']);
      table.dropColumn('is_itil_standard');
    })
    .alterTable('standard_priorities', function(table) {
      table.dropIndex(['is_itil_standard']);
      table.dropColumn('is_itil_standard');
      table.dropColumn('itil_priority_level');
    });
};