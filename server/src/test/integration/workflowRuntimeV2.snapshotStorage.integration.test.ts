import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { encryptActionReplay, decryptActionReplay } from '../../../../shared/workflow/runtime/utils/actionReplayCipher';
import WorkflowActionInvocationModelV2 from '@alga-psa/workflows/persistence/workflowActionInvocationModelV2';
import { getActionRegistryV2, initializeWorkflowRuntimeV2 } from '@alga-psa/workflows/runtime/core';

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
import { listWorkflowRunStepsAction, exportWorkflowRunDetailAction } from '../../../../ee/packages/workflows/src/actions/workflow-runtime-v2-actions';
import { projectWorkflowRuntimeV2StepCompletion, executeWorkflowRuntimeV2ActionStep, executeWorkflowRuntimeV2NodeStep } from '../../../../ee/temporal-workflows/src/activities/workflow-runtime-v2-activities';

let db: Knex;
beforeAll(async () => {
  db = await createTestDbConnection();
}, 120_000);
afterAll(async () => { await db?.destroy(); });
beforeEach(async () => {
  state.canRead = true;
  vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-workflow-replay-secret');
  vi.stubEnv('WORKFLOW_REPLAY_KEYS', '');
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

it.each([['history', listWorkflowRunStepsAction], ['export', exportWorkflowRunDetailAction]] as const)('excludes protected replay fields from %s while preserving internal retry access', async (_name, read) => {
  const f = await fixture(); state.tenant = f.tenant;
  const invocationId = randomUUID(), idempotencyKey = randomUUID();
  const identity = { tenantId: f.tenant, invocationId }, key = 'synthetic-private-replay-key';
  const envelope = encryptActionReplay({ secretRef: 'private-result' }, key, identity);
  await state.trx!('workflow_action_invocations').insert({ tenant: f.tenant, invocation_id: invocationId,
    run_id: f.runId, step_path: f.stepPath, action_id: 'test.private-replay', action_version: 1,
    idempotency_key: idempotencyKey, status: 'SUCCEEDED', attempt: 1,
    output_json: { secretRef: '[REDACTED]' }, replay_output_encrypted: envelope,
  });
  const internal = await WorkflowActionInvocationModelV2.findByIdempotency(state.trx!, 'test.private-replay', 1, idempotencyKey, f.tenant);
  expect(decryptActionReplay(internal?.replay_output_encrypted, key, identity)).toEqual({ secretRef: 'private-result' });
  const result = await read({ runId: f.runId });
  expect(result.invocations).toHaveLength(1);
  expect(result.invocations[0]).toMatchObject({ output_json: { secretRef: '[REDACTED]' } });
  expect(result.invocations[0]).not.toHaveProperty('replay_output_encrypted');
  expect(JSON.stringify(result)).not.toContain(envelope.ciphertext);
});

it('stores redacted output diagnostics and preserves sensitive results across successful retries and key rotation', async () => {
  const f = await fixture(); state.tenant = f.tenant;
  const actionId = `test.protected-output.${randomUUID()}`;
  const output = { secretRef: 'synthetic-sensitive-result', value: 'keep' };
  const handler = vi.fn(async () => output);
  getActionRegistryV2().register({ id: actionId, version: 1, inputSchema: z.object({}), outputSchema: z.object({ secretRef: z.string(), value: z.string() }),
    sideEffectful: true, idempotency: { mode: 'engineProvided' }, ui: { label: 'Protected output probe', category: 'Test' }, handler });
  const input = { runId: f.runId, stepId: f.stepId, stepPath: f.stepPath, tenantId: f.tenant,
    step: { type: 'action.call' as const, config: { actionId, version: 1 } },
    scopes: { payload: {}, workflow: {}, lexical: [], system: { runId: f.runId, workflowId: randomUUID(), workflowVersion: 1, tenantId: f.tenant, definitionHash: null, runtimeSemanticsVersion: null } } };
  expect((await executeWorkflowRuntimeV2ActionStep(input)).output).toEqual(output);
  const row = await state.trx!('workflow_action_invocations').where({ run_id: f.runId }).first();
  expect(row.output_json).toEqual({ secretRef: '[REDACTED]', value: 'keep' });
  expect(JSON.stringify(row)).not.toContain(output.secretRef);
  vi.stubEnv('WORKFLOW_REPLAY_KEYS', JSON.stringify({ activeKeyId: 'rotated', keys: { nextauth: 'synthetic-workflow-replay-secret', rotated: 'synthetic-next-key' } }));
  expect((await executeWorkflowRuntimeV2ActionStep(input)).output).toEqual(output);
  expect(handler).toHaveBeenCalledOnce();
  const history = await listWorkflowRunStepsAction({ runId: f.runId });
  expect(history.invocations[0]).not.toHaveProperty('replay_output_encrypted');
  expect(history.invocations[0].output_json).toEqual({ secretRef: '[REDACTED]', value: 'keep' });
  const rotatedInput = { ...input, stepPath: 'rotated-step' };
  expect((await executeWorkflowRuntimeV2ActionStep(rotatedInput)).output).toEqual(output);
  const rotatedRow = await state.trx!('workflow_action_invocations').where({ run_id: f.runId, step_path: 'rotated-step' }).first();
  expect(rotatedRow.replay_output_encrypted.keyId).toBe('rotated');
  vi.stubEnv('WORKFLOW_REPLAY_KEYS', JSON.stringify({ activeKeyId: 'rotated', keys: { rotated: 'synthetic-next-key' } }));
  await expect(executeWorkflowRuntimeV2ActionStep(input)).rejects.toThrow('key is unavailable');
  expect((await executeWorkflowRuntimeV2ActionStep(rotatedInput)).output).toEqual(output);
  expect(handler).toHaveBeenCalledTimes(2);
});

async function replayProbe() {
  const f = await fixture(), actionId = `test.replay-preflight.${randomUUID()}`;
  const handler = vi.fn(async () => ({ value: 'new-result' }));
  getActionRegistryV2().register({ id: actionId, version: 1, inputSchema: z.object({}), outputSchema: z.object({ value: z.string() }),
    sideEffectful: true, idempotency: { mode: 'engineProvided' }, ui: { label: 'Replay preflight probe', category: 'Test' }, handler });
  const input = { runId: f.runId, stepId: f.stepId, stepPath: f.stepPath, tenantId: f.tenant,
    step: { type: 'action.call' as const, config: { actionId, version: 1, idempotencyKey: { $expr: '"stable-probe"' } } },
    scopes: { payload: {}, workflow: {}, lexical: [], system: { runId: f.runId, workflowId: randomUUID(), workflowVersion: 1, tenantId: f.tenant, definitionHash: null, runtimeSemanticsVersion: null } } };
  return { f, actionId, handler, input };
}

it.each(['missing-key', 'invalid-key-config', 'missing-schema'])('rejects %s before invoking an action or reserving an invocation', async condition => {
  const { handler, input } = await replayProbe();
  if (condition === 'missing-key') vi.stubEnv('NEXTAUTH_SECRET', '');
  if (condition === 'invalid-key-config') vi.stubEnv('WORKFLOW_REPLAY_KEYS', '{invalid-json');
  if (condition === 'missing-schema') await state.trx!.schema.alterTable('workflow_action_invocations', table => table.dropColumn('replay_output_encrypted'));
  await expect(executeWorkflowRuntimeV2ActionStep(input)).rejects.toThrow(/replay/i);
  expect(handler).not.toHaveBeenCalled();
  expect(await state.trx!('workflow_action_invocations')).toHaveLength(0);
});

it('replays legacy completed invocations without a replay key and without repeating the action', async () => {
  const { f, actionId, handler, input } = await replayProbe();
  await state.trx!('workflow_action_invocations').insert({ tenant: f.tenant, run_id: f.runId, step_path: f.stepPath,
    action_id: actionId, action_version: 1, idempotency_key: `${f.tenant}:stable-probe`, status: 'SUCCEEDED', attempt: 1,
    output_json: { value: 'legacy-result' },
  });
  vi.stubEnv('NEXTAUTH_SECRET', '');
  expect((await executeWorkflowRuntimeV2ActionStep(input)).output).toEqual({ value: 'legacy-result' });
  expect(handler).not.toHaveBeenCalled();
});


it('runs the real email parser through the activity and persists sanitized content and parser metadata', async () => {
  const f = await fixture();
  const scopes = { payload: { text: 'Please help with the printer.', html: '<p>Please help with the printer.</p><script>alert("unsafe")</script><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">unsafe link</a><a href="https://example.invalid/help">Help link</a>' },
    workflow: {}, lexical: [], system: { runId: f.runId, workflowId: randomUUID(), workflowVersion: 1,
      tenantId: f.tenant, definitionHash: null, runtimeSemanticsVersion: null } };
  const input = { ...f, tenantId: f.tenant, scopes, step: { type: 'email.parseBody', config: {
    text: { $expr: 'payload.text' }, html: { $expr: 'payload.html' }, saveAs: 'vars.parsedEmail' } } };
  const result = await executeWorkflowRuntimeV2NodeStep(input);
  const parsed = result.scopes.workflow.parsedEmail as any;
  expect(parsed.sanitizedText).toContain('Please help with the printer.');
  expect(parsed.sanitizedHtml).toContain('Please help with the printer.');
  expect(parsed.sanitizedHtml).not.toMatch(/<script|onerror|javascript:|alert\(/i);
  expect(parsed.sanitizedHtml).toContain('https://example.invalid/help');
  expect(['high', 'medium', 'low']).toContain(parsed.confidence);
  expect(parsed.metadata.parser).toMatchObject({ confidence: parsed.confidence });
  const invocation = await state.trx!('workflow_action_invocations').where({ run_id: f.runId }).first();
  expect(invocation, invocation.error_message).toMatchObject({ action_id: 'parse_email_reply', status: 'SUCCEEDED' });
  expect(invocation.output_json.success).toBe(true);
  expect(invocation.output_json.parsed.tokens).toBeNull();
  expect(parsed.confidence).toBe(invocation.output_json.parsed.confidence);
  const snapshot = await complete(f, { payload: result.scopes.payload, vars: result.scopes.workflow });
  expect(snapshot.envelope_json.vars.parsedEmail).toEqual(parsed);
  expect((await executeWorkflowRuntimeV2NodeStep(input)).scopes.workflow.parsedEmail).toEqual(parsed);
  expect(await state.trx!('workflow_action_invocations').where({ run_id: f.runId })).toHaveLength(1);
});

it.each(['unavailable', 'throws'])('persists readable comment blocks when HTML conversion %s', async failure => {
  const f = await fixture();
  initializeWorkflowRuntimeV2();
  const action = getActionRegistryV2().get('convert_html_to_blocks', 1)!;
  const handler = vi.spyOn(action, 'handler');
  if (failure === 'throws') handler.mockRejectedValue(new Error('synthetic converter failure'));
  else handler.mockResolvedValue({ success: false, blocks: [] });
  try {
    const result = await executeWorkflowRuntimeV2NodeStep({ ...f, tenantId: f.tenant,
      step: { type: 'email.renderCommentBlocks', config: { html: { $expr: 'payload.html' }, text: { $expr: 'payload.text' }, saveAs: 'payload.blocks' } },
      scopes: { payload: { html: '<p>Keep this reply</p>', text: 'Keep this reply' }, workflow: {}, lexical: [],
        system: { runId: f.runId, workflowId: randomUUID(), workflowVersion: 1, tenantId: f.tenant, definitionHash: null, runtimeSemanticsVersion: null } } });
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep this reply' }] }];
    expect(result.scopes.payload.blocks).toEqual(blocks);
    expect(handler).toHaveBeenCalledOnce();
    const snapshot = await complete(f, { payload: result.scopes.payload });
    expect(snapshot.envelope_json.payload.blocks).toEqual(blocks);
    expect(await state.trx!('workflow_action_invocations').where({ run_id: f.runId }).first())
      .toMatchObject({ action_id: 'convert_html_to_blocks', status: failure === 'throws' ? 'FAILED' : 'SUCCEEDED' });
  } finally { handler.mockRestore(); }
});


it.each(['unavailable', 'throws'])('sanitizes HTML even when the reply parser %s', async failure => {
  const f = await fixture();
  initializeWorkflowRuntimeV2();
  const action = getActionRegistryV2().get('parse_email_reply', 1)!;
  const handler = vi.spyOn(action, 'handler');
  if (failure === 'throws') handler.mockRejectedValue(new Error('synthetic parser failure'));
  else handler.mockResolvedValue({ success: false, parsed: null });
  try {
    const result = await executeWorkflowRuntimeV2NodeStep({ ...f, tenantId: f.tenant,
      step: { type: 'email.parseBody', config: { html: { $expr: 'payload.html' }, text: { $expr: 'payload.text' }, saveAs: 'vars.parsedEmail' } },
      scopes: { payload: { html: '<p>Keep this reply</p><script>alert(1)</script><img src="x" onerror="alert(2)">', text: 'Keep this reply' }, workflow: {}, lexical: [],
        system: { runId: f.runId, workflowId: randomUUID(), workflowVersion: 1, tenantId: f.tenant, definitionHash: null, runtimeSemanticsVersion: null } } });
    const parsed = result.scopes.workflow.parsedEmail as any;
    expect(parsed).toMatchObject({ sanitizedText: 'Keep this reply', confidence: 'low' });
    expect(parsed.sanitizedHtml).toContain('<p>Keep this reply</p>');
    expect(parsed.sanitizedHtml).not.toMatch(/<script|onerror|alert\(/i);
    expect(parsed.metadata.parser.warnings).toContain(failure === 'throws' ? 'parser-error' : 'parser-unavailable');
    const snapshot = await complete(f, { vars: result.scopes.workflow });
    expect(snapshot.envelope_json.vars.parsedEmail.sanitizedHtml).toBe(parsed.sanitizedHtml);
  } finally { handler.mockRestore(); }
});
