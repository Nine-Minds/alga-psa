import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_READINESS_URL = 'http://workflow-worker:4000/readyz';
const workerNames = ['temporal', 'eventStream', 'dataStoreSweep'];

export async function checkBackgroundWorkers({ url = DEFAULT_READINESS_URL, timeoutMs = 120_000, pollIntervalMs = 1000 } = {}) {
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Readiness URL must use HTTP or HTTPS');
  for (const [name, value, max] of [['timeoutMs', timeoutMs, 600_000], ['pollIntervalMs', pollIntervalMs, 60_000]]) {
    if (!Number.isInteger(value) || value <= 0 || value > max) throw new Error(`${name} must be a positive integer no greater than ${max}`);
  }
  const deadline = performance.now() + timeoutMs;
  let lastFailure = 'No response';
  do {
    try {
      // The deadline covers response headers AND body; redirects cannot turn a
      // generic health page into evidence that these workers started.
      const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))) });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const snapshot = await response.json();
      if (snapshot?.ready !== true || !workerNames.every(name => snapshot.workers?.[name] === true)) {
        throw new Error('Expected ready=true and workers.temporal/eventStream/dataStoreSweep=true');
      }
      return snapshot;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await delay(Math.min(pollIntervalMs, remaining));
  } while (performance.now() < deadline);
  throw new Error(`Workflow worker readiness timed out after ${timeoutMs}ms: ${lastFailure}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    const flags = { '--url': 'url', '--timeout-ms': 'timeoutMs', '--poll-interval-ms': 'pollIntervalMs' };
    for (let i = 0; i < args.length; i += 2) {
      const key = flags[args[i]];
      if (!key || args[i + 1] === undefined) throw new Error('Usage: check-background-workers.mjs [--url URL] [--timeout-ms N] [--poll-interval-ms N]');
      options[key] = key === 'url' ? args[i + 1] : Number(args[i + 1]);
    }
    await checkBackgroundWorkers(options);
    console.log('Workflow worker ready: temporal, eventStream, dataStoreSweep');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
