import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPublishedImage } from '../inspect-published-image.mjs';

test('waits for a pushed digest to become visible and returns the registry manifest', async () => {
  const calls = [];
  const sleeps = [];
  const manifest = '{"schemaVersion":2,"config":{"digest":"sha256:config"}}';

  const result = await inspectPublishedImage('ghcr.io/example/worker', 'sha256:manifest', {
    inspect: (image) => {
      calls.push(image);
      return calls.length === 1
        ? { status: 1, stdout: '', stderr: `${image}: not found` }
        : { status: 0, stdout: manifest, stderr: '' };
    },
    sleep: async (ms) => sleeps.push(ms),
  });

  assert.equal(result, manifest);
  assert.deepEqual(calls, [
    'ghcr.io/example/worker@sha256:manifest',
    'ghcr.io/example/worker@sha256:manifest',
  ]);
  assert.deepEqual(sleeps, [2_000]);
});

test('fails after the bounded retry window when the registry never serves the digest', async () => {
  let calls = 0;

  await assert.rejects(
    inspectPublishedImage('ghcr.io/example/worker', 'sha256:missing', {
      inspect: () => {
        calls += 1;
        return { status: 1, stdout: '', stderr: 'not found' };
      },
      sleep: async () => {},
    }),
    /not found/,
  );
  assert.equal(calls, 6);
});
