/**
 * Create extension schedule tables (EE).
 *
 * Note: This migration is required to exist once it has been applied, otherwise
 * knex will refuse to run future migrations ("migration directory is corrupt").
 *
 * The table already exists in many environments; this migration is written to
 * be idempotent for safety.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenant_extension_schedule');
  if (!hasTable) {
    await knex.schema.createTable('tenant_extension_schedule', (table) => {
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('install_id').notNullable();
      table.string('tenant_id', 255).notNullable();
      table.uuid('endpoint_id').notNullable();
      table.string('name', 128).nullable();
      table.text('cron').notNullable();
      table.string('timezone', 64).notNullable().defaultTo('UTC');
      table.boolean('enabled').notNullable().defaultTo(true);
      table.jsonb('payload_json').nullable();
      table.uuid('job_id').nullable();
      table.string('runner_schedule_id', 255).nullable();
      table.timestamp('last_run_at', { useTz: true }).nullable();
      table.string('last_run_status', 32).nullable();
      table.text('last_error').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['id']);
    });
  }

  // Indexes / constraints (safe to re-run)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS tenant_extension_schedule_install_name_uniq
    ON tenant_extension_schedule (install_id, name)
    WHERE name IS NOT NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS tenant_extension_schedule_runner_schedule_id_idx
    ON tenant_extension_schedule (runner_schedule_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS tenant_extension_schedule_tenant_endpoint_idx
    ON tenant_extension_schedule (tenant_id, endpoint_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS tenant_extension_schedule_tenant_idx
    ON tenant_extension_schedule (tenant_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS tenant_extension_schedule_tenant_install_idx
    ON tenant_extension_schedule (tenant_id, install_id);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS tenant_extension_schedule_tenant_job_idx
    ON tenant_extension_schedule (tenant_id, job_id);
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS tenant_extension_schedule_tenant_job_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS tenant_extension_schedule_tenant_install_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS tenant_extension_schedule_tenant_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS tenant_extension_schedule_tenant_endpoint_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS tenant_extension_schedule_runner_schedule_id_idx;`);
  await knex.raw(`DROP INDEX IF EXISTS tenant_extension_schedule_install_name_uniq;`);

  const hasTable = await knex.schema.hasTable('tenant_extension_schedule');
  if (hasTable) {
    await knex.schema.dropTable('tenant_extension_schedule');
  }
};

