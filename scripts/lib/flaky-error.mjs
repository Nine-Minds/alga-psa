// The first attempt's error is the only thing that says *why* a test flaked,
// and the runner's default reporter never prints it once the retry passes. One
// bounded line of it travels with every flaky record; the full stack stays in
// the lane's log.
export const FLAKY_ERROR_LIMIT = 400;

export function flakyError(value) {
  const message = typeof value === 'string' ? value : value?.message;
  if (typeof message !== 'string') return undefined;
  const line = message.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > FLAKY_ERROR_LIMIT ? `${line.slice(0, FLAKY_ERROR_LIMIT - 1)}…` : line;
}
