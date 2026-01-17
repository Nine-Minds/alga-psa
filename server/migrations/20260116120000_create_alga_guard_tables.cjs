/**
 * Alga Guard Database Migration
 * Creates all tables for PII Scanner, ASM, Security Score, and supporting functionality
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // =============================================================================
  // ENUM Types
  // =============================================================================

  // Check if enums exist before creating
  const enumExists = async (name) => {
    const result = await knex.raw(`
      SELECT 1 FROM pg_type WHERE typname = ?
    `, [name]);
    return result.rows.length > 0;
  };

  if (!await enumExists('guard_pii_type')) {
    await knex.raw(`
      CREATE TYPE guard_pii_type AS ENUM (
        'ssn', 'credit_card', 'bank_account', 'dob', 'drivers_license',
        'passport', 'email', 'phone', 'ip_address', 'mac_address'
      )
    `);
  }

  if (!await enumExists('guard_job_status')) {
    await knex.raw(`
      CREATE TYPE guard_job_status AS ENUM (
        'queued', 'running', 'completed', 'failed', 'cancelled'
      )
    `);
  }

  if (!await enumExists('guard_asm_result_type')) {
    await knex.raw(`
      CREATE TYPE guard_asm_result_type AS ENUM (
        'subdomain', 'ip_address', 'open_port', 'service', 'cve',
        'dns_record', 'http_header', 'cloud_storage', 'email_security'
      )
    `);
  }

  if (!await enumExists('guard_schedule_type')) {
    await knex.raw(`
      CREATE TYPE guard_schedule_type AS ENUM ('pii', 'asm')
    `);
  }

  if (!await enumExists('guard_schedule_frequency')) {
    await knex.raw(`
      CREATE TYPE guard_schedule_frequency AS ENUM ('daily', 'weekly', 'monthly')
    `);
  }

  if (!await enumExists('guard_risk_level')) {
    await knex.raw(`
      CREATE TYPE guard_risk_level AS ENUM ('critical', 'high', 'moderate', 'low')
    `);
  }

  if (!await enumExists('guard_report_type')) {
    await knex.raw(`
      CREATE TYPE guard_report_type AS ENUM ('pii', 'asm', 'security_score')
    `);
  }

  if (!await enumExists('guard_report_format')) {
    await knex.raw(`
      CREATE TYPE guard_report_format AS ENUM ('word', 'excel', 'pdf')
    `);
  }

  // =============================================================================
  // PII Scanner Tables
  // =============================================================================

  // guard_pii_profiles
  if (!await knex.schema.hasTable('guard_pii_profiles')) {
    await knex.schema.createTable('guard_pii_profiles', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.text('name').notNullable();
      table.text('description');
      table.jsonb('pii_types').notNullable().defaultTo('[]');
      table.jsonb('file_extensions').notNullable().defaultTo('["txt","pdf","xls","xlsx","doc","docx","zip"]');
      table.jsonb('target_companies');
      table.jsonb('target_agents');
      table.jsonb('include_paths').notNullable().defaultTo('[]');
      table.jsonb('exclude_paths').notNullable().defaultTo('[]');
      table.integer('max_file_size_mb').defaultTo(50);
      table.boolean('enabled').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.uuid('created_by');

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_pii_profiles_tenant');
      table.index(['tenant', 'enabled'], 'idx_guard_pii_profiles_enabled');
    });
  }

  // guard_pii_jobs
  if (!await knex.schema.hasTable('guard_pii_jobs')) {
    await knex.schema.createTable('guard_pii_jobs', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('profile_id').notNullable();
      table.specificType('status', 'guard_job_status').notNullable().defaultTo('queued');
      table.timestamp('started_at');
      table.timestamp('completed_at');
      table.integer('total_files_scanned').defaultTo(0);
      table.integer('total_matches').defaultTo(0);
      table.text('error_message');
      table.integer('progress_percent').defaultTo(0);
      table.jsonb('metadata').defaultTo('{}');

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_pii_jobs_tenant');
      table.index(['tenant', 'status'], 'idx_guard_pii_jobs_status');
      table.index(['tenant', 'profile_id'], 'idx_guard_pii_jobs_profile');
    });

    // Add foreign key constraint
    await knex.raw(`
      ALTER TABLE guard_pii_jobs
      ADD CONSTRAINT fk_guard_pii_jobs_profile
      FOREIGN KEY (profile_id, tenant)
      REFERENCES guard_pii_profiles(id, tenant)
    `);
  }

  // guard_pii_results
  if (!await knex.schema.hasTable('guard_pii_results')) {
    await knex.schema.createTable('guard_pii_results', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('job_id').notNullable();
      table.uuid('profile_id').notNullable();
      table.uuid('company_id').notNullable();
      table.uuid('asset_id');
      table.uuid('agent_id');
      table.specificType('pii_type', 'guard_pii_type').notNullable();
      table.text('file_path').notNullable();
      table.jsonb('line_numbers').notNullable().defaultTo('[]');
      table.jsonb('page_numbers');
      table.decimal('confidence', 3, 2).defaultTo(1.0);
      table.timestamp('found_at').defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_pii_results_tenant');
      table.index(['tenant', 'job_id'], 'idx_guard_pii_results_job');
      table.index(['tenant', 'company_id'], 'idx_guard_pii_results_company');
      table.index(['tenant', 'pii_type'], 'idx_guard_pii_results_type');
    });

    // Add foreign key constraints
    await knex.raw(`
      ALTER TABLE guard_pii_results
      ADD CONSTRAINT fk_guard_pii_results_job
      FOREIGN KEY (job_id, tenant)
      REFERENCES guard_pii_jobs(id, tenant)
    `);

    await knex.raw(`
      ALTER TABLE guard_pii_results
      ADD CONSTRAINT fk_guard_pii_results_profile
      FOREIGN KEY (profile_id, tenant)
      REFERENCES guard_pii_profiles(id, tenant)
    `);

    await knex.raw(`
      ALTER TABLE guard_pii_results
      ADD CONSTRAINT fk_guard_pii_results_company
      FOREIGN KEY (company_id, tenant)
      REFERENCES companies(id, tenant)
    `);
  }

  // =============================================================================
  // Attack Surface Mapper Tables
  // =============================================================================

  // guard_asm_domains
  if (!await knex.schema.hasTable('guard_asm_domains')) {
    await knex.schema.createTable('guard_asm_domains', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('company_id').notNullable();
      table.text('domain_name').notNullable();
      table.boolean('ownership_verified').defaultTo(false);
      table.timestamp('last_scanned_at');
      table.boolean('enabled').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.uuid('created_by');

      table.primary(['id', 'tenant']);
      table.unique(['tenant', 'domain_name'], { indexName: 'uq_guard_asm_domains_tenant_domain' });
      table.index(['tenant'], 'idx_guard_asm_domains_tenant');
      table.index(['tenant', 'company_id'], 'idx_guard_asm_domains_company');
    });

    await knex.raw(`
      ALTER TABLE guard_asm_domains
      ADD CONSTRAINT fk_guard_asm_domains_company
      FOREIGN KEY (company_id, tenant)
      REFERENCES companies(id, tenant)
    `);
  }

  // guard_asm_jobs
  if (!await knex.schema.hasTable('guard_asm_jobs')) {
    await knex.schema.createTable('guard_asm_jobs', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('domain_id').notNullable();
      table.specificType('status', 'guard_job_status').notNullable().defaultTo('queued');
      table.text('scanner_pod_id');
      table.timestamp('started_at');
      table.timestamp('completed_at');
      table.text('error_message');
      table.jsonb('summary').defaultTo('{}');

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_asm_jobs_tenant');
      table.index(['tenant', 'domain_id'], 'idx_guard_asm_jobs_domain');
      table.index(['tenant', 'status'], 'idx_guard_asm_jobs_status');
    });

    await knex.raw(`
      ALTER TABLE guard_asm_jobs
      ADD CONSTRAINT fk_guard_asm_jobs_domain
      FOREIGN KEY (domain_id, tenant)
      REFERENCES guard_asm_domains(id, tenant)
    `);
  }

  // guard_asm_results
  if (!await knex.schema.hasTable('guard_asm_results')) {
    await knex.schema.createTable('guard_asm_results', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('job_id').notNullable();
      table.uuid('domain_id').notNullable();
      table.specificType('result_type', 'guard_asm_result_type').notNullable();
      table.jsonb('data').notNullable();
      table.text('severity');
      table.timestamp('found_at').defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_asm_results_tenant');
      table.index(['tenant', 'job_id'], 'idx_guard_asm_results_job');
      table.index(['tenant', 'domain_id'], 'idx_guard_asm_results_domain');
      table.index(['tenant', 'result_type'], 'idx_guard_asm_results_type');
      table.index(['tenant', 'severity'], 'idx_guard_asm_results_severity');
    });

    await knex.raw(`
      ALTER TABLE guard_asm_results
      ADD CONSTRAINT fk_guard_asm_results_job
      FOREIGN KEY (job_id, tenant)
      REFERENCES guard_asm_jobs(id, tenant)
    `);

    await knex.raw(`
      ALTER TABLE guard_asm_results
      ADD CONSTRAINT fk_guard_asm_results_domain
      FOREIGN KEY (domain_id, tenant)
      REFERENCES guard_asm_domains(id, tenant)
    `);
  }

  // =============================================================================
  // Scheduling Tables
  // =============================================================================

  if (!await knex.schema.hasTable('guard_schedules')) {
    await knex.schema.createTable('guard_schedules', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.specificType('schedule_type', 'guard_schedule_type').notNullable();
      table.uuid('target_id').notNullable();
      table.specificType('frequency', 'guard_schedule_frequency').notNullable();
      table.integer('day_of_week');
      table.integer('day_of_month');
      table.time('time_of_day').notNullable().defaultTo('02:00');
      table.text('timezone').notNullable().defaultTo('UTC');
      table.timestamp('next_run_at').notNullable();
      table.timestamp('last_run_at');
      table.uuid('last_job_id');
      table.boolean('enabled').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_schedules_tenant');
      table.index(['enabled', 'next_run_at'], 'idx_guard_schedules_next_run');
      table.index(['tenant', 'schedule_type'], 'idx_guard_schedules_type');
    });
  }

  // =============================================================================
  // Security Score Tables
  // =============================================================================

  if (!await knex.schema.hasTable('guard_security_scores')) {
    await knex.schema.createTable('guard_security_scores', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('company_id').notNullable();
      table.integer('score').notNullable();
      table.specificType('risk_level', 'guard_risk_level').notNullable();
      table.integer('pii_subscore').notNullable().defaultTo(100);
      table.integer('asm_subscore').notNullable().defaultTo(100);
      table.jsonb('breakdown').notNullable().defaultTo('{}');
      table.jsonb('top_issues').notNullable().defaultTo('[]');
      table.integer('previous_score');
      table.integer('score_delta');
      table.timestamp('calculated_at').defaultTo(knex.fn.now());
      table.uuid('triggered_by_pii_job_id');
      table.uuid('triggered_by_asm_job_id');

      table.primary(['id', 'tenant']);
      table.unique(['tenant', 'company_id'], { indexName: 'uq_guard_security_scores_tenant_company' });
      table.index(['tenant'], 'idx_guard_security_scores_tenant');
      table.index(['tenant', 'company_id'], 'idx_guard_security_scores_company');
      table.index(['tenant', 'risk_level'], 'idx_guard_security_scores_level');
      table.index(['tenant', 'score'], 'idx_guard_security_scores_score');

      table.check('score >= 0 AND score <= 100', [], 'guard_security_scores_score_check');
    });

    await knex.raw(`
      ALTER TABLE guard_security_scores
      ADD CONSTRAINT fk_guard_security_scores_company
      FOREIGN KEY (company_id, tenant)
      REFERENCES companies(id, tenant)
    `);
  }

  if (!await knex.schema.hasTable('guard_security_score_history')) {
    await knex.schema.createTable('guard_security_score_history', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('company_id').notNullable();
      table.integer('score').notNullable();
      table.specificType('risk_level', 'guard_risk_level').notNullable();
      table.jsonb('breakdown').notNullable().defaultTo('{}');
      table.timestamp('recorded_at').defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_score_history_tenant');
      table.index(['tenant', 'company_id'], 'idx_guard_score_history_company');
      table.index(['tenant', 'company_id', 'recorded_at'], 'idx_guard_score_history_date');
    });

    await knex.raw(`
      ALTER TABLE guard_security_score_history
      ADD CONSTRAINT fk_guard_score_history_company
      FOREIGN KEY (company_id, tenant)
      REFERENCES companies(id, tenant)
    `);
  }

  // =============================================================================
  // Report Jobs Table
  // =============================================================================

  if (!await knex.schema.hasTable('guard_report_jobs')) {
    await knex.schema.createTable('guard_report_jobs', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.specificType('report_type', 'guard_report_type').notNullable();
      table.specificType('report_format', 'guard_report_format').notNullable();
      table.specificType('status', 'guard_job_status').notNullable().defaultTo('queued');
      table.jsonb('filters').notNullable().defaultTo('{}');
      table.text('file_path');
      table.text('download_url');
      table.timestamp('download_url_expires_at');
      table.timestamp('started_at');
      table.timestamp('completed_at');
      table.text('error_message');
      table.uuid('created_by');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_report_jobs_tenant');
      table.index(['tenant', 'status'], 'idx_guard_report_jobs_status');
    });
  }

  // =============================================================================
  // Audit Log Table
  // =============================================================================

  if (!await knex.schema.hasTable('guard_audit_log')) {
    await knex.schema.createTable('guard_audit_log', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('user_id');
      table.text('action').notNullable();
      table.text('resource_type').notNullable();
      table.uuid('resource_id');
      table.jsonb('details').defaultTo('{}');
      table.specificType('ip_address', 'inet');
      table.text('user_agent');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.index(['tenant'], 'idx_guard_audit_log_tenant');
      table.index(['tenant', 'action'], 'idx_guard_audit_log_action');
      table.index(['tenant', 'created_at'], 'idx_guard_audit_log_date');
    });
  }

  // =============================================================================
  // Endpoint Agents Table (for PII Scanner agent registration)
  // =============================================================================

  if (!await knex.schema.hasTable('guard_endpoint_agents')) {
    await knex.schema.createTable('guard_endpoint_agents', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('agent_id').notNullable();
      table.text('hostname').notNullable();
      table.text('os').notNullable();
      table.text('os_version');
      table.text('arch').notNullable();
      table.text('agent_version').notNullable();
      table.jsonb('capabilities').notNullable().defaultTo('[]');
      table.timestamp('last_seen_at').defaultTo(knex.fn.now());
      table.timestamp('registered_at').defaultTo(knex.fn.now());
      table.boolean('active').defaultTo(true);

      table.primary(['id', 'tenant']);
      table.unique(['tenant', 'agent_id'], { indexName: 'uq_guard_endpoint_agents_tenant_agent' });
      table.index(['tenant'], 'idx_guard_endpoint_agents_tenant');
      table.index(['tenant', 'active'], 'idx_guard_endpoint_agents_active');
    });
  }

  // =============================================================================
  // Agent Extension Cache Table
  // =============================================================================

  if (!await knex.schema.hasTable('guard_agent_extension_cache')) {
    await knex.schema.createTable('guard_agent_extension_cache', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('agent_id').notNullable();
      table.text('extension_id').notNullable();
      table.text('content_hash').notNullable();
      table.text('version_id').notNullable();
      table.timestamp('cached_at').defaultTo(knex.fn.now());
      table.timestamp('last_used_at').defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.unique(['tenant', 'agent_id', 'extension_id'], { indexName: 'uq_guard_agent_extension_cache' });
      table.index(['tenant'], 'idx_guard_agent_ext_cache_tenant');
      table.index(['tenant', 'agent_id'], 'idx_guard_agent_ext_cache_agent');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Drop tables in reverse order (respecting foreign key constraints)
  await knex.schema.dropTableIfExists('guard_agent_extension_cache');
  await knex.schema.dropTableIfExists('guard_endpoint_agents');
  await knex.schema.dropTableIfExists('guard_audit_log');
  await knex.schema.dropTableIfExists('guard_report_jobs');
  await knex.schema.dropTableIfExists('guard_security_score_history');
  await knex.schema.dropTableIfExists('guard_security_scores');
  await knex.schema.dropTableIfExists('guard_schedules');
  await knex.schema.dropTableIfExists('guard_asm_results');
  await knex.schema.dropTableIfExists('guard_asm_jobs');
  await knex.schema.dropTableIfExists('guard_asm_domains');
  await knex.schema.dropTableIfExists('guard_pii_results');
  await knex.schema.dropTableIfExists('guard_pii_jobs');
  await knex.schema.dropTableIfExists('guard_pii_profiles');

  // Drop enum types
  await knex.raw('DROP TYPE IF EXISTS guard_report_format CASCADE');
  await knex.raw('DROP TYPE IF EXISTS guard_report_type CASCADE');
  await knex.raw('DROP TYPE IF EXISTS guard_risk_level CASCADE');
  await knex.raw('DROP TYPE IF EXISTS guard_schedule_frequency CASCADE');
  await knex.raw('DROP TYPE IF EXISTS guard_schedule_type CASCADE');
  await knex.raw('DROP TYPE IF EXISTS guard_asm_result_type CASCADE');
  await knex.raw('DROP TYPE IF EXISTS guard_job_status CASCADE');
  await knex.raw('DROP TYPE IF EXISTS guard_pii_type CASCADE');
};
