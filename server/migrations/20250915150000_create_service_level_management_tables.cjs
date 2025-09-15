/**
 * Migration: Create Service Level Management Tables
 * 
 * Creates comprehensive database schema for ITIL Service Level Management
 * including services, SLAs, SLOs, performance tracking, and customer satisfaction
 */

exports.up = function(knex) {
  return knex.schema

    // Services table - Core service catalog
    .createTable('services', function(table) {
      table.uuid('service_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      
      // Basic service information
      table.string('service_name', 255).notNullable();
      table.string('service_code', 50).notNullable(); // Unique identifier
      table.text('description').notNullable();
      table.enum('service_category', ['business', 'technical', 'infrastructure', 'application']).notNullable();
      table.enum('service_type', ['customer_facing', 'supporting', 'management']).notNullable();
      
      // Service ownership
      table.uuid('service_owner').notNullable(); // User ID
      table.uuid('technical_owner').notNullable(); // User ID
      table.uuid('business_owner').notNullable(); // User ID
      
      // Service status and lifecycle
      table.enum('status', ['design', 'transition', 'live', 'retired']).defaultTo('design');
      table.enum('lifecycle_stage', ['strategy', 'design', 'transition', 'operation', 'continual_improvement']).defaultTo('strategy');
      
      // Service details
      table.text('business_value');
      table.json('target_audience'); // Array of target audience descriptions
      table.json('operating_hours'); // Operating schedule configuration
      table.decimal('availability_target', 5, 2).defaultTo(99.9); // Percentage
      
      // Dependencies (stored as JSON arrays of service IDs)
      table.json('depends_on_services').defaultTo('[]');
      table.json('supports_services').defaultTo('[]');
      
      // Financial information
      table.string('cost_center', 100);
      table.decimal('annual_cost', 15, 2);
      table.enum('charging_model', ['free', 'subscription', 'usage_based', 'project_based']);
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      table.timestamp('retired_date');
      table.text('retired_reason');
      
      // Indexes
      table.index(['tenant', 'status']);
      table.index(['tenant', 'service_category']);
      table.index(['tenant', 'service_owner']);
      table.unique(['tenant', 'service_code']);
    })

    // Service Level Agreements table
    .createTable('service_level_agreements', function(table) {
      table.uuid('sla_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.string('sla_name', 255).notNullable();
      table.uuid('service_id').notNullable();
      
      // Agreement details
      table.uuid('customer_id'); // Optional - specific customer
      table.enum('agreement_type', ['standard', 'custom', 'internal']).defaultTo('standard');
      table.enum('status', ['draft', 'active', 'expired', 'terminated']).defaultTo('draft');
      
      // Validity period
      table.timestamp('effective_date').notNullable();
      table.timestamp('expiry_date');
      table.timestamp('review_date');
      
      // Service level targets
      table.decimal('availability_target', 5, 2).notNullable();
      table.integer('response_time_target').notNullable(); // Minutes
      table.json('resolution_time_targets').notNullable(); // Priority-based targets in hours
      
      // Performance measurement
      table.enum('uptime_measurement_period', ['monthly', 'quarterly', 'annually']).defaultTo('monthly');
      table.json('exclusions').defaultTo('[]'); // Planned maintenance, etc.
      table.json('penalties'); // Penalty structure
      
      // Service credits
      table.boolean('service_credits_enabled').defaultTo(false);
      table.json('credit_thresholds').defaultTo('[]'); // Threshold and credit percentages
      
      // Reporting configuration
      table.enum('reporting_frequency', ['weekly', 'monthly', 'quarterly']).defaultTo('monthly');
      table.json('report_recipients').defaultTo('[]'); // Array of user IDs
      
      // Escalation matrix
      table.json('escalation_matrix').notNullable(); // Escalation levels and contacts
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      table.uuid('approved_by');
      table.timestamp('approved_date');
      
      // Foreign key constraints
      table.foreign('service_id').references('service_id').inTable('services').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'status']);
      table.index(['service_id', 'status']);
      table.index(['customer_id']);
    })

    // Service Level Objectives table
    .createTable('service_level_objectives', function(table) {
      table.uuid('slo_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.uuid('sla_id').notNullable();
      table.uuid('service_id').notNullable();
      
      // Objective details
      table.string('objective_name', 255).notNullable();
      table.text('description').notNullable();
      table.enum('metric_type', ['availability', 'response_time', 'resolution_time', 'throughput', 'error_rate', 'customer_satisfaction']).notNullable();
      
      // Target values
      table.decimal('target_value', 10, 4).notNullable();
      table.string('target_unit', 50).notNullable(); // %, minutes, hours, etc.
      table.enum('measurement_period', ['hourly', 'daily', 'weekly', 'monthly']).notNullable();
      
      // Measurement configuration
      table.string('measurement_method', 255).notNullable();
      table.string('data_source', 255).notNullable();
      table.text('calculation_formula');
      
      // Thresholds
      table.decimal('warning_threshold', 10, 4).notNullable();
      table.decimal('critical_threshold', 10, 4).notNullable();
      
      // Status
      table.enum('status', ['active', 'paused', 'archived']).defaultTo('active');
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('last_measured');
      table.decimal('current_performance', 10, 4);
      
      // Foreign key constraints
      table.foreign('sla_id').references('sla_id').inTable('service_level_agreements').onDelete('CASCADE');
      table.foreign('service_id').references('service_id').inTable('services').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'status']);
      table.index(['service_id', 'metric_type']);
      table.index(['sla_id']);
    })

    // Service Performance Records table
    .createTable('service_performance_records', function(table) {
      table.uuid('record_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.uuid('service_id').notNullable();
      table.uuid('sla_id');
      table.uuid('slo_id');
      
      // Measurement details
      table.timestamp('measurement_date').notNullable();
      table.timestamp('measurement_period_start').notNullable();
      table.timestamp('measurement_period_end').notNullable();
      
      // Performance metrics
      table.decimal('availability_percentage', 5, 2);
      table.integer('uptime_minutes');
      table.integer('downtime_minutes');
      table.integer('total_incidents');
      
      // Response time metrics
      table.decimal('avg_response_time', 8, 2); // Minutes
      table.decimal('p95_response_time', 8, 2);
      table.decimal('p99_response_time', 8, 2);
      
      // Resolution time metrics by priority (hours)
      table.json('resolution_times').defaultTo('{}');
      
      // SLA compliance
      table.decimal('sla_compliance_percentage', 5, 2).notNullable();
      table.integer('sla_breaches').defaultTo(0);
      
      // Customer satisfaction
      table.decimal('csat_score', 3, 2); // 1-5 scale
      table.integer('csat_responses');
      table.decimal('nps_score', 6, 2); // -100 to +100
      table.integer('nps_responses');
      
      // Incident counts by priority
      table.integer('total_incidents_p1').defaultTo(0);
      table.integer('total_incidents_p2').defaultTo(0);
      table.integer('total_incidents_p3').defaultTo(0);
      table.integer('total_incidents_p4').defaultTo(0);
      table.integer('total_incidents_p5').defaultTo(0);
      
      // Change statistics
      table.integer('total_changes').defaultTo(0);
      table.integer('successful_changes').defaultTo(0);
      table.integer('failed_changes').defaultTo(0);
      
      // Financial impact
      table.decimal('service_credits_applied', 10, 2).defaultTo(0);
      table.decimal('penalty_amount', 10, 2).defaultTo(0);
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.json('data_sources').defaultTo('[]'); // Systems that provided data
      
      // Foreign key constraints
      table.foreign('service_id').references('service_id').inTable('services').onDelete('CASCADE');
      table.foreign('sla_id').references('sla_id').inTable('service_level_agreements').onDelete('CASCADE');
      table.foreign('slo_id').references('slo_id').inTable('service_level_objectives').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'service_id', 'measurement_date']);
      table.index(['service_id', 'measurement_period_start', 'measurement_period_end']);
      table.index(['sla_id', 'measurement_date']);
    })

    // Customer Satisfaction Surveys table
    .createTable('customer_satisfaction_surveys', function(table) {
      table.uuid('survey_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      
      // Survey details
      table.enum('survey_type', ['csat', 'nps', 'ces', 'custom']).notNullable();
      table.string('title', 255).notNullable();
      table.text('description');
      
      // Trigger configuration
      table.enum('trigger_type', ['ticket_closure', 'scheduled', 'manual', 'service_interaction']).notNullable();
      table.json('trigger_conditions'); // Service IDs, priority levels, etc.
      
      // Survey questions
      table.json('questions').notNullable(); // Array of question objects
      
      // Configuration
      table.enum('status', ['draft', 'active', 'paused', 'archived']).defaultTo('draft');
      table.integer('send_delay_minutes').defaultTo(0);
      table.boolean('reminder_enabled').defaultTo(false);
      table.json('reminder_days').defaultTo('[]');
      
      // Recipients
      table.enum('target_audience', ['all_customers', 'specific_customers', 'service_users']).notNullable();
      table.json('customer_filter'); // Company IDs, contact IDs, service IDs
      
      // Response settings
      table.boolean('anonymous_responses').defaultTo(false);
      table.integer('response_limit');
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      
      // Indexes
      table.index(['tenant', 'status']);
      table.index(['survey_type', 'status']);
    })

    // Customer Satisfaction Responses table
    .createTable('customer_satisfaction_responses', function(table) {
      table.uuid('response_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.uuid('survey_id').notNullable();
      
      // Respondent information
      table.uuid('customer_id'); // Null if anonymous
      table.uuid('contact_id');
      table.uuid('ticket_id'); // If triggered by ticket closure
      table.uuid('service_id');
      
      // Response data
      table.json('responses').notNullable(); // Array of question responses
      
      // Calculated scores
      table.decimal('csat_score', 3, 2); // 1-5 scale
      table.decimal('nps_score', 6, 2); // -100 to +100 (converted from 0-10)
      table.decimal('ces_score', 3, 2); // 1-7 scale
      table.decimal('overall_satisfaction', 3, 2);
      
      // Response metadata
      table.timestamp('response_date').defaultTo(knex.fn.now());
      table.enum('response_channel', ['email', 'web', 'mobile', 'phone', 'sms']).notNullable();
      table.integer('completion_time_seconds');
      
      // Follow-up
      table.boolean('follow_up_requested').defaultTo(false);
      table.boolean('follow_up_completed').defaultTo(false);
      table.text('follow_up_notes');
      
      // Foreign key constraints
      table.foreign('survey_id').references('survey_id').inTable('customer_satisfaction_surveys').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'survey_id', 'response_date']);
      table.index(['customer_id']);
      table.index(['ticket_id']);
      table.index(['service_id']);
    })

    // Service Reports table
    .createTable('service_reports', function(table) {
      table.uuid('report_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      
      // Report configuration
      table.string('report_name', 255).notNullable();
      table.enum('report_type', ['sla_performance', 'service_availability', 'customer_satisfaction', 'service_overview', 'executive_summary']).notNullable();
      table.json('service_ids').notNullable(); // Array of service IDs
      table.json('sla_ids'); // Array of SLA IDs
      
      // Report period
      table.timestamp('period_start').notNullable();
      table.timestamp('period_end').notNullable();
      table.enum('reporting_frequency', ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'custom']).notNullable();
      
      // Report content configuration
      table.json('sections').notNullable(); // Array of section configurations
      
      // Distribution
      table.json('recipients').notNullable(); // Array of user IDs
      table.enum('distribution_method', ['email', 'portal', 'both']).defaultTo('email');
      table.boolean('auto_generate').defaultTo(false);
      
      // Generation status
      table.enum('status', ['pending', 'generating', 'completed', 'failed']).defaultTo('pending');
      table.timestamp('generated_date');
      table.string('file_path', 500); // Path to generated report file
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.uuid('template_id'); // Reference to report template
      
      // Indexes
      table.index(['tenant', 'report_type']);
      table.index(['tenant', 'status']);
      table.index(['auto_generate', 'reporting_frequency']);
    })

    // Service Dependencies table
    .createTable('service_dependencies', function(table) {
      table.uuid('dependency_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.uuid('service_id').notNullable(); // Dependent service
      table.uuid('depends_on_service_id').notNullable(); // Service being depended on
      
      // Dependency details
      table.enum('dependency_type', ['hard', 'soft', 'operational']).notNullable();
      table.enum('impact_level', ['high', 'medium', 'low']).notNullable();
      table.text('description');
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      
      // Foreign key constraints
      table.foreign('service_id').references('service_id').inTable('services').onDelete('CASCADE');
      table.foreign('depends_on_service_id').references('service_id').inTable('services').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'service_id']);
      table.index(['depends_on_service_id']);
      table.unique(['service_id', 'depends_on_service_id']); // Prevent duplicate dependencies
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('service_dependencies')
    .dropTableIfExists('service_reports')
    .dropTableIfExists('customer_satisfaction_responses')
    .dropTableIfExists('customer_satisfaction_surveys')
    .dropTableIfExists('service_performance_records')
    .dropTableIfExists('service_level_objectives')
    .dropTableIfExists('service_level_agreements')
    .dropTableIfExists('services');
};