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
  return { ...actual, withAdminTransaction: async (fn: (trx: Knex.Transaction) => Promise<unknown>) => fn(state.trx!), createTenantKnex: async () => ({ knex: state.trx, tenant: state.tenant }) };
});
vi.mock('@alga-psa/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return { ...actual,
    withAuth: (fn: any) => (input: unknown) => fn({ user_id: 'test-user', user_type: 'internal', roles: [] }, { tenant: state.tenant }, input),
    hasPermission: async () => state.canRead,
  };
});
import { listWorkflowRunStepsAction, exportWorkflowRunDetailAction } from '../../../../ee/packages/workflows/src/actions/workflow-runtime-v2-actions';
import { projectWorkflowRuntimeV2StepCompletion, executeWorkflowRuntimeV2ActionStep, executeWorkflowRuntimeV2NodeStep, completeWorkflowRuntimeV2Run } from '../../../../ee/temporal-workflows/src/activities/workflow-runtime-v2-activities';

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


it.each(['new', 'reply', 'no-defaults', 'ack-failure', 'attachment-failure', 'resolution-failure'])('persists the shipped email workflow through Temporal and real activities: %s', async scenario => {
  const { Worker } = await import('@temporalio/worker');
  const { TestWorkflowEnvironment } = await import('@temporalio/testing');
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(__dirname, '../../../..');
  const definition = JSON.parse(readFileSync(path.join(root, 'shared/workflow/runtime/workflows/email-processing-workflow.v2.json'), 'utf8'));
  const f = await fixture();
  initializeWorkflowRuntimeV2();
  const ticketContext = { ticketDefaults: scenario === 'no-defaults' ? null : { board_id: 'board-email', status_id: 'status-email' },
    matchedClient: { contact_id: 'contact-email', client_id: 'client-email', name: 'Synthetic Contact', email: 'sender@example.invalid' },
    targetClientId: 'client-email', targetContactId: 'contact-email', targetAuthorUserId: null, targetLocationId: 'location-email' };
  const handlers: Record<string, ReturnType<typeof vi.spyOn>> = {};
  const outputs = {
    resolve_existing_ticket_from_email: { success: scenario === 'reply', ticket: scenario === 'reply' ? { ticketId: 'ticket-existing' } : null, source: scenario === 'reply' ? 'replyToken' : null },
    resolve_inbound_ticket_context: ticketContext,
    create_ticket_with_initial_comment: { ticket_id: 'ticket-new', ticket_number: 'T-1', comment_id: 'comment-new' },
    create_comment_from_parsed_email: { comment_id: 'comment-reply' },
    process_email_attachments_batch: { processed: 1, failed: 0 },
    send_ticket_acknowledgement_email: { success: true },
    create_human_task_for_email_processing_failure: { task_id: 'task-email' },
  };
  for (const [id, output] of Object.entries(outputs)) {
    handlers[id] = vi.spyOn(getActionRegistryV2().get(id, 1)!, 'handler').mockResolvedValue(output);
  }
  const failedAction = scenario === 'ack-failure' ? 'send_ticket_acknowledgement_email'
    : scenario === 'attachment-failure' ? 'process_email_attachments_batch'
    : scenario === 'resolution-failure' ? 'resolve_existing_ticket_from_email' : null;
  if (failedAction) handlers[failedAction].mockRejectedValue(new Error(`synthetic ${scenario}`));
  let environment: Awaited<ReturnType<typeof TestWorkflowEnvironment.createTimeSkipping>> | undefined;
  try {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `email-persistence-${randomUUID()}`;
    const payload = { tenantId: f.tenant, providerId: 'provider-email', emailData: { id: 'message-email', subject: 'Help with printer',
      from: { email: 'sender@example.invalid' }, body: { text: 'Please help with the printer.', html: '<p>Please help with the printer.</p>' },
      attachments: [{ id: 'attachment-email', name: 'example.txt', contentType: 'text/plain', size: 10 }] } };
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue,
      workflowsPath: path.join(root, 'ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts'),
      bundlerOptions: { webpackConfigHook: config => ({ ...config, resolve: { ...config.resolve,
        alias: { ...config.resolve?.alias, '@alga-psa/workflows': path.join(root, 'ee/packages/workflows/src') } } }) },
      activities: {
        loadWorkflowRuntimeV2PinnedDefinition: async () => ({ definition, initialScopes: {
          payload, workflow: {}, lexical: [], meta: {}, error: null,
          system: { runId: f.runId, tenantId: f.tenant, workflowId: definition.id, workflowVersion: definition.version, definitionHash: null, runtimeSemanticsVersion: null } } }),
        // Seed step starts without quota accounting; completions and all action/node
        // activity behavior use production persistence against the isolated schema.
        projectWorkflowRuntimeV2StepStart: async ({ runId, stepPath, definitionStepId }: any) => {
          const stepId = randomUUID();
          await state.trx!('workflow_run_steps').insert({ step_id: stepId, tenant: f.tenant, run_id: runId, step_path: stepPath,
            definition_step_id: definitionStepId, status: 'RUNNING' });
          return { stepId };
        },
        projectWorkflowRuntimeV2StepCompletion, executeWorkflowRuntimeV2NodeStep, executeWorkflowRuntimeV2ActionStep, completeWorkflowRuntimeV2Run,
      } });
    await worker.runUntil(() => environment!.client.workflow.execute('workflowRuntimeV2RunWorkflow', {
      taskQueue, workflowId: randomUUID(), workflowExecutionTimeout: '30s',
      args: [{ runId: f.runId, tenantId: f.tenant, workflowId: definition.id, workflowVersion: definition.version }],
    }));
    expect(await state.trx!('workflow_runs').where({ run_id: f.runId }).first()).toMatchObject({ status: 'SUCCEEDED' });
    const snapshots = await state.trx!('workflow_run_snapshots').where({ run_id: f.runId }).orderBy('created_at', 'desc');
    const final = snapshots[0].envelope_json;
    expect(final.payload).toEqual(payload);
    expect(Number.isNaN(Date.parse(final.vars.processedAt))).toBe(false);
    expect(final.vars.parsedEmail.metadata.parser).toBeDefined();
    const invocations = await state.trx!('workflow_action_invocations').where({ run_id: f.runId });
    expect(invocations.filter(row => row.status === 'FAILED').map(row => row.action_id)).toEqual(failedAction ? [failedAction] : []);
    if (scenario === 'no-defaults') {
      expect(final.meta.state).toBe('ERROR_NO_TICKET_DEFAULTS');
      expect(final.vars.createdTicket).toBeUndefined();
      expect(handlers.create_ticket_with_initial_comment).not.toHaveBeenCalled();
      expect(handlers.process_email_attachments_batch).not.toHaveBeenCalled();
      return;
    }
    if (scenario === 'resolution-failure') {
      expect(final.meta.state).toBe('AWAITING_MANUAL_RESOLUTION');
      expect(snapshots.some(row => row.envelope_json.meta?.state === 'ERROR_PROCESSING_EMAIL')).toBe(true);
      expect(handlers.create_human_task_for_email_processing_failure).toHaveBeenCalledWith(expect.objectContaining({
        contextData: expect.objectContaining({ emailId: payload.emailData.id, providerId: payload.providerId,
          senderEmail: payload.emailData.from.email, errorMessage: expect.stringContaining('synthetic resolution-failure') }),
      }), expect.anything());
      expect(handlers.create_ticket_with_initial_comment).not.toHaveBeenCalled();
      return;
    }
    expect(handlers.create_human_task_for_email_processing_failure).not.toHaveBeenCalled();
    const target = scenario === 'reply' ? 'ticket-existing' : 'ticket-new';
    expect(invocations.find(row => row.action_id === 'process_email_attachments_batch')?.idempotency_key)
      .toBe(`${f.tenant}:message-email:${target}:attachments`);
    if (scenario === 'reply') {
      expect(final.vars.ticketContext).toBeUndefined();
      expect(handlers.create_ticket_with_initial_comment).not.toHaveBeenCalled();
      expect(handlers.create_comment_from_parsed_email).toHaveBeenCalledWith(expect.objectContaining({
        author_type: 'contact', parsedEmail: expect.objectContaining({ metadata: final.vars.parsedEmail.metadata }),
      }), expect.anything());
      expect(invocations.find(row => row.action_id === 'create_comment_from_parsed_email')?.idempotency_key)
        .toBe(`${f.tenant}:message-email:ticket-existing`);
    } else {
      expect(final.meta.state).toBe('EMAIL_PROCESSED');
      expect(final.vars.ticketContext).toEqual(ticketContext);
      expect(handlers.resolve_inbound_ticket_context).toHaveBeenCalledWith({ tenantId: f.tenant, providerId: payload.providerId, senderEmail: payload.emailData.from.email }, expect.anything());
      expect(final.vars.createdTicket).toMatchObject({ ticket_id: 'ticket-new' });
      expect(handlers.create_ticket_with_initial_comment).toHaveBeenCalledWith(expect.objectContaining({
        ticketDefaults: ticketContext.ticketDefaults, targetLocationId: 'location-email', parsedEmail: final.vars.parsedEmail,
      }), expect.anything());
      expect(handlers.send_ticket_acknowledgement_email).toHaveBeenCalledOnce();
      expect(invocations.find(row => row.action_id === 'create_ticket_with_initial_comment')?.idempotency_key)
        .toBe(`${f.tenant}:provider-email:message-email`);
    }
  } finally {
    try { await environment?.teardown(); } finally { Object.values(handlers).forEach(handler => handler.mockRestore()); }
  }
}, 60_000);


it.each(['threadId', 'inReplyTo', 'references', 'unmatched-token'])('resolves email threading with real tenant-scoped queries: %s', async lookup => {
  const f = await fixture(), foreign = randomUUID(), ticketId = randomUUID();
  for (const table of ['tickets', 'statuses', 'email_reply_tokens']) {
    await state.trx!.raw('CREATE TABLE ?? (LIKE ?? INCLUDING ALL)', [table, `public.${table}`]);
  }
  await state.trx!('tickets').insert([
    { tenant: foreign, client_id: randomUUID(), ticket_id: randomUUID(), ticket_number: 'FOREIGN-1', title: 'Foreign thread', email_metadata: { threadId: 'shared-thread', messageId: 'shared-message@example.invalid' } },
    { tenant: f.tenant, client_id: randomUUID(), ticket_id: ticketId, ticket_number: 'OWN-1', title: 'Own thread', email_metadata: { threadId: 'shared-thread', messageId: 'shared-message@example.invalid' } },
    { tenant: foreign, client_id: randomUUID(), ticket_id: randomUUID(), ticket_number: 'FOREIGN-ONLY', title: 'Foreign only', email_metadata: { threadId: 'foreign-only' } },
  ]);
  const emailData = { id: 'incoming-message', subject: 'Re: Own thread', from: { email: 'sender@example.invalid' }, body: { text: 'Please help' },
    ...(lookup === 'threadId' ? { threadId: 'shared-thread' } : lookup === 'references' ? { references: ['<unknown@example.invalid>', '<shared-message@example.invalid>'] } : { inReplyTo: '<shared-message@example.invalid>' }) };
  const input = { ...f, tenantId: f.tenant,
    step: { type: 'action.call' as const, config: { actionId: 'resolve_existing_ticket_from_email', version: 1,
      inputMapping: { emailData, parsedEmail: { sanitizedText: 'Please help', metadata: { parser: { tokens: lookup === 'unmatched-token' ? { conversationToken: 'missing-token' } : null } } } } } },
    scopes: { payload: {}, workflow: {}, lexical: [], system: { runId: f.runId, workflowId: randomUUID(), workflowVersion: 1, tenantId: f.tenant, definitionHash: null, runtimeSemanticsVersion: null } } };
  const result = await executeWorkflowRuntimeV2ActionStep(input);
  expect(result.output).toMatchObject({ success: true, source: 'threadHeaders', ticket: { ticketId, ticketNumber: 'OWN-1', subject: 'Own thread' } });
  const invocation = await state.trx!('workflow_action_invocations').where({ run_id: f.runId }).first();
  expect(invocation).toMatchObject({ status: 'SUCCEEDED', output_json: result.output });
  const denied = await executeWorkflowRuntimeV2ActionStep({ ...input, stepPath: 'foreign-only', step: { ...input.step,
    config: { ...input.step.config, inputMapping: { emailData: { id: 'foreign-message', subject: 'Foreign only', from: emailData.from, body: emailData.body, threadId: 'foreign-only' } } } } });
  expect(denied.output).toEqual({ success: false, ticket: null, source: null });
});
