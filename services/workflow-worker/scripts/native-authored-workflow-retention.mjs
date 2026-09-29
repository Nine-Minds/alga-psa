#!/usr/bin/env node
// Fault scenario for the native harness only. Uses real supported event.wait;
// leaves its uniquely owned rows for that harness's private-database teardown.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkAuthoredWorkflow } from './check-authored-workflow.mjs';

const correlation = randomUUID();
let failure;
try {
  await checkAuthoredWorkflow({ completionTimeoutMs: 3000, steps: [
    { id: 'wait_for_unpublished_event', type: 'event.wait', config: {
      eventName: `ci.retention.${correlation}`, correlationKey: { $expr: '"never-published"' }, filters: [],
    } },
    { id: 'finish', type: 'control.return' },
  ] });
} catch (error) { failure = error; }
assert.ok(failure, 'Pending event workflow must fail the bounded completion check');
assert.match(failure.message, /Authored workflow did not complete within 3000ms/);
const scenario = failure.authoredScenario;
assert.equal(scenario?.fixtureCleanup, 'retained-on-failure');

const [{ getAdminConnection }, { Connection, Client }] = await Promise.all([
  import('@alga-psa/db/admin'), import('@temporalio/client'),
]);
const db = await getAdminConnection();
let connection;
try {
  connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE });
  const handle = client.workflow.getHandle(`workflow-runtime-v2:run:${scenario.runId}`);
  assert.equal((await handle.describe()).status.name, 'TERMINATED');
  assert.ok(await db('tenants').where({ tenant: scenario.tenant }).first());
  assert.ok(await db('workflow_definitions').where({ tenant: scenario.tenant, workflow_id: scenario.workflowId }).first());
  assert.ok(await db('workflow_runs').where({ tenant: scenario.tenant, run_id: scenario.runId }).first());
  const wait = await db('workflow_run_waits').where({ tenant: scenario.tenant, run_id: scenario.runId, wait_type: 'event', status: 'WAITING' }).first();
  assert.ok(wait, 'Real event wait projection must remain for diagnosis after termination');
  console.log(JSON.stringify({ scope: 'native-authored-failure-retention', status: 'passed', temporalStatus: 'TERMINATED',
    fixtureCleanup: scenario.fixtureCleanup, tenant: scenario.tenant, runId: scenario.runId, eventWaitRetained: true }));
} finally {
  try { await connection?.close(); }
  finally { await db.destroy(); }
}
