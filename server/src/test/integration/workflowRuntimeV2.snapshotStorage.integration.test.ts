import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => ({ trx: null as Knex.Transaction | null }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => state.trx,
  retryOnAdminReadOnly: async (fn: () => Promise<unknown>) => fn(),
}));
import { projectWorkflowRuntimeV2StepCompletion } from '../../../../ee/temporal-workflows/src/activities/workflow-runtime-v2-activities';

let db: Knex;
beforeAll(async () => {
  db = await createTestDbConnection();
}, 120_000);
afterAll(async () => { await db?.destroy(); });
beforeEach(async () => {
  const trx = state.trx = await db.transaction();
  const schema = `workflow_snapshot_${randomUUID().replaceAll('-', '')}`;
  await trx.raw('CREATE SCHEMA ??', [schema]);
  await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
  for (const table of ['workflow_runs', 'workflow_run_steps', 'workflow_run_snapshots']) {
    await trx.raw('CREATE TABLE ?? (LIKE ?? INCLUDING ALL)', [table, `public.${table}`]);
  }
});
afterEach(async () => { await state.trx?.rollback(); state.trx = null; vi.unstubAllEnvs(); });

async function fixture(tenant = randomUUID()) {
  const runId = randomUUID(), stepId = randomUUID();
  await state.trx!('workflow_runs').insert({ run_id: runId, tenant, workflow_id: randomUUID(), workflow_version: 1, status: 'RUNNING' });
  await state.trx!('workflow_run_steps').insert({ step_id: stepId, tenant, run_id: runId, step_path: 'state-1', definition_step_id: 'state-1', status: 'RUNNING' });
  return { tenant, runId, stepId, stepPath: 'state-1' };
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, snapshot: Record<string, unknown>) {
  await projectWorkflowRuntimeV2StepCompletion({ ...f, status: 'SUCCEEDED', snapshot });
  return state.trx!('workflow_run_snapshots').where({ tenant: f.tenant, run_id: f.runId }).orderBy('created_at', 'desc').first();
}

it('stores nested secret references redacted and links exactly one snapshot when activity completion is retried', async () => {
  const f = await fixture();
  const diagnostic = { payload: { secretRef: 'private', nested: [{ secretRef: 'nested-private' }], visible: 'keep' } };
  const snapshot = await complete(f, diagnostic);
  expect(snapshot.envelope_json.payload).toEqual({ secretRef: '[REDACTED]', nested: [{ secretRef: '[REDACTED]' }], visible: 'keep' });
  expect(diagnostic.payload.secretRef).toBe('private');
  expect(snapshot.size_bytes).toBe(Buffer.byteLength(JSON.stringify(snapshot.envelope_json), 'utf8'));
  const step = await state.trx!('workflow_run_steps').where({ step_id: f.stepId }).first();
  expect(step).toMatchObject({ status: 'SUCCEEDED', snapshot_id: snapshot.snapshot_id });
  await complete(f, diagnostic);
  expect(await state.trx!('workflow_run_snapshots').where({ run_id: f.runId })).toHaveLength(1);
});

it('stores valid bounded JSON when a diagnostic snapshot exceeds the byte limit', async () => {
  const f = await fixture();
  const snapshot = await complete(f, { payload: { big: '漢字'.repeat(100000) } });
  expect(snapshot.envelope_json.truncated).toBe(true);
  expect(snapshot.size_bytes).toBeLessThanOrEqual(256 * 1024);
  expect(() => JSON.parse(JSON.stringify(snapshot.envelope_json))).not.toThrow();
});

it.each([undefined, '7'])('prunes expired snapshots using retention %s without crossing run or tenant boundaries', async retention => {
  if (retention === undefined) vi.stubEnv('WORKFLOW_SNAPSHOT_RETENTION_DAYS', undefined);
  else vi.stubEnv('WORKFLOW_SNAPSHOT_RETENTION_DAYS', retention);
  const f = await fixture(), sameTenantRun = await fixture(f.tenant), foreign = await fixture();
  for (const subject of [f, sameTenantRun, foreign]) {
    const old = await complete(subject, { payload: { state: 'old' } });
    await state.trx!('workflow_run_snapshots').where({ snapshot_id: old.snapshot_id }).update({ created_at: new Date(Date.now() - (retention ? 8 : 40) * 86400000) });
  }
  const stepId = randomUUID();
  await state.trx!('workflow_run_steps').insert({ step_id: stepId, tenant: f.tenant, run_id: f.runId, step_path: 'state-2', definition_step_id: 'state-2', status: 'RUNNING' });
  await complete({ ...f, stepId, stepPath: 'state-2' }, { payload: { state: 'new' } });
  const snapshots = await state.trx!('workflow_run_snapshots');
  expect(snapshots).toHaveLength(3);
  expect(snapshots.filter(row => row.run_id === f.runId).map(row => row.envelope_json.payload.state)).toEqual(['new']);
  expect(snapshots.filter(row => row.run_id !== f.runId)).toHaveLength(2);
  expect(await state.trx!('workflow_run_steps').where({ step_id: f.stepId }).first()).toMatchObject({ snapshot_id: null });
});
