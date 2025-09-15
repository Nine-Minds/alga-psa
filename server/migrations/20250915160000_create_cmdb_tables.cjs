/**
 * Migration: Create CMDB (Configuration Management Database) Tables
 * 
 * Creates comprehensive database schema for ITIL Configuration Management
 * including CIs, relationships, discovery, impact analysis, and audit trails
 */

exports.up = function(knex) {
  return knex.schema

    // CI Types table - Define different types of Configuration Items
    .createTable('ci_types', function(table) {
      table.uuid('ci_type_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      
      // Type definition
      table.string('type_name', 100).notNullable();
      table.string('type_code', 50).notNullable();
      table.uuid('parent_type_id').references('ci_type_id').inTable('ci_types');
      table.enum('category', ['hardware', 'software', 'service', 'documentation', 'location', 'person']).notNullable();
      
      // Type configuration
      table.text('description');
      table.string('icon', 100).defaultTo('default');
      table.string('color', 7).defaultTo('#666666'); // Hex color for visualization
      
      // Attribute schema
      table.json('required_attributes').defaultTo('[]');
      table.json('optional_attributes').defaultTo('[]');
      table.json('attribute_definitions').defaultTo('{}');
      
      // Relationship rules
      table.json('allowed_relationships').defaultTo('[]');
      
      // Discovery configuration
      table.boolean('discoverable').defaultTo(false);
      table.json('discovery_rules').defaultTo('{}');
      
      // Status
      table.boolean('active').defaultTo(true);
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      
      // Indexes
      table.index(['tenant', 'active']);
      table.index(['category']);
      table.unique(['tenant', 'type_code']);
    })

    // Configuration Items table - Core CMDB entity
    .createTable('configuration_items', function(table) {
      table.uuid('ci_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      
      // Basic CI information
      table.string('ci_name', 255).notNullable();
      table.string('ci_number', 100).notNullable(); // Unique identifier
      table.string('ci_type', 100).notNullable(); // References ci_types.type_code
      table.string('ci_class', 100); // More specific classification
      table.enum('ci_status', ['planned', 'ordered', 'received', 'under_development', 'build_complete', 'live', 'withdrawn', 'disposed']).defaultTo('planned');
      
      // Descriptive information
      table.text('description').notNullable();
      table.text('purpose');
      table.enum('business_criticality', ['very_high', 'high', 'medium', 'low', 'very_low']).defaultTo('medium');
      table.enum('environment', ['production', 'staging', 'testing', 'development', 'disaster_recovery']).defaultTo('production');
      
      // Ownership and responsibility
      table.uuid('owner').notNullable(); // User ID
      table.uuid('custodian').notNullable(); // User ID
      table.string('supplier', 255);
      
      // Technical details (flexible JSON for different CI types)
      table.json('technical_attributes').defaultTo('{}');
      
      // Location and physical details
      table.string('location', 255);
      table.string('room', 50);
      table.string('rack', 50);
      table.string('position', 50);
      
      // Lifecycle information
      table.timestamp('acquisition_date');
      table.timestamp('warranty_expiry_date');
      table.string('maintenance_schedule', 500);
      table.timestamp('disposal_date');
      
      // Version and change control
      table.string('version', 50).defaultTo('1.0');
      table.timestamp('last_modified_date').defaultTo(knex.fn.now());
      table.uuid('last_modified_by').notNullable();
      table.string('change_control_record', 100); // Link to change request
      
      // Discovery information
      table.enum('discovered_by', ['manual', 'automated', 'import']).defaultTo('manual');
      table.string('discovery_source', 100);
      table.timestamp('last_discovered');
      table.enum('discovery_status', ['confirmed', 'pending', 'unconfirmed', 'duplicate']).defaultTo('confirmed');
      
      // Compliance and security
      table.json('compliance_requirements').defaultTo('[]');
      table.enum('security_classification', ['public', 'internal', 'confidential', 'restricted']).defaultTo('internal');
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      
      // Indexes
      table.index(['tenant', 'ci_status']);
      table.index(['tenant', 'ci_type']);
      table.index(['tenant', 'environment']);
      table.index(['tenant', 'business_criticality']);
      table.index(['owner']);
      table.index(['custodian']);
      table.index(['last_modified_date']);
      table.unique(['tenant', 'ci_number']);
    })

    // CI Relationships table - Defines relationships between CIs
    .createTable('ci_relationships', function(table) {
      table.uuid('relationship_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      
      // Relationship definition
      table.uuid('source_ci_id').notNullable();
      table.uuid('target_ci_id').notNullable();
      table.enum('relationship_type', ['depends_on', 'part_of', 'connected_to', 'installed_on', 'uses', 'provides', 'manages', 'backed_up_by', 'clustered_with']).notNullable();
      
      // Relationship details
      table.text('description');
      table.enum('strength', ['strong', 'medium', 'weak']).defaultTo('medium');
      table.enum('criticality', ['critical', 'important', 'normal', 'low']).defaultTo('normal');
      
      // Directional information
      table.boolean('is_bidirectional').defaultTo(false);
      
      // Lifecycle
      table.timestamp('start_date').defaultTo(knex.fn.now());
      table.timestamp('end_date');
      table.enum('status', ['active', 'inactive', 'pending', 'expired']).defaultTo('active');
      
      // Discovery and validation
      table.enum('discovered_by', ['manual', 'automated', 'network_scan', 'service_mapping']).defaultTo('manual');
      table.timestamp('last_validated');
      table.enum('validation_status', ['confirmed', 'pending', 'suspected', 'invalid']).defaultTo('confirmed');
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      
      // Foreign key constraints
      table.foreign('source_ci_id').references('ci_id').inTable('configuration_items').onDelete('CASCADE');
      table.foreign('target_ci_id').references('ci_id').inTable('configuration_items').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'status']);
      table.index(['source_ci_id', 'relationship_type']);
      table.index(['target_ci_id', 'relationship_type']);
      table.index(['relationship_type']);
      table.unique(['source_ci_id', 'target_ci_id', 'relationship_type']); // Prevent duplicate relationships
    })

    // Discovery Rules table - Defines automated discovery configurations
    .createTable('discovery_rules', function(table) {
      table.uuid('rule_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      
      // Rule definition
      table.string('rule_name', 255).notNullable();
      table.enum('rule_type', ['network_scan', 'agent_based', 'api_integration', 'file_scan', 'database_query']).notNullable();
      table.json('target_ci_types').notNullable(); // Array of CI types to discover
      
      // Rule configuration
      table.json('configuration').defaultTo('{}');
      
      // Scheduling
      table.boolean('schedule_enabled').defaultTo(false);
      table.string('schedule_cron', 100); // Cron expression
      table.timestamp('last_run');
      table.timestamp('next_run');
      
      // Filtering and mapping
      table.json('inclusion_filters').defaultTo('{}');
      table.json('exclusion_filters').defaultTo('{}');
      table.json('attribute_mapping').defaultTo('{}');
      
      // Processing rules
      table.enum('duplicate_handling', ['merge', 'create_new', 'skip', 'flag']).defaultTo('flag');
      table.enum('conflict_resolution', ['keep_existing', 'update_existing', 'manual_review']).defaultTo('manual_review');
      
      // Status and performance
      table.boolean('active').defaultTo(true);
      table.decimal('success_rate', 5, 2).defaultTo(0); // Percentage
      table.timestamp('last_success_date');
      table.text('last_error');
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      
      // Indexes
      table.index(['tenant', 'active']);
      table.index(['rule_type']);
      table.index(['schedule_enabled', 'next_run']);
    })

    // Discovery Results table - Results of discovery rule executions
    .createTable('discovery_results', function(table) {
      table.uuid('result_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      table.uuid('rule_id').notNullable();
      
      // Discovery session
      table.string('discovery_session_id', 100).notNullable();
      table.timestamp('discovery_date').notNullable();
      
      // Results summary
      table.integer('total_items_found').defaultTo(0);
      table.integer('items_created').defaultTo(0);
      table.integer('items_updated').defaultTo(0);
      table.integer('items_skipped').defaultTo(0);
      table.integer('items_flagged').defaultTo(0);
      
      // Status
      table.enum('status', ['completed', 'failed', 'partial', 'in_progress']).notNullable();
      
      // Details
      table.json('discovered_items').defaultTo('[]');
      table.json('errors').defaultTo('[]');
      
      // Performance metrics
      table.integer('execution_time_ms').defaultTo(0);
      table.decimal('data_processed_mb', 10, 2).defaultTo(0);
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      
      // Foreign key constraints
      table.foreign('rule_id').references('rule_id').inTable('discovery_rules').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'discovery_date']);
      table.index(['rule_id', 'discovery_date']);
      table.index(['status']);
    })

    // Impact Analysis table - Results of change impact analysis
    .createTable('impact_analysis', function(table) {
      table.uuid('analysis_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      
      // Analysis context
      table.enum('trigger_type', ['change_request', 'incident', 'planned_maintenance', 'manual']).notNullable();
      table.string('trigger_id', 100); // ID of the triggering entity
      
      // Analysis scope
      table.json('source_ci_ids').notNullable(); // Array of starting CI IDs
      table.enum('analysis_direction', ['upstream', 'downstream', 'both']).defaultTo('downstream');
      table.integer('max_depth').defaultTo(5); // Relationship levels to analyze
      
      // Analysis results
      table.json('impacted_cis').defaultTo('[]');
      
      // Impact summary
      table.integer('total_impacted').defaultTo(0);
      table.integer('critical_impact_count').defaultTo(0);
      table.integer('high_impact_count').defaultTo(0);
      table.integer('medium_impact_count').defaultTo(0);
      table.integer('low_impact_count').defaultTo(0);
      
      // Business impact assessment
      table.json('affected_services').defaultTo('[]');
      table.integer('affected_users_estimate').defaultTo(0);
      table.integer('estimated_downtime_minutes').defaultTo(0);
      table.decimal('financial_impact_estimate', 12, 2);
      
      // Recommendations
      table.json('recommendations').defaultTo('[]');
      
      // Analysis metadata
      table.timestamp('analysis_date').defaultTo(knex.fn.now());
      table.integer('analysis_duration_ms').defaultTo(0);
      table.enum('analyzer', ['automated', 'manual']).defaultTo('automated');
      table.uuid('performed_by').notNullable();
      
      // Status
      table.enum('status', ['completed', 'failed', 'in_progress']).defaultTo('in_progress');
      table.decimal('confidence_score', 5, 2).defaultTo(0); // 0-100%
      
      // Indexes
      table.index(['tenant', 'trigger_type']);
      table.index(['analysis_date']);
      table.index(['status']);
    })

    // CMDB Audit Log table - Track all changes to CMDB data
    .createTable('cmdb_audit_log', function(table) {
      table.uuid('audit_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      
      // Audit context
      table.uuid('ci_id');
      table.uuid('relationship_id');
      table.enum('entity_type', ['configuration_item', 'relationship', 'ci_type', 'discovery_rule']).notNullable();
      
      // Change information
      table.enum('action', ['created', 'updated', 'deleted', 'status_changed', 'discovered', 'validated']).notNullable();
      table.json('field_changes').defaultTo('[]'); // Array of field change objects
      
      // Context
      table.enum('change_reason', ['manual_update', 'discovery', 'import', 'change_request', 'incident_resolution']);
      table.string('change_request_id', 100);
      table.string('incident_id', 100);
      
      // Metadata
      table.uuid('performed_by').notNullable();
      table.timestamp('performed_date').defaultTo(knex.fn.now());
      table.string('source_system', 100);
      table.text('notes');
      
      // Validation
      table.boolean('validated').defaultTo(false);
      table.timestamp('validation_date');
      table.uuid('validated_by');
      
      // Foreign key constraints
      table.foreign('ci_id').references('ci_id').inTable('configuration_items').onDelete('CASCADE');
      table.foreign('relationship_id').references('relationship_id').inTable('ci_relationships').onDelete('CASCADE');
      
      // Indexes
      table.index(['tenant', 'performed_date']);
      table.index(['ci_id', 'performed_date']);
      table.index(['entity_type', 'action']);
      table.index(['performed_by']);
    })

    // CMDB Reports table - Configuration management reports
    .createTable('cmdb_reports', function(table) {
      table.uuid('report_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant').notNullable();
      
      // Report configuration
      table.string('report_name', 255).notNullable();
      table.enum('report_type', ['inventory', 'relationships', 'compliance', 'change_impact', 'discovery_status', 'data_quality']).notNullable();
      
      // Scope and filters
      table.json('ci_types').defaultTo('[]');
      table.json('statuses').defaultTo('[]');
      table.json('owners').defaultTo('[]');
      table.json('locations').defaultTo('[]');
      table.json('date_range'); // {start: Date, end: Date}
      
      // Report content
      table.json('include_sections').defaultTo('{}');
      
      // Scheduling
      table.boolean('is_scheduled').defaultTo(false);
      table.enum('schedule_frequency', ['daily', 'weekly', 'monthly', 'quarterly']);
      table.timestamp('next_generation_date');
      
      // Distribution
      table.json('recipients').defaultTo('[]'); // Array of user IDs
      table.enum('delivery_format', ['pdf', 'excel', 'csv', 'json']).defaultTo('pdf');
      
      // Generation status
      table.enum('status', ['pending', 'generating', 'completed', 'failed']).defaultTo('pending');
      table.timestamp('generated_date');
      table.string('file_path', 500);
      
      // Metadata
      table.timestamp('created_date').defaultTo(knex.fn.now());
      table.uuid('created_by').notNullable();
      table.timestamp('updated_date');
      table.uuid('updated_by');
      
      // Indexes
      table.index(['tenant', 'report_type']);
      table.index(['is_scheduled', 'next_generation_date']);
      table.index(['status']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('cmdb_reports')
    .dropTableIfExists('cmdb_audit_log')
    .dropTableIfExists('impact_analysis')
    .dropTableIfExists('discovery_results')
    .dropTableIfExists('discovery_rules')
    .dropTableIfExists('ci_relationships')
    .dropTableIfExists('configuration_items')
    .dropTableIfExists('ci_types');
};