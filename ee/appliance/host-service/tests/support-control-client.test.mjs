import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportControlClient, SupportControlError } from '../support-control-client.mjs';

const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

test('central client sends appliance credential only in create body and scoped tokens as bearer headers', async () => {
  const requests = [];
  const client = new SupportControlClient({ baseUrl: 'https://support.example', fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === 'POST' && String(url).endsWith('/sessions')) return response({ sessionId: SESSION_ID, shareCode: 'ABCDE-FGHJK', connectorToken: 'connector-token-123456', applianceToken: 'appliance-token-123456', resumeGrant: 'resume-grant-123456', statusUrl: 'https://support.example/status', relayUrl: 'wss://relay.example/session', activatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    return response({ ok: true });
  }});
  const created = await client.createSession({ durationHours: 4, credential: 'long-lived-appliance-credential' });
  assert.equal(created.sessionId, SESSION_ID);
  assert.match(requests[0].options.body, /long-lived-appliance-credential/);
  await client.acknowledge(SESSION_ID, 'appliance-token-123456');
  assert.equal(requests[1].options.headers.authorization, 'Bearer appliance-token-123456');
  assert.doesNotMatch(requests[1].options.body, /appliance-token-123456/);
});

test('central client fails closed on missing HTTPS service and malformed responses', async () => {
  assert.throws(() => new SupportControlClient({ baseUrl: 'http://support.example' }), /must use HTTPS/);
  const client = new SupportControlClient({ baseUrl: 'https://support.example', fetchImpl: async () => response({ sessionId: 'not-a-uuid' }) });
  await assert.rejects(() => client.createSession({ durationHours: 4, credential: 'long-lived-appliance-credential' }), (error) => error instanceof SupportControlError && error.code === 'central_invalid_response');
  const unavailable = new SupportControlClient({ fetchImpl: async () => response({ code: 'not_ready', error: 'nope' }, 503) });
  await assert.rejects(() => unavailable.createSession({ durationHours: 4, credential: 'long-lived-appliance-credential' }), (error) => error.code === 'central_unavailable');
});

test('central client rejects non-TLS relay and an expiry beyond the requested ladder window', async () => {
  const methods = [];
  const client = new SupportControlClient({ baseUrl: 'https://support.example', fetchImpl: async (url, options) => { methods.push(options.method); return response({
    sessionId: SESSION_ID,
    shareCode: 'ABCDE-FGHJK',
    connectorToken: 'connector-token-123456',
    applianceToken: 'appliance-token-123456',
    resumeGrant: 'resume-grant-123456',
    statusUrl: 'https://support.example/status',
    relayUrl: 'ws://relay.example/session',
    activatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 9 * 3600000).toISOString(),
  }); } });
  await assert.rejects(() => client.createSession({ durationHours: 4, credential: 'long-lived-appliance-credential' }), (error) => error.code === 'central_invalid_response');
  assert.deepEqual(methods, ['POST', 'DELETE']);
});
