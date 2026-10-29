// vitest 4 forwards a worker's console output to the main process with a
// fire-and-forget `rpc.onUserConsoleLog(...)` call. Before a fork closes, the
// worker drains only the RPC calls that were pending when draining began, then
// rejects whatever is still in flight. A log emitted inside that window (a timer
// or a React effect that writes to the console as the file finishes) has its
// delivery rejected with EnvironmentTeardownError. That rejection has no handler,
// so vitest counts it as an unhandled error and fails a run whose tests all
// passed. On a loaded CI shard the main process is slow to acknowledge logs, so
// the window is wide. Every test is still reported; the only loss is a console
// line from after the file finished.
const LATE_CONSOLE_LOG = /^\[vitest-worker\]: Closing rpc while "onUserConsoleLog" was pending$/;

export function isLateConsoleLogTeardown(error) {
  return error?.name === 'EnvironmentTeardownError' && LATE_CONSOLE_LOG.test(String(error.message ?? ''));
}

// vitest `test.onUnhandledError`: returning false drops the error. Only the late
// console-log delivery is dropped; every other unhandled error, including other
// RPC calls rejected at teardown, still fails the run.
export function onUnhandledError(error) {
  if (isLateConsoleLogTeardown(error)) return false;
}
