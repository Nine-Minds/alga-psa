const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  if (!await knex.schema.hasColumn('migration_jobs', 'created_target')) {
    await knex.schema.alterTable('migration_jobs', table => {
      table.boolean('created_target').notNullable().defaultTo(false);
      table.jsonb('target_policies').notNullable().defaultTo('{}');
    });
  }
  if (!await knex.schema.hasTable('migration_staged_attachments')) {
    await knex.schema.createTable('migration_staged_attachments', table => {
      table.uuid('tenant').notNullable();
      table.uuid('migration_job_id').notNullable();
      table.text('sha256').notNullable();
      table.bigInteger('size').notNullable();
      table.binary('content').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable().defaultTo(knex.raw("now() + interval '30 days'"));
      table.index(['tenant', 'expires_at']);
      table.primary(['tenant', 'migration_job_id', 'sha256']);
      table.check("sha256 ~ '^[a-f0-9]{64}$' AND size >= 0 AND size <= 104857600 AND octet_length(content) = size");
    });
  }
  if (!await knex.schema.hasColumn('migration_staged_attachments', 'expires_at')) {
    await knex.schema.alterTable('migration_staged_attachments', table => table.timestamp('expires_at', { useTz: true }).notNullable().defaultTo(knex.raw("now() + interval '30 days'")));
  }
  await ensureTenantDistribution(knex, 'migration_staged_attachments');
  await ensureCompositeFk(knex, { table: 'migration_staged_attachments', constraint: 'migration_staged_attachments_job_fk', columns: ['tenant', 'migration_job_id'], referencedTable: 'migration_jobs', referencedColumns: ['tenant', 'migration_job_id'], onDelete: 'CASCADE' });
  // Reuse the native dispatch gate rather than inventing a restore-only suspension table.
  await knex.raw('ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_suspended_reason_check');
  await knex.raw(`ALTER TABLE tenants ADD CONSTRAINT tenants_suspended_reason_check CHECK (
    (suspended_at IS NULL AND suspended_reason IS NULL) OR
    (suspended_at IS NOT NULL AND suspended_reason IN ('tenant_cancelled', 'amp_workspace_review'))
  ) NOT VALID`);
  // Ownership kinds are validated by their producer (native domain commands or the AMP dictionary).
  // A closed native enum prevented attachment restoration for whole supported domains, e.g. projects.
  // Keep the lexical constraint; never interpolate these values into SQL identifiers.
  await knex.raw('ALTER TABLE document_associations DROP CONSTRAINT IF EXISTS document_associations_entity_type_check');
  await knex.raw("ALTER TABLE document_associations ADD CONSTRAINT document_associations_entity_type_check CHECK (entity_type ~ '^[a-z][a-z0-9_]{0,63}$') NOT VALID");
  // The temporary archive has no compatibility or migration path. Its operational receipts are retired.
  for (const name of ['portable_workspace_restore_uploads', 'portable_workspace_restores', 'portable_restore_suspensions']) {
    await knex.schema.dropTableIfExists(name);
  }
};
exports.down = async function down() {
  throw new Error('AMP workspace replacement is irreversible: retired archive receipts and suspension state are not recreated');
};
exports.config = { transaction: false };
