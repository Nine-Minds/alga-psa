/**
 * Migration to create ITIL Change Management tables
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Create change_statuses table
    .createTable('change_statuses', function(table) {
      table.uuid('status_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('name').notNullable();
      table.text('description');
      table.boolean('is_active').defaultTo(true);
      table.boolean('is_closed').defaultTo(false);
      table.boolean('is_approved').defaultTo(false);
      table.boolean('is_rejected').defaultTo(false);
      table.integer('order_number').defaultTo(0);
      table.string('color', 7); // Hex color codes
      table.json('allowed_transitions'); // Valid next status IDs
      table.timestamps(true, true);
      
      // Indexes
      table.index(['tenant']);
      table.index(['is_active']);
      table.index(['order_number']);
      table.unique(['tenant', 'name']);
    })
    
    // Create change_requests table
    .createTable('change_requests', function(table) {
      table.uuid('change_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('change_number').notNullable();
      table.string('title').notNullable();
      table.text('description').notNullable();
      table.text('justification').notNullable();
      
      // Classification
      table.enum('change_type', ['standard', 'normal', 'emergency']).notNullable();
      table.enum('change_category', [
        'hardware', 'software', 'network', 'process', 'documentation',
        'security', 'infrastructure', 'application', 'database', 'environment'
      ]).notNullable();
      table.uuid('priority_id').notNullable().references('priority_id').inTable('priorities');
      table.uuid('status_id').notNullable().references('status_id').inTable('change_statuses');
      
      // Ownership
      table.uuid('requested_by').notNullable().references('user_id').inTable('users');
      table.uuid('change_owner').nullable().references('user_id').inTable('users');
      table.uuid('change_manager').nullable().references('user_id').inTable('users');
      table.uuid('implementer').nullable().references('user_id').inTable('users');
      
      // Scheduling
      table.timestamp('requested_implementation_date').nullable();
      table.timestamp('scheduled_start_date').nullable();
      table.timestamp('scheduled_end_date').nullable();
      table.timestamp('actual_start_date').nullable();
      table.timestamp('actual_end_date').nullable();
      
      // Impact and Risk
      table.text('business_impact');
      table.text('technical_impact');
      table.enum('risk_level', ['very_low', 'low', 'medium', 'high', 'very_high']).notNullable().defaultTo('medium');
      table.text('risk_assessment');
      table.json('affected_services'); // Array of service IDs
      table.json('affected_cis'); // Configuration Items
      
      // Implementation details
      table.text('implementation_plan');
      table.text('test_plan');
      table.text('backout_plan');
      table.text('communication_plan');
      
      // Approval flags
      table.boolean('cab_required').defaultTo(false);
      table.boolean('emergency_change').defaultTo(false);
      table.boolean('pre_approved').defaultTo(false);
      table.text('approval_notes');
      
      // Success criteria
      table.text('success_criteria');
      table.text('validation_plan');
      table.text('post_implementation_review');
      
      // Relationships
      table.json('related_incident_ids'); // Array of incident IDs
      table.json('related_problem_ids'); // Array of problem IDs
      table.uuid('parent_change_id').nullable().references('change_id').inTable('change_requests');
      table.json('child_change_ids'); // Array of child change IDs
      
      // User tracking
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.uuid('updated_by').nullable().references('user_id').inTable('users');
      table.uuid('approved_by').nullable().references('user_id').inTable('users');
      table.uuid('rejected_by').nullable().references('user_id').inTable('users');
      table.uuid('implemented_by').nullable().references('user_id').inTable('users');
      table.uuid('closed_by').nullable().references('user_id').inTable('users');
      
      // Timestamps
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').nullable();
      table.timestamp('submitted_at').nullable();
      table.timestamp('approved_at').nullable();
      table.timestamp('rejected_at').nullable();
      table.timestamp('implemented_at').nullable();
      table.timestamp('closed_at').nullable();
      
      // Closure information
      table.string('closure_code');
      table.text('closure_notes');
      table.boolean('implementation_success');
      table.text('lessons_learned');
      
      // Additional metadata
      table.json('attributes');
      table.json('tags'); // Tags support
      
      // Indexes
      table.index(['tenant']);
      table.index(['change_number']);
      table.index(['change_type']);
      table.index(['change_category']);
      table.index(['status_id']);
      table.index(['priority_id']);
      table.index(['requested_by']);
      table.index(['change_owner']);
      table.index(['change_manager']);
      table.index(['risk_level']);
      table.index(['cab_required']);
      table.index(['emergency_change']);
      table.index(['created_at']);
      table.index(['scheduled_start_date']);
      table.index(['scheduled_end_date']);
      
      // Unique constraint on change number per tenant
      table.unique(['tenant', 'change_number']);
    })
    
    // Create Change Advisory Board (CAB) table
    .createTable('change_advisory_boards', function(table) {
      table.uuid('cab_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('name').notNullable();
      table.text('description');
      table.boolean('is_active').defaultTo(true);
      
      // CAB composition
      table.uuid('chair_user_id').notNullable().references('user_id').inTable('users');
      table.json('members').notNullable(); // Array of user IDs
      table.json('advisors'); // Optional advisors
      
      // Meeting configuration
      table.string('meeting_schedule'); // Cron expression or description
      table.integer('meeting_duration_minutes').defaultTo(60);
      
      // Approval thresholds
      table.integer('quorum_required').defaultTo(3);
      table.decimal('approval_threshold', 5, 2).defaultTo(50.00); // Percentage
      
      // Scope
      table.json('change_types'); // Which change types this CAB handles
      table.json('risk_levels'); // Which risk levels require this CAB
      
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').nullable();
      
      // Indexes
      table.index(['tenant']);
      table.index(['is_active']);
      table.index(['chair_user_id']);
      table.unique(['tenant', 'name']);
    })
    
    // Create CAB meetings table
    .createTable('cab_meetings', function(table) {
      table.uuid('meeting_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('cab_id').notNullable().references('cab_id').inTable('change_advisory_boards').onDelete('CASCADE');
      table.timestamp('meeting_date').notNullable();
      table.integer('duration_minutes');
      table.string('location');
      table.enum('meeting_type', ['regular', 'emergency', 'special']).notNullable().defaultTo('regular');
      
      // Participants
      table.uuid('chair_user_id').notNullable().references('user_id').inTable('users');
      table.json('attendees'); // User IDs who attended
      table.json('apologies'); // User IDs who sent apologies
      
      // Meeting content
      table.text('agenda');
      table.text('minutes');
      table.json('action_items');
      
      // Status
      table.enum('status', ['scheduled', 'in_progress', 'completed', 'cancelled']).notNullable().defaultTo('scheduled');
      
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').nullable();
      
      // Indexes
      table.index(['tenant']);
      table.index(['cab_id']);
      table.index(['meeting_date']);
      table.index(['status']);
    })
    
    // Create CAB decisions table
    .createTable('cab_decisions', function(table) {
      table.uuid('decision_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('meeting_id').notNullable().references('meeting_id').inTable('cab_meetings').onDelete('CASCADE');
      table.uuid('change_id').notNullable().references('change_id').inTable('change_requests').onDelete('CASCADE');
      
      // Decision details
      table.enum('decision', ['approved', 'rejected', 'deferred', 'conditional']).notNullable();
      table.text('rationale').notNullable();
      table.text('conditions'); // If conditional approval
      
      // Voting details
      table.integer('votes_for').defaultTo(0);
      table.integer('votes_against').defaultTo(0);
      table.integer('abstentions').defaultTo(0);
      
      // Implementation constraints
      table.string('implementation_window');
      table.text('special_conditions');
      
      table.uuid('decided_by').notNullable().references('user_id').inTable('users');
      table.timestamp('decided_at').defaultTo(knex.fn.now());
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index(['tenant']);
      table.index(['meeting_id']);
      table.index(['change_id']);
      table.index(['decision']);
      table.unique(['meeting_id', 'change_id']); // One decision per change per meeting
    })
    
    // Create change conflicts table
    .createTable('change_conflicts', function(table) {
      table.uuid('conflict_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('change_id_1').notNullable().references('change_id').inTable('change_requests').onDelete('CASCADE');
      table.uuid('change_id_2').notNullable().references('change_id').inTable('change_requests').onDelete('CASCADE');
      
      table.enum('conflict_type', [
        'resource_conflict', 'time_overlap', 'dependency_conflict', 
        'blackout_violation', 'maintenance_window'
      ]).notNullable();
      table.enum('severity', ['low', 'medium', 'high', 'critical']).notNullable().defaultTo('medium');
      
      // Conflict details
      table.text('description').notNullable();
      table.json('affected_resources');
      table.boolean('time_overlap').defaultTo(false);
      table.boolean('resource_contention').defaultTo(false);
      table.boolean('dependency_conflict').defaultTo(false);
      
      // Resolution
      table.enum('status', ['identified', 'under_review', 'resolved', 'accepted_risk']).notNullable().defaultTo('identified');
      table.text('resolution');
      table.uuid('resolved_by').nullable().references('user_id').inTable('users');
      table.timestamp('resolved_at').nullable();
      
      table.string('detected_by').notNullable(); // System or user ID
      table.timestamp('detected_at').defaultTo(knex.fn.now());
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index(['tenant']);
      table.index(['change_id_1']);
      table.index(['change_id_2']);
      table.index(['conflict_type']);
      table.index(['severity']);
      table.index(['status']);
      table.unique(['change_id_1', 'change_id_2', 'conflict_type']); // Prevent duplicate conflicts
    })
    
    // Create change calendar events table
    .createTable('change_calendar_events', function(table) {
      table.uuid('event_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('change_id').nullable().references('change_id').inTable('change_requests').onDelete('CASCADE');
      
      table.enum('event_type', ['change', 'maintenance_window', 'blackout', 'freeze']).notNullable();
      table.string('title').notNullable();
      table.text('description');
      
      // Timing
      table.timestamp('start_date').notNullable();
      table.timestamp('end_date').notNullable();
      table.boolean('all_day').defaultTo(false);
      table.string('timezone').defaultTo('UTC');
      
      // Scope
      table.json('affected_services');
      table.json('affected_environments');
      
      // Ownership
      table.uuid('approved_by').nullable().references('user_id').inTable('users');
      table.uuid('owner').nullable().references('user_id').inTable('users');
      
      // Recurrence
      table.string('recurrence_rule'); // RRULE format
      table.json('recurrence_exceptions'); // Exception dates
      
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').nullable();
      
      // Indexes
      table.index(['tenant']);
      table.index(['change_id']);
      table.index(['event_type']);
      table.index(['start_date']);
      table.index(['end_date']);
      table.index(['owner']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('change_calendar_events')
    .dropTableIfExists('change_conflicts')
    .dropTableIfExists('cab_decisions')
    .dropTableIfExists('cab_meetings')
    .dropTableIfExists('change_advisory_boards')
    .dropTableIfExists('change_requests')
    .dropTableIfExists('change_statuses');
};