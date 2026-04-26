import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';

const require = createRequire(import.meta.url);

let db: Knex;

async function resetToLegacyWorkflowScheduleTable(): Promise<void> {
  await db.schema.dropTableIfExists('tenant_workflow_schedule');

  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const legacyMigration = require(path.resolve(
    repoRoot,
    'ee',
    'server',
    'migrations',
    '20260307200000_create_workflow_schedule_tables.cjs'
  ));

  await legacyMigration.up(db);
}

async function applyWorkflowScheduleMigrations(): Promise<void> {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  for (const migrationName of [
    '20260308130000_expand_workflow_schedule_for_external_schedules.cjs',
    '20260410120000_add_workflow_schedule_business_day_fields.cjs'
  ]) {
    const migration = require(path.resolve(
      repoRoot,
      'ee',
      'server',
      'migrations',
      migrationName
    ));

    await migration.up(db);
  }
}

describe('Workflow external schedules migration – DB integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T001: migration removes the one-row-per-workflow constraint', async () => {
    await resetToLegacyWorkflowScheduleTable();
    await applyWorkflowScheduleMigrations();

    const indexes = await db('pg_indexes')
      .where({ schemaname: 'public', tablename: 'tenant_workflow_schedule' })
      .select('indexname');
    const indexNames = new Set(indexes.map((row: { indexname: string }) => row.indexname));

    expect(indexNames.has('tenant_workflow_schedule_workflow_unique')).toBe(false);
    expect(indexNames.has('tenant_workflow_schedule_tenant_workflow_status_idx')).toBe(true);
    expect(indexNames.has('tenant_workflow_schedule_tenant_name_idx')).toBe(true);
    expect(indexNames.has('tenant_workflow_schedule_tenant_day_type_filter_idx')).toBe(true);
    expect(indexNames.has('tenant_workflow_schedule_tenant_business_hours_schedule_idx')).toBe(true);
  });

  it('T002: legacy schedule rows survive migration with runner state intact', async () => {
    await resetToLegacyWorkflowScheduleTable();

    const workflowId = uuidv4();
    await db('workflow_definitions').insert({
      workflow_id: workflowId,
      tenant_id: 'tenant-a',
      name: 'Legacy Workflow',
      description: null,
      payload_schema_ref: 'payload.Empty.v1',
      draft_definition: { id: workflowId, name: 'Legacy Workflow', version: 2, steps: [] },
      draft_version: 2,
      status: 'published',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const scheduleId = uuidv4();
    await db('tenant_workflow_schedule').insert({
      id: scheduleId,
      tenant_id: 'tenant-a',
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
      status: 'scheduled',
      job_id: uuidv4(),
      runner_schedule_id: 'runner-schedule-1',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    await applyWorkflowScheduleMigrations();

    const row = await db('tenant_workflow_schedule').where({ id: scheduleId }).first();
    expect(row).toBeTruthy();
    expect(row.name).toBe('Legacy Workflow');
    expect(row.payload_json).toEqual({});
    expect(row.day_type_filter).toBe('any');
    expect(row.business_hours_schedule_id).toBeNull();
    expect(row.job_id).toBeTruthy();
    expect(row.runner_schedule_id).toBe('runner-schedule-1');
    expect(row.workflow_id).toBe(workflowId);
  });
});
