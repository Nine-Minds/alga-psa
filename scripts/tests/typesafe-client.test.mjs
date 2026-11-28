import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTypeSafeClient, TypeSafeError } from '../lib/typesafe-client.mjs';

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const next = responses.shift();
    return { ok: next.status < 400, status: next.status, text: async () => JSON.stringify(next.body) };
  };
  return { fetch, calls };
}

test('transient statuses retry with backoff and usage is accumulated', async () => {
  const { fetch, calls } = fakeFetch([
    { status: 429, body: { error: 'slow down' } },
    { status: 529, body: { error: 'overloaded' } },
    { status: 200, body: { model: 'jev-latest', answers: { q: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 10, output_tokens: 1 } } },
  ]);
  const client = createTypeSafeClient({ apiKey: 'k', fetch, sleep: async () => {} });
  const result = await client.systemOne({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } });
  assert.equal(result.answers.q.noul, 0.8);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].auth, 'Bearer k');
  assert.deepEqual(calls[0].body, { model: 'jev-latest', state: 's', questions: { q: { type: 'noul', instructions: 'x' } } });
  assert.deepEqual(client.usage, { requests: 3, retries: 2, input_tokens: 10, output_tokens: 1 });
});

test('auth and validation failures do not retry and carry the response body', async () => {
  const { fetch, calls } = fakeFetch([{ status: 422, body: { error: 'bad question' } }]);
  const client = createTypeSafeClient({ apiKey: 'k', fetch, sleep: async () => {} });
  await assert.rejects(client.systemOne({ state: 's', questions: {} }), (error) => error instanceof TypeSafeError && error.status === 422 && /bad question/.test(error.body));
  assert.equal(calls.length, 1);
});

test('retries are bounded and a missing key is reported before any request', async () => {
  const { fetch, calls } = fakeFetch(Array.from({ length: 10 }, () => ({ status: 529, body: {} })));
  const client = createTypeSafeClient({ apiKey: 'k', fetch, sleep: async () => {}, retries: 2 });
  await assert.rejects(client.systemOne({ state: 's', questions: {} }), /529/);
  assert.equal(calls.length, 3);
  const keyless = createTypeSafeClient({ apiKey: '', fetch });
  assert.equal(keyless.available, false);
  await assert.rejects(keyless.systemOne({ state: 's', questions: {} }), /TYPESAFE_API_KEY/);
});
