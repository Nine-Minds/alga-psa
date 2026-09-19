/**
 * EE-only migration: scheduled tasks for extensions.
 *
 * Notes:
 * - Avoid ON DELETE cascades (Citus constraints); cleanup is handled in application code.
 * - `tenant_extension_schedule` is tenant-scoped and can be distributed when Citus is enabled.
 *
 * @param { import('knex').Knex } knex
 */

exports.config = { transaction: false };

async function hasCitusCreateDistributedTable(knex) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'create_distributed_table'
      ) AS exists;
    `);
    return Boolean(result.rows?.[0]?.exists);
  } catch {
    return false;
  }
}

async function hasCitusCreateReferenceTable(knex) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'create_reference_table'
      ) AS exists;
    `);
    return Boolean(result.rows?.[0]?.exists);
  } catch {
    return false;
  }
}

async function ensureDistributed(knex, table, distributionColumn) {
  const canDistribute = await hasCitusCreateDistributedTable(knex);
  if (!canDistribute) return;

  // Best-effort; ignore if already distributed.
  try {
    await knex.raw(`SELECT create_distributed_table('${table}', '${distributionColumn}');`);
  } catch (e) {
    const msg = String(e?.message || e);
    if (!msg.toLowerCase().includes('already')) {
      // eslint-disable-next-line no-console
      console.warn(`[${table}] create_distributed_table failed`, { error: msg });
    }
  }
}

async function ensureReference(knex, table) {
  const canReference = await hasCitusCreateReferenceTable(knex);
  if (!canReference) return;

  try {
    await knex.raw(`SELECT create_reference_table('${table}');`);
  } catch (e) {
    const msg = String(e?.message || e);
    if (!msg.toLowerCase().includes('already')) {
      // eslint-disable-next-line no-console
      console.warn(`[${table}] create_reference_table failed`, { error: msg });
    }
  }
}

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasEndpoints = await knex.schema.hasTable('extension_api_endpoint');
  if (!hasEndpoints) {
    await knex.schema.createTable('extension_api_endpoint', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      // References extension_version.id (enforced in application logic; no FK to avoid cascade/Citus issues)
      t.uuid('version_id').notNullable();
      t.string('method', 16).notNullable();
      t.text('path').notNullable();
      t.text('handler').notNullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['version_id', 'method', 'path'], {
        indexName: 'extension_api_endpoint_version_method_path_uniq',
      });
      t.index(['version_id'], 'extension_api_endpoint_version_idx');
    });
  }

  // Best-effort mark as reference table when Citus is enabled so distributed schedules can join against it.
  await ensureReference(knex, 'extension_api_endpoint');

  const hasSchedules = await knex.schema.hasTable('tenant_extension_schedule');
  if (!hasSchedules) {
    await knex.schema.createTable('tenant_extension_schedule', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      // References tenant_extension_install.id (enforced in application logic; no FK)
      t.uuid('install_id').notNullable();
      // Duplicated tenant_id for isolation and (optional) Citus distribution.
      t.string('tenant_id').notNullable();
      // References extension_api_endpoint.id (enforced in application logic; no FK)
      t.uuid('endpoint_id').notNullable();

      t.string('name', 128).nullable();
      t.text('cron').notNullable();
      t.string('timezone', 64).notNullable().defaultTo('UTC');
      t.boolean('enabled').notNullable().defaultTo(true);
      t.jsonb('payload_json').nullable();

      // Job record id in our `jobs` table (tenant-scoped composite PK there).
      t.uuid('job_id').nullable();

      // External durable schedule handle id (Temporal scheduleId / pgboss schedule name)
      t.string('runner_schedule_id', 255).nullable();

      t.timestamp('last_run_at').nullable();
      t.string('last_run_status', 32).nullable();
      t.text('last_error').nullable();

      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      t.index(['tenant_id'], 'tenant_extension_schedule_tenant_idx');
      t.index(['tenant_id', 'install_id'], 'tenant_extension_schedule_tenant_install_idx');
      t.index(['tenant_id', 'endpoint_id'], 'tenant_extension_schedule_tenant_endpoint_idx');
      t.index(['runner_schedule_id'], 'tenant_extension_schedule_runner_schedule_id_idx');
      t.index(['tenant_id', 'job_id'], 'tenant_extension_schedule_tenant_job_idx');
    });

    // Optional uniqueness for schedule names per install (only when name is provided).
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS tenant_extension_schedule_install_name_uniq
      ON tenant_extension_schedule (install_id, name)
      WHERE name IS NOT NULL
    `);

    // Best-effort distribute the schedules table when Citus is enabled.
    await ensureDistributed(knex, 'tenant_extension_schedule', 'tenant_id');
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // No cascades: drop schedules first (references endpoints via business logic)
  await knex.schema.dropTableIfExists('tenant_extension_schedule');
  await knex.schema.dropTableIfExists('extension_api_endpoint');
};
