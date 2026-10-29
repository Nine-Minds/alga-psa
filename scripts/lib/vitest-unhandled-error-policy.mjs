// Vitest 4's fork worker sends console output as a tracked rpc call and
// rejects whatever is still pending when the file's environment tears down,
// so a line written in a file's last tick fails a shard whose every test
// passed (10 such errors on shard 1 of 8969b3a0d1). That line was already
// headed for the passed-only bin; only this exact race is dropped, and every
// other unhandled error still fails the run.
const LOST_CONSOLE_LOG = /Closing rpc while "onUserConsoleLog" was pending/;

export function isLostConsoleLogTeardown(error) {
  return error?.name === 'EnvironmentTeardownError'
    && LOST_CONSOLE_LOG.test(String(error?.message ?? ''));
}
