/**
 * EE-only durable schedule state for Workflow Runtime V2 time triggers.
 *
 * Notes:
 * - Avoid foreign keys / cascades to stay compatible with Citus distribution patterns.
 * - `tenant_workflow_schedule` is tenant-scoped and can be distributed on `tenant_id`.
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

async function ensureDistributed(knex, table, distributionColumn) {
  const canDistribute = await hasCitusCreateDistributedTable(knex);
  if (!canDistribute) return;

  try {
    await knex.raw(`SELECT create_distributed_table('${table}', '${distributionColumn}');`);
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.toLowerCase().includes('already')) {
      console.warn(`[${table}] create_distributed_table failed`, { error: message });
    }
  }
}

exports.up = async function up(knex) {
  const hasSchedules = await knex.schema.hasTable('tenant_workflow_schedule');
  if (hasSchedules) return;

  await knex.schema.createTable('tenant_workflow_schedule', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('tenant_id').notNullable();
    table.uuid('workflow_id').notNullable();
    table.integer('workflow_version').notNullable();
    table.string('trigger_type', 32).notNullable();
    table.timestamp('run_at', { useTz: true }).nullable();
    table.text('cron').nullable();
    table.string('timezone', 64).nullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.string('status', 32).notNullable().defaultTo('scheduled');
    table.uuid('job_id').nullable();
    table.string('runner_schedule_id', 255).nullable();
    table.timestamp('last_fire_at', { useTz: true }).nullable();
    table.timestamp('next_fire_at', { useTz: true }).nullable();
    table.string('last_run_status', 32).nullable();
    table.text('last_error').nullable();
    table.text('last_fire_key').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['workflow_id'], { indexName: 'tenant_workflow_schedule_workflow_unique' });
    table.index(['tenant_id'], 'tenant_workflow_schedule_tenant_idx');
    table.index(['tenant_id', 'workflow_id'], 'tenant_workflow_schedule_tenant_workflow_idx');
    table.index(['runner_schedule_id'], 'tenant_workflow_schedule_runner_schedule_id_idx');
    table.index(['tenant_id', 'job_id'], 'tenant_workflow_schedule_tenant_job_idx');
  });

  await ensureDistributed(knex, 'tenant_workflow_schedule', 'tenant_id');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('tenant_workflow_schedule');
};
