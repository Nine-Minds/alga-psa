/**
 * Migration to add ITIL-specific fields to the tickets table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('tickets', function(table) {
      // ITIL Impact and Urgency (1-5 scale)
      // These are kept for UI calculation and priority matrix determination
      table.integer('itil_impact').nullable().comment('ITIL Impact level (1=High, 5=Low)');
      table.integer('itil_urgency').nullable().comment('ITIL Urgency level (1=High, 5=Low)');

      // Calculated ITIL priority level (1-5) based on impact/urgency matrix
      table.integer('itil_priority_level').nullable().comment('Calculated ITIL priority (1=Critical, 5=Planning)');

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

      // Add constraints with explicit names
      table.check('itil_impact >= 1 AND itil_impact <= 5', [], 'tickets_itil_impact_check');
      table.check('itil_urgency >= 1 AND itil_urgency <= 5', [], 'tickets_itil_urgency_check');
      table.check('itil_priority_level >= 1 AND itil_priority_level <= 5', [], 'tickets_itil_priority_level_check');
      table.check('escalation_level >= 1 AND escalation_level <= 3', [], 'tickets_escalation_level_check');

      // Add indexes for performance
      table.index(['itil_impact']);
      table.index(['itil_urgency']);
      table.index(['itil_priority_level']);
      table.index(['sla_breach']);
      table.index(['escalated']);
      table.index(['escalation_level']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .alterTable('tickets', function(table) {
      // Drop check constraints
      table.dropChecks(['tickets_itil_impact_check']);
      table.dropChecks(['tickets_itil_urgency_check']);
      table.dropChecks(['tickets_itil_priority_level_check']);
      table.dropChecks(['tickets_escalation_level_check']);

      // Drop indexes
      table.dropIndex(['itil_impact']);
      table.dropIndex(['itil_urgency']);
      table.dropIndex(['itil_priority_level']);
      table.dropIndex(['sla_breach']);
      table.dropIndex(['escalated']);
      table.dropIndex(['escalation_level']);

      // Drop columns
      table.dropColumn('itil_impact');
      table.dropColumn('itil_urgency');
      table.dropColumn('itil_priority_level');
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