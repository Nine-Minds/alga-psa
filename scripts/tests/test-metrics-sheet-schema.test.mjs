import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRows, HEADER } from '../record-test-metrics.mjs';

function sheet(t, existing) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = { url: decodeURIComponent(url), method: options.method, body: options.body && JSON.parse(options.body) };
    calls.push(request);
    return { ok: true, status: 200, json: async () => options.method === 'GET' ? { values: [existing] } : {} };
  });
  return calls;
}

test('legacy metrics headers gain only the missing suffix before rows are appended', async t => {
  const calls = sheet(t, HEADER.slice(0, 16));
  await appendRows('synthetic-token', 'test-sheet', 'metrics', HEADER, [HEADER.map(() => '')]);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /metrics!1:1$/);
  const writes = calls.filter(call => call.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /metrics!Q1\?valueInputOption=RAW$/);
  assert.deepEqual(writes[0].body.values, [HEADER.slice(16)]);
  assert.equal(calls.at(-1).method, 'POST');
});

test('reordered existing columns reject the append without writing to the sheet', async t => {
  const existing = [...HEADER];
  [existing[4], existing[5]] = [existing[5], existing[4]];
  const calls = sheet(t, existing);
  await assert.rejects(appendRows('synthetic-token', 'test-sheet', 'metrics', HEADER, [[]]), /header.*mismatch/i);
  assert.deepEqual(calls.map(call => call.method), ['GET']);
});

test('a matching header with user-added trailing columns remains untouched', async t => {
  const calls = sheet(t, [...HEADER, 'review notes']);
  await appendRows('synthetic-token', 'test-sheet', 'metrics', HEADER, [[]]);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
});

test('an empty tab receives the full header before data', async t => {
  const calls = sheet(t, []);
  await appendRows('synthetic-token', 'test-sheet', 'metrics', HEADER, [[]]);
  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /metrics!A1\?valueInputOption=RAW$/);
  assert.deepEqual(calls[1].body.values, [HEADER]);
  assert.equal(calls[2].method, 'POST');
});

test('schema extension beyond column Z writes the suffix at AA', async t => {
  const header = Array.from({ length: 28 }, (_, index) => `field_${index}`);
  const calls = sheet(t, header.slice(0, 26));
  await appendRows('synthetic-token', 'test-sheet', 'metrics', header, [[]]);
  assert.match(calls[1].url, /metrics!AA1\?valueInputOption=RAW$/);
  assert.deepEqual(calls[1].body.values, [header.slice(26)]);
});
