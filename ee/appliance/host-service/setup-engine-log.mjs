/**
 * Detached setup-engine log.
 *
 * The setup engine runs as a detached child so a k3s restart (DNS activation)
 * cannot kill it mid-run. Its stdout and stderr are appended to
 * <state-dir>/setup-engine.log so a failed or retried install always leaves
 * operator-visible evidence. The log is rotated between launches so repeated
 * retries cannot grow it without bound.
 *
 * Extracted from server.mjs so the open/append/rotate/error lifecycle is
 * directly testable with an injectable fs and a real child process.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETUP_ENGINE_LOG_MAX_BYTES = 1_000_000;

export function createSetupEngineLog(options = {}) {
  const logFile = options.logFile;
  const maxBytes = Number(options.maxBytes || DEFAULT_SETUP_ENGINE_LOG_MAX_BYTES);
  const fsImpl = options.fs || fs;
  let lastError = null;

  function append(line) {
    if (!logFile) {
      lastError = 'setup engine log path is not configured';
      return false;
    }
    try {
      fsImpl.appendFileSync(logFile, line.endsWith('\n') ? line : `${line}\n`, { mode: 0o600 });
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  // Open (rotating an oversized prior log first) and return a file descriptor
  // the detached child inherits for both stdout and stderr. A failure is
  // returned rather than thrown so the caller can still run setup (availability)
  // while surfacing the error instead of silently reverting to stdio: 'ignore'.
  function open() {
    if (!logFile) return { error: 'setup engine log path is not configured' };
    try {
      fsImpl.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o750 });
      try {
        const stats = fsImpl.statSync(logFile);
        if (stats.size > maxBytes) {
          fsImpl.renameSync(logFile, `${logFile}.1`);
        }
      } catch {
        // No existing log yet.
      }
      const fd = fsImpl.openSync(logFile, 'a', 0o600);
      fsImpl.chmodSync(logFile, 0o600);
      lastError = null;
      return { fd };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return { error: lastError };
    }
  }

  return {
    append,
    open,
    get error() {
      return lastError;
    }
  };
}
