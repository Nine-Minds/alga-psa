import {
  DEFAULT_UPDATE_OWNER_MAX_AGE_MS,
  classifyUpdateOwner,
  interruptedUpdateState,
  isPidAlive
} from './update-ownership.mjs';
import { appendUpdateHistory, readJsonFile, writeSecureJsonFileAtomic } from './update-state.mjs';

export function reconcileInterruptedUpdate(options) {
  const {
    stateFile,
    historyFile,
    now = () => new Date(),
    pidIsAlive = isPidAlive,
    maxAgeMs = DEFAULT_UPDATE_OWNER_MAX_AGE_MS,
    logger = console
  } = options;
  const state = readJsonFile(stateFile);
  const classification = classifyUpdateOwner(state, {
    nowMs: now().getTime(),
    isPidAlive: pidIsAlive,
    maxAgeMs
  });
  if (classification.status === 'none') return { classification, state };
  if (classification.status === 'live') {
    logger.info?.(`Adopting live app update owner PID ${classification.owner.pid}.`);
    return { classification, state };
  }

  const at = now().toISOString();
  const interrupted = interruptedUpdateState(state, classification, at);
  writeSecureJsonFileAtomic(stateFile, interrupted);
  appendUpdateHistory({
    at,
    channel: interrupted.update.requestedChannel || null,
    ok: false,
    category: interrupted.failure.category,
    phase: interrupted.failure.phase,
    message: interrupted.failure.message
  }, historyFile, () => at);
  logger.warn?.(interrupted.failure.suspectedCause);
  return { classification, state: interrupted };
}

export function createUpdateCoordinator(options) {
  const {
    stateFile,
    historyFile,
    spawnUpdate,
    now = () => new Date(),
    pidIsAlive = isPidAlive,
    maxAgeMs = DEFAULT_UPDATE_OWNER_MAX_AGE_MS,
    logger = console
  } = options;
  let deciding = false;

  function reconcile() {
    return reconcileInterruptedUpdate({
      stateFile,
      historyFile,
      now,
      pidIsAlive,
      maxAgeMs,
      logger
    });
  }

  function start(channel) {
    if (deciding) {
      return {
        status: 409,
        body: { error: 'An app update is already starting.', code: 'update_in_progress', retryable: true }
      };
    }
    deciding = true;
    try {
      const current = readJsonFile(stateFile);
      const classification = classifyUpdateOwner(current, {
        nowMs: now().getTime(),
        isPidAlive: pidIsAlive,
        maxAgeMs
      });
      if (classification.status === 'live') {
        return {
          status: 409,
          body: {
            error: 'An app update is already running.',
            code: 'update_in_progress',
            retryable: true,
            requestedChannel: current.update?.requestedChannel || null,
            startedAt: classification.owner.startedAt,
            status: current.status
          }
        };
      }
      if (classification.status !== 'none') reconcile();

      const startedAt = now().toISOString();
      const pid = spawnUpdate(channel, startedAt);
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error('Update workflow did not return a valid child PID.');
      }
      const state = {
        status: 'update-queued',
        phase: 'registry-release-source',
        lastAction: `Update to ${channel} queued; background workflow is starting`,
        updatedAt: startedAt,
        update: {
          requestedChannel: channel,
          scope: 'application-only',
          startedAt,
          owner: { pid, startedAt }
        }
      };
      const childState = readJsonFile(stateFile);
      const childPublishedGeneration = childState?.update?.startedAt === startedAt
        && childState?.update?.requestedChannel === channel;
      if (!childPublishedGeneration) writeSecureJsonFileAtomic(stateFile, state);
      return {
        status: 202,
        body: { ok: true, started: true },
        state: childPublishedGeneration ? childState : state
      };
    } finally {
      deciding = false;
    }
  }

  return { reconcile, start };
}
