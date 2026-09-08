import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { verifyProviderRouting } from './check-provider-routing.mjs';

const env = {
  PROVIDER_PROBE_SERVICE: 'workflow-worker', E2E_CANDIDATE_REVISION: 'a'.repeat(40),
  MICROSOFT_GRAPH_BASE_URL: 'http://algasim:4010/v1.0', MICROSOFT_LOGIN_BASE_URL: 'http://algasim.test:4010',
  QBO_API_BASE_URL: 'http://algasim:4020/v3/company', QBO_OAUTH_REVOKE_URL: 'http://algasim:4020/v2/oauth2/tokens/revoke',
  XERO_API_BASE_URL: 'http://algasim:4060/api.xro/2.0', XERO_OAUTH_REVOKE_URL: 'http://algasim:4060/connect/revocation',
  XERO_REVOCATION_URL: 'http://algasim:4060/connect/revocation', STRIPE_API_BASE_URL: 'http://algasim:4050',
  STRIPE_SECRET_KEY: 'synthetic-test-key-never-in-evidence',
};

async function fixture(t, { badStatus = false, incompleteJournal = false, externalReachable = false, redirectProvider = false, staleJournal = false } = {}) {
  const journal = redirectProvider || staleJournal ? [{ sequence: 1, path: "/v1.0/me", method: "GET", status: 401 }] : [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/control/')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: { complete: !incompleteJournal, requests: journal } }));
      return;
    }
    if (redirectProvider && req.url === '/v1.0/me') {
      journal.push({ sequence: journal.length + 1, path: req.url, method: req.method, status: 302 });
      res.writeHead(302, { location: '/redirected' });
      res.end();
      return;
    }
    const status = badStatus ? 502 : req.url === '/v1/customers' ? 200 : 401;
    if (!(staleJournal && req.url === '/v1.0/me')) journal.push({ sequence: journal.length + 1, path: req.url, method: req.method, status });
    res.statusCode = status;
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const calls = [];
  return {
    calls, journal,
    request: async (input, options) => {
      const url = new URL(input);
      calls.push(url.href);
      if (url.hostname === '1.1.1.1') {
        if (externalReachable) return new Response('reachable');
        throw new Error('Fixture transport blocks external destinations');
      }
      assert.ok(['algasim', 'algasim.test'].includes(url.hostname));
      // Map only the fixed emulator DNS names to this real native HTTP fixture.
      // Production CLI uses the unmodified built-in fetch and container routing.
      url.hostname = '127.0.0.1';
      url.port = String(server.address().port);
      return fetch(url, options);
    },
  };
}

test('records process, revision and safe origins only after real HTTP and journal probes pass', async t => {
  const f = await fixture(t);
  const evidence = await verifyProviderRouting({ env, request: f.request });
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.service, 'workflow-worker');
  assert.equal(evidence.revision, env.E2E_CANDIDATE_REVISION);
  assert.deepEqual(Object.values(evidence.checks), [true, true, true, true]);
  assert.equal(evidence.endpoints.QBO_API_BASE_URL, 'http://algasim:4020');
  assert.equal(f.journal.length, 7);
  assert.equal(f.journal.filter(entry => entry.method === 'POST').length, 3);
  assert.ok(!JSON.stringify(evidence).includes(env.STRIPE_SECRET_KEY));
  assert.ok(f.calls.includes('http://1.1.1.1/'));
});

for (const [name, option] of [['bad provider response', 'badStatus'], ['incomplete request journal', 'incompleteJournal'], ['reachable external fallback', 'externalReachable'], ['redirect masked by an earlier successful journal entry', 'redirectProvider'], ['stale journal with no record of this request', 'staleJournal']]) {
  test(`refuses readiness evidence for ${name}`, async t => {
    const f = await fixture(t, { [option]: true });
    await assert.rejects(verifyProviderRouting({ env, request: f.request }));
  });
}

for (const [name, override] of [
  ['embedded credential', { STRIPE_API_BASE_URL: 'http://user:secret@algasim:4050' }],
  ['query credential', { STRIPE_API_BASE_URL: 'http://algasim:4050?token=secret' }],
  ['live provider', { STRIPE_API_BASE_URL: 'https://api.stripe.com' }],
  ['missing candidate identity', { E2E_CANDIDATE_REVISION: '' }],
]) {
  test(`rejects ${name} before any network request`, async () => {
    let calls = 0;
    await assert.rejects(verifyProviderRouting({ env: { ...env, ...override }, request: async () => { calls++; } }));
    assert.equal(calls, 0);
  });
}
