/**
 * Migration to create ITIL Problem Management tables
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Create problem_statuses table
    .createTable('problem_statuses', function(table) {
      table.uuid('status_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('name').notNullable();
      table.text('description');
      table.boolean('is_active').defaultTo(true);
      table.boolean('is_closed').defaultTo(false);
      table.boolean('is_resolved').defaultTo(false);
      table.integer('order_number').defaultTo(0);
      table.string('color', 7); // Hex color codes
      table.timestamps(true, true);
      
      // Indexes
      table.index(['tenant']);
      table.index(['is_active']);
      table.index(['order_number']);
      table.unique(['tenant', 'name']);
    })
    
    // Create problems table
    .createTable('problems', function(table) {
      table.uuid('problem_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('problem_number').notNullable();
      table.string('title').notNullable();
      table.text('description').notNullable();
      
      // Status and priority
      table.uuid('status_id').notNullable().references('status_id').inTable('problem_statuses');
      table.uuid('priority_id').notNullable().references('priority_id').inTable('priorities');
      table.uuid('category_id').nullable().references('category_id').inTable('categories');
      table.uuid('subcategory_id').nullable();
      
      // Problem management specific
      table.enum('problem_type', ['proactive', 'reactive']).notNullable().defaultTo('reactive');
      table.text('root_cause');
      table.text('workaround');
      table.text('permanent_solution');
      
      // Assignment
      table.uuid('assigned_to').nullable().references('user_id').inTable('users');
      table.uuid('problem_manager').nullable().references('user_id').inTable('users');
      table.json('investigation_team'); // Array of user IDs
      
      // User tracking
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.uuid('updated_by').nullable().references('user_id').inTable('users');
      table.uuid('resolved_by').nullable().references('user_id').inTable('users');
      table.uuid('closed_by').nullable().references('user_id').inTable('users');
      
      // Timestamps
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').nullable();
      table.timestamp('resolved_at').nullable();
      table.timestamp('closed_at').nullable();
      table.timestamp('investigation_started_at').nullable();
      table.timestamp('investigation_completed_at').nullable();
      table.timestamp('solution_implemented_at').nullable();
      
      // Business impact
      table.text('business_impact');
      table.json('affected_services'); // Array of service IDs
      table.decimal('estimated_cost', 12, 2).nullable();
      
      // KEDB fields
      table.boolean('is_known_error').defaultTo(false);
      table.timestamp('known_error_date').nullable();
      table.text('error_pattern');
      table.text('detection_criteria');
      
      // Relationships
      table.uuid('parent_problem_id').nullable().references('problem_id').inTable('problems');
      table.uuid('duplicate_of_problem_id').nullable().references('problem_id').inTable('problems');
      table.json('related_change_ids'); // Array of change IDs
      
      // Metrics
      table.integer('incident_count').defaultTo(0);
      table.integer('recurrence_count').defaultTo(0);
      table.timestamp('last_occurrence').nullable();
      
      // Closure information
      table.string('closure_code');
      table.text('closure_notes');
      table.text('lessons_learned');
      
      // Additional metadata
      table.json('attributes');
      
      // Tags support (if using tagging system)
      table.json('tags');
      
      // Indexes
      table.index(['tenant']);
      table.index(['problem_number']);
      table.index(['status_id']);
      table.index(['priority_id']);
      table.index(['category_id']);
      table.index(['assigned_to']);
      table.index(['problem_manager']);
      table.index(['created_by']);
      table.index(['problem_type']);
      table.index(['is_known_error']);
      table.index(['created_at']);
      table.index(['resolved_at']);
      table.index(['closed_at']);
      
      // Unique constraint on problem number per tenant
      table.unique(['tenant', 'problem_number']);
    })
    
    // Create problem_incidents table (many-to-many relationship)
    .createTable('problem_incidents', function(table) {
      table.uuid('problem_incident_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('problem_id').notNullable().references('problem_id').inTable('problems').onDelete('CASCADE');
      table.uuid('incident_id').notNullable().references('ticket_id').inTable('tickets').onDelete('CASCADE');
      table.enum('relationship_type', ['caused_by', 'related_to', 'symptom_of']).notNullable().defaultTo('caused_by');
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.text('notes');
      
      // Indexes
      table.index(['tenant']);
      table.index(['problem_id']);
      table.index(['incident_id']);
      table.index(['relationship_type']);
      
      // Unique constraint to prevent duplicate relationships
      table.unique(['problem_id', 'incident_id', 'relationship_type']);
    })
    
    // Create known_errors table (KEDB)
    .createTable('known_errors', function(table) {
      table.uuid('known_error_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('problem_id').notNullable().references('problem_id').inTable('problems').onDelete('CASCADE');
      table.string('error_code').notNullable(); // Unique identifier
      table.string('title').notNullable();
      table.text('description').notNullable();
      table.text('symptoms').notNullable(); // How to identify this error
      table.text('workaround');
      table.text('resolution_steps');
      table.json('affected_cis'); // Configuration Items affected
      
      // Classification
      table.enum('error_type', ['software', 'hardware', 'network', 'process', 'environmental']).notNullable();
      table.enum('severity', ['critical', 'high', 'medium', 'low']).notNullable().defaultTo('medium');
      
      // Lifecycle
      table.timestamp('identified_date').notNullable();
      table.timestamp('resolved_date').nullable();
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.uuid('updated_by').nullable().references('user_id').inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').nullable();
      
      // Metrics
      table.integer('occurrence_count').defaultTo(0);
      table.timestamp('last_occurrence').nullable();
      table.decimal('avg_resolution_time', 8, 2).nullable(); // In hours
      
      // Documentation
      table.string('documentation_url');
      table.string('vendor_reference');
      table.string('internal_reference');
      
      // Additional metadata
      table.json('attributes');
      
      // Indexes
      table.index(['tenant']);
      table.index(['problem_id']);
      table.index(['error_code']);
      table.index(['error_type']);
      table.index(['severity']);
      table.index(['identified_date']);
      table.index(['resolved_date']);
      
      // Unique constraint on error code per tenant
      table.unique(['tenant', 'error_code']);
    })
    
    // Create problem_analysis table
    .createTable('problem_analysis', function(table) {
      table.uuid('analysis_id').primary().defaultTo(knex.fn.uuid());
      table.uuid('tenant').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('problem_id').notNullable().references('problem_id').inTable('problems').onDelete('CASCADE');
      table.timestamp('session_date').notNullable();
      table.integer('duration_minutes');
      
      // Participants
      table.uuid('lead_analyst').notNullable().references('user_id').inTable('users');
      table.json('participants'); // Array of user IDs
      
      // Analysis details
      table.enum('analysis_type', ['root_cause_analysis', 'impact_assessment', 'solution_design', 'review']).notNullable();
      table.text('findings').notNullable();
      table.text('actions_identified');
      table.text('recommendations');
      
      // Follow-up
      table.text('next_steps');
      table.timestamp('next_session_date').nullable();
      
      // Documentation
      table.text('meeting_notes');
      table.json('attachments'); // Array of attachment references
      
      table.uuid('created_by').notNullable().references('user_id').inTable('users');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').nullable();
      
      // Indexes
      table.index(['tenant']);
      table.index(['problem_id']);
      table.index(['session_date']);
      table.index(['analysis_type']);
      table.index(['lead_analyst']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('problem_analysis')
    .dropTableIfExists('known_errors')
    .dropTableIfExists('problem_incidents')
    .dropTableIfExists('problems')
    .dropTableIfExists('problem_statuses');
};