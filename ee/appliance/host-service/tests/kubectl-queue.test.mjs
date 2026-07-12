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

test('SerialCommandQueue passes provided stdin to the command', async () => {
  const queue = createKubectlQueue({ name: 'test-stdin' });
  const result = await queue.enqueue('read value; printf "%s" "$value"', { stdin: 'secret-value\n' });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'secret-value');
  assert.equal(result.command.includes('secret-value'), false);
});
