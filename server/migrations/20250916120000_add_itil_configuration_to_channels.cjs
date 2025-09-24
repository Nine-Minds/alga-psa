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
      // Citus requires adding columns and constraints separately
      table.text('category_type').defaultTo('custom').comment('Type of categories: custom or ITIL');
      table.text('priority_type').defaultTo('custom').comment('Type of priorities: custom or ITIL');
    })
    .raw(`
      ALTER TABLE standard_channels
      ADD CONSTRAINT standard_channels_category_type_check
      CHECK (category_type IN ('custom', 'itil'));
    `)
    .raw(`
      ALTER TABLE standard_channels
      ADD CONSTRAINT standard_channels_priority_type_check
      CHECK (priority_type IN ('custom', 'itil'));
    `)
    .raw('CREATE INDEX idx_standard_channels_category_type ON standard_channels(category_type);')
    .raw('CREATE INDEX idx_standard_channels_priority_type ON standard_channels(priority_type);')
    // Add ITIL configuration to tenant channels (distributed table)
    .alterTable('channels', function(table) {
      // Category and Priority type configuration
      // Citus requires adding columns and constraints separately
      table.text('category_type').defaultTo('custom').comment('Type of categories: custom or ITIL');
      table.text('priority_type').defaultTo('custom').comment('Type of priorities: custom or ITIL');

      // ITIL-specific display configuration
      table.boolean('display_itil_impact').defaultTo(false).comment('Show ITIL Impact field in forms');
      table.boolean('display_itil_urgency').defaultTo(false).comment('Show ITIL Urgency field in forms');
    })
    .raw(`
      ALTER TABLE channels
      ADD CONSTRAINT channels_category_type_check
      CHECK (category_type IN ('custom', 'itil'));
    `)
    .raw(`
      ALTER TABLE channels
      ADD CONSTRAINT channels_priority_type_check
      CHECK (priority_type IN ('custom', 'itil'));
    `)
    .raw('CREATE INDEX idx_channels_tenant_category_type ON channels(tenant, category_type);')
    .raw('CREATE INDEX idx_channels_tenant_priority_type ON channels(tenant, priority_type);')
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
    .raw('DROP INDEX IF EXISTS idx_channels_tenant_category_type;')
    .raw('DROP INDEX IF EXISTS idx_channels_tenant_priority_type;')
    .raw('ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_category_type_check;')
    .raw('ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_priority_type_check;')
    .alterTable('channels', function(table) {
      table.dropColumn('category_type');
      table.dropColumn('priority_type');
      table.dropColumn('display_itil_impact');
      table.dropColumn('display_itil_urgency');
    })
    // Remove from standard tables
    .raw('DROP INDEX IF EXISTS idx_standard_channels_category_type;')
    .raw('DROP INDEX IF EXISTS idx_standard_channels_priority_type;')
    .raw('ALTER TABLE standard_channels DROP CONSTRAINT IF EXISTS standard_channels_category_type_check;')
    .raw('ALTER TABLE standard_channels DROP CONSTRAINT IF EXISTS standard_channels_priority_type_check;')
    .alterTable('standard_channels', function(table) {
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