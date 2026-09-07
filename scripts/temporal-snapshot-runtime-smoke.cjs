const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const fs = require('node:fs');
const evidencePath = root + '/test-results/temporal-readiness/snapshot-runtime.json';
function report(status) {
  fs.mkdirSync(require('node:path').dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify({ status, workflow: 'workflowRuntimeV2RunWorkflow', realTemporalServer: true, realDatabase: false }) + '\n');
}
report('running');
const req = createRequire(root + '/ee/temporal-workflows/package.json');
const { TestWorkflowEnvironment } = req('@temporalio/testing');
const { Worker } = req('@temporalio/worker');
(async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const completions = [];
    const initialScopes = { payload: { secretRef: 'private', token: 'resolved' }, workflow: {}, lexical: [], meta: { redactions: ['/payload/token'] }, system: { runId: 'snapshot-run', workflowId: 'snapshot-workflow', workflowVersion: 1, tenantId: null, definitionHash: 'snapshot-test', runtimeSemanticsVersion: '2026-04-08.temporal-native.v1' } };
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: 'snapshot-runtime', workflowsPath: root + '/ee/temporal-workflows/dist/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.js', activities: {
      loadWorkflowRuntimeV2PinnedDefinition: async () => ({ definition: { id: 'snapshot-workflow', name: 'Snapshot runtime', version: 1, payloadSchemaRef: 'payload.test.v1', steps: [{ id: 'return', type: 'control.return' }] }, initialScopes }),
      projectWorkflowRuntimeV2StepStart: async () => ({ stepId: 'snapshot-step' }),
      projectWorkflowRuntimeV2StepCompletion: async input => { completions.push(input); },
      completeWorkflowRuntimeV2Run: async () => {},
    }});
    await worker.runUntil(async () => {
      const result = await env.client.workflow.execute('workflowRuntimeV2RunWorkflow', { taskQueue: 'snapshot-runtime', workflowId: 'snapshot-runtime-test', workflowExecutionTimeout: '30s', args: [{ runId: 'snapshot-run', tenantId: null, workflowId: 'snapshot-workflow', workflowVersion: 1, triggerType: null, executionKey: 'snapshot-execution' }] });
      assert.deepEqual(result.scopes.payload, initialScopes.payload);
      assert.equal(completions.length, 1);
      assert.equal(Object.hasOwn(completions[0], 'scopes'), false);
      assert.deepEqual(completions[0].snapshot.payload, { secretRef: '[REDACTED]', token: '[REDACTED]' });
      console.log('PASS: built Temporal workflow executed with redacted diagnostic activity payload and unchanged execution state');
    });
  } finally { await env.teardown(); }
  report('passed');
})().catch(error => { report('failed'); console.error(error); process.exitCode = 1; });
