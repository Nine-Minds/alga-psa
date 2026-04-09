#!/usr/bin/env node

import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, Client } from '@temporalio/client';
import knexModule from 'knex';

const authoredTaskQueue = 'workflow-runtime-v2';
const temporalNamespace = 'default';
const id = randomUUID().slice(0, 8);
const composeProject = `workflow-v2-smoke-${id}`;
const temporalHostPort = 17233;
const temporalUiHostPort = 18088;
const dbHostPort = 15432;
const redisHostPort = 16379;
const temporalAddress = `127.0.0.1:${temporalHostPort}`;

const composeFiles = [
  'docker-compose.base.yaml',
  'docker-compose.ee.yaml',
  'docker-compose.temporal.ee.yaml',
];

const composeEnv = {
  ...process.env,
  COMPOSE_PROJECT_NAME: composeProject,
  APP_NAME: process.env.APP_NAME || composeProject,
  PROJECT_NAME: process.env.PROJECT_NAME || composeProject,
  VERSION: process.env.VERSION || 'dev',
  HOST: process.env.HOST || 'localhost',
  DB_TYPE: process.env.DB_TYPE || 'postgres',
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
  LOG_IS_FORMAT_JSON: process.env.LOG_IS_FORMAT_JSON || 'false',
  LOG_IS_FULL_DETAILS: process.env.LOG_IS_FULL_DETAILS || 'false',
  LOG_ENABLED_FILE_LOGGING: process.env.LOG_ENABLED_FILE_LOGGING || 'false',
  LOG_ENABLED_EXTERNAL_LOGGING: process.env.LOG_ENABLED_EXTERNAL_LOGGING || 'false',
  LOG_DIR_PATH: process.env.LOG_DIR_PATH || '/tmp',
  LOG_EXTERNAL_HTTP_HOST: process.env.LOG_EXTERNAL_HTTP_HOST || 'localhost',
  LOG_EXTERNAL_HTTP_PORT: process.env.LOG_EXTERNAL_HTTP_PORT || '80',
  LOG_EXTERNAL_HTTP_PATH: process.env.LOG_EXTERNAL_HTTP_PATH || '/',
  LOG_EXTERNAL_HTTP_LEVEL: process.env.LOG_EXTERNAL_HTTP_LEVEL || 'info',
  LOG_EXTERNAL_HTTP_TOKEN: process.env.LOG_EXTERNAL_HTTP_TOKEN || 'local-token',
  VERIFY_EMAIL_ENABLED: process.env.VERIFY_EMAIL_ENABLED || 'false',
  EMAIL_ENABLE: process.env.EMAIL_ENABLE || 'false',
  EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@example.com',
  EMAIL_HOST: process.env.EMAIL_HOST || 'localhost',
  EMAIL_PORT: process.env.EMAIL_PORT || '587',
  EMAIL_USERNAME: process.env.EMAIL_USERNAME || 'noreply@example.com',
  SALT_BYTES: process.env.SALT_BYTES || '16',
  ITERATION: process.env.ITERATION || '10000',
  KEY_LENGTH: process.env.KEY_LENGTH || '64',
  ALGORITHM: process.env.ALGORITHM || 'sha512',
  TOKEN_EXPIRES: process.env.TOKEN_EXPIRES || '1d',
  EXPOSE_SERVER_PORT: process.env.EXPOSE_SERVER_PORT || '3000',
  EXPOSE_HOCUSPOCUS_PORT: process.env.EXPOSE_HOCUSPOCUS_PORT || '1234',
  HOCUSPOCUS_URL: process.env.HOCUSPOCUS_URL || 'ws://localhost:1234',
  HOCUSPOCUS_PORT: process.env.HOCUSPOCUS_PORT || '1234',
  DB_NAME_HOCUSPOCUS: process.env.DB_NAME_HOCUSPOCUS || 'server',
  DB_USER_HOCUSPOCUS: process.env.DB_USER_HOCUSPOCUS || 'app_user',
  DB_PASSWORD_HOCUSPOCUS: process.env.DB_PASSWORD_HOCUSPOCUS || 'postpass123',
  REDIS_HOST: process.env.REDIS_HOST || 'redis',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || 'postpass123',
  NEXTAUTH_SESSION_EXPIRES: process.env.NEXTAUTH_SESSION_EXPIRES || '86400',
  EXPOSE_TEMPORAL_PORT: String(temporalHostPort),
  EXPOSE_TEMPORAL_UI_PORT: String(temporalUiHostPort),
  EXPOSE_DB_PORT: String(dbHostPort),
  EXPOSE_REDIS_PORT: String(redisHostPort),
  TEMPORAL_ADDRESS: 'temporal-dev:7233',
  APPLICATION_URL: process.env.APPLICATION_URL || 'http://localhost:3000',
  NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000',
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'local-nextauth-secret',
  ALGA_AUTH_KEY: process.env.ALGA_AUTH_KEY || 'local-alga-auth-key',
};

const composeArgs = [
  'compose',
  ...composeFiles.flatMap((file) => ['-f', file]),
  '-p',
  composeProject,
];

function run(command, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    env: composeEnv,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });

  if (!allowFailure && result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(
      `Command failed (${command} ${args.join(' ')}): ${stderr || stdout || `exit code ${result.status}`}`,
    );
  }
  return result;
}

function compose(args, options) {
  return run('docker', [...composeArgs, ...args], options);
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await check()) return;
    } catch {
      // retry
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for ${label} (${timeoutMs}ms)`);
}

async function waitForTemporal() {
  await waitFor(async () => {
    const connection = await Connection.connect({ address: temporalAddress });
    await connection.close();
    return true;
  }, 120_000, 'Temporal frontend');
}

async function waitForAuthoredPoller() {
  await waitFor(async () => {
    const connection = await Connection.connect({ address: temporalAddress });
    try {
      const response = await connection.workflowService.describeTaskQueue({
        namespace: temporalNamespace,
        taskQueue: { name: authoredTaskQueue },
        taskQueueType: 1,
      });
      return (response.pollers ?? []).length > 0;
    } finally {
      await connection.close();
    }
  }, 180_000, `poller on ${authoredTaskQueue}`);
}

async function waitForTemporalUi() {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${temporalUiHostPort}`);
    return response.ok;
  }, 60_000, 'Temporal UI');
}

function readSecret(path, fallback) {
  if (fs.existsSync(path)) {
    const value = fs.readFileSync(path, 'utf8').trim();
    if (value) return value;
  }
  return fallback;
}

function createDefinition(workflowId) {
  return {
    id: workflowId,
    version: 1,
    name: 'Temporal Runtime V2 DB Projection Smoke',
    description: 'Ensures wait projection + resume updates remain correct',
    payloadSchemaRef: 'payload.SmokePayload.v1',
    trigger: null,
    steps: [
      {
        id: 'wait-1',
        type: 'event.wait',
        config: {
          eventName: 'PING',
          correlationKey: { $expr: 'payload.key' },
          timeoutMs: 60_000,
        },
      },
      {
        id: 'set-state',
        type: 'state.set',
        config: { state: 'done' },
      },
      {
        id: 'return-1',
        type: 'control.return',
      },
    ],
  };
}

async function runDbProjectionScenario() {
  const dbUser = process.env.DB_USER_SERVER || 'app_user';
  const dbPassword = readSecret('./secrets/db_password_server', 'postpass123');
  const db = createKnex({
    client: 'pg',
    connection: {
      host: '127.0.0.1',
      port: dbHostPort,
      user: dbUser,
      password: dbPassword,
      database: 'server',
    },
    asyncStackTraces: true,
    pool: { min: 0, max: 4 },
  });

  try {
    await waitFor(async () => {
      await db.raw('select 1');
      return true;
    }, 120_000, 'Postgres readiness');

    await waitFor(async () => {
      const exists = await db.schema.hasTable('workflow_runs');
      return exists;
    }, 120_000, 'workflow runtime tables');

    const workflowId = randomUUID();
    const runId = randomUUID();
    const tenantId = randomUUID();
    const definition = createDefinition(workflowId);
    const definitionHash = createHash('sha256').update(JSON.stringify(definition)).digest('hex');

    await db('workflow_definitions').insert({
      workflow_id: workflowId,
      name: definition.name,
      description: definition.description,
      payload_schema_ref: definition.payloadSchemaRef,
      draft_definition: definition,
      draft_version: 1,
      status: 'published',
      published_version: 1,
      payload_schema_mode: 'inferred',
      payload_schema_provenance: 'inferred',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db('workflow_definition_versions').insert({
      workflow_id: workflowId,
      version: 1,
      definition_json: definition,
      validation_status: 'valid',
      validation_errors: JSON.stringify([]),
      validation_warnings: JSON.stringify([]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db('workflow_runs').insert({
      run_id: runId,
      workflow_id: workflowId,
      workflow_version: 1,
      tenant_id: tenantId,
      status: 'RUNNING',
      trigger_type: 'event',
      trigger_fire_key: `smoke-fire-${id}`,
      event_type: 'PING',
      source_payload_schema_ref: definition.payloadSchemaRef,
      trigger_mapping_applied: false,
      engine: 'temporal',
      definition_hash: definitionHash,
      runtime_semantics_version: 'v2-temporal',
      root_run_id: runId,
      input_json: { key: 'smoke-key' },
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const connection = await Connection.connect({ address: temporalAddress });
    const client = new Client({ connection, namespace: temporalNamespace });
    try {
      const handle = await client.workflow.start('workflowRuntimeV2RunWorkflow', {
        workflowId: `workflow-runtime-v2:run:${runId}`,
        taskQueue: authoredTaskQueue,
        args: [{
          runId,
          tenantId,
          workflowId,
          workflowVersion: 1,
          triggerType: 'event',
          executionKey: `smoke-execution-${id}`,
        }],
        workflowExecutionTimeout: '2m',
        retry: { maximumAttempts: 1 },
      });

      const waitRow = await (async () => {
        let row = null;
        await waitFor(async () => {
          row = await db('workflow_run_waits')
            .where({ run_id: runId, wait_type: 'event', status: 'WAITING' })
            .first();
          return Boolean(row);
        }, 90_000, 'projected event wait row');
        return row;
      })();

      await handle.signal('workflowRuntimeV2Event', {
        eventId: randomUUID(),
        eventName: 'PING',
        correlationKey: 'smoke-key',
        payload: { accepted: true },
        receivedAt: new Date().toISOString(),
      });

      await Promise.race([
        handle.result(),
        (async () => {
          await delay(60_000);
          throw new Error('Timed out waiting for workflow completion');
        })(),
      ]);

      const runRecord = await db('workflow_runs').where({ run_id: runId }).first();
      const resolvedWait = await db('workflow_run_waits').where({ wait_id: waitRow.wait_id }).first();
      const stepCountRow = await db('workflow_run_steps')
        .where({ run_id: runId })
        .count('* as count')
        .first();
      const stepCount = Number(stepCountRow?.count ?? 0);

      if (!runRecord || runRecord.status !== 'SUCCEEDED') {
        throw new Error(`Expected run ${runId} to be SUCCEEDED; got ${JSON.stringify(runRecord)}`);
      }
      if (!resolvedWait || resolvedWait.status !== 'RESOLVED' || !resolvedWait.resolved_at) {
        throw new Error(`Expected wait ${waitRow.wait_id} to be RESOLVED; got ${JSON.stringify(resolvedWait)}`);
      }
      if (stepCount < 2) {
        throw new Error(`Expected projected workflow steps for run ${runId}; got count=${stepCount}`);
      }
    } finally {
      await connection.close();
    }
  } finally {
    await db.destroy().catch(() => undefined);
  }
}

function printServiceLogs(service) {
  const containerId = compose(['ps', '-q', service], { capture: true, allowFailure: true }).stdout?.trim();
  if (!containerId) return;
  run('docker', ['logs', '--tail', '200', containerId], { allowFailure: true });
}

async function main() {
  console.log('=== Workflow Runtime V2 compose smoke ===');
  console.log(`Compose project: ${composeProject}`);

  try {
    run('docker', ['volume', 'create', `${composeProject}_ngrok_data`], { capture: true });

    // Run setup first so DB schema + users are available before worker startup.
    compose(['up', '-d', '--build', 'setup']);
    compose(['up', '-d', '--build', 'temporal-dev', 'temporal-ui', 'workflow-worker']);

    await waitForTemporal();
    await waitForTemporalUi();
    await waitForAuthoredPoller();
    await runDbProjectionScenario();
    console.log('\nWorkflow Runtime V2 compose smoke passed.');
  } catch (error) {
    console.error('\nWorkflow Runtime V2 compose smoke failed.\n');
    console.error(error instanceof Error ? error.message : error);
    console.error('\n=== setup logs ===');
    printServiceLogs('setup');
    console.error('\n=== workflow-worker logs ===');
    printServiceLogs('workflow-worker');
    console.error('\n=== temporal-dev logs ===');
    printServiceLogs('temporal-dev');
    throw error;
  } finally {
    compose(['down', '-v'], { allowFailure: true });
    run('docker', ['volume', 'rm', `${composeProject}_ngrok_data`], {
      allowFailure: true,
      capture: true,
    });
  }
}

main().catch(() => process.exit(1));
const { knex: createKnex } = knexModule;
