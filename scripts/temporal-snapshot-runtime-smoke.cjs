const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const evidencePath = path.join(root, 'test-results/temporal-readiness/snapshot-runtime.json');
function report(status) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify({ status, workflow: 'workflowRuntimeV2RunWorkflow',
    realTemporalServer: true, realDatabase: false, cases: ['redaction', 'oversized', 'metadata'], replay: 'same-build histories' }) + '\n');
}
report('running');
const req = createRequire(path.join(root, 'ee/temporal-workflows/package.json'));
const { TestWorkflowEnvironment } = req('@temporalio/testing');
const { Worker } = req('@temporalio/worker');
const workflowsPath = path.join(root, 'ee/temporal-workflows/dist/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.js');
(async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const completions = [];
    const histories = [];
    const scopeFor = (runId) => ({
      payload: runId === 'oversized' ? { big: '💡'.repeat(100000) } : { secretRef: 'private', token: 'resolved' },
      workflow: {}, lexical: [], meta: { redactions: ['/payload/token'] },
      system: { runId, workflowId: 'snapshot-workflow', workflowVersion: 1, tenantId: null,
        definitionHash: 'snapshot-test', runtimeSemanticsVersion: '2026-04-08.temporal-native.v1' },
    });
    const actionOutput = { secretRef: 'action-private', public: 'action output' };
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: 'snapshot-runtime', workflowsPath, activities: {
      loadWorkflowRuntimeV2PinnedDefinition: async ({ runId }) => ({
        definition: { id: 'snapshot-workflow', name: 'Snapshot runtime', version: 1, payloadSchemaRef: 'payload.test.v1', steps: [
          { id: 'action', type: 'action.call', config: { actionId: 'test.output', version: 1, saveAs: 'vars.output' } },
          { id: 'return', type: 'control.return' },
        ] }, initialScopes: scopeFor(runId),
      }),
      projectWorkflowRuntimeV2StepStart: async ({ stepPath }) => ({ stepId: stepPath }),
      executeWorkflowRuntimeV2ActionStep: async ({ runId }) => ({ output: actionOutput, saveAsPath: runId === 'metadata' ? 'meta.output' : 'vars.output' }),
      projectWorkflowRuntimeV2StepCompletion: async input => { completions.push(input); },
      completeWorkflowRuntimeV2Run: async () => {},
    }});
    await worker.runUntil(async () => {
      for (const runId of ['redaction', 'oversized', 'metadata']) {
        const handle = await env.client.workflow.start('workflowRuntimeV2RunWorkflow', {
          taskQueue: 'snapshot-runtime', workflowId: `snapshot-runtime-${runId}`, workflowExecutionTimeout: '30s',
          args: [{ runId, tenantId: null, workflowId: 'snapshot-workflow', workflowVersion: 1, triggerType: null, executionKey: runId }],
        });
        const result = await handle.result();
        assert.deepEqual(result.scopes.payload, scopeFor(runId).payload);
        assert.deepEqual(runId === 'metadata' ? result.scopes.meta.output : result.scopes.workflow.output, actionOutput);
        assert.deepEqual(result.scopes.meta.redactions, ['/payload/token']);
        const records = completions.filter(record => record.runId === runId);
        assert.equal(records.length, 2);
        for (const record of records) {
          assert.equal(Object.hasOwn(record, 'scopes'), false);
          assert.ok(Buffer.byteLength(JSON.stringify(record.snapshot)) <= 256 * 1024);
          if (runId !== 'oversized') {
            assert.deepEqual(record.snapshot.payload, { secretRef: '[REDACTED]', token: '[REDACTED]' });
            assert.deepEqual(runId === 'metadata' ? record.snapshot.meta.output : record.snapshot.vars.output, { secretRef: '[REDACTED]', public: 'action output' });
          } else {
            assert.equal(record.snapshot.truncated, true);
            assert.ok(record.snapshot.size > 256 * 1024);
          }
        }
        histories.push({ id: handle.workflowId, history: await handle.fetchHistory() });
      }
    });
    for (const { id, history } of histories) await Worker.runReplayHistory({ workflowsPath }, history, id);
    console.log('PASS: action and return snapshots redact or truncate without altering execution; all histories replay');
  } finally { await env.teardown(); }
  report('passed');
})().catch(error => { report('failed'); console.error(error); process.exitCode = 1; });
