#!/usr/bin/env node
// Native execution proof, not an image-build test. Prerequisites: built worker,
// Temporal and workflow packages, installed dependencies, local PostgreSQL and
// redis-server. Supply NATIVE_WORKFLOW_ENV_FILE with DB_HOST/DB_PORT and admin
// credentials. NATIVE_WORKFLOW_DB_HOST/PORT can override container addresses;
// NATIVE_TEMPORAL_CLI must name an installed CLI (never downloaded here).
// Every run creates and drops its own database and local services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const { Client } = require('pg');
const knex = require('knex');
const { TestWorkflowEnvironment } = require('@temporalio/testing');
assert.ok(process.env.NATIVE_TEMPORAL_CLI, 'NATIVE_TEMPORAL_CLI must name an installed Temporal executable (no downloads)');
const configurationFile = process.env.NATIVE_WORKFLOW_ENV_FILE;
assert.ok(configurationFile, 'NATIVE_WORKFLOW_ENV_FILE must name a private local database configuration');
const configuration = require('dotenv').parse(fs.readFileSync(configurationFile));
const host = process.env.NATIVE_WORKFLOW_DB_HOST || configuration.DB_HOST_ADMIN || configuration.DB_HOST || '127.0.0.1';
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'This harness only uses local PostgreSQL');
const port = Number(process.env.NATIVE_WORKFLOW_DB_PORT || configuration.DB_PORT_ADMIN || configuration.DB_PORT);
assert.ok(Number.isInteger(port) && port > 0, 'Explicit PostgreSQL port required');
assert.ok(configuration.DB_USER_ADMIN && configuration.DB_PASSWORD_ADMIN, 'Explicit admin credentials required');
const connection = { host, port, user: configuration.DB_USER_ADMIN, password: configuration.DB_PASSWORD_ADMIN };
const databaseName = `authored_worker_test_${randomUUID().replaceAll('-', '')}`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'authored-worker-proof-'));
const admin = new Client({ ...connection, database: 'postgres' });
const workerEntry = path.join(root, 'services/workflow-worker/dist/services/workflow-worker/src/index.js');
const workflowPackage = path.join(root, 'ee/packages/workflows/dist');
const load = relative => import(pathToFileURL(path.join(workflowPackage, relative)).href);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let databaseCreated = false, db, redis, worker, temporal;
const originalTemporalAddress = process.env.TEMPORAL_ADDRESS;
const originalTemporalNamespace = process.env.TEMPORAL_NAMESPACE;
const evidence = { schemaVersion: 1, scope: 'native-compiled-authored-workflow', status: 'failed',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  databaseName, nodeVersion: process.version, harnessSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), shutdown: {},
  limitations: ['Reuses installed dependencies and existing compiled artifacts; no Docker or clean build proof.',
    'Runs one authored state node with real persistence; no provider actions or Redis event dispatch are exercised.'] };
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const selected = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return selected;
}
function start(command, args, options, name) {
  const log = fs.openSync(path.join(temporary, `${name}.log`), 'w', 0o600);
  const child = spawn(command, args, { ...options, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  child.completion = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', error => resolve({ error: error.message }));
  });
  return child;
}
async function stop(child, name) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    evidence.shutdown[name] = await child.completion;
    return;
  }
  child.kill('SIGTERM');
  let timer;
  const result = await Promise.race([child.completion, new Promise(resolve => { timer = setTimeout(() => resolve(null), 10_000); })]);
  clearTimeout(timer);
  if (!result) { child.kill('SIGKILL'); evidence.shutdown[name] = { ...await child.completion, forced: true }; }
  else evidence.shutdown[name] = result;
}
try {
  for (const file of [workerEntry, path.join(root, 'ee/temporal-workflows/dist/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.js')]) {
    assert.ok(fs.existsSync(file), `Build prerequisite missing: ${path.relative(root, file)}`);
  }
  const core = await load('runtime/core.mjs');
  core.initializeWorkflowRuntimeV2();
  const workflowId = randomUUID(), runId = randomUUID(), tenant = randomUUID();
  const definition = core.workflowDefinitionSchema.parse({ id: workflowId, name: 'Native authored execution', version: 1,
    payloadSchemaRef: 'payload.native-proof.v1', steps: [
      { id: 'mark_ready', type: 'state.set', config: { state: 'native-ready' } },
      { id: 'finish', type: 'control.return' },
    ] });
  const nodeType = core.getNodeTypeRegistry().get('state.set');
  assert.ok(nodeType, 'Real runtime must register state.set');
  nodeType.configSchema.parse(definition.steps[0].config);
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  const migrationDirectory = path.join(temporary, 'server/migrations');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'));
  fs.cpSync(path.join(root, 'server/migrations'), migrationDirectory, { recursive: true });
  fs.cpSync(path.join(root, 'ee/server/migrations'), migrationDirectory, { recursive: true, force: true });
  for (const directory of ['src', 'seeds']) fs.symlinkSync(path.join(root, 'server', directory), path.join(temporary, 'server', directory));
  db = knex({ client: 'pg', connection: { ...connection, database: databaseName },
    migrations: { directory: migrationDirectory, loadExtensions: ['.cjs', '.js'] } });
  await db.raw('CREATE TABLE public.pg_dist_partition (logicalrelid regclass)');
  await db.migrate.latest();
  const { default: Definitions } = await load('persistence/workflowDefinitionModelV2.mjs');
  const { default: Versions } = await load('persistence/workflowDefinitionVersionModelV2.mjs');
  const { default: Runs } = await load('persistence/workflowRunModelV2.mjs');
  await db('tenants').insert({ tenant, client_name: 'Native workflow proof', email: `${tenant}@example.test` });
  await Definitions.create(db, tenant, { workflow_id: workflowId, name: definition.name, payload_schema_ref: definition.payloadSchemaRef,
    draft_definition: definition, draft_version: 1, status: 'published' });
  const pinnedVersion = await Versions.create(db, { workflow_id: workflowId, tenant, version: 1, definition_json: definition });
  await Runs.create(db, { run_id: runId, workflow_id: workflowId, workflow_version: 1, tenant, status: 'RUNNING', engine: 'temporal',
    definition_hash: createHash('sha256').update(JSON.stringify(pinnedVersion.definition_json)).digest('hex'), input_json: {} });
  const redisPort = await freePort(), healthPort = await freePort();
  redis = start(process.env.NATIVE_REDIS_SERVER || 'redis-server', ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no'], {}, 'redis');
  temporal = await TestWorkflowEnvironment.createLocal({ server: { executable: { type: 'existing-path', path: process.env.NATIVE_TEMPORAL_CLI } } });
  const env = { PATH: process.env.PATH, HOME: temporary, NODE_ENV: 'production', APP_ENV: 'production', PORT: String(healthPort),
    DB_HOST: host, DB_HOST_ADMIN: host, DB_PORT: String(port), DB_PORT_ADMIN: String(port), DB_NAME_SERVER: databaseName,
    DB_USER_ADMIN: connection.user, DB_PASSWORD_ADMIN: connection.password, DB_USER_SERVER: connection.user, DB_PASSWORD_SERVER: connection.password,
    DB_TYPE: 'postgres', REDIS_HOST: '127.0.0.1', REDIS_PORT: String(redisPort), REDIS_PASSWORD: '',
    TEMPORAL_ADDRESS: temporal.address, TEMPORAL_NAMESPACE: temporal.namespace || 'default', WORKFLOW_RUNTIME_V2_TEMPORAL_USE_SOURCE_PATHS: 'false',
    SECRET_FS_BASE_PATH: path.join(temporary, 'secrets'), STORAGE_LOCAL_BASE_PATH: path.join(temporary, 'files'),
    NEXTAUTH_SECRET: randomBytes(32).toString('hex'), EMAIL_PROVIDER: 'mock', LOG_LEVEL: 'info' };
  worker = start(process.execPath, [workerEntry], { cwd: path.join(root, 'services/workflow-worker'), env }, 'worker');
  for (let attempt = 0; attempt < 90; attempt++) {
    assert.equal(worker.exitCode, null, 'Compiled worker exited before readiness; see private worker.log');
    try {
      const response = await fetch(`http://127.0.0.1:${healthPort}/readyz`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) { evidence.readiness = await response.json(); break; }
    } catch {}
    await delay(500);
  }
  assert.ok(evidence.readiness?.ready, 'Compiled worker did not become ready');
  for (const name of ['temporal', 'eventStream', 'dataStoreSweep']) assert.equal(evidence.readiness.workers[name], true);
  process.env.TEMPORAL_ADDRESS = temporal.address;
  process.env.TEMPORAL_NAMESPACE = temporal.namespace || 'default';
  const { startWorkflowRuntimeV2TemporalRun } = await load('lib/workflowRuntimeV2Temporal.mjs');
  const dispatched = await startWorkflowRuntimeV2TemporalRun({ runId, tenantId: tenant, workflowId, workflowVersion: 1, triggerType: null, executionKey: runId });
  assert.equal(dispatched.workflowId, `workflow-runtime-v2:run:${runId}`);
  evidence.dispatch = dispatched;
  const handle = temporal.client.workflow.getHandle(dispatched.workflowId, dispatched.firstExecutionRunId ?? undefined);
  let completed = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const description = await handle.describe();
    if (description.status.name !== 'RUNNING') { assert.equal(description.status.name, 'COMPLETED'); completed = true; break; }
    await delay(250);
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
  assert.ok(stateStep, 'Real state node step must be persisted');
  assert.equal(stateStep.status, 'SUCCEEDED');
  const snapshot = await db('workflow_run_snapshots').where({ tenant, run_id: runId, snapshot_id: stateStep.snapshot_id }).first();
  assert.equal(snapshot?.envelope_json?.meta?.state, 'native-ready');
  evidence.execution = { temporalStatus: 'COMPLETED', runStatus: run.status, persistedSteps: steps.map(step => ({ definitionStepId: step.definition_step_id, status: step.status })), state: snapshot.envelope_json.meta.state };
  const scenario = start(process.execPath, [path.join(root, 'services/workflow-worker/scripts/check-authored-workflow.mjs')], {
    cwd: path.join(root, 'services/workflow-worker'), env: { ...env, AUTHORED_WORKFLOW_CI_OWNED: 'true',
      AUTHORED_WORKFLOW_EXPECTED_DB_HOST: host, AUTHORED_WORKFLOW_EXPECTED_DB_NAME: databaseName },
  }, 'candidate-scenario');
  const scenarioExit = await scenario.completion;
  assert.equal(scenarioExit.code, 0, 'Candidate scenario helper failed; see private candidate-scenario.log');
  assert.ok(await db('tenants').where({ tenant }).first(), 'Scenario cleanup must preserve the unrelated native fixture tenant');
  assert.equal((await db('tenants').count('* as count').first()).count, '1', 'Scenario must leave only the unrelated native fixture tenant');
  evidence.candidateScenario = { status: 'passed', unrelatedFixturePreserved: true, noAdditionalTenantRemains: true };
  evidence.status = 'passed';
  console.log('Actual authored workflow execution passed');
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  const cleanup = async (name, action) => {
    try { await action(); }
    catch (error) { cleanupErrors.push({ resource: name, message: error.message }); }
  };
  await cleanup('worker', () => stop(worker, 'worker'));
  await cleanup('redis', () => stop(redis, 'redis'));
  await cleanup('temporal', async () => { if (temporal) await temporal.teardown(); });
  await cleanup('database connection', async () => { await db?.destroy(); });
  await cleanup('owned database', async () => {
    if (databaseCreated) {
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      evidence.databaseDropped = true;
    }
  });
  await cleanup('admin connection', () => admin.end());
  if (cleanupErrors.length) {
    evidence.cleanupErrors = cleanupErrors;
    evidence.status = 'failed';
    process.exitCode = 1;
  }
  for (const [name, value] of [['TEMPORAL_ADDRESS', originalTemporalAddress], ['TEMPORAL_NAMESPACE', originalTemporalNamespace]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  // Keep private logs and concise evidence for review; remove migration copies.
  fs.rmSync(path.join(temporary, 'server'), { recursive: true, force: true });
  fs.rmSync(path.join(temporary, 'node_modules'), { force: true });
  fs.writeFileSync(path.join(temporary, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(`Evidence and private logs: ${temporary}`);
  if (evidence.failure) console.error(evidence.failure);
}
