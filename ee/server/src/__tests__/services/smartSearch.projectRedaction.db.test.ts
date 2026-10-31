/**
 * Runs the masked project SQL against a real Postgres. Skipped unless SMART_SEARCH_REDACTION_DB_URL is set, e.g.
 *   SMART_SEARCH_REDACTION_DB_URL=postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5474/server
 * (dev stack container alga-psa-local-test-postgres-1; password from `docker exec ... printenv POSTGRES_PASSWORD`).
 * Everything runs in a transaction that is rolled back.
 */
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  authorizeProjectIdsWithRedactions: vi.fn(),
  loadProjectListItemsByIds: vi.fn(),
}));

import ProjectModel, { PROJECT_MASKED_ROW_COLUMNS } from '@alga-psa/projects/models/project';
import { loadProjectTaskRows, loadProjectTextRows } from '../../services/smartSearch/entities/project';

const url = process.env.SMART_SEARCH_REDACTION_DB_URL;
const TENANT = '374a6b30-392b-4e3d-8d09-2ea8dc447c72';
const PROJECT = 'a1c30000-0000-4000-8000-000000000004';
const BILLING_PROFILE = '5dcaccc5-cb09-4a8c-b8f3-09b070fa9457'; // an existing client_billing_profiles row (FK target)

describe.skipIf(!url)('masked project SQL on a real database', () => {
  let db: Knex;
  let trx: Knex.Transaction;

  beforeAll(async () => {
    db = knex({ client: 'pg', connection: url });
    trx = await db.transaction();
    await trx('projects').where({ tenant: TENANT, project_id: PROJECT })
      .update({ description: 'HIDDEN-PROJECT-DESCRIPTION', billing_profile_id: BILLING_PROFILE, budgeted_hours: 120 });
    await trx('project_tasks as t').whereIn('t.task_id', trx('project_tasks as x').join('project_phases as ph', 'ph.phase_id', 'x.phase_id')
      .where('ph.project_id', PROJECT).where('x.tenant', TENANT).select('x.task_id').limit(3))
      .update({ description: 'HIDDEN-TASK-DESCRIPTION' });
  });
  afterAll(async () => {
    await trx?.rollback();
    await db?.destroy();
  });

  const HIDDEN = ['description', 'project_tasks.task_name', 'project_tasks.description', 'budgeted_hours', 'client_name', 'billing_profile_id', 'project_name'];

  it('loadProjectTextRows: typed NULLs and neutral title execute and mask', async () => {
    const [row] = await loadProjectTextRows(trx, TENANT, [PROJECT], HIDDEN);
    expect(row).toMatchObject({ project_id: PROJECT, project_name: 'Project', description: null, client_name: null, budgeted_hours: null });
    expect(JSON.stringify(row)).not.toContain('HIDDEN-PROJECT-DESCRIPTION');
    expect(row.project_number).toBeTruthy();
  });

  it('loadProjectTextRows: unmasked reader sees the data; hidden resource drops the row', async () => {
    const [row] = await loadProjectTextRows(trx, TENANT, [PROJECT], []);
    expect(row).toMatchObject({ project_name: 'Card Garden Asset Tagging', description: 'HIDDEN-PROJECT-DESCRIPTION' });
    await expect(loadProjectTextRows(trx, TENANT, [PROJECT], ['projects'])).resolves.toEqual([]);
  });

  it('loadProjectTaskRows: masks task name/description with the neutral title and keeps the rest', async () => {
    const rows = await loadProjectTaskRows(trx, TENANT, [PROJECT], HIDDEN);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.task_name).toBe('Project task');
      expect(row.description).toBeNull();
    }
    expect(JSON.stringify(rows)).not.toContain('HIDDEN-TASK-DESCRIPTION');
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
