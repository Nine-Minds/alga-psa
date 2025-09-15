/**
 * Migration to add ITIL-specific fields to the tickets table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    // ITIL Impact and Urgency (1-5 scale)
    table.integer('itil_impact').nullable().comment('ITIL Impact level (1=High, 5=Low)');
    table.integer('itil_urgency').nullable().comment('ITIL Urgency level (1=High, 5=Low)');
    
    // ITIL Categories
    table.string('itil_category').nullable().comment('ITIL incident category');
    table.string('itil_subcategory').nullable().comment('ITIL incident subcategory');
    
    // Resolution and Root Cause
    table.text('resolution_code').nullable().comment('How the incident was resolved');
    table.text('root_cause').nullable().comment('Root cause analysis');
    table.text('workaround').nullable().comment('Temporary workaround if any');
    
    // Problem Management
    table.uuid('related_problem_id').nullable().comment('Link to related problem record');
    
    // SLA Management
    table.string('sla_target').nullable().comment('Target resolution time based on SLA');
    table.boolean('sla_breach').defaultTo(false).comment('Whether SLA was breached');
    
    // Escalation Management
    table.boolean('escalated').defaultTo(false).comment('Whether ticket was escalated');
    table.integer('escalation_level').nullable().comment('Current escalation level (1-3)');
    table.timestamp('escalated_at').nullable().comment('When escalation occurred');
    table.uuid('escalated_by').nullable().comment('Who escalated the ticket');
    
    // Add constraints
    table.check('itil_impact >= 1 AND itil_impact <= 5');
    table.check('itil_urgency >= 1 AND itil_urgency <= 5');
    table.check('escalation_level >= 1 AND escalation_level <= 3');
    
    // Add indexes for performance
    table.index(['itil_impact']);
    table.index(['itil_urgency']);
    table.index(['itil_category']);
    table.index(['sla_breach']);
    table.index(['escalated']);
    table.index(['escalation_level']);
    
    // Foreign key for escalated_by
    table.foreign('escalated_by').references('user_id').inTable('users').onDelete('SET NULL');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    // Drop foreign keys first
    table.dropForeign(['escalated_by']);
    
    // Drop indexes
    table.dropIndex(['itil_impact']);
    table.dropIndex(['itil_urgency']);
    table.dropIndex(['itil_category']);
    table.dropIndex(['sla_breach']);
    table.dropIndex(['escalated']);
    table.dropIndex(['escalation_level']);
    
    // Drop columns
    table.dropColumn('itil_impact');
    table.dropColumn('itil_urgency');
    table.dropColumn('itil_category');
    table.dropColumn('itil_subcategory');
    table.dropColumn('resolution_code');
    table.dropColumn('root_cause');
    table.dropColumn('workaround');
    table.dropColumn('related_problem_id');
    table.dropColumn('sla_target');
    table.dropColumn('sla_breach');
    table.dropColumn('escalated');
    table.dropColumn('escalation_level');
    table.dropColumn('escalated_at');
    table.dropColumn('escalated_by');
  });
};