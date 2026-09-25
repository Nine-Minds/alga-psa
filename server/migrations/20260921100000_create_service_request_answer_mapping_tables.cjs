/**
 * Questionnaire answer → account/asset mapping tables (2026-09-21)
 *
 * Implements the storage layer for the answer-mapping engine described in
 * docs/plans/2026-09-20-questionnaire-answer-mapping-plan.md §3-§4. Four
 * tenant-scoped tables:
 *
 *  - service_request_answer_mappings            mutable working copy, one per definition
 *  - service_request_answer_mapping_versions    immutable numbered rule snapshots
 *  - service_request_submission_applications    one row per apply run (idempotent per tuple)
 *  - service_request_submission_application_results  one row per rule per run
 *
 * Composite (tenant, id) primary keys, Citus distribution by tenant colocated
 * with `tenants`, FKs added after distribution (Citus requires both sides
 * distributed first), and no RLS policies — application-level tenant scoping,
 * following the 2026-09-13 external-entity-links migration.
 */

// Distribute tenant-scoped tables, colocated with `tenants`. No-op on plain
// Postgres and on already-distributed tables.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

exports.up = async function up(knex) {
  // --- service_request_answer_mappings (working copy) ---------------------
  if (!(await knex.schema.hasTable('service_request_answer_mappings'))) {
    await knex.schema.createTable('service_request_answer_mappings', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('mapping_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('definition_id').notNullable();

      table.text('lifecycle_state').notNullable().defaultTo('draft');
      table.uuid('current_version_id').nullable();
      // Working set of rules: { rules: MappingRule[] }. Mirrors the definition's
      // JSONB form_schema working copy for symmetry.
      table.jsonb('rules').notNullable().defaultTo(knex.raw(`'{"rules":[]}'::jsonb`));

      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'mapping_id']);
      table.unique(['tenant', 'definition_id'], {
        indexName: 'service_request_answer_mappings_definition_unique',
      });
    });

    await knex.raw(`
      ALTER TABLE service_request_answer_mappings
      ADD CONSTRAINT service_request_answer_mappings_lifecycle_state_check
      CHECK (lifecycle_state IN ('draft', 'published'))
    `);
  }

  // --- service_request_answer_mapping_versions (immutable) ----------------
  if (!(await knex.schema.hasTable('service_request_answer_mapping_versions'))) {
    await knex.schema.createTable('service_request_answer_mapping_versions', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('version_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('mapping_id').notNullable();
      table.uuid('definition_id').notNullable();
      table.integer('version_number').notNullable();

      table.jsonb('rules_snapshot').notNullable().defaultTo(knex.raw(`'{"rules":[]}'::jsonb`));

      table.uuid('published_by').nullable();
      table.timestamp('published_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'version_id']);
      table.unique(['tenant', 'mapping_id', 'version_number'], {
        indexName: 'service_request_answer_mapping_versions_number_unique',
      });
    });

    await knex.raw(`
      CREATE INDEX idx_service_request_answer_mapping_versions_tenant_definition
      ON service_request_answer_mapping_versions (tenant, definition_id)
    `);
  }

  // --- service_request_submission_applications (one per apply run) --------
  if (!(await knex.schema.hasTable('service_request_submission_applications'))) {
    await knex.schema.createTable('service_request_submission_applications', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('application_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('submission_id').notNullable();
      table.uuid('mapping_version_id').notNullable();

      table.uuid('applied_by').nullable();
      table.timestamp('applied_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('status').notNullable().defaultTo('pending');
      table.jsonb('summary').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'application_id']);
    });

    await knex.raw(`
      ALTER TABLE service_request_submission_applications
      ADD CONSTRAINT service_request_submission_applications_status_check
      CHECK (status IN ('pending', 'applied', 'partially_applied', 'failed', 'no_op'))
    `);

    // Idempotency: applying the same immutable submission under the same frozen
    // mapping version is one logical run. The partial predicate keeps the index
    // valid on Citus (leads with the distribution column) and mirrors the
    // submission client-key index discipline.
    await knex.raw(`
      CREATE UNIQUE INDEX service_request_submission_applications_replay_unique
      ON service_request_submission_applications (tenant, submission_id, mapping_version_id)
      WHERE mapping_version_id IS NOT NULL
    `);

    await knex.raw(`
      CREATE INDEX idx_service_request_submission_applications_tenant_submission
      ON service_request_submission_applications (tenant, submission_id)
    `);
  }

  // --- service_request_submission_application_results (one per rule) ------
  if (!(await knex.schema.hasTable('service_request_submission_application_results'))) {
    await knex.schema.createTable('service_request_submission_application_results', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('result_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('application_id').notNullable();

      table.uuid('rule_id').nullable();
      table.text('question_key').nullable();
      table.text('destination_kind').notNullable();
      table.text('target_field_key').notNullable();

      table.uuid('resolved_target_ref').nullable();
      table.text('resolved_target_display').nullable();

      table.text('status').notNullable();
      table.jsonb('before_value').nullable();
      table.jsonb('after_value').nullable();
      table.text('error_code').nullable();
      table.text('error_detail').nullable();

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'result_id']);
    });

    await knex.raw(`
      ALTER TABLE service_request_submission_application_results
      ADD CONSTRAINT service_request_submission_application_results_status_check
      CHECK (status IN (
        'applied', 'skipped_answer_absent', 'skipped_no_change',
        'failed_validation', 'failed_type_conversion', 'failed_permission',
        'failed_asset_unresolved', 'failed_asset_ambiguous'
      ))
    `);

    await knex.raw(`
      CREATE INDEX idx_service_request_submission_application_results_tenant_application
      ON service_request_submission_application_results (tenant, application_id)
    `);
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await ensureTenantDistribution(knex, 'service_request_answer_mappings');
  await ensureTenantDistribution(knex, 'service_request_answer_mapping_versions');
  await ensureTenantDistribution(knex, 'service_request_submission_applications');
  await ensureTenantDistribution(knex, 'service_request_submission_application_results');

  await addForeignKeyIfMissing(knex, 'service_request_answer_mappings_tenant_fkey', `
    ALTER TABLE service_request_answer_mappings
      ADD CONSTRAINT service_request_answer_mappings_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_answer_mappings_definition_fkey', `
    ALTER TABLE service_request_answer_mappings
      ADD CONSTRAINT service_request_answer_mappings_definition_fkey
      FOREIGN KEY (tenant, definition_id)
      REFERENCES service_request_definitions (tenant, definition_id) ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'service_request_answer_mapping_versions_tenant_fkey', `
    ALTER TABLE service_request_answer_mapping_versions
      ADD CONSTRAINT service_request_answer_mapping_versions_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_answer_mapping_versions_mapping_fkey', `
    ALTER TABLE service_request_answer_mapping_versions
      ADD CONSTRAINT service_request_answer_mapping_versions_mapping_fkey
      FOREIGN KEY (tenant, mapping_id)
      REFERENCES service_request_answer_mappings (tenant, mapping_id) ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'service_request_submission_applications_tenant_fkey', `
    ALTER TABLE service_request_submission_applications
      ADD CONSTRAINT service_request_submission_applications_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_submission_applications_submission_fkey', `
    ALTER TABLE service_request_submission_applications
      ADD CONSTRAINT service_request_submission_applications_submission_fkey
      FOREIGN KEY (tenant, submission_id)
      REFERENCES service_request_submissions (tenant, submission_id) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_submission_applications_version_fkey', `
    ALTER TABLE service_request_submission_applications
      ADD CONSTRAINT service_request_submission_applications_version_fkey
      FOREIGN KEY (tenant, mapping_version_id)
      REFERENCES service_request_answer_mapping_versions (tenant, version_id) ON DELETE RESTRICT
  `);

  await addForeignKeyIfMissing(knex, 'service_request_submission_application_results_tenant_fkey', `
    ALTER TABLE service_request_submission_application_results
      ADD CONSTRAINT service_request_submission_application_results_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_submission_application_results_application_fkey', `
    ALTER TABLE service_request_submission_application_results
      ADD CONSTRAINT service_request_submission_application_results_application_fkey
      FOREIGN KEY (tenant, application_id)
      REFERENCES service_request_submission_applications (tenant, application_id) ON DELETE CASCADE
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('service_request_submission_application_results');
  await knex.schema.dropTableIfExists('service_request_submission_applications');
  await knex.schema.dropTableIfExists('service_request_answer_mapping_versions');
  await knex.schema.dropTableIfExists('service_request_answer_mappings');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
