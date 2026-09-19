/**
 * EE-only migration for Workflow V2 external schedules.
 *
 * Expands the schedule table from one row per workflow into many schedules per
 * workflow and adds the persisted schedule name/payload fields required by the
 * external schedules UI and runtime.
 */

exports.config = { transaction: false };

async function dropWorkflowUniqueIndex(knex) {
  try {
    await knex.raw(`
      ALTER TABLE tenant_workflow_schedule
      DROP CONSTRAINT IF EXISTS tenant_workflow_schedule_workflow_unique
    `);
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.toLowerCase().includes('does not exist')) {
      throw error;
    }
  }
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenant_workflow_schedule');
  if (!hasTable) return;

  const hasName = await knex.schema.hasColumn('tenant_workflow_schedule', 'name');
  if (!hasName) {
    await knex.schema.alterTable('tenant_workflow_schedule', (table) => {
      table.text('name');
    });
  }

  const hasPayloadJson = await knex.schema.hasColumn('tenant_workflow_schedule', 'payload_json');
  if (!hasPayloadJson) {
    await knex.schema.alterTable('tenant_workflow_schedule', (table) => {
      table.jsonb('payload_json');
    });
  }

  await knex.raw(`
    UPDATE tenant_workflow_schedule AS tws
    SET name = COALESCE(NULLIF(BTRIM(wd.name), ''), 'Migrated schedule')
    FROM workflow_definitions AS wd
    WHERE tws.workflow_id = wd.workflow_id
      AND (tws.name IS NULL OR BTRIM(tws.name) = '')
  `);

  await knex.raw(`
    UPDATE tenant_workflow_schedule
    SET name = 'Migrated schedule'
    WHERE name IS NULL OR BTRIM(name) = ''
  `);

  await knex.raw(`
    UPDATE tenant_workflow_schedule
    SET payload_json = '{}'::jsonb
    WHERE payload_json IS NULL
  `);

  await knex.raw(`
    ALTER TABLE tenant_workflow_schedule
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN payload_json SET DEFAULT '{}'::jsonb,
    ALTER COLUMN payload_json SET NOT NULL
  `);

  await dropWorkflowUniqueIndex(knex);

  await knex.schema.alterTable('tenant_workflow_schedule', (table) => {
    table.index(['tenant_id', 'workflow_id', 'status'], 'tenant_workflow_schedule_tenant_workflow_status_idx');
    table.index(['tenant_id', 'name'], 'tenant_workflow_schedule_tenant_name_idx');
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenant_workflow_schedule');
  if (!hasTable) return;

  const duplicates = await knex('tenant_workflow_schedule')
    .select('workflow_id')
    .groupBy('workflow_id')
    .havingRaw('count(*) > 1');

  if (duplicates.length > 0) {
    throw new Error('Cannot restore single-schedule workflow constraint while multiple schedules exist for a workflow.');
  }

  const hasName = await knex.schema.hasColumn('tenant_workflow_schedule', 'name');
  const hasPayloadJson = await knex.schema.hasColumn('tenant_workflow_schedule', 'payload_json');

  await knex.schema.alterTable('tenant_workflow_schedule', (table) => {
    table.dropIndex(['tenant_id', 'workflow_id', 'status'], 'tenant_workflow_schedule_tenant_workflow_status_idx');
    table.dropIndex(['tenant_id', 'name'], 'tenant_workflow_schedule_tenant_name_idx');
  });

  if (hasPayloadJson) {
    await knex.raw(`
      ALTER TABLE tenant_workflow_schedule
      ALTER COLUMN payload_json DROP DEFAULT
    `);
  }

  await knex.schema.alterTable('tenant_workflow_schedule', (table) => {
    if (hasPayloadJson) {
      table.dropColumn('payload_json');
    }
    if (hasName) {
      table.dropColumn('name');
    }
  });

  await knex.raw(`
    ALTER TABLE tenant_workflow_schedule
    ADD CONSTRAINT tenant_workflow_schedule_workflow_unique UNIQUE (workflow_id)
  `);
};
