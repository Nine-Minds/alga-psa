const SCENARIOS = new Set([
  'password-baseline',
  'oauth-baseline',
  'rename-preserve',
  'scope-change',
  'replacement',
  'oauth-reconnect',
  'oauth-refresh',
]);

const SECRET_FIELD = /^(?:password|passwd|pass|access_token|refresh_token|authorization_code|client_secret|secret_value|raw_token|token_value)$/i;

function fail(message) {
  throw new Error(message);
}

function parseTime(value, label) {
  if (typeof value !== 'string') fail(`${label} must be an ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`${label} must be an ISO timestamp`);
  return parsed;
}

function rejectSecretFields(value, label = 'record') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => rejectSecretFields(item, label));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key.replaceAll('-', '_'))) fail(`${label} contains a prohibited credential field`);
    rejectSecretFields(child, label);
  }
}

function parseJsonLines(text, label) {
  if (typeof text !== 'string' || !text.trim()) fail(`${label} is empty`);
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      fail(`${label} contains invalid JSON on line ${index + 1}`);
    }
  });
}

function serviceEventsFromLog(text, context) {
  const events = [];
  for (const line of String(text).split(/\r?\n/)) {
    const marker = '[IMAP_SM] ';
    const index = line.indexOf(marker);
    if (index < 0) continue;
    let event;
    try {
      event = JSON.parse(line.slice(index + marker.length));
    } catch {
      fail('email-service log contains malformed structured IMAP state');
    }
    if (event.evidenceRunId !== context.runId) fail('email-service state event has the wrong evidence run ID');
    const at = parseTime(event.ts, 'email-service event timestamp');
    if (at < context.serviceStartedAt || at > context.serviceEndedAt) {
      fail('email-service state event falls outside the captured service run');
    }
    events.push(event);
  }
  if (events.length === 0) fail('email-service log contains no structured IMAP state events');
  return events;
}

function validateReadiness(readiness) {
  if (!readiness || readiness.status !== 'ready' || !readiness.checks || typeof readiness.checks !== 'object') {
    fail('email-service /ready did not report ready');
  }
  if (Object.values(readiness.checks).some((check) => check?.ok !== true)) {
    fail('email-service /ready contains a failed dependency or consumer check');
  }
}

function requireWorkerExecution(events, input) {
  const providerEvents = events.filter((event) => event.providerId === input.providerId);
  const worker = providerEvents.find((event) => event.event === 'worker_start'
    && event.host === input.expectedHost
    && Number(event.port) === Number(input.expectedPort));
  if (!worker) fail('email-service did not start the expected provider worker and destination');
  if (input.credentialGeneration && worker.credentialGeneration !== input.credentialGeneration) {
    fail('email-service worker used a different credential generation than the UI save');
  }

  const listener = providerEvents.find((event) => event.event === 'folder_listener_start'
    && event.host === input.expectedHost
    && Number(event.port) === Number(input.expectedPort)
    && typeof event.listenerId === 'string');
  if (!listener) fail('email-service did not start a listener for the expected provider and destination');
  return { providerEvents, worker, listener };
}

function requireConnected(providerEvents, listener, providerId) {
  if (!providerEvents.some((event) => event.event === 'connected'
    && event.providerId === providerId
    && event.listenerId === listener.listenerId)) {
    fail('email-service did not authenticate and connect the expected IMAP listener');
  }
}

function requireRecipientEvent(events, predicate, message) {
  if (!events.some(predicate)) fail(message);
}

/** Validate that a protected fixture export and a ready built worker prove one exact scenario run. */
export function validatePublicEmailServiceEvidence(input) {
  const { runId, scenario } = input;
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(runId)) fail('evidence run ID is invalid');
  if (!SCENARIOS.has(scenario)) fail('evidence scenario is unsupported');

  validateReadiness(input.readiness);
  const serviceStartedAt = parseTime(input.serviceStartedAt, 'service start time');
  const serviceEndedAt = parseTime(input.serviceEndedAt, 'service end time');
  if (serviceEndedAt <= serviceStartedAt) fail('email-service run window is empty or reversed');
  const context = { runId, serviceStartedAt, serviceEndedAt };
  const serviceEvents = serviceEventsFromLog(input.emailServiceLog, context);
  const { providerEvents, listener } = requireWorkerExecution(serviceEvents, input);

  const records = parseJsonLines(input.recipientJsonl, 'recipient export');
  records.forEach((record) => rejectSecretFields(record, 'recipient export'));
  const windows = records.filter((record) => record?.type === 'window');
  if (windows.length !== 1) fail('recipient export must contain exactly one run window');
  const window = windows[0];
  if (window.runId !== runId || window.scenario !== scenario) fail('recipient window does not match this run ID and scenario');
  const windowStart = parseTime(window.startedAt, 'recipient window start');
  const windowEnd = parseTime(window.endedAt, 'recipient window end');
  const exportedAt = parseTime(window.exportedAt, 'recipient export time');
  if (windowStart > serviceStartedAt || windowEnd < serviceEndedAt || exportedAt < serviceEndedAt || exportedAt > Date.now() + 60_000) {
    fail('recipient export does not cover the complete email-service run');
  }

  const recipientEvents = records.filter((record) => record?.type !== 'window');
  for (const event of recipientEvents) {
    if (!['connect', 'auth', 'token'].includes(event.type)) fail('recipient export contains an unknown event type');
    if (event.runId !== runId || event.providerId !== input.providerId) fail('recipient event does not match this run and provider');
    const at = parseTime(event.at, 'recipient event timestamp');
    if (at < windowStart || at > windowEnd || at < serviceStartedAt || at > serviceEndedAt) {
      fail('recipient event falls outside the exact email-service run window');
    }
    if (!['success', 'failure'].includes(event.result)) fail('recipient event has no success/failure result');
  }

  const imapAuth = (host, credentialId) => (event) => event.type === 'auth'
    && event.protocol === 'imap'
    && event.destinationHost === host
    && event.credentialId === credentialId
    && event.result === 'success';

  if (scenario === 'scope-change') {
    const error = providerEvents.find((event) => event.event === 'folder_listener_error'
      && event.providerId === input.providerId
      && event.listenerId === listener.listenerId
      && event.message === 'IMAP credentials missing');
    if (!error) fail('scope-change worker did not fail closed on missing replacement credentials');
    if (recipientEvents.some((event) => event.type === 'auth' && event.protocol === 'imap' && event.destinationHost === input.expectedHost)) {
      fail('changed IMAP recipient received an authentication attempt after credentials were cleared');
    }
    const forbidden = new Set(input.oldCredentialIds ?? []);
    if (recipientEvents.some((event) => event.type === 'auth' && forbidden.has(event.credentialId))) {
      fail('recipient export contains authentication with an old credential generation');
    }
    return { runId, scenario, workerId: providerEvents.find((event) => event.event === 'worker_start')?.workerId, recipientEventCount: recipientEvents.length };
  }

  requireConnected(providerEvents, listener, input.providerId);
  requireRecipientEvent(recipientEvents, imapAuth(input.expectedHost, input.expectedCredentialId), 'recipient export lacks successful IMAP auth with the expected synthetic credential ID');

  if (['oauth-baseline', 'oauth-reconnect', 'oauth-refresh'].includes(scenario)) {
    const grantType = scenario === 'oauth-reconnect' ? 'authorization_code' : 'refresh_token';
    requireRecipientEvent(recipientEvents, (event) => event.type === 'token'
      && event.protocol === 'oauth'
      && event.grantType === grantType
      && event.credentialId === input.expectedOAuthClientId
      && event.result === 'success', `recipient export lacks a successful OAuth ${grantType} exchange`);
  }
  if (scenario === 'oauth-refresh') {
    if (!providerEvents.some((event) => event.event === 'oauth_refresh' && event.providerId === input.providerId)) {
      fail('email-service did not record its OAuth refresh for this provider');
    }
  }

  return {
    runId,
    scenario,
    workerId: providerEvents.find((event) => event.event === 'worker_start')?.workerId,
    listenerId: listener.listenerId,
    recipientEventCount: recipientEvents.length,
  };
}
