import test from 'node:test';
import assert from 'node:assert/strict';
import { createKubectlQueue } from '../kubectl-queue.mjs';

test('SerialCommandQueue runs commands one at a time and resolves callbacks', async () => {
  const queue = createKubectlQueue({ name: 'test-kubectl' });
  const events = [];
  const startedAt = Date.now();

  const first = queue.enqueue('sleep 0.2; printf first', {
    timeoutMs: 2_000,
    onStart: (entry) => events.push(`start:${entry.id}`),
    onDone: (result) => events.push(`done:${result.id}`)
  });
  const second = queue.enqueue('printf second', {
    timeoutMs: 2_000,
    onStart: (entry) => events.push(`start:${entry.id}`),
    onDone: (result) => events.push(`done:${result.id}`)
  });

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.stdout, 'first');
  assert.equal(secondResult.stdout, 'second');
  assert.deepEqual(events, ['start:1', 'done:1', 'start:2', 'done:2']);
  assert.equal(secondResult.queuedMs >= 150, true);
  assert.equal(Date.now() - startedAt >= 150, true);
});

test('SerialCommandQueue returns timeout result without rejecting', async () => {
  const queue = createKubectlQueue({ name: 'test-timeout' });
  const result = await queue.enqueue('sleep 2', { timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 124);
  assert.match(result.stderr, /Command timed out/);
});

test('SerialCommandQueue caps output at the default limit and flags truncation', async () => {
  const queue = createKubectlQueue({ name: 'test-truncate-default' });
  const result = await queue.enqueue('head -c 300000 /dev/zero | tr "\\0" "a"', { timeoutMs: 5_000 });
  assert.equal(result.ok, true);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stdout.startsWith('a'.repeat(1000)), true);
  assert.match(result.stdout, /output truncated at 262144 bytes/);
});

test('SerialCommandQueue honors a per-command maxOutputBytes above the default', async () => {
  const queue = createKubectlQueue({ name: 'test-truncate-custom' });
  const result = await queue.enqueue('head -c 300000 /dev/zero | tr "\\0" "a"', { timeoutMs: 5_000, maxOutputBytes: 1024 * 1024 });
  assert.equal(result.ok, true);
  assert.equal(result.stdoutTruncated, false);
  assert.equal(result.stdout.length, 300000);
});

test('SerialCommandQueue passes provided stdin to the command', async () => {
  const queue = createKubectlQueue({ name: 'test-stdin' });
  const result = await queue.enqueue('read value; printf "%s" "$value"', { stdin: 'secret-value\n' });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'secret-value');
  assert.equal(result.command.includes('secret-value'), false);
});
