#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, Connection } from '@temporalio/client';

const id = randomUUID().slice(0, 8);
const imageTag = `temporal-worker-readiness:${id}`;
const networkName = `temporal-readiness-${id}`;
const postgresContainer = `temporal-readiness-pg-${id}`;
const temporalContainer = `temporal-readiness-temporal-${id}`;
const workerContainer = `temporal-readiness-worker-${id}`;
const temporalHostPort = 17233;
const temporalAddress = `127.0.0.1:${temporalHostPort}`;
const taskQueue = 'alga-jobs';

function run(cmd, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, {
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (!allowFailure && result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(
      `Command failed (${cmd} ${args.join(' ')}):\n${stderr || stdout || `exit code ${result.status}`}`
    );
  }
  return result;
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ok = await check();
      if (ok) return;
    } catch {
      // retry
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${label} (${timeoutMs}ms)`);
}

async function waitForTemporal(address) {
  await waitFor(
    async () => {
      const connection = await Connection.connect({ address });
      await connection.close();
      return true;
    },
    150_000,
    `Temporal at ${address}`
  );
}

async function waitForPoller(address, namespace, queue) {
  await waitFor(
    async () => {
      const connection = await Connection.connect({ address });
      try {
        const response = await connection.workflowService.describeTaskQueue({
          namespace,
          taskQueue: { name: queue },
          taskQueueType: 1,
        });
        const pollers = response.pollers ?? [];
        return pollers.length > 0;
      } finally {
        await connection.close();
      }
    },
    120_000,
    `worker poller on queue ${queue}`
  );
}

async function runRoundtripWorkflow(address, namespace, queue) {
  const connection = await Connection.connect({ address });
  try {
    const client = new Client({ connection, namespace });
    const workflowId = `readiness-${Date.now()}`;
    const handle = await client.workflow.start('readinessWorkflow', {
      workflowId,
      taskQueue: queue,
      args: [{ echo: 'docker-parity' }],
      workflowExecutionTimeout: '30s',
      retry: { maximumAttempts: 1 },
    });

    const result = await Promise.race([
      handle.result(),
      (async () => {
        await delay(20_000);
        throw new Error('Timed out waiting for readiness workflow result');
      })(),
    ]);

    if (!result || result.ok !== true || result.echo !== 'docker-parity') {
      throw new Error(`Unexpected readiness workflow result: ${JSON.stringify(result)}`);
    }
  } finally {
    await connection.close();
  }
}

function cleanup() {
  run('docker', ['rm', '-f', workerContainer], { capture: true, allowFailure: true });
  run('docker', ['rm', '-f', temporalContainer], { capture: true, allowFailure: true });
  run('docker', ['rm', '-f', postgresContainer], { capture: true, allowFailure: true });
  run('docker', ['network', 'rm', networkName], { capture: true, allowFailure: true });
}

async function main() {
  console.log('=== Temporal worker Docker parity check ===');
  console.log(`ID: ${id}`);
  cleanup();

  try {
    console.log('\n[1/7] Build temporal worker dist locally...');
    run('npm', ['--prefix', 'ee/temporal-workflows', 'run', 'build']);

    console.log('\n[2/7] Build worker image...');
    run('docker', [
      'build',
      '--target',
      'production-prebuilt',
      '-f',
      'ee/temporal-workflows/Dockerfile',
      '-t',
      imageTag,
      '.',
    ]);

    console.log('\n[3/7] Create isolated Docker network...');
    run('docker', ['network', 'create', networkName]);

    console.log('\n[4/7] Start Postgres for worker startup validation...');
    run('docker', [
      'run',
      '-d',
      '--name',
      postgresContainer,
      '--network',
      networkName,
      '-e',
      'POSTGRES_USER=app_user',
      '-e',
      'POSTGRES_PASSWORD=postpass123',
      '-e',
      'POSTGRES_DB=server',
      'postgres:16-alpine',
    ]);

    await waitFor(
      async () => {
        const result = run(
          'docker',
          ['exec', postgresContainer, 'pg_isready', '-U', 'app_user', '-d', 'server'],
          { capture: true, allowFailure: true }
        );
        return result.status === 0;
      },
      60_000,
      'Postgres readiness'
    );

    console.log('\n[5/7] Start Temporal server...');
    run('docker', [
      'run',
      '-d',
      '--name',
      temporalContainer,
      '--network',
      networkName,
      '-p',
      `${temporalHostPort}:7233`,
      '-e',
      'DB=postgres12',
      '-e',
      'DB_PORT=5432',
      '-e',
      'POSTGRES_USER=app_user',
      '-e',
      'POSTGRES_PWD=postpass123',
      '-e',
      `POSTGRES_SEEDS=${postgresContainer}`,
      'temporalio/auto-setup:1.24.2',
    ]);

    await waitForTemporal(temporalAddress);

    console.log('\n[6/7] Start worker container...');
    run('docker', [
      'run',
      '-d',
      '--name',
      workerContainer,
      '--network',
      networkName,
      '-e',
      'LOG_LEVEL=info',
      '-e',
      'SECRET_READ_CHAIN=env',
      '-e',
      'SECRET_WRITE_PROVIDER=env',
      '-e',
      'ALGA_AUTH_KEY=test-auth-key',
      '-e',
      'NEXTAUTH_SECRET=test-nextauth-secret',
      '-e',
      'APPLICATION_URL=http://localhost:3000',
      '-e',
      'DB_HOST=' + postgresContainer,
      '-e',
      'DB_PORT=5432',
      '-e',
      'DB_NAME_SERVER=server',
      '-e',
      'DB_USER_SERVER=app_user',
      '-e',
      'DB_PASSWORD_SERVER=postpass123',
      '-e',
      'DB_USER_ADMIN=app_user',
      '-e',
      'DB_PASSWORD_ADMIN=postpass123',
      '-e',
      'TEMPORAL_ADDRESS=' + temporalContainer + ':7233',
      '-e',
      'TEMPORAL_NAMESPACE=default',
      '-e',
      'TEMPORAL_TASK_QUEUE=' + taskQueue,
      '-e',
      'TEMPORAL_TASK_QUEUES=' + taskQueue,
      '-e',
      'PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE=msp/alga-psa-vs',
      '-e',
      'ENABLE_HEALTH_CHECK=false',
      imageTag,
    ]);

    await waitForPoller(temporalAddress, 'default', taskQueue);

    console.log('\n[7/7] Run readiness workflow roundtrip...');
    await runRoundtripWorkflow(temporalAddress, 'default', taskQueue);

    console.log('\nTemporal worker Docker parity check passed.');
  } catch (error) {
    console.error('\nTemporal worker Docker parity check failed.\n');
    console.error(error instanceof Error ? error.message : error);
    console.error('\nTemporal logs:');
    run('docker', ['logs', '--tail', '200', temporalContainer], { allowFailure: true });
    console.error('\nPostgres logs:');
    run('docker', ['logs', '--tail', '200', postgresContainer], { allowFailure: true });
    const inspectResult = run('docker', ['inspect', workerContainer], {
      capture: true,
      allowFailure: true,
    });
    if (inspectResult.status === 0) {
      console.error('\nWorker logs:');
      run('docker', ['logs', '--tail', '200', workerContainer], { allowFailure: true });
    }
    throw error;
  } finally {
    cleanup();
  }
}

main().catch(() => {
  process.exit(1);
});
