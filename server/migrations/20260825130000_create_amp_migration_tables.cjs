/** AMP staging and ledger tables.  Kept separate from the asset-only importer. */
exports.config = { transaction: false };

const tables = [
  'migration_jobs', 'migration_job_entities', 'migration_staged_records',
  'migration_record_outcomes', 'migration_identity_mappings',
  'migration_mapping_profiles', 'migration_reports',
];

exports.up = async function up(knex) {
  await knex.raw(`DO $$ BEGIN
    CREATE TYPE migration_job_state AS ENUM ('uploaded','inspecting','needs_configuration','rejected','preflighting','ready','blocked','queued','applying','completed','completed_with_errors','failed','cancelled');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  await knex.schema.createTable('migration_jobs', t => {
    t.uuid('tenant').notNullable(); t.uuid('migration_job_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('owner_user_id').notNullable(); t.uuid('source_file_id'); t.uuid('source_document_id');
    t.text('source_file_name').notNullable(); t.text('package_sha256').notNullable(); t.text('package_id').notNullable();
    t.text('format_version').notNullable(); t.text('producer_name').notNullable(); t.text('producer_version').notNullable();
    t.specificType('state', 'migration_job_state').notNullable().defaultTo('uploaded'); t.jsonb('configuration').notNullable().defaultTo('{}');
    t.jsonb('manifest').notNullable(); t.timestamp('preflighted_at'); t.timestamp('cancel_requested_at'); t.timestamp('completed_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()); t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant','migration_job_id']); t.foreign(['tenant','owner_user_id']).references(['tenant','user_id']).inTable('users');
  });
  await knex.schema.createTable('migration_job_entities', t => {
    t.uuid('tenant').notNullable(); t.uuid('migration_job_entity_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')); t.uuid('migration_job_id').notNullable();
    t.text('entity_type').notNullable(); t.integer('phase').notNullable(); t.integer('planned_count').notNullable().defaultTo(0); t.integer('applied_count').notNullable().defaultTo(0); t.integer('skipped_count').notNullable().defaultTo(0); t.integer('failed_count').notNullable().defaultTo(0); t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant','migration_job_entity_id']); t.unique(['tenant','migration_job_id','entity_type']); t.foreign(['tenant','migration_job_id']).references(['tenant','migration_job_id']).inTable('migration_jobs').onDelete('CASCADE');
  });
  await knex.schema.createTable('migration_staged_records', t => {
    t.uuid('tenant').notNullable(); t.uuid('migration_staged_record_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')); t.uuid('migration_job_id').notNullable();
    t.text('entity_type').notNullable(); t.text('package_record_id').notNullable(); t.text('source_record_id').notNullable(); t.text('namespace').notNullable(); t.jsonb('payload').notNullable(); t.jsonb('validation_errors').notNullable().defaultTo('[]'); t.text('validation_state').notNullable().defaultTo('pending'); t.integer('source_row_number'); t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant','migration_staged_record_id']); t.unique(['tenant','migration_job_id','entity_type','package_record_id']); t.foreign(['tenant','migration_job_id']).references(['tenant','migration_job_id']).inTable('migration_jobs').onDelete('CASCADE');
  });
  await knex.schema.createTable('migration_record_outcomes', t => {
    t.uuid('tenant').notNullable(); t.uuid('migration_record_outcome_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')); t.uuid('migration_job_id').notNullable(); t.uuid('migration_staged_record_id').notNullable(); t.integer('attempt').notNullable(); t.text('action').notNullable(); t.text('target_entity_type'); t.uuid('target_entity_id'); t.jsonb('errors').notNullable().defaultTo('[]'); t.jsonb('warnings').notNullable().defaultTo('[]'); t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant','migration_record_outcome_id']); t.unique(['tenant','migration_staged_record_id','attempt']); t.foreign(['tenant','migration_job_id']).references(['tenant','migration_job_id']).inTable('migration_jobs').onDelete('CASCADE'); t.foreign(['tenant','migration_staged_record_id']).references(['tenant','migration_staged_record_id']).inTable('migration_staged_records').onDelete('CASCADE');
  });
  await knex.schema.createTable('migration_identity_mappings', t => {
    t.uuid('tenant').notNullable(); t.uuid('migration_identity_mapping_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')); t.text('namespace').notNullable(); t.text('entity_type').notNullable(); t.text('source_record_id').notNullable(); t.text('target_entity_type').notNullable(); t.uuid('target_entity_id').notNullable(); t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant','migration_identity_mapping_id']); t.unique(['tenant','namespace','entity_type','source_record_id']);
  });
  await knex.schema.createTable('migration_mapping_profiles', t => { t.uuid('tenant').notNullable(); t.uuid('migration_mapping_profile_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')); t.text('entity_type').notNullable(); t.text('source_signature').notNullable(); t.text('name').notNullable(); t.jsonb('mapping').notNullable(); t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()); t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now()); t.primary(['tenant','migration_mapping_profile_id']); t.unique(['tenant','entity_type','source_signature','name']); });
  await knex.schema.createTable('migration_reports', t => { t.uuid('tenant').notNullable(); t.uuid('migration_report_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')); t.uuid('migration_job_id').notNullable(); t.text('report_type').notNullable(); t.uuid('document_id'); t.text('sha256').notNullable(); t.jsonb('summary').notNullable(); t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()); t.primary(['tenant','migration_report_id']); t.unique(['tenant','migration_job_id','report_type']); t.foreign(['tenant','migration_job_id']).references(['tenant','migration_job_id']).inTable('migration_jobs').onDelete('CASCADE'); });
  for (const table of tables) {
    await knex.raw(`CREATE INDEX ${table}_tenant_created_idx ON ${table} (tenant, created_at DESC)`);
  }
  await knex.raw('CREATE INDEX migration_jobs_state_idx ON migration_jobs (tenant, state, created_at DESC)');
  await knex.raw('CREATE INDEX migration_staged_records_work_idx ON migration_staged_records (tenant, migration_job_id, entity_type, validation_state, package_record_id)');
  await knex.raw('CREATE INDEX migration_outcomes_job_idx ON migration_record_outcomes (tenant, migration_job_id, action, created_at)');
  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS present");
  if (citus.rows[0].present) for (const table of tables) await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
};

exports.down = async function down(knex) { for (const table of [...tables].reverse()) await knex.schema.dropTableIfExists(table); await knex.raw('DROP TYPE IF EXISTS migration_job_state'); };
