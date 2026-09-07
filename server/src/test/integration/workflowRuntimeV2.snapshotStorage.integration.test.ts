import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getActionRegistryV2 } from '@alga-psa/workflows/runtime/core';

const state = vi.hoisted(() => ({ trx: null as Knex.Transaction | null, tenant: '', canRead: true }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => state.trx,
  retryOnAdminReadOnly: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@alga-psa/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, createTenantKnex: async () => ({ knex: state.trx, tenant: state.tenant }) };
});
vi.mock('@alga-psa/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return { ...actual,
    withAuth: (fn: any) => (input: unknown) => fn({ user_id: 'test-user', user_type: 'internal', roles: [] }, { tenant: state.tenant }, input),
    hasPermission: async () => state.canRead,
  };
});
import { listWorkflowRunStepsAction } from '../../../../ee/packages/workflows/src/actions/workflow-runtime-v2-actions';
import { projectWorkflowRuntimeV2StepCompletion, executeWorkflowRuntimeV2ActionStep } from '../../../../ee/temporal-workflows/src/activities/workflow-runtime-v2-activities';

let db: Knex;
beforeAll(async () => {
  db = await createTestDbConnection();
}, 120_000);
afterAll(async () => { await db?.destroy(); });
beforeEach(async () => {
  state.canRead = true;
  const trx = state.trx = await db.transaction();
  const schema = `workflow_snapshot_${randomUUID().replaceAll('-', '')}`;
  await trx.raw('CREATE SCHEMA ??', [schema]);
  await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
  for (const table of ['workflow_runs', 'workflow_run_steps', 'workflow_run_snapshots', 'workflow_action_invocations', 'workflow_run_waits', 'tenant_settings']) {
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

it('reads activity-written snapshot references through the run-history action without exposing secret values', async () => {
  const f = await fixture();
  state.tenant = f.tenant;
  await state.trx!('tenant_settings').insert({ tenant: f.tenant, settings: { workflowRunStudio: { redactionPointers: ['/payload/customerNote'] } } });
  const snapshot = await complete(f, { payload: { secretRef: 'private-value', visible: 'public-value', customerNote: 'private-note' } });
  expect(snapshot.envelope_json.payload.customerNote).toBe('private-note');
  const result = await listWorkflowRunStepsAction({ runId: f.runId });
  expect(result.steps).toHaveLength(1);
  expect(result.steps[0]).toMatchObject({ snapshot_id: snapshot.snapshot_id });
  expect(result.snapshots).toHaveLength(1);
  expect(result.snapshots[0].envelope_json).toMatchObject({ payload: { secretRef: '[REDACTED]', visible: 'public-value', customerNote: '[REDACTED]' } });
  expect(JSON.stringify(result)).not.toContain('private-value');
  expect(JSON.stringify(result)).not.toContain('private-note');
  state.tenant = randomUUID();
  await expect(listWorkflowRunStepsAction({ runId: f.runId })).rejects.toThrow('Not found');
  state.tenant = f.tenant;
  state.canRead = false;
  await expect(listWorkflowRunStepsAction({ runId: f.runId })).rejects.toThrow('Forbidden');
});

it('redacts invocation inputs while preserving the successful result and avoiding repeated action effects', async () => {
  const f = await fixture();
  const actionId = `test.snapshot-input.${randomUUID()}`;
  const handler = vi.fn(async () => ({ result: 'completed' }));
  getActionRegistryV2().register({ id: actionId, version: 1,
    inputSchema: z.object({ credentials: z.object({ secretRef: z.string() }) }),
    outputSchema: z.object({ result: z.string() }), sideEffectful: true,
    idempotency: { mode: 'engineProvided' }, ui: { label: 'Invocation storage probe', category: 'Test' }, handler,
  });
  const input = { runId: f.runId, stepId: f.stepId, stepPath: f.stepPath, tenantId: f.tenant,
    step: { type: 'action.call' as const, config: { actionId, version: 1, inputMapping: { credentials: { secretRef: 'synthetic-secret-reference' } } } },
    scopes: { payload: {}, workflow: {}, lexical: [], system: { runId: f.runId, workflowId: randomUUID(), workflowVersion: 1, tenantId: f.tenant, definitionHash: null, runtimeSemanticsVersion: null } },
  };
  expect((await executeWorkflowRuntimeV2ActionStep(input)).output).toEqual({ result: 'completed' });
  const row = await state.trx!('workflow_action_invocations').where({ run_id: f.runId }).first();
  expect(row.input_json).toEqual({ credentials: { secretRef: '[REDACTED]' } });
  expect(row.status).toBe('SUCCEEDED');
  expect((await executeWorkflowRuntimeV2ActionStep(input)).output).toEqual({ result: 'completed' });
  expect(handler).toHaveBeenCalledOnce();
  expect(handler).toHaveBeenCalledWith({ credentials: { secretRef: 'synthetic-secret-reference' } }, expect.anything());
});
