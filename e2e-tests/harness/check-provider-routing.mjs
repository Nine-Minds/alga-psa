import assert from 'node:assert/strict';

// Run via stdin inside each real Alga container, where its process environment
// and Docker routing apply. These are infrastructure probes, not UI journeys.
const providers = [
  ['msgraph', 'MICROSOFT_GRAPH_BASE_URL', '/me', 401],
  ['qbo', 'QBO_API_BASE_URL', '/probe/companyinfo/probe', 401],
  ['xero', 'XERO_API_BASE_URL', '/Organisation', 401],
  ['stripe', 'STRIPE_API_BASE_URL', '/v1/customers', 200],
];
for (const [provider, variable, suffix, status] of providers) {
  assert.ok(process.env[variable], `${variable} must be configured`);
  const url = new URL(`${process.env[variable]}${suffix}`);
  assert.ok(['algasim', 'algasim.test'].includes(url.hostname), `${provider} must target this run's emulator`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    ...(provider === 'stripe' ? { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } } : {}),
  });
  assert.equal(response.status, status, `${provider} wire response`);
  await response.arrayBuffer();
  const evidenceResponse = await fetch(`http://algasim:9500/control/${provider}/requests`, { signal: AbortSignal.timeout(5000) });
  assert.equal(evidenceResponse.status, 200);
  const { result: history } = await evidenceResponse.json();
  assert.ok(history.complete, `${provider} request journal must be complete`);
  assert.ok(history.requests.some(request => request.path === url.pathname && request.method === 'GET' && request.status === status), `${provider} must actually observe this request`);
}
const login = new URL(process.env.MICROSOFT_LOGIN_BASE_URL);
assert.equal(login.hostname, 'algasim.test');
// The shared login hostname must resolve from the container as well as the
// browser host. Catalog lives on the same emulator's control port.
login.port = '9500'; login.pathname = '/control/catalog';
assert.equal((await fetch(login, { signal: AbortSignal.timeout(5000) })).status, 200);
await assert.rejects(fetch('http://1.1.1.1', { signal: AbortSignal.timeout(3000) }), 'Application containers must not reach live external services');
console.log('Four provider routes reached algasim; shared login alias resolved; external fallback is blocked.');
