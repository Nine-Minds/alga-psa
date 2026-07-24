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

test('SerialCommandQueue flags truncated output instead of clipping silently', async () => {
  const queue = createKubectlQueue({ name: 'test-truncate' });
  const result = await queue.enqueue('head -c 4096 /dev/zero | tr "\\0" "x"', { maxOutputBytes: 1024 });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.maxOutputBytes, 1024);
  assert.match(result.stdout, /output truncated at 1024 bytes/);
});

test('SerialCommandQueue returns large output intact when the caller raises the cap', async () => {
  const queue = createKubectlQueue({ name: 'test-large-json' });
  // Stands in for `kubectl get pods -o json` on a real namespace, which runs
  // well past the text-output default.
  const bytes = 512 * 1024;
  const result = await queue.enqueue(`head -c ${bytes} /dev/zero | tr "\\0" "x"`, {
    timeoutMs: 10_000,
    maxOutputBytes: 8 * 1024 * 1024
  });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, false);
  assert.equal(result.stdout.length, bytes);
});

test('SerialCommandQueue keeps large multi-byte JSON parseable across chunk boundaries', async () => {
  const queue = createKubectlQueue({ name: 'test-json-utf8' });
  const payload = JSON.stringify({
    items: Array.from({ length: 10_000 }, (_, index) => ({
      name: `pod-${index}`,
      note: 'naïve — café ☕ 日本語'
    }))
  });
  assert.equal(payload.length > 256 * 1024, true);
  const result = await queue.enqueue('cat', {
    timeoutMs: 10_000,
    maxOutputBytes: 8 * 1024 * 1024,
    stdin: payload
  });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(JSON.parse(result.stdout), JSON.parse(payload));
});

test('SerialCommandQueue passes provided stdin to the command', async () => {
  const queue = createKubectlQueue({ name: 'test-stdin' });
  const result = await queue.enqueue('read value; printf "%s" "$value"', { stdin: 'secret-value\n' });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'secret-value');
  assert.equal(result.command.includes('secret-value'), false);
});
