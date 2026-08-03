export const DEFAULT_UPDATE_OWNER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const UPDATE_IN_PROGRESS_STATUSES = new Set([
  'update-queued',
  'update-running',
  'release-config-running',
  'storage-install-running'
]);

export function isUpdateInProgressStatus(status) {
  return UPDATE_IN_PROGRESS_STATUSES.has(status);
}

export function isPidAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

export function classifyUpdateOwner(state, options = {}) {
  if (!isUpdateInProgressStatus(state?.status)) {
    return { status: 'none', reason: 'Install state is not an app update in progress.' };
  }

  const owner = state?.update?.owner;
  const pid = owner?.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      status: 'invalid',
      reason: 'The previous update was interrupted by control-plane restart and has no valid owner PID.'
    };
  }

  const startedAtMs = Date.parse(owner?.startedAt || '');
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(startedAtMs) || startedAtMs > nowMs) {
    return {
      status: 'invalid',
      reason: 'The previous update was interrupted by control-plane restart and has an invalid owner start time.'
    };
  }

  const checkPid = options.isPidAlive || isPidAlive;
  let alive;
  try {
    alive = checkPid(pid);
  } catch (error) {
    return {
      status: 'invalid',
      reason: `The previous update owner could not be verified: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
  if (!alive) {
    return {
      status: 'dead',
      reason: `The previous update was interrupted by control-plane restart; owner PID ${pid} is no longer alive.`,
      owner
    };
  }

  const maxAgeMs = options.maxAgeMs ?? DEFAULT_UPDATE_OWNER_MAX_AGE_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return { status: 'invalid', reason: 'The configured update owner maximum age is invalid.', owner };
  }
  if (nowMs - startedAtMs > maxAgeMs) {
    return {
      status: 'aged',
      reason: `The previous update owner PID ${pid} exceeded the ${maxAgeMs} ms safety limit.`,
      owner
    };
  }

  return { status: 'live', reason: `Update owner PID ${pid} is alive.`, owner };
}

export function interruptedUpdateState(state, classification, nowIso = new Date().toISOString()) {
  const message = 'The previous app update was interrupted and reset. You can start it again.';
  const failure = {
    ok: false,
    code: 'update_interrupted',
    category: 'update-interrupted',
    phase: 'update',
    step: 'recover-update-owner',
    message,
    suspectedCause: classification.reason,
    suggestedNextStep: 'Start the app update again from the Manage page.',
    retrySafe: true
  };
  const previousUpdate = state?.update || {};
  const update = {
    ...(previousUpdate.requestedChannel ? { requestedChannel: previousUpdate.requestedChannel } : {}),
    ...(previousUpdate.owner?.startedAt || previousUpdate.startedAt
      ? { startedAt: previousUpdate.owner?.startedAt || previousUpdate.startedAt }
      : {}),
    scope: previousUpdate.scope || 'application-only'
  };
  return {
    ...state,
    status: 'update-blocked',
    phase: 'update-interrupted',
    lastAction: message,
    failure,
    updatedAt: nowIso,
    update
  };
}
