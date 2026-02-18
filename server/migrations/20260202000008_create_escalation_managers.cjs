/**
 * Migration: Create escalation_managers table
 *
 * This table stores escalation manager configurations per board and level.
 * When a ticket's escalation level increases, the configured manager for
 * that board/level is added as an additional resource and notified.
 *
 * Part of Phase 4: Escalation Automation
 */

exports.up = async function(knex) {
  // Create the escalation_managers table
  await knex.schema.createTable('escalation_managers', (table) => {
    table.uuid('config_id').notNullable();
    table.uuid('tenant').notNullable();
    table.uuid('board_id').references('board_id').inTable('boards').onDelete('CASCADE');
    table.integer('escalation_level').notNullable().checkBetween([1, 3]);
    table.uuid('manager_user_id').references('user_id').inTable('users').onDelete('SET NULL');
    table.specificType('notify_via', 'TEXT[]').defaultTo('{in_app,email}');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Primary key includes tenant for CitusDB distribution
    table.primary(['config_id', 'tenant']);

    // Unique constraint: one manager per board per level
    table.unique(['tenant', 'board_id', 'escalation_level']);

    // Index for lookups by board
    table.index(['tenant', 'board_id']);
  });

  // Add tenant foreign key constraint
  await knex.raw(`
    ALTER TABLE escalation_managers
    ADD CONSTRAINT escalation_managers_tenant_fkey
    FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('escalation_managers');
};
