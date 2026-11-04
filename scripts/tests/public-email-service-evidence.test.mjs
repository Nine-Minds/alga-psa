import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicEmailServiceEvidence } from '../lib/public-email-service-evidence.mjs';
import { createImapProviderStateSnapshot } from '../security/imap-provider-state-snapshot.mjs';

const now = Date.now();
const runStart = new Date(now - 60_000).toISOString();
const serviceStart = new Date(now - 30_000).toISOString();
const serviceEnd = new Date(now - 10_000).toISOString();
const exportAt = new Date(now - 5_000).toISOString();
const uiAt = new Date(now - 35_000).toISOString();
const workerAt = new Date(now - 20_000).toISOString();

function readiness(ready = true) {
  return ready
    ? { status: 'ready', checks: { database: { ok: true }, redis: { ok: true }, consumer: { ok: true } } }
    : { status: 'not_ready', checks: { database: { ok: false } } };
}

function defaultServiceEvents({ host = 'imap.test.example', generation = 'generation-new', at = workerAt } = {}) {
  return [
    { ts: at, evidenceRunId: 'public-run-1', event: 'worker_start', providerId: 'provider-1', workerId: 'worker-1', host, port: 993, credentialGeneration: generation },
    { ts: at, evidenceRunId: 'public-run-1', event: 'folder_listener_start', providerId: 'provider-1', workerId: 'worker-1', credentialGeneration: generation, listenerId: 'listener-1', host, port: 993 },
    { ts: at, evidenceRunId: 'public-run-1', event: 'connected', providerId: 'provider-1', listenerId: 'listener-1' },
  ];
}

function evidence({
  scenario = 'password-baseline',
  recipientEvents = [],
  serviceEvents = defaultServiceEvents(),
  ready = true,
  expectedHost = 'imap.test.example',
  expectedCredentialId = 'credential-new',
  credentialGeneration = 'generation-new',
  persistedState,
  serviceStartedAt = serviceStart,
  serviceEndedAt = serviceEnd,
} = {}) {
  const runId = 'public-run-1';
  const providerId = 'provider-1';
  const window = { type: 'window', runId, scenario, startedAt: runStart, endedAt: exportAt, exportedAt: new Date(now).toISOString() };
  const rows = [window, ...recipientEvents.map((event) => ({
    runId,
    providerId,
    at: workerAt,
    result: 'success',
    credentialGeneration,
    ...event,
  }))];
  const input = {
    runId,
    scenario,
    readiness: readiness(ready),
    runStartedAt: runStart,
    serviceStartedAt,
    serviceEndedAt,
    emailServiceLog: serviceEvents.map((event) => `[IMAP_SM] ${JSON.stringify(event)}`).join('\n'),
    recipientJsonl: rows.map((event) => JSON.stringify(event)).join('\n'),
    providerId,
    expectedHost,
    expectedPort: 993,
    expectedCredentialId,
    expectedOAuthClientId: 'oauth-client-1',
    persistedState: persistedState ?? {
      before: { credentialGeneration, scopeFingerprint: 'same-scope', host: expectedHost, port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 50_000).toISOString() },
      after: { credentialGeneration, scopeFingerprint: 'same-scope', host: expectedHost, port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 40_000).toISOString() },
    },
    oldCredentialIds: ['credential-old'],
    oldCredentialGenerations: ['generation-old'],
    minimumObservationSeconds: 15,
  };
  return { input, runId, providerId };
}

const successfulImap = {
  type: 'auth', protocol: 'imap', destinationHost: 'imap.test.example', destinationPort: 993,
  credentialId: 'credential-new', credentialGeneration: 'generation-new',
};

test('accepts a current-run password authentication with ready worker evidence', () => {
  const { input } = evidence({ recipientEvents: [successfulImap] });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'password-baseline');
});

test('accepts a harmless rename only when its credential generation is retained', () => {
  const previousAuth = { ...successfulImap, credentialId: 'credential-old', credentialGeneration: 'generation-old' };
  const { input } = evidence({
    scenario: 'rename-preserve',
    credentialGeneration: 'generation-old',
    expectedCredentialId: 'credential-old',
    serviceEvents: defaultServiceEvents({ generation: 'generation-old' }),
    recipientEvents: [previousAuth],
  });
  assert.equal(validatePublicEmailServiceEvidence(input).credentialGeneration, 'generation-old');
  input.persistedState.before.credentialGeneration = 'generation-stale';
  assert.throws(() => validatePublicEmailServiceEvidence(input), /credential-preserving scenario/);
});

test('accepts explicit replacement credential authentication', () => {
  const { input } = evidence({ scenario: 'replacement', recipientEvents: [successfulImap] });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'replacement');
});

test('accepts UI authorization-code exchange before capture and worker authentication during capture', () => {
  const { input } = evidence({
    scenario: 'oauth-reconnect',
    persistedState: {
      before: { credentialGeneration: 'generation-old', scopeFingerprint: 'scope-old', host: 'imap.test.example', port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 50_000).toISOString() },
      after: { credentialGeneration: 'generation-new', scopeFingerprint: 'scope-new', host: 'imap.test.example', port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 40_000).toISOString() },
    },
    recipientEvents: [
      { ...successfulImap },
      {
        type: 'token', protocol: 'oauth', at: uiAt, grantType: 'authorization_code',
        recipientHost: 'oauth.example', recipientPort: 443, clientId: 'oauth-client-1',
        credentialGeneration: 'generation-new', result: 'success',
      },
    ],
  });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'oauth-reconnect');
});

test('requires baseline OAuth refresh token and IMAP authentication at the stored destination', () => {
  const { input } = evidence({
    scenario: 'oauth-baseline',
    recipientEvents: [
      successfulImap,
      {
        type: 'token', protocol: 'oauth', at: workerAt, grantType: 'refresh_token',
        recipientHost: 'oauth.example', recipientPort: 443,
        clientId: 'oauth-client-1', credentialGeneration: 'generation-new', result: 'success',
      },
    ],
  });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'oauth-baseline');
});

test('rejects recipient records from stale runs or outside the full prepare/UI/capture window', () => {
  const stale = evidence({ recipientEvents: [{ ...successfulImap, runId: 'older-run' }] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(stale), /does not match this run/);
  const late = evidence({ recipientEvents: [{ ...successfulImap, at: new Date(now).toISOString() }] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(late), /complete prepare, UI, and capture window/);
});

test('requires the exported fixture window to cover UI actions before the service starts', () => {
  const { input } = evidence({
    scenario: 'oauth-reconnect',
    persistedState: {
      before: { credentialGeneration: 'generation-old', scopeFingerprint: 'scope-old', host: 'imap.test.example', port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 50_000).toISOString() },
      after: { credentialGeneration: 'generation-new', scopeFingerprint: 'scope-new', host: 'imap.test.example', port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 40_000).toISOString() },
    },
    recipientEvents: [{
      type: 'token', protocol: 'oauth', at: uiAt, grantType: 'authorization_code',
      recipientHost: 'oauth.example', recipientPort: 443, clientId: 'oauth-client-1',
      credentialGeneration: 'generation-new', result: 'success',
    }],
  });
  const rows = input.recipientJsonl.split('\n').map((line) => JSON.parse(line));
  rows[0].startedAt = new Date(now - 35_000).toISOString();
  input.recipientJsonl = rows.map((row) => JSON.stringify(row)).join('\n');
  assert.throws(() => validatePublicEmailServiceEvidence(input), /cover the complete prepare, UI, and email-service run/);
});

test('rejects a window-only export without recipient evidence', () => {
  const { input } = evidence();
  input.recipientJsonl = input.recipientJsonl.split('\n')[0];
  assert.throws(() => validatePublicEmailServiceEvidence(input), /lacks successful in-service IMAP auth/);
});

test('rejects evidence without worker execution or successful readiness', () => {
  const noWorker = evidence({ recipientEvents: [successfulImap], serviceEvents: [] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(noWorker), /no structured IMAP state/);
  const notReady = evidence({ recipientEvents: [successfulImap], ready: false }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(notReady), /did not report ready/);
});

function scopeChangeEvidence({ recipientEvents = [], durationSeconds = 20, listenerDelaySeconds = 2 } = {}) {
  const newHost = 'imap.changed.example';
  const started = Date.parse(serviceStart);
  const ended = new Date(started + durationSeconds * 1000).toISOString();
  const listenerStartedAt = new Date(started + listenerDelaySeconds * 1000).toISOString();
  const controlAt = new Date(Date.parse(runStart) + 15_000).toISOString();
  const events = [
    ...defaultServiceEvents({ host: newHost, at: listenerStartedAt }),
    { ts: listenerStartedAt, evidenceRunId: 'public-run-1', event: 'folder_listener_error', providerId: 'provider-1', listenerId: 'listener-1', message: 'IMAP credentials missing' },
  ];
  const { input } = evidence({
    scenario: 'scope-change',
    expectedHost: newHost,
    serviceEvents: events,
    serviceStartedAt: new Date(started).toISOString(),
    serviceEndedAt: ended,
    recipientEvents: [
      {
        type: 'auth', protocol: 'imap', at: controlAt,
        destinationHost: 'imap.test.example', destinationPort: 993, credentialId: 'credential-old',
        credentialGeneration: 'generation-old', result: 'success',
      },
      ...recipientEvents,
    ],
  });
  input.originalHost = 'imap.test.example';
  input.originalCredentialId = 'credential-old';
  input.persistedState = {
    before: { credentialGeneration: 'generation-old', scopeFingerprint: 'scope-old', host: 'imap.test.example', port: 993, oauthClientId: 'oauth-client-1', updatedAt: new Date(now - 50_000).toISOString() },
    after: { credentialGeneration: 'generation-new', scopeFingerprint: 'scope-new', host: newHost, port: 993, oauthClientId: 'oauth-client-1', updatedAt: new Date(now - 40_000).toISOString() },
  };
  input.minimumObservationSeconds = 15;
  return input;
}

test('requires a successful old-scope positive control and a full fail-closed observation window', () => {
  const input = scopeChangeEvidence();
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'scope-change');

  const noControl = scopeChangeEvidence();
  noControl.recipientJsonl = noControl.recipientJsonl.split('\n').filter((line) => !line.includes('credential-old')).join('\n');
  assert.throws(() => validatePublicEmailServiceEvidence(noControl), /positive control/);

  const shortObservation = scopeChangeEvidence({ durationSeconds: 10 });
  assert.throws(() => validatePublicEmailServiceEvidence(shortObservation), /listener observation is shorter than the required duration/);
});

test('measures scope-change observation from the current-generation listener, not process startup', () => {
  const lateListener = scopeChangeEvidence({ durationSeconds: 20, listenerDelaySeconds: 6 });
  assert.throws(() => validatePublicEmailServiceEvidence(lateListener), /listener observation is shorter than the required duration/);
});

test('rejects old credentials delivered to the changed destination through IMAP or OAuth', () => {
  const oldImap = scopeChangeEvidence({ recipientEvents: [{
    type: 'auth', protocol: 'imap', at: workerAt, destinationHost: 'imap.changed.example', destinationPort: 993,
    credentialId: 'credential-old', credentialGeneration: 'generation-old', result: 'failure',
  }] });
  assert.throws(() => validatePublicEmailServiceEvidence(oldImap), /changed IMAP destination received authentication/);

  const oldRefreshToken = scopeChangeEvidence({ recipientEvents: [{
    type: 'token', protocol: 'oauth', at: workerAt, recipientHost: 'oauth.example', recipientPort: 443,
    grantType: 'refresh_token', credentialId: 'credential-old', clientId: 'oauth-client-old',
    credentialGeneration: 'generation-old', result: 'failure',
  }] });
  assert.throws(() => validatePublicEmailServiceEvidence(oldRefreshToken), /old credential ID or generation/);

  const oldRefreshAtOriginalDestination = scopeChangeEvidence({ recipientEvents: [{
    type: 'token', protocol: 'oauth', at: workerAt, recipientHost: 'oauth.example', recipientPort: 443,
    grantType: 'refresh_token', credentialId: 'credential-old', credentialGeneration: 'generation-old', result: 'failure',
  }] });
  assert.throws(() => validatePublicEmailServiceEvidence(oldRefreshAtOriginalDestination), /old credential ID or generation/);

  const oldGenerationAtOriginalImapHost = scopeChangeEvidence({ recipientEvents: [{
    type: 'auth', protocol: 'imap', at: workerAt, destinationHost: 'imap.test.example', destinationPort: 993,
    credentialId: 'credential-other', credentialGeneration: 'generation-old', result: 'failure',
  }] });
  assert.throws(() => validatePublicEmailServiceEvidence(oldGenerationAtOriginalImapHost), /old credential ID or generation/);

  const oldCredentialAtOriginalImapHost = scopeChangeEvidence({ recipientEvents: [{
    type: 'auth', protocol: 'imap', at: workerAt, destinationHost: 'imap.test.example', destinationPort: 993,
    credentialId: 'credential-old', credentialGeneration: 'generation-new', result: 'success',
  }] });
  assert.throws(() => validatePublicEmailServiceEvidence(oldCredentialAtOriginalImapHost), /old credential ID or generation/);
});

test('requires mandatory state and binds OAuth exchanges to their persisted HTTPS recipient', () => {
  const missingGeneration = evidence({ recipientEvents: [successfulImap] }).input;
  delete missingGeneration.persistedState.after.credentialGeneration;
  assert.throws(() => validatePublicEmailServiceEvidence(missingGeneration), /post-UI persisted credential generation is required/);

  const staleWorker = evidence({ recipientEvents: [successfulImap] }).input;
  staleWorker.persistedState.before.credentialGeneration = 'generation-from-db';
  staleWorker.persistedState.after.credentialGeneration = 'generation-from-db';
  assert.throws(() => validatePublicEmailServiceEvidence(staleWorker), /worker did not report the expected persisted credential generation/);

  const reconnectState = {
    before: { credentialGeneration: 'generation-old', scopeFingerprint: 'scope-old', host: 'imap.test.example', port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 50_000).toISOString() },
    after: { credentialGeneration: 'generation-new', scopeFingerprint: 'scope-new', host: 'imap.test.example', port: 993, oauthClientId: 'oauth-client-1', oauthTokenProtocol: 'https:', oauthTokenHost: 'oauth.example', oauthTokenPort: 443, updatedAt: new Date(now - 40_000).toISOString() },
  };
  const missingDestination = evidence({ scenario: 'oauth-reconnect', persistedState: reconnectState, recipientEvents: [
    successfulImap,
    { type: 'token', protocol: 'oauth', at: uiAt, grantType: 'authorization_code', clientId: 'oauth-client-1', credentialGeneration: 'generation-new' },
  ] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(missingDestination), /OAuth token recipient host is required/);

  const wrongDestination = evidence({ scenario: 'oauth-reconnect', persistedState: reconnectState, recipientEvents: [
    successfulImap,
    { type: 'token', protocol: 'oauth', at: uiAt, grantType: 'authorization_code', recipientHost: 'idp.other.example', recipientPort: 443, clientId: 'oauth-client-1', credentialGeneration: 'generation-new' },
  ] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(wrongDestination), /does not match the persisted OAuth token endpoint/);

  const wrongPersistedClient = evidence({ scenario: 'oauth-reconnect', persistedState: reconnectState, recipientEvents: [
    successfulImap,
    { type: 'token', protocol: 'oauth', at: uiAt, grantType: 'authorization_code', recipientHost: 'oauth.example', recipientPort: 443, clientId: 'oauth-client-1', credentialGeneration: 'generation-new' },
  ] }).input;
  wrongPersistedClient.persistedState.after.oauthClientId = 'oauth-client-other';
  assert.throws(() => validatePublicEmailServiceEvidence(wrongPersistedClient), /persisted OAuth client identity/);
});

test('requires a successful expected OAuth refresh exchange during service authentication', () => {
  const token = {
    type: 'token', protocol: 'oauth', recipientHost: 'oauth.example', recipientPort: 443,
    grantType: 'refresh_token', clientId: 'oauth-client-1', credentialGeneration: 'generation-new',
  };
  const missingExchange = evidence({ scenario: 'oauth-refresh', recipientEvents: [successfulImap] }).input;
  assert.throws(() => validatePublicEmailServiceEvidence(missingExchange), /successful in-service OAuth refresh_token exchange/);
  const { input } = evidence({ scenario: 'oauth-refresh', recipientEvents: [successfulImap, token] });
  const events = defaultServiceEvents();
  events.push({ ts: workerAt, evidenceRunId: 'public-run-1', event: 'oauth_refresh', providerId: 'provider-1' });
  input.emailServiceLog = events.map((event) => `[IMAP_SM] ${JSON.stringify(event)}`).join('\n');
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'oauth-refresh');
});

test('secret-only OAuth client-secret rotation changes the captured scope and validates reconnect evidence', () => {
  const fingerprintKey = Buffer.from('11'.repeat(32), 'hex');
  const beforeRow = {
    host: 'imap.test.example', port: 993, secure: true, allow_starttls: false, username: 'mailbox@example.test',
    auth_type: 'oauth2', oauth_token_url: 'https://oauth.example/token',
    oauth_authorize_url: 'https://oauth.example/authorize', oauth_client_id: 'oauth-client-1',
    oauth_client_secret: 'synthetic-client-secret-before', credential_generation: 'generation-old',
    updated_at: new Date(now - 50_000).toISOString(),
  };
  const afterRow = {
    ...beforeRow,
    oauth_client_secret: 'synthetic-client-secret-after',
    credential_generation: 'generation-new',
    updated_at: new Date(now - 40_000).toISOString(),
  };
  const before = createImapProviderStateSnapshot({ row: beforeRow, database: 'smoke_imap_public_test', providerId: 'provider-1', fingerprintKey });
  const after = createImapProviderStateSnapshot({ row: afterRow, database: 'smoke_imap_public_test', providerId: 'provider-1', fingerprintKey });
  assert.notEqual(before.scopeFingerprint, after.scopeFingerprint);
  assert.equal(after.oauthTokenHost, 'oauth.example');
  assert.equal(after.oauthTokenPort, 443);
  assert.equal(JSON.stringify({ before, after }).includes('synthetic-client-secret'), false);

  const { input } = evidence({
    scenario: 'oauth-reconnect',
    persistedState: { before, after },
    recipientEvents: [successfulImap, {
      type: 'token', protocol: 'oauth', at: uiAt, grantType: 'authorization_code',
      recipientHost: 'oauth.example', recipientPort: 443, clientId: 'oauth-client-1',
      credentialGeneration: 'generation-new', result: 'success',
    }],
  });
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'oauth-reconnect');
});

test('accepts a shutdown event at a millisecond-precision service end boundary', () => {
  const end = new Date(Math.floor((now - 10_000) / 1000) * 1000 + 123).toISOString();
  const start = new Date(Date.parse(end) - 20_000 + 456).toISOString();
  const shutdown = { ts: end, evidenceRunId: 'public-run-1', event: 'worker_stop', providerId: 'provider-1', workerId: 'worker-1' };
  const { input } = evidence({
    recipientEvents: [successfulImap],
    serviceEvents: [...defaultServiceEvents({ at: start }), shutdown],
    serviceStartedAt: start,
    serviceEndedAt: end,
  });
  const rows = input.recipientJsonl.split('\n').map((line) => JSON.parse(line));
  rows[0].endedAt = new Date(Date.parse(end) + 1000).toISOString();
  rows[0].exportedAt = rows[0].endedAt;
  input.recipientJsonl = rows.map((row) => JSON.stringify(row)).join('\n');
  assert.equal(validatePublicEmailServiceEvidence(input).scenario, 'password-baseline');

  const afterBoundaryTime = new Date(Date.parse(end) + 1).toISOString();
  const afterBoundary = { ...input, emailServiceLog: [...defaultServiceEvents({ at: start }), { ...shutdown, ts: afterBoundaryTime }].map((event) => `[IMAP_SM] ${JSON.stringify(event)}`).join('\n') };
  assert.throws(() => validatePublicEmailServiceEvidence(afterBoundary), /falls outside the captured service run/);
});

test('rejects raw credentials in recipient evidence', () => {
  const { input } = evidence({ recipientEvents: [{ ...successfulImap, password: 'synthetic-password' }] });
  assert.throws(() => validatePublicEmailServiceEvidence(input), /prohibited credential field/);
});
