import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const endpointNames = [
  'MICROSOFT_GRAPH_BASE_URL', 'MICROSOFT_LOGIN_BASE_URL', 'QBO_API_BASE_URL',
  'QBO_OAUTH_REVOKE_URL', 'XERO_API_BASE_URL', 'XERO_OAUTH_REVOKE_URL',
  'XERO_REVOCATION_URL', 'STRIPE_API_BASE_URL',
];

export async function verifyProviderRouting({ env = process.env, request = fetch } = {}) {
  assert.ok(['server', 'email-service', 'workflow-worker', 'temporal-worker'].includes(env.PROVIDER_PROBE_SERVICE), 'Expected an application process identity');
  assert.match(env.E2E_CANDIDATE_REVISION ?? '', /^[a-f0-9]{40}$/, 'Expected candidate revision');
  for (const name of endpointNames) {
    const url = new URL(env[name]);
    assert.ok(['http:', 'https:'].includes(url.protocol) && ['algasim', 'algasim.test'].includes(url.hostname), 'Expected isolated provider endpoint');
    assert.ok(!url.username && !url.password && !url.search && !url.hash, 'Provider endpoint must not contain credentials or query data');
  }
  const probe = (input, options = {}) => request(input, { ...options, redirect: 'error' });

  const readJournal = async provider => {
    const response = await probe(`http://algasim:9500/control/${provider}/requests`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, 'Expected provider journal response');
    const { result: history } = await response.json();
    assert.equal(history.complete, true, 'Provider journal must be complete');
    assert.ok(Array.isArray(history.requests) && history.requests.every(item => Number.isSafeInteger(item.sequence) && item.sequence > 0), 'Expected journal sequence identities');
    return history.requests;
  };
  const journalCursor = async provider => Math.max(0, ...(await readJournal(provider)).map(item => item.sequence));

  // Run via stdin inside each real Alga container, where its process environment
  // and Docker routing apply. These are infrastructure probes, not UI journeys.
  const providers = [
    ['msgraph', 'MICROSOFT_GRAPH_BASE_URL', '/me', 401],
    ['qbo', 'QBO_API_BASE_URL', '/probe/companyinfo/probe', 401],
    ['xero', 'XERO_API_BASE_URL', '/Organisation', 401],
    ['stripe', 'STRIPE_API_BASE_URL', '/v1/customers', 200],
  ];
  for (const [provider, variable, suffix, status] of providers) {
    assert.ok(env[variable], `${variable} must be configured`);
    const url = new URL(`${env[variable]}${suffix}`);
    assert.ok(['algasim', 'algasim.test'].includes(url.hostname), `${provider} must target this run's emulator`);
    const beforeSequence = await journalCursor(provider);
    const response = await probe(url, {
      signal: AbortSignal.timeout(5000),
      ...(provider === 'stripe' ? { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } } : {}),
    });
    assert.equal(response.status, status, `${provider} wire response`);
    await response.arrayBuffer();
    const requests = await readJournal(provider);
    assert.ok(requests.some(request => request.sequence > beforeSequence && request.path === url.pathname && request.method === 'GET' && request.status === status), `${provider} must actually observe this request`);
  }
  // Probe revocation with deliberately invalid client credentials. This verifies
  // reachability without revoking any grant used by a browser scenario.
  for (const [provider, variable] of [
    ['qbo', 'QBO_OAUTH_REVOKE_URL'],
    ['xero', 'XERO_OAUTH_REVOKE_URL'],
    ['xero', 'XERO_REVOCATION_URL'],
  ]) {
    assert.ok(env[variable], `${variable} must be configured`);
    const url = new URL(env[variable]);
    assert.equal(url.hostname, 'algasim', `${variable} must target this run's emulator`);
    const beforeSequence = await journalCursor(provider);
    const response = await probe(url, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: {
        authorization: `Basic ${Buffer.from('routing-probe-invalid:routing-probe-invalid').toString('base64')}`,
        'content-type': provider === 'qbo' ? 'application/json' : 'application/x-www-form-urlencoded',
      },
      body: provider === 'qbo' ? JSON.stringify({ token: 'routing-probe-invalid' })
        : new URLSearchParams({ token: 'routing-probe-invalid', token_type_hint: 'refresh_token' }).toString(),
    });
    assert.equal(response.status, 401, `${variable} must reject invalid client credentials`);
    await response.arrayBuffer();
    const requests = await readJournal(provider);
    assert.ok(requests.some(request => request.sequence > beforeSequence && request.path === url.pathname && request.method === 'POST' && request.status === 401), `${variable} must actually receive the probe`);
  }
  const login = new URL(env.MICROSOFT_LOGIN_BASE_URL);
  assert.equal(login.hostname, 'algasim.test');
  // The shared login hostname must resolve from the container as well as the
  // browser host. Catalog lives on the same emulator's control port.
  login.port = '9500'; login.pathname = '/control/catalog';
  assert.equal((await probe(login, { signal: AbortSignal.timeout(5000) })).status, 200);
  await assert.rejects(probe('http://1.1.1.1', { signal: AbortSignal.timeout(3000) }), 'Application containers must not reach live external services');
  return {
    schemaVersion: 1, kind: 'provider-process-readiness', status: 'passed',
    service: env.PROVIDER_PROBE_SERVICE, revision: env.E2E_CANDIDATE_REVISION,
    checkedAt: new Date().toISOString(),
    endpoints: Object.fromEntries(endpointNames.map(name => [name, new URL(env[name]).origin])),
    checks: { providerHttpAndJournal: true, accountingRevocationHttpAndJournal: true, sharedLoginResolution: true, externalFallbackBlocked: true },
    limitation: 'Container network and configuration probes; does not prove application workflow execution.',
  };
}

if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await verifyProviderRouting()));
  } catch {
    // Errors can contain request metadata; retain a fixed failure, never raw credentials.
    console.error('Provider process readiness failed');
    process.exitCode = 1;
  }
}
