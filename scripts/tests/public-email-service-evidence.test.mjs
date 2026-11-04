import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicEmailServiceEvidence } from '../lib/public-email-service-evidence.mjs';

function evidence({ scenario = 'password-baseline', recipientEvents = [], serviceEvents, readiness = true } = {}) {
  const runId = 'public-run-1';
  const providerId = 'provider-1';
  const started = new Date(Date.now() - 30_000).toISOString();
  const ended = new Date(Date.now() - 10_000).toISOString();
  const at = new Date(Date.now() - 20_000).toISOString();
  const baseServiceEvents = [
    { ts: at, evidenceRunId: runId, event: 'worker_start', providerId, workerId: 'worker-1', host: 'imap.test.example', port: 993, credentialGeneration: 'generation-2' },
    { ts: at, evidenceRunId: runId, event: 'folder_listener_start', providerId, listenerId: 'listener-1', host: 'imap.test.example', port: 993 },
    { ts: at, evidenceRunId: runId, event: 'connected', providerId, listenerId: 'listener-1' },
  ];
  const events = serviceEvents ?? baseServiceEvents;
  const window = { type: 'window', runId, scenario, startedAt: started, endedAt: ended, exportedAt: new Date().toISOString() };
  const recipientJsonl = [window, ...recipientEvents].map((event) => JSON.stringify({ runId, providerId, at, result: 'success', ...event })).join('\n');
  const input = {
    runId,
    scenario,
    readiness: readiness ? { status: 'ready', checks: { database: { ok: true }, redis: { ok: true }, consumer: { ok: true } } } : { status: 'not_ready', checks: { database: { ok: false } } },
    serviceStartedAt: started,
    serviceEndedAt: ended,
    emailServiceLog: events.map((event) => `[IMAP_SM] ${JSON.stringify(event)}`).join('\n'),
    recipientJsonl,
    providerId,
    expectedHost: 'imap.test.example',
    expectedPort: 993,
    expectedCredentialId: 'credential-new',
    expectedOAuthClientId: 'oauth-client-1',
    credentialGeneration: 'generation-2',
    oldCredentialIds: ['credential-old'],
  };
  return { input, at, runId, providerId, started, ended };
}

const successfulImap = { type: 'auth', protocol: 'imap', destinationHost: 'imap.test.example', credentialId: 'credential-new' };

test('accepts current-run password authentication with ready worker evidence', () => {
  const { input } = evidence({ recipientEvents: [successfulImap] });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'password-baseline');
});

test('accepts harmless rename when the preserved credential authenticates', () => {
  const { input } = evidence({ scenario: 'rename-preserve', recipientEvents: [successfulImap] });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'rename-preserve');
});

test('accepts explicit replacement credential authentication', () => {
  const { input } = evidence({ scenario: 'replacement', recipientEvents: [successfulImap] });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'replacement');
});

test('rejects recipient records from a stale run or outside the service window', () => {
  const wrongRun = evidence({ recipientEvents: [{ ...successfulImap, runId: 'older-run' }] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(wrongRun), /does not match this run/);
  const late = evidence({ recipientEvents: [{ ...successfulImap, at: new Date().toISOString() }] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(late), /outside the exact/);
});

test('rejects a window-only export even when its timestamps cover the run', () => {
  const { input } = evidence();
  input.recipientJsonl = input.recipientJsonl.split('\n')[0];
  assert.throws(() => validatePublicEmailServiceEvidence(input), /lacks successful IMAP auth/);
});

test('rejects evidence without worker execution or successful readiness', () => {
  const noWorker = evidence({ recipientEvents: [successfulImap], serviceEvents: [] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(noWorker), /no structured IMAP state/);
  const notReady = evidence({ recipientEvents: [successfulImap], readiness: false }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(notReady), /did not report ready/);
});

test('requires fail-closed worker evidence and rejects old credentials at changed destination', () => {
  const { input, at } = evidence({ scenario: 'scope-change', serviceEvents: undefined });
  input.expectedHost = 'imap.changed.example';
  input.emailServiceLog = [
    { ts: at, evidenceRunId: input.runId, event: 'worker_start', providerId: input.providerId, workerId: 'worker-1', host: input.expectedHost, port: 993, credentialGeneration: 'generation-2' },
    { ts: at, evidenceRunId: input.runId, event: 'folder_listener_start', providerId: input.providerId, listenerId: 'listener-1', host: input.expectedHost, port: 993 },
    { ts: at, evidenceRunId: input.runId, event: 'folder_listener_error', providerId: input.providerId, listenerId: 'listener-1', message: 'IMAP credentials missing' },
  ].map((event) => `[IMAP_SM] ${JSON.stringify(event)}`).join('\n');
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'scope-change');
  input.recipientJsonl = input.recipientJsonl.split('\n').concat(JSON.stringify({ runId: input.runId, providerId: input.providerId, at, type: 'auth', protocol: 'imap', destinationHost: input.expectedHost, credentialId: 'credential-old', result: 'success' })).join('\n');
  assert.throws(() => validatePublicEmailServiceEvidence(input), /changed IMAP recipient received/);
});

test('requires OAuth reconnect authorization-code exchange and refresh evidence', () => {
  const { input } = evidence({ scenario: 'oauth-reconnect', recipientEvents: [successfulImap] });
  assert.throws(() => validatePublicEmailServiceEvidence(input), /authorization_code exchange/);
  input.recipientJsonl += `\n${JSON.stringify({ runId: input.runId, providerId: input.providerId, at: new Date(Date.now() - 20_000).toISOString(), type: 'token', protocol: 'oauth', grantType: 'authorization_code', credentialId: 'oauth-client-1', result: 'success' })}`;
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'oauth-reconnect');
});

test('requires recipient token exchange and service refresh evidence for OAuth refresh', () => {
  const token = { type: 'token', protocol: 'oauth', grantType: 'refresh_token', credentialId: 'oauth-client-1' };
  const missingExchange = evidence({ scenario: 'oauth-refresh', recipientEvents: [successfulImap] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(missingExchange), /refresh_token exchange/);
  const { input, at } = evidence({
    scenario: 'oauth-refresh',
    recipientEvents: [successfulImap, token],
    serviceEvents: [
      { ts: atForTest(), evidenceRunId: 'public-run-1', event: 'worker_start', providerId: 'provider-1', workerId: 'worker-1', host: 'imap.test.example', port: 993, credentialGeneration: 'generation-2' },
      { ts: atForTest(), evidenceRunId: 'public-run-1', event: 'folder_listener_start', providerId: 'provider-1', listenerId: 'listener-1', host: 'imap.test.example', port: 993 },
      { ts: atForTest(), evidenceRunId: 'public-run-1', event: 'connected', providerId: 'provider-1', listenerId: 'listener-1' },
      { ts: atForTest(), evidenceRunId: 'public-run-1', event: 'oauth_refresh', providerId: 'provider-1' },
    ],
  });
  assert.ok(at);
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'oauth-refresh');
});

function atForTest() {
  return new Date(Date.now() - 20_000).toISOString();
}

test('rejects raw credentials in recipient evidence', () => {
  const { input } = evidence({ recipientEvents: [{ ...successfulImap, password: 'synthetic-password' }] });
  assert.throws(() => validatePublicEmailServiceEvidence(input), /prohibited credential field/);
});
