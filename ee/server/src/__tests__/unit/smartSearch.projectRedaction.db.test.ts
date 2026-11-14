/**
 * Runs the masked project SQL against a real, migrated Postgres. The suite seeds its own tenant, client,
 * billing profile, project, phase and tasks, and every case runs inside a transaction that is rolled back.
 * Run: node scripts/run-workspace-db-tests.mjs smartSearch.projectRedaction
 */
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  authorizeProjectIdsWithRedactions: vi.fn(),
  loadProjectListItemsByIds: vi.fn(),
}));

import ProjectModel, { PROJECT_MASKED_ROW_COLUMNS } from '@alga-psa/projects/models/project';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { createClient, createTenant } from '../../../../../server/test-utils/testDataFactory';
import { ensureDefaultBillingProfile } from '../../../../../server/test-utils/billingProfileTestHelpers';
import { loadProjectTaskRows, loadProjectTextRows } from '../../services/smartSearch/entities/project';

const HOOK_TIMEOUT = 180_000;
const PROJECT_NAME = 'Card Garden Asset Tagging';
const PROJECT_DESCRIPTION = 'HIDDEN-PROJECT-DESCRIPTION';
const TASK_DESCRIPTION = 'HIDDEN-TASK-DESCRIPTION';
const HIDDEN = ['description', 'project_tasks.task_name', 'project_tasks.description', 'budgeted_hours', 'client_name', 'billing_profile_id', 'project_name'];

describe('masked project SQL on a real database', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let billingProfile: string;
  let projectStatus: string;
  let trx: Knex.Transaction;
  let project: string;

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = await createTenant(db, 'Smart search redaction tenant');
    clientId = await createClient(db, tenant, 'Smart search redaction client');
    billingProfile = await ensureDefaultBillingProfile({ db, tenantId: tenant }, clientId);
    projectStatus = randomUUID();
    await db('statuses').insert({
      tenant, status_id: projectStatus, name: 'Active', status_type: 'project', order_number: 1, is_closed: false, is_default: true,
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    trx = await db.transaction();
    const n = randomUUID().slice(0, 8);
    project = randomUUID();
    await trx('projects').insert({
      tenant, project_id: project, client_id: clientId, status: projectStatus, project_name: PROJECT_NAME, description: PROJECT_DESCRIPTION,
      billing_profile_id: billingProfile, budgeted_hours: 120, wbs_code: n, project_number: `PRJ-${n}`,
    });
    const [phase] = await trx('project_phases')
      .insert({ tenant, project_id: project, phase_name: 'Tagging', status: 'active', order_number: 1, wbs_code: `${n}.1`, order_key: 'a0' })
      .returning('phase_id');
    await trx('project_tasks').insert([1, 2].map((i) => ({
      tenant, phase_id: phase.phase_id, task_name: `Tag rack ${i}`, description: TASK_DESCRIPTION, wbs_code: `${n}.1.${i}`,
    })));
  });

  afterEach(async () => {
    await trx?.rollback();
  });

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('loadProjectTextRows: typed NULLs and neutral title execute and mask', async () => {
    const [row] = await loadProjectTextRows(trx, tenant, [project], HIDDEN);
    expect(row).toMatchObject({ project_id: project, project_name: 'Project', description: null, client_name: null, budgeted_hours: null });
    expect(JSON.stringify(row)).not.toContain(PROJECT_DESCRIPTION);
    expect(row.project_number).toBeTruthy();
  });

  it('loadProjectTextRows: unmasked reader sees the data; hidden resource drops the row', async () => {
    const [row] = await loadProjectTextRows(trx, tenant, [project], []);
    expect(row).toMatchObject({ project_name: PROJECT_NAME, description: PROJECT_DESCRIPTION });
    await expect(loadProjectTextRows(trx, tenant, [project], ['projects'])).resolves.toEqual([]);
  });

  it('loadProjectTaskRows: masks task name/description with the neutral title and keeps the rest', async () => {
    const rows = await loadProjectTaskRows(trx, tenant, [project], HIDDEN);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.task_name).toBe('Project task');
      expect(row.description).toBeNull();
    }
    expect(JSON.stringify(rows)).not.toContain(TASK_DESCRIPTION);
    const unmasked = await loadProjectTaskRows(trx, tenant, [project], []);
    expect(unmasked.every((row) => row.description === TASK_DESCRIPTION)).toBe(true);
    await expect(loadProjectTaskRows(trx, tenant, [project], ['project_tasks'])).resolves.toEqual([]);
  });

  it('getMaskedByIds: explicit columns, hidden ones NULL (billing_profile_id included), dates stay Dates', async () => {
    const [row] = await ProjectModel.getMaskedByIds(trx, tenant, [project], HIDDEN);
    expect(row).toMatchObject({ project_id: project, project_name: 'Project', description: null, budgeted_hours: null, billing_profile_id: null, client_name: null });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(Object.keys(row)).toEqual(expect.arrayContaining([...PROJECT_MASKED_ROW_COLUMNS]));
    expect(JSON.stringify(row)).not.toContain(billingProfile);
    const [open] = await ProjectModel.getMaskedByIds(trx, tenant, [project], ['description']);
    expect((open as unknown as Record<string, unknown>).billing_profile_id).toBe(billingProfile);
    expect(open.description).toBeNull();
  });

  it('getMaskedByIds: the emitted column list matches the live projects table, and a hidden identifier drops the row', async () => {
    const columns = (await trx('information_schema.columns').where({ table_name: 'projects', table_schema: 'public' }).pluck('column_name')) as string[];
    expect([...PROJECT_MASKED_ROW_COLUMNS].sort()).toEqual(columns.sort());
    await expect(ProjectModel.getMaskedByIds(trx, tenant, [project], ['project_id'])).resolves.toEqual([]);
  });
});
