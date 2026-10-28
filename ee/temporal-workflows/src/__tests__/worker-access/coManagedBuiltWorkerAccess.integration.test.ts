import { registerNativeAccessTests } from '../integration/helpers/coManagedNativeAccessCases';
import { expect } from 'vitest';
import { Connection, Client } from '@temporalio/client';
import { createClient } from 'redis';
import { getAdminConnection, tenantDb } from '@alga-psa/db';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import dotenv from 'dotenv';

/** Opt-in integration transport. Requires the built Dockerfile seed payloads,
 * a local Temporal server, Redis and Mailpit; it never starts the app server. */
registerNativeAccessTests(async (input, databaseName) => {
  const workflowsDir = path.resolve(__dirname, '../../..');
  const root = path.resolve(workflowsDir, '../..');
  const entry = path.join(workflowsDir, 'dist/ee/temporal-workflows/src/worker.js');
  // A local tsc build alone omits these Dockerfile COPY assets. Reject stale
  // seed code before letting the worker create any tenant.
  expect(readFileSync(path.join(workflowsDir, 'dist/seeds/permissions/catalog.cjs')))
    .toEqual(readFileSync(path.join(root, 'server/migrations/utils/permissions/catalog.cjs')));
  const defaults = dotenv.parse(readFileSync(path.join(workflowsDir, '.env')));
  const namespace = `cm-l1a-access-${randomUUID()}`;
  const queue = namespace;
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const env = { ...defaults, ...process.env, DB_NAME_SERVER: databaseName,
    TEMPORAL_ADDRESS: defaults.TEMPORAL_ADDRESS ?? '127.0.0.1:7374',
    TEMPORAL_NAMESPACE: namespace, TEMPORAL_TASK_QUEUE: queue, TEMPORAL_TASK_QUEUES: queue,
    HEALTH_CHECK_PORT: String(port), SECRET_READ_CHAIN: 'env', SECRET_WRITE_PROVIDER: 'env' };
  delete env.FORCE_CAPABILITIES;
  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: { seconds: 86400 } });
  const client = new Client({ connection, namespace });
  const work = mkdtempSync(path.join(tmpdir(), 'cm-l1a-worker-'));
  const logPath = path.join(work, 'worker.log');
  const log = openSync(logPath, 'w', 0o600);
  const worker = spawn(process.execPath, [entry], { cwd: workflowsDir, env, stdio: ['ignore', log, log] });
  let redis: ReturnType<typeof createClient> | undefined;
  const close = async () => {
    if (redis?.isOpen) await redis.quit();
    worker.kill('SIGTERM');
    if (worker.exitCode === null) {
      await Promise.race([new Promise(resolve => worker.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
      if (worker.exitCode === null) worker.kill('SIGKILL');
    }
    for await (const schedule of client.schedule.list()) await client.schedule.getHandle(schedule.scheduleId).delete();
    for await (const execution of client.workflow.list({ query: 'ExecutionStatus = "Running"' })) {
      await client.workflow.getHandle(execution.workflowId, execution.runId).terminate('Native-access integration cleanup');
    }
    await connection.close();
    closeSync(log);
    rmSync(work, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (worker.exitCode !== null) throw new Error(`Built worker exited; inspect ${logPath}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ready`);
        if (response.status === 200) { ready = true; break; }
      } catch { /* Worker has not opened its health listener yet. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(ready, `Worker readiness; log ${logPath}`).toBe(true);
    for (const taskQueue of [queue, 'alga-jobs', 'sla-workflows']) {
      let pollers: string[] = [];
      for (let attempt = 0; attempt < 40; attempt++) {
        const result = await connection.workflowService.describeTaskQueue({ namespace, taskQueue: { name: taskQueue }, taskQueueType: 1 });
        pollers = (result.pollers ?? []).map(poller => poller.identity ?? '');
        if (pollers.some(identity => identity.startsWith(`${worker.pid}@`))) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      expect(pollers.some(identity => identity.startsWith(`${worker.pid}@`)), `${taskQueue}: ${JSON.stringify(pollers)}`).toBe(true);
    }
    const handle = await client.workflow.start('coManagedProvisioningWorkflow', {
      workflowId: `co-managed-native-${input.operationId}`, taskQueue: queue, args: [input],
    });
    await handle.result();
    const db = await getAdminConnection();
    const operation = await tenantDb(db, input.sponsorTenant).table('co_managed_provisioning_operations').where('operation_id', input.operationId).first();
    expect(operation).toMatchObject({ state: 'pending_acceptance', invitation_sent_at: expect.any(Date) });
    const mailbox = await (await fetch('http://127.0.0.1:39472/api/v1/messages')).json();
    const message = mailbox.messages.find((message: any) => message.To.some((to: any) => to.Address === operation.request.administrator.email));
    expect(message).toBeDefined();
    const body = await (await fetch(`http://127.0.0.1:39472/api/v1/message/${message.ID}`)).json();
    const links = `${body.HTML ?? ''} ${body.Text ?? ''}`.match(/https?:\/\/[^\s"<>]+/g) ?? [];
    const invitation = links.map((link: string) => new URL(link.replace(/&amp;/g, '&')))
      .find((link: URL) => link.pathname === '/auth/team/setup' && link.searchParams.has('token'));
    const token = invitation?.searchParams.get('token');
    expect(token, 'The actual delivered invitation must contain the signup credential').toBeTruthy();
    redis = createClient({ socket: { host: env.REDIS_HOST, port: Number(env.REDIS_PORT), reconnectStrategy: false }, password: env.REDIS_PASSWORD });
    redis.on('error', () => undefined);
    await redis.connect();
    expect(await redis.ping()).toBe('PONG');
    const events = await redis.xRevRange('workflow:events:global', '+', '-', { COUNT: 100 });
    expect(events.some(event => {
      const value = JSON.stringify(event);
      return value.includes(operation.customer_tenant) && value.includes('OUTBOUND_EMAIL_SENT');
    })).toBe(true);
    console.info('Built worker provisioned the native-access test customer', {
      namespace, workflowId: handle.workflowId, pid: worker.pid,
      entrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'),
      catalogSha256: createHash('sha256').update(readFileSync('dist/seeds/permissions/catalog.cjs')).digest('hex'),
    });
    return { token: token!, close };
  } catch (error) {
    // Keep the failing runtime output available to the test runner; it contains
    // no passwords. The child is stopped even when setup fails.
    console.error(readFileSync(logPath, 'utf8').slice(-6000));
    await close();
    throw error;
  }
});
