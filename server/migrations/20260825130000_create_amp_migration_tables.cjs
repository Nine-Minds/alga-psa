'use strict';

/**
 * AMP staging and ledger tables — Phase 2 of the Alga Migration Package plan
 * (docs/plans/2026-08-25-alga-migration-package-amp-plan.md).
 *
 * Deliberately separate from the asset-bound import framework
 * (import_jobs/import_job_items/external_entity_mappings): those tables FK
 * into assets and cannot represent AMP's six entity types or their
 * relationships. The legacy tables stay untouched for legacy asset imports.
 *
 * Keys, indexes, and Citus distribution follow the approved decision record
 * (docs/architecture/amp-decision-record.md): every table is tenant-first with
 * a composite (tenant, <id>) primary key, composite tenant-aware foreign keys,
 * standard RLS, and distribution on tenant colocated with `tenants`. Runs
 * outside a transaction so create_distributed_table can execute.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

const TABLES = [
  'migration_jobs',
  'migration_job_entities',
  'migration_staged_records',
  'migration_record_outcomes',
  'migration_identity_mappings',
  'migration_mapping_profiles',
  'migration_reports',
];

async function createIndex(knex, name, definition) {
  await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${definition}`);
}

async function enableRls(knex, table) {
  await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  for (const [suffix, clause] of [
    ['tenant_isolation_policy', "USING (tenant = current_setting('app.current_tenant', true)::uuid)"],
    ['tenant_insert_policy', "FOR INSERT WITH CHECK (tenant = current_setting('app.current_tenant', true)::uuid)"],
  ]) {
    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = '${table}'
            AND policyname = '${table}_${suffix}'
        ) THEN
          EXECUTE $policy$CREATE POLICY ${table}_${suffix} ON ${table} ${clause}$policy$;
        END IF;
      END
      $$;
    `);
  }
}

exports.up = async function up(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'migration_job_state') THEN
        CREATE TYPE migration_job_state AS ENUM (
          'uploaded',
          'inspecting',
          'needs_configuration',
          'rejected',
          'preflighting',
          'ready',
          'blocked',
          'queued',
          'applying',
          'completed',
          'completed_with_errors',
          'failed',
          'cancelled'
        );
      END IF;
    END
    $$;
  `);

  if (!(await knex.schema.hasTable('migration_jobs'))) {
    await knex.schema.createTable('migration_jobs', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_job_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('owner_user_id').notNullable();
      table.uuid('job_id');
      table.uuid('source_file_id');
      table.uuid('source_document_id');
      table.text('source_file_name').notNullable();
      table.text('package_sha256').notNullable();
      // Manifest-derived fields are unknown until inspection parses the file.
      table.text('package_id');
      table.text('format_version');
      table.text('producer_name');
      table.text('producer_version');
      table.text('source_system');
      table.jsonb('manifest');
      table.specificType('state', 'migration_job_state').notNullable().defaultTo('uploaded');
      table.jsonb('configuration').notNullable().defaultTo('{}');
      table.text('error');
      table.timestamp('preflighted_at', { useTz: true });
      table.timestamp('queued_at', { useTz: true });
      table.timestamp('started_at', { useTz: true });
      table.timestamp('cancel_requested_at', { useTz: true });
      table.timestamp('completed_at', { useTz: true });
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'migration_job_id']);
      table.foreign('tenant').references('tenants.tenant');
      table
        .foreign(['tenant', 'owner_user_id'])
        .references(['tenant', 'user_id'])
        .inTable('users');
      // job_id links to the background `jobs` row that applies the migration,
      // but `jobs` is a plain (non-distributed) table on Citus, so a distributed
      // table cannot carry an enforced FK to it ("referenced table must be a
      // distributed table or a reference table"). Keep job_id as an indexed soft
      // reference; the application owns its integrity.
    });
  }

  if (!(await knex.schema.hasTable('migration_job_entities'))) {
    await knex.schema.createTable('migration_job_entities', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_job_entity_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('migration_job_id').notNullable();
      table.text('entity_type').notNullable();
      table.integer('phase').notNullable();
      table.text('state').notNullable().defaultTo('pending');
      table.integer('planned_count').notNullable().defaultTo(0);
      table.integer('applied_count').notNullable().defaultTo(0);
      table.integer('skipped_count').notNullable().defaultTo(0);
      table.integer('failed_count').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'migration_job_entity_id']);
      table.unique(['tenant', 'migration_job_id', 'entity_type'], 'uq_migration_job_entities_entity');
      table
        .foreign(['tenant', 'migration_job_id'])
        .references(['tenant', 'migration_job_id'])
        .inTable('migration_jobs')
        .onDelete('CASCADE');
    });
  }

  if (!(await knex.schema.hasTable('migration_staged_records'))) {
    await knex.schema.createTable('migration_staged_records', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_staged_record_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('migration_job_id').notNullable();
      table.text('entity_type').notNullable();
      table.text('package_record_id').notNullable();
      table.text('source_record_id').notNullable();
      table.text('namespace').notNullable();
      table.jsonb('payload').notNullable();
      table.timestamp('source_created_at', { useTz: true });
      table.timestamp('source_updated_at', { useTz: true });
      table.text('validation_state').notNullable().defaultTo('pending');
      table.jsonb('validation_errors').notNullable().defaultTo('[]');
      table.integer('source_row_number');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'migration_staged_record_id']);
      table.unique(
        ['tenant', 'migration_job_id', 'entity_type', 'package_record_id'],
        'uq_migration_staged_records_package_record'
      );
      table
        .foreign(['tenant', 'migration_job_id'])
        .references(['tenant', 'migration_job_id'])
        .inTable('migration_jobs')
        .onDelete('CASCADE');
    });
  }

  if (!(await knex.schema.hasTable('migration_record_outcomes'))) {
    await knex.schema.createTable('migration_record_outcomes', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_record_outcome_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('migration_job_id').notNullable();
      table.uuid('migration_staged_record_id').notNullable();
      table.integer('attempt').notNullable();
      table.text('action').notNullable();
      table.text('target_entity_type');
      table.uuid('target_entity_id');
      table.jsonb('errors').notNullable().defaultTo('[]');
      table.jsonb('warnings').notNullable().defaultTo('[]');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'migration_record_outcome_id']);
      table.unique(
        ['tenant', 'migration_staged_record_id', 'attempt'],
        'uq_migration_record_outcomes_attempt'
      );
      table
        .foreign(['tenant', 'migration_job_id'])
        .references(['tenant', 'migration_job_id'])
        .inTable('migration_jobs')
        .onDelete('CASCADE');
      table
        .foreign(['tenant', 'migration_staged_record_id'])
        .references(['tenant', 'migration_staged_record_id'])
        .inTable('migration_staged_records')
        .onDelete('CASCADE');
    });
  }

  if (!(await knex.schema.hasTable('migration_identity_mappings'))) {
    await knex.schema.createTable('migration_identity_mappings', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_identity_mapping_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('namespace').notNullable();
      table.text('entity_type').notNullable();
      table.text('source_record_id').notNullable();
      table.text('target_entity_type').notNullable();
      table.uuid('target_entity_id').notNullable();
      table.uuid('migration_job_id');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'migration_identity_mapping_id']);
      table.unique(
        ['tenant', 'namespace', 'entity_type', 'source_record_id'],
        'uq_migration_identity_source_key'
      );
      table
        .foreign(['tenant', 'migration_job_id'])
        .references(['tenant', 'migration_job_id'])
        .inTable('migration_jobs');
    });
  }

  if (!(await knex.schema.hasTable('migration_mapping_profiles'))) {
    await knex.schema.createTable('migration_mapping_profiles', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_mapping_profile_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('entity_type').notNullable();
      table.text('source_signature').notNullable();
      table.text('name').notNullable();
      table.jsonb('mapping').notNullable();
      table.uuid('created_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'migration_mapping_profile_id']);
      table.unique(
        ['tenant', 'entity_type', 'source_signature', 'name'],
        'uq_migration_mapping_profiles_signature'
      );
      table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    });
  }

  if (!(await knex.schema.hasTable('migration_reports'))) {
    await knex.schema.createTable('migration_reports', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_report_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('migration_job_id').notNullable();
      table.text('report_type').notNullable();
      table.uuid('document_id');
      table.text('sha256');
      table.jsonb('summary').notNullable().defaultTo('{}');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'migration_report_id']);
      table.unique(['tenant', 'migration_job_id', 'report_type'], 'uq_migration_reports_type');
      table
        .foreign(['tenant', 'migration_job_id'])
        .references(['tenant', 'migration_job_id'])
        .inTable('migration_jobs')
        .onDelete('CASCADE');
    });
  }

  // Index set from the decision record.
  await createIndex(knex, 'idx_migration_jobs_state', 'migration_jobs (tenant, state, created_at DESC)');
  await createIndex(knex, 'idx_migration_jobs_owner', 'migration_jobs (tenant, owner_user_id, created_at DESC)');
  await createIndex(knex, 'idx_migration_jobs_sha256', 'migration_jobs (tenant, package_sha256)');
  await createIndex(knex, 'idx_migration_jobs_source_file', 'migration_jobs (tenant, source_file_id)');
  await createIndex(knex, 'idx_migration_jobs_job', 'migration_jobs (tenant, job_id)');
  await createIndex(knex, 'idx_migration_job_entities_phase', 'migration_job_entities (tenant, migration_job_id, phase)');
  await createIndex(
    knex,
    'idx_migration_staged_records_work',
    'migration_staged_records (tenant, migration_job_id, entity_type, validation_state, package_record_id)'
  );
  await createIndex(
    knex,
    'idx_migration_staged_records_source',
    'migration_staged_records (tenant, migration_job_id, source_record_id)'
  );
  await createIndex(
    knex,
    'idx_migration_record_outcomes_record',
    'migration_record_outcomes (tenant, migration_staged_record_id, created_at)'
  );
  await createIndex(
    knex,
    'idx_migration_record_outcomes_job',
    'migration_record_outcomes (tenant, migration_job_id, action, created_at)'
  );
  await createIndex(
    knex,
    'idx_migration_identity_mappings_target',
    'migration_identity_mappings (tenant, target_entity_type, target_entity_id)'
  );
  await createIndex(
    knex,
    'idx_migration_mapping_profiles_recent',
    'migration_mapping_profiles (tenant, entity_type, source_signature, updated_at DESC)'
  );
  await createIndex(knex, 'idx_migration_reports_job', 'migration_reports (tenant, migration_job_id, created_at DESC)');

  for (const table of TABLES) {
    await enableRls(knex, table);
  }

  for (const table of TABLES) {
    await ensureTenantDistribution(knex, table);
  }
};

exports.down = async function down(knex) {
  for (const table of [...TABLES].reverse()) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.raw('DROP TYPE IF EXISTS migration_job_state');
};
