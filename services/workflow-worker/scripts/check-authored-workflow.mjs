#!/usr/bin/env node
// Run inside the existing workflow-worker candidate. This scenario creates only
// uniquely identified fixture rows; it never starts infrastructure or drops DBs.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function checkAuthoredWorkflow() {
  assert.equal(process.env.AUTHORED_WORKFLOW_CI_OWNED, 'true', 'Explicit CI-owned database authorization required');
  const expectedHost = process.env.AUTHORED_WORKFLOW_EXPECTED_DB_HOST;
  const expectedDatabase = process.env.AUTHORED_WORKFLOW_EXPECTED_DB_NAME;
  assert.ok(expectedHost && expectedDatabase, 'Expected isolated database host/name required');
  assert.equal(process.env.DB_HOST_ADMIN || process.env.DB_HOST, expectedHost, 'Database host differs from authorized CI stack');
  assert.equal(process.env.DB_NAME_SERVER, expectedDatabase, 'Database name differs from authorized CI stack');
  assert.ok(process.env.TEMPORAL_ADDRESS && process.env.TEMPORAL_NAMESPACE, 'Explicit Temporal address/namespace required');
  const port = Number(process.env.PORT || 4000);
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid worker health port');
  const readiness = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  assert.equal(readiness.status, 200, 'Actual worker must be ready before execution');
  const ready = await readiness.json();
  assert.equal(ready.ready, true);
  for (const name of ['temporal', 'eventStream', 'dataStoreSweep']) assert.equal(ready.workers[name], true);

  const [{ getAdminConnection }, core, { default: Definitions }, { default: Versions }, { default: Runs }, dispatcher, temporal] = await Promise.all([
    import('@alga-psa/db/admin'), import('@alga-psa/workflows/runtime/core'),
    import('@alga-psa/workflows/persistence/workflowDefinitionModelV2'),
    import('@alga-psa/workflows/persistence/workflowDefinitionVersionModelV2'),
    import('@alga-psa/workflows/persistence/workflowRunModelV2'),
    import('@alga-psa/workflows/lib/workflowRuntimeV2Temporal'), import('@temporalio/client'),
  ]);
  const db = await getAdminConnection();
  const tenant = randomUUID(), workflowId = randomUUID(), runId = randomUUID();
  let tenantCreated = false, executionCompleted = false, handle, connection;
  const result = { scope: 'candidate-authored-workflow-execution', status: 'failed', tenant, workflowId, runId };
  try {
    const identity = await db.raw('SELECT current_database() AS database');
    assert.equal(identity.rows[0].database, expectedDatabase, 'Connected database differs from authorized CI stack');
    core.initializeWorkflowRuntimeV2();
    const definition = core.workflowDefinitionSchema.parse({ id: workflowId, name: 'CI authored execution', version: 1,
      payloadSchemaRef: 'payload.ci-authored-proof.v1', steps: [
        { id: 'mark_ready', type: 'state.set', config: { state: 'native-ready' } },
        { id: 'finish', type: 'control.return' },
      ] });
    const node = core.getNodeTypeRegistry().get('state.set');
    assert.ok(node, 'Production registry must contain state.set');
    node.configSchema.parse(definition.steps[0].config);
    await db('tenants').insert({ tenant, client_name: 'CI authored workflow proof', email: `${tenant}@example.test` });
    tenantCreated = true;
    await Definitions.create(db, tenant, { workflow_id: workflowId, name: definition.name, payload_schema_ref: definition.payloadSchemaRef,
      draft_definition: definition, draft_version: 1, status: 'published' });
    const version = await Versions.create(db, { workflow_id: workflowId, tenant, version: 1, definition_json: definition });
    await Runs.create(db, { run_id: runId, workflow_id: workflowId, workflow_version: 1, tenant, status: 'RUNNING', engine: 'temporal',
      definition_hash: createHash('sha256').update(JSON.stringify(version.definition_json)).digest('hex'), input_json: {} });
    // Obtain an owned handle before dispatch, so even an uncertain start reply
    // cannot leave this scenario's execution running during fixture cleanup.
    connection = await temporal.Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
    const client = new temporal.Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE });
    handle = client.workflow.getHandle(`workflow-runtime-v2:run:${runId}`);
    const dispatched = await dispatcher.startWorkflowRuntimeV2TemporalRun({ runId, tenantId: tenant, workflowId, workflowVersion: 1, triggerType: null, executionKey: runId });
    assert.equal(dispatched.workflowId, handle.workflowId);
    let completed = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const description = await handle.describe();
      if (description.status.name !== 'RUNNING') { assert.equal(description.status.name, 'COMPLETED'); completed = true; executionCompleted = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(completed, 'Authored workflow did not complete within 30 seconds');
    await handle.result();
    const run = await db('workflow_runs').where({ tenant, run_id: runId }).first();
    assert.equal(run.status, 'SUCCEEDED');
    assert.ok(run.completed_at);
    const steps = await db('workflow_run_steps').where({ tenant, run_id: runId });
    assert.deepEqual(steps.map(step => step.definition_step_id).sort(), ['finish', 'mark_ready']);
    for (const step of steps) assert.equal(step.status, 'SUCCEEDED');
    const stateStep = steps.find(step => step.definition_step_id === 'mark_ready');
    const snapshot = await db('workflow_run_snapshots').where({ tenant, run_id: runId, snapshot_id: stateStep.snapshot_id }).first();
    assert.equal(snapshot?.envelope_json?.meta?.state, 'native-ready');
    result.execution = { temporalStatus: 'COMPLETED', runStatus: 'SUCCEEDED', steps: steps.map(step => ({ id: step.definition_step_id, status: step.status })), state: 'native-ready' };
    result.status = 'passed';
  } catch (error) {
    error.authoredScenario = result;
    throw error;
  } finally {
    if (tenantCreated && !executionCompleted) result.fixtureCleanup = 'retained-on-failure';
    try {
      if (handle) {
        try {
          const description = await handle.describe();
          if (description.status.name === 'COMPLETED') executionCompleted = true;
          if (description.status.name === 'RUNNING') {
            await handle.terminate('CI authored scenario cleanup');
            assert.notEqual((await handle.describe()).status.name, 'RUNNING');
          }
        } catch (error) {
          if (error.name !== 'WorkflowNotFoundError') throw error;
        }
      }
      // Termination stops orchestration, not necessarily the underlying activity
      // JavaScript. Only a completed workflow permits immediate scoped cleanup;
      // failed/terminated fixture rows remain for the owned job's teardown.
      if (tenantCreated && executionCompleted) {
        await db.transaction(async trx => {
          for (const table of ['workflow_run_logs', 'workflow_action_invocations', 'workflow_run_waits', 'workflow_run_steps', 'workflow_run_snapshots']) {
            await trx(table).where({ tenant, run_id: runId }).delete();
          }
          await trx('workflow_runs').where({ tenant, run_id: runId }).delete();
          await trx('workflow_definition_versions').where({ tenant, workflow_id: workflowId }).delete();
          await trx('workflow_definitions').where({ tenant, workflow_id: workflowId }).delete();
          await trx('workflow_step_usage_periods').where({ tenant }).delete();
          await trx('tenants').where({ tenant }).delete();
        });
        assert.equal(await db('tenants').where({ tenant }).first(), undefined);
        assert.equal(await db('workflow_runs').where({ tenant, run_id: runId }).first(), undefined);
        result.fixtureCleanup = 'passed';
      }
    } finally {
      try { await connection?.close(); }
      finally { await db.destroy(); }
    }
  }
  return result;
}

if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkAuthoredWorkflow())); }
  catch (error) {
    const diagnostic = path.join(os.tmpdir(), `authored-workflow-failure-${randomUUID()}.json`);
    try {
      await writeFile(diagnostic, JSON.stringify({ error: { name: error.name, message: error.message }, scenario: error.authoredScenario }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      console.error(`Authored workflow execution check failed; private diagnostic: ${diagnostic}`);
    } catch { console.error('Authored workflow execution check failed; private diagnostic unavailable'); }
    process.exitCode = 1;
  }
}
