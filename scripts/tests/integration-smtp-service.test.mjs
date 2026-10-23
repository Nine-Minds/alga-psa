import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'yaml';
import nodemailer from 'nodemailer';

const exec = promisify(execFile);

test('integration SMTP delivers mail when the former fixed host ports are occupied', { timeout: 110_000 }, async t => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/integration-tests.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['integration-tests'];
  const service = job.services['comment-smtp'];

  // Reproduce the runner collision without interrupting any existing listener.
  for (const port of [33025, 38080]) {
    const blocker = createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', error => error.code === 'EADDRINUSE' ? resolve() : reject(error));
      blocker.listen(port, '0.0.0.0', resolve);
    });
    t.after(() => blocker.listening && new Promise(resolve => blocker.close(resolve)));
  }

  const name = `integration-smtp-regression-${randomUUID()}`;
  t.after(() => exec('docker', ['rm', '-f', name], { timeout: 10_000 }));
  await exec('docker', [
    'run', '-d', '--name', name,
    ...Object.entries(service.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    ...service.ports.flatMap(port => ['-p', String(port)]),
    service.image,
  ], { timeout: 60_000 });
  const { stdout } = await exec('docker', ['inspect', name]);
  const bindings = JSON.parse(stdout)[0].NetworkSettings.Ports;
  const assignedPorts = Object.fromEntries(Object.entries(bindings)
    .filter(([, value]) => value?.length)
    .map(([port, value]) => [port.split('/')[0], value[0].HostPort]));

  // Execute the workflow's actual environment export step with the service
  // context populated from Docker, as the Actions runner does after startup.
  const step = job.steps.find(step => step.name === 'Configure isolated SMTP ports');
  assert.ok(step, 'the test processes must receive the assigned service ports');
  const env = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key,
    String(value).replace(/\$\{\{\s*job\.services\['comment-smtp'\]\.ports\['(\d+)'\]\s*\}\}/g,
      (_, port) => assignedPorts[port]),
  ]));
  const directory = await mkdtemp(path.join(tmpdir(), 'integration-smtp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, 'env');
  await exec('bash', ['-e', '-c', step.run], { env: { ...process.env, ...env, GITHUB_ENV: envFile } });
  const exported = Object.fromEntries((await readFile(envFile, 'utf8')).trim().split('\n').map(line => line.split('=')));
  const smtpPort = Number(exported.COMMENT_SMTP_PORT);
  const apiPort = Number(exported.COMMENT_SMTP_API_PORT);
  for (const port of [smtpPort, apiPort]) {
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'a valid assigned port is exported');
    assert.ok(![33025, 38080].includes(port), 'occupied host ports are avoided');
  }
  assert.notEqual(smtpPort, apiPort);

  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false,
    ignoreTLS: true, connectionTimeout: 1000, greetingTimeout: 1000 });
  t.after(() => transport.close());
  const recipient = `regression-${randomUUID()}@example.test`;
  const messagesUrl = `http://127.0.0.1:${apiPort}/api/user/${encodeURIComponent(recipient)}/messages`;
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      await transport.verify();
      // The HTTP listener can start after SMTP. Wait for both interfaces.
      const ready = await fetch(messagesUrl, { signal: AbortSignal.timeout(1000) });
      assert.equal(ready.status, 400);
      assert.deepEqual(await ready.json(), { message: `User '${recipient}' not found` });
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(250);
    }
  }
  await transport.sendMail({ from: 'sender@example.test', to: recipient,
    subject: 'Dynamic CI service ports', text: 'Delivered through the workflow port mapping.' });
  const response = await fetch(messagesUrl, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const messages = await response.json();
  assert.equal(messages.length, 1);
  assert.match(messages[0].mimeMessage, /Delivered through the workflow port mapping\./);
});
