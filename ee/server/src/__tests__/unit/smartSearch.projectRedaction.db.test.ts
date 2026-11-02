/**
 * Runs the masked project SQL against a real, migrated Postgres (workspace DB lane).
 * Seeds its own project, phase, tasks and billing profile inside a transaction that is rolled back.
 * Run: DB_HOST=127.0.0.1 DB_PORT=<port> TEST_DB_NAME=<scratch db> node scripts/run-workspace-db-tests.mjs smartSearch.projectRedaction
 */
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  authorizeProjectIdsWithRedactions: vi.fn(),
  loadProjectListItemsByIds: vi.fn(),
}));

import ProjectModel, { PROJECT_MASKED_ROW_COLUMNS } from '@alga-psa/projects/models/project';
import { loadProjectTaskRows, loadProjectTextRows } from '../../services/smartSearch/entities/project';

const HOOK_TIMEOUT = 180_000;
const PROJECT_NAME = 'Redaction Fixture Asset Tagging';
const HIDDEN = ['description', 'project_tasks.task_name', 'project_tasks.description', 'budgeted_hours', 'client_name', 'billing_profile_id', 'project_name'];

describe('masked project SQL on a real database', () => {
  let db: Knex;
  let trx: Knex.Transaction;
  let TENANT: string;
  let PROJECT: string;
  let BILLING_PROFILE: string;

  beforeAll(async () => {
    db = await createTestDbConnection();
    trx = await db.transaction();
    const client = await trx('clients').first('tenant', 'client_id');
    if (!client) throw new Error('Seeded database has no client to attach the project fixture to');
    TENANT = client.tenant;
    const status = await trx('statuses').where({ tenant: TENANT }).first('status_id');
    if (!status) throw new Error('Seeded tenant has no status for the project fixture');

    BILLING_PROFILE = randomUUID();
    await trx('client_billing_profiles').insert({
      tenant: TENANT, billing_profile_id: BILLING_PROFILE, client_id: client.client_id, name: `Redaction ${BILLING_PROFILE.slice(0, 8)}`,
      is_default: false, is_system_managed_default: false, is_active: true, billing_email: 'billing@example.invalid',
    });
    const n = randomUUID().slice(0, 8);
    const [project] = await trx('projects').insert({
      tenant: TENANT, project_name: PROJECT_NAME, client_id: client.client_id, status: status.status_id,
      wbs_code: n, project_number: `PRJ-RED-${n}`, description: 'HIDDEN-PROJECT-DESCRIPTION',
      billing_profile_id: BILLING_PROFILE, budgeted_hours: 120,
    }).returning('project_id');
    PROJECT = project.project_id;
    const [phase] = await trx('project_phases').insert({
      tenant: TENANT, project_id: PROJECT, phase_name: 'Tagging', status: 'active', order_number: 1, wbs_code: `${n}.1`, order_key: 'a0',
    }).returning('phase_id');
    await trx('project_tasks').insert([1, 2, 3].map((i) => ({
      tenant: TENANT, phase_id: phase.phase_id, task_name: `HIDDEN-TASK-NAME-${i}`, description: 'HIDDEN-TASK-DESCRIPTION', wbs_code: `${n}.1.${i}`,
    })));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await trx?.rollback().catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('loadProjectTextRows: typed NULLs and neutral title execute and mask', async () => {
    const [row] = await loadProjectTextRows(trx, TENANT, [PROJECT], HIDDEN);
    expect(row).toMatchObject({ project_id: PROJECT, project_name: 'Project', description: null, client_name: null, budgeted_hours: null });
    expect(JSON.stringify(row)).not.toContain('HIDDEN-PROJECT-DESCRIPTION');
    expect(JSON.stringify(row)).not.toContain(PROJECT_NAME);
    expect(row.project_number).toBeTruthy();
  });

  it('loadProjectTextRows: unmasked reader sees the data; hidden resource drops the row', async () => {
    const [row] = await loadProjectTextRows(trx, TENANT, [PROJECT], []);
    expect(row).toMatchObject({ project_name: PROJECT_NAME, description: 'HIDDEN-PROJECT-DESCRIPTION' });
    await expect(loadProjectTextRows(trx, TENANT, [PROJECT], ['projects'])).resolves.toEqual([]);
  });

  it('loadProjectTaskRows: masks task name/description with the neutral title and keeps the rest', async () => {
    const rows = await loadProjectTaskRows(trx, TENANT, [PROJECT], HIDDEN);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.task_name).toBe('Project task');
      expect(row.description).toBeNull();
    }
    expect(JSON.stringify(rows)).not.toContain('HIDDEN-TASK');
    const unmasked = await loadProjectTaskRows(trx, TENANT, [PROJECT], []);
    expect(unmasked.some((row) => row.description === 'HIDDEN-TASK-DESCRIPTION')).toBe(true);
    await expect(loadProjectTaskRows(trx, TENANT, [PROJECT], ['project_tasks'])).resolves.toEqual([]);
  });

  it('getMaskedByIds: explicit columns, hidden ones NULL (billing_profile_id included), dates stay Dates', async () => {
    const [row] = await ProjectModel.getMaskedByIds(trx, TENANT, [PROJECT], HIDDEN);
    expect(row).toMatchObject({ project_id: PROJECT, project_name: 'Project', description: null, budgeted_hours: null, billing_profile_id: null, client_name: null });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(Object.keys(row)).toEqual(expect.arrayContaining([...PROJECT_MASKED_ROW_COLUMNS]));
    expect(JSON.stringify(row)).not.toContain(BILLING_PROFILE);
    const [open] = await ProjectModel.getMaskedByIds(trx, TENANT, [PROJECT], ['description']);
    expect((open as unknown as Record<string, unknown>).billing_profile_id).toBe(BILLING_PROFILE);
    expect(open.description).toBeNull();
  });

  it('getMaskedByIds: the emitted column list matches the live projects table, and a hidden identifier drops the row', async () => {
    const columns = (await trx('information_schema.columns').where({ table_name: 'projects', table_schema: 'public' }).pluck('column_name')) as string[];
    expect([...PROJECT_MASKED_ROW_COLUMNS].sort()).toEqual(columns.sort());
    await expect(ProjectModel.getMaskedByIds(trx, TENANT, [PROJECT], ['project_id'])).resolves.toEqual([]);
  });
});
