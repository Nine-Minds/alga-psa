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

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} is required`);
  return value;
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
    events.push({ ...event, _at: at });
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
  if (worker.credentialGeneration !== input.credentialGeneration) {
    fail('email-service worker did not report the expected persisted credential generation');
  }
  requiredString(worker.workerId, 'email-service worker ID');

  const listener = providerEvents.find((event) => event.event === 'folder_listener_start'
    && event.host === input.expectedHost
    && Number(event.port) === Number(input.expectedPort)
    && event._at >= worker._at
    && event.workerId === worker.workerId
    && event.credentialGeneration === input.credentialGeneration
    && typeof event.listenerId === 'string');
  if (!listener) fail('email-service did not start a listener for the expected provider and destination');
  requiredString(listener.listenerId, 'email-service listener ID');
  return { providerEvents, worker, listener };
}

function observedListenerLifetime(providerEvents, worker, listener, serviceEndedAt) {
  // Ownership ends at the first listener termination, worker stop, or replacement.
  // A stop during startup also invalidates a listener-start logged after the stop.
  const endedAt = providerEvents.reduce((end, event) => {
    if (event === worker || event._at < worker._at) return end;
    const workerEnded = (event.event === 'worker_stop' && event.workerId === worker.workerId)
      || (event.event === 'worker_start' && event.workerId !== worker.workerId);
    const listenerEnded = event.listenerId === listener.listenerId
      && ['folder_listener_stop', 'listener_stop_inbound_paused'].includes(event.event);
    return workerEnded || listenerEnded ? Math.min(end, event._at) : end;
  }, serviceEndedAt);
  if (endedAt <= listener._at) fail('email-service listener has no active lifetime after termination');
  return { startedAt: listener._at, endedAt };
}

function duringLifetime(event, lifetime) {
  return event._at >= lifetime.startedAt && event._at <= lifetime.endedAt;
}

function requireConnected(providerEvents, listener, providerId, lifetime) {
  if (!providerEvents.some((event) => event.event === 'connected'
    && event.providerId === providerId
    && event.listenerId === listener.listenerId
    && duringLifetime(event, lifetime))) {
    fail('email-service did not authenticate and connect the expected IMAP listener');
  }
}

function requireRecipientEvent(events, predicate, message) {
  const match = events.find(predicate);
  if (!match) fail(message);
  return match;
}

function validatePersistedState(input) {
  const state = input.persistedState;
  if (!state || !state.before || !state.after) fail('persisted before/after provider state is required');
  const beforeGeneration = requiredString(state.before.credentialGeneration, 'pre-UI persisted credential generation');
  const generation = requiredString(state.after.credentialGeneration, 'post-UI persisted credential generation');
  requiredString(state.before.scopeFingerprint, 'pre-UI credential-scope fingerprint');
  requiredString(state.after.scopeFingerprint, 'post-UI credential-scope fingerprint');
  requiredString(state.after.host, 'post-UI persisted IMAP host');
  parseTime(state.before.updatedAt, 'pre-UI provider update time');
  parseTime(state.after.updatedAt, 'post-UI provider update time');
  if (Number(state.after.port) !== Number(input.expectedPort) || state.after.host !== input.expectedHost) {
    fail('persisted provider destination does not match the expected IMAP destination');
  }
  if (['oauth-baseline', 'oauth-reconnect', 'oauth-refresh'].includes(input.scenario)) {
    if (state.after.oauthTokenProtocol !== 'https:') fail('persisted OAuth token endpoint must use HTTPS');
    requiredString(state.after.oauthTokenHost, 'persisted OAuth token host');
    if (!Number.isFinite(Number(state.after.oauthTokenPort)) || Number(state.after.oauthTokenPort) <= 0) {
      fail('persisted OAuth token port is required');
    }
  }

  const changedScope = beforeGeneration !== generation
    && state.before.scopeFingerprint !== state.after.scopeFingerprint;
  if (['scope-change', 'oauth-reconnect'].includes(input.scenario) && !changedScope) {
    fail('persisted provider state did not advance generation for the changed credential scope');
  }
  if (['rename-preserve', 'replacement', 'password-baseline', 'oauth-baseline', 'oauth-refresh'].includes(input.scenario)
    && (beforeGeneration !== generation || state.before.scopeFingerprint !== state.after.scopeFingerprint)) {
    fail('persisted provider state changed scope or generation during a credential-preserving scenario');
  }
  return { before: state.before, after: state.after, generation };
}

function oauthClientId(event) {
  return event.clientId ?? event.credentialId;
}

function validateScopeChange({ input, state, recipientEvents, providerEvents, worker, listener, lifetime, windowStart, serviceStartedAt }) {
  const previousGeneration = state.before.credentialGeneration;
  const originalHost = state.before.host;
  const originalCredentialId = requiredString(input.originalCredentialId, 'positive-control credential ID');
  const oldCredentialIds = input.oldCredentialIds;
  if (!Array.isArray(oldCredentialIds) || oldCredentialIds.length === 0) fail('scope-change old credential IDs are required');
  if (!oldCredentialIds.includes(originalCredentialId)) fail('positive-control credential ID must be included among old credential IDs');

  const minimumObservationSeconds = Number(input.minimumObservationSeconds);
  if (!Number.isFinite(minimumObservationSeconds) || minimumObservationSeconds <= 0) {
    fail('scope-change minimum observation duration must be positive');
  }
  const scopeSavedAt = parseTime(state.after.updatedAt, 'scope-change persisted update time');
  if (scopeSavedAt < windowStart || scopeSavedAt >= serviceStartedAt) {
    fail('scope-change persisted save time is outside the UI phase');
  }

  requireRecipientEvent(recipientEvents, (event) => event.type === 'auth'
    && event.protocol === 'imap'
    && event.destinationHost === originalHost
    && Number(event.destinationPort) === Number(state.before.port)
    && event.credentialId === originalCredentialId
    && event.credentialGeneration === previousGeneration
    && event.result === 'success'
    && event._at >= windowStart
    && event._at < scopeSavedAt,
  'scope-change recipient observation lacks a successful pre-change positive control');

  const error = providerEvents.find((event) => event.event === 'folder_listener_error'
    && event.providerId === input.providerId
    && event.listenerId === listener.listenerId
    && duringLifetime(event, lifetime)
    && event.message === 'IMAP credentials missing');
  if (!error) fail('scope-change worker did not fail closed on missing replacement credentials');
  if (providerEvents.some((event) => event.event === 'connected' && event.listenerId === listener.listenerId)) {
    fail('scope-change listener connected after credentials were cleared');
  }

  const observationStartedAt = lifetime.startedAt;
  const observationDurationMs = lifetime.endedAt - observationStartedAt;
  if (observationStartedAt < scopeSavedAt || observationDurationMs < minimumObservationSeconds * 1000) {
    fail('scope-change current-generation listener observation is shorter than the required duration');
  }

  if (recipientEvents.some((event) => event.type === 'auth'
    && event._at >= scopeSavedAt
    && event.destinationHost === input.expectedHost
    && Number(event.destinationPort) === Number(input.expectedPort))) {
    fail('changed IMAP destination received authentication after scope save');
  }
  const oldIds = new Set(oldCredentialIds);
  if (recipientEvents.some((event) => ['auth', 'token'].includes(event.type)
    && event._at >= scopeSavedAt
    && (oldIds.has(event.credentialId) || oldIds.has(event.clientId)
      || event.credentialGeneration === previousGeneration))) {
    fail('an old credential ID or generation was delivered after the credential scope changed');
  }

  return {
    runId: input.runId,
    scenario: input.scenario,
    workerId: worker.workerId,
    credentialGeneration: state.generation,
    observationStartedAt: new Date(observationStartedAt).toISOString(),
    observationEndedAt: new Date(lifetime.endedAt).toISOString(),
    observationDurationMs,
    recipientEventCount: recipientEvents.length,
  };
}

/** Validate one run across recipient reset, real UI edits, and built-worker capture. */
export function validatePublicEmailServiceEvidence(input) {
  const { runId, scenario } = input;
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(runId)) fail('evidence run ID is invalid');
  if (!SCENARIOS.has(scenario)) fail('evidence scenario is unsupported');
  requiredString(input.providerId, 'provider ID');
  requiredString(input.expectedHost, 'expected IMAP host');
  requiredString(input.expectedCredentialId, 'expected credential ID');
  if (!Number.isFinite(Number(input.expectedPort)) || Number(input.expectedPort) <= 0) fail('expected IMAP port is invalid');
  const state = validatePersistedState(input);

  validateReadiness(input.readiness);
  const runStartedAt = parseTime(input.runStartedAt, 'fixture reset time');
  const serviceStartedAt = parseTime(input.serviceStartedAt, 'service start time');
  const serviceEndedAt = parseTime(input.serviceEndedAt, 'service end time');
  if (serviceStartedAt < runStartedAt) fail('email-service capture starts before fixture reset');
  if (serviceEndedAt <= serviceStartedAt) fail('email-service run window is empty or reversed');
  const serviceContext = { runId, serviceStartedAt, serviceEndedAt };
  const serviceEvents = serviceEventsFromLog(input.emailServiceLog, serviceContext);
  const stateBoundInput = { ...input, credentialGeneration: state.generation };
  const { providerEvents, worker, listener } = requireWorkerExecution(serviceEvents, stateBoundInput);
  const lifetime = observedListenerLifetime(providerEvents, worker, listener, serviceEndedAt);

  const records = parseJsonLines(input.recipientJsonl, 'recipient export');
  records.forEach((record) => rejectSecretFields(record, 'recipient export'));
  const windows = records.filter((record) => record?.type === 'window');
  if (windows.length !== 1) fail('recipient export must contain exactly one run window');
  const window = windows[0];
  if (window.runId !== runId || window.scenario !== scenario) fail('recipient window does not match this run ID and scenario');
  const windowStart = parseTime(window.startedAt, 'recipient window start');
  const windowEnd = parseTime(window.endedAt, 'recipient window end');
  const exportedAt = parseTime(window.exportedAt, 'recipient export time');
  if (windowStart > runStartedAt || windowEnd < serviceEndedAt || exportedAt < serviceEndedAt || exportedAt > Date.now() + 60_000) {
    fail('recipient export does not cover the complete prepare, UI, and email-service run');
  }

  const recipientEvents = records.filter((record) => record?.type !== 'window').map((event) => {
    if (!['connect', 'auth', 'token'].includes(event.type)) fail('recipient export contains an unknown event type');
    if (event.runId !== runId || event.providerId !== input.providerId) fail('recipient event does not match this run and provider');
    const at = parseTime(event.at, 'recipient event timestamp');
    if (at < windowStart || at > windowEnd || at < runStartedAt || at > exportedAt) {
      fail('recipient event falls outside the complete prepare, UI, and capture window');
    }
    if (!['success', 'failure'].includes(event.result)) fail('recipient event has no success/failure result');
    if (['auth', 'token'].includes(event.type)) {
      requiredString(event.credentialGeneration, 'recipient credential generation');
      if (event.type === 'token' && event.protocol !== 'oauth') fail('recipient token event must identify the OAuth protocol');
      requiredString(event.type === 'token' ? event.recipientHost : event.destinationHost,
        event.type === 'token' ? 'OAuth token recipient host' : 'IMAP auth destination host');
      const port = event.type === 'token' ? event.recipientPort : event.destinationPort;
      if (!Number.isFinite(Number(port)) || Number(port) <= 0) {
        fail('recipient credential event destination port is required');
      }
      if (event.type === 'token' && ['oauth-baseline', 'oauth-reconnect', 'oauth-refresh'].includes(scenario)
        && (event.recipientHost !== state.after.oauthTokenHost
          || Number(event.recipientPort) !== Number(state.after.oauthTokenPort))) {
        fail('OAuth token recipient does not match the persisted OAuth token endpoint');
      }
    }
    return { ...event, _at: at };
  });

  const imapAuth = (host, credentialId, generation) => (event) => event.type === 'auth'
    && event.protocol === 'imap'
    && event.destinationHost === host
    && Number(event.destinationPort) === Number(input.expectedPort)
    && event.credentialId === credentialId
    && event.credentialGeneration === generation
    && event.result === 'success'
    && event._at >= serviceStartedAt
    && event._at <= serviceEndedAt
    && duringLifetime(event, lifetime);

  if (scenario === 'scope-change') {
    return validateScopeChange({ input, state, recipientEvents, providerEvents, worker, listener, lifetime, windowStart, serviceStartedAt });
  }

  requireConnected(providerEvents, listener, input.providerId, lifetime);
  requireRecipientEvent(recipientEvents, imapAuth(input.expectedHost, input.expectedCredentialId, state.generation),
    'recipient export lacks successful in-service IMAP auth with the expected credential ID and generation');

  if (['oauth-baseline', 'oauth-reconnect', 'oauth-refresh'].includes(scenario)) {
    const expectedOAuthClientId = requiredString(input.expectedOAuthClientId, 'expected OAuth client ID');
    if (state.after.oauthClientId !== expectedOAuthClientId) {
      fail('persisted OAuth client identity does not match the expected OAuth recipient evidence');
    }
    const grantType = scenario === 'oauth-reconnect' ? 'authorization_code' : 'refresh_token';
    const isUiReconnect = scenario === 'oauth-reconnect';
    requireRecipientEvent(recipientEvents, (event) => event.type === 'token'
      && event.protocol === 'oauth'
      && event.recipientHost === state.after.oauthTokenHost
      && Number(event.recipientPort) === Number(state.after.oauthTokenPort)
      && event.grantType === grantType
      && oauthClientId(event) === expectedOAuthClientId
      && event.credentialGeneration === state.generation
      && event.result === 'success'
      && (isUiReconnect ? event._at < serviceStartedAt : event._at >= serviceStartedAt && event._at <= serviceEndedAt),
    `recipient export lacks a successful ${isUiReconnect ? 'UI-phase' : 'in-service'} OAuth ${grantType} exchange at the persisted OAuth token endpoint`);
  }
  if (scenario === 'oauth-refresh') {
    if (!providerEvents.some((event) => event.event === 'oauth_refresh' && event.providerId === input.providerId)) {
      fail('email-service did not record its OAuth refresh for this provider');
    }
  }

  return {
    runId,
    scenario,
    workerId: worker.workerId,
    listenerId: listener.listenerId,
    credentialGeneration: state.generation,
    recipientEventCount: recipientEvents.length,
  };
}
