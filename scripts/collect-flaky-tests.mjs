import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { aggregateFlakyTests, renderFlakyTestReport } from './lib/flaky-test-report.mjs';

const execute = promisify(execFile);
const WORKFLOW = 'production-regression.yml';
const MEMBER = 'flaky-tests.json';
const PREFIX = 'flaky-tests-';
const archiveCap = 4 * 1024 * 1024, documentCap = 1024 * 1024, pageCap = 100;

// Only locally authored codes reach CI logs and the step summary. Never attach
// upstream errors, response bodies, URLs or credential values.
export class FlakyCollectionError extends Error {
  constructor(phase, code) {
    super(`Flaky test collection failed (${phase}): ${code}`);
    this.diagnostic = { phase, code };
  }
}

const check = condition => { if (!condition) throw new Error('Invalid flaky evidence'); };

// The archive is never extracted to disk and no archive path is honoured: one
// fixed member is streamed to stdout under a size cap and a kill timeout.
export async function readFlakyDocumentZip(bytes, { timeoutMs = 10_000 } = {}) {
  check(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= archiveCap && timeoutMs > 0);
  const directory = await mkdtemp(path.join(tmpdir(), 'flaky-artifact-'));
  try {
    const archive = path.join(directory, 'artifact.zip');
    await writeFile(archive, bytes, { mode: 0o600, flag: 'wx' });
    const { stdout } = await execute('unzip', ['-p', archive, MEMBER], {
      timeout: Math.min(timeoutMs, 10_000), maxBuffer: documentCap, killSignal: 'SIGKILL', encoding: 'utf8' });
    check(stdout.length > 0 && stdout.length <= documentCap);
    return JSON.parse(stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function boundedBytes(response, cap) {
  check(response.body && (!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= cap));
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; check(size <= cap); chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}

// Read-only: lists recent production-regression runs, then every artifact whose
// name marks it as flaky evidence. Expired, missing or unreadable artifacts are
// reported as diagnostics; they never abort the weekly report.
// The caps must clear a real week: this repository produced 351 regression runs
// in seven days, one inventory request each. That plus the few flake reports
// stays well inside the 1,000 requests an hour GITHUB_TOKEN is allowed, and
// anything the caps do cut is reported as partial coverage rather than read as
// a clean week.
export async function collectFlakyArtifacts({ repository, githubToken, request = fetch, now = Date.now(),
  windowDays = 7, maxRunPages = 6, maxArtifactPages = 3, maxRuns = 600, timeoutMs = 600_000 } = {}) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new FlakyCollectionError('configuration', 'invalid-repository');
  if (typeof githubToken !== 'string' || !githubToken) throw new FlakyCollectionError('configuration', 'github-token-missing');
  if (!Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > 90) throw new FlakyCollectionError('configuration', 'invalid-window');
  // `now` anchors the reported window; the deadline follows the wall clock.
  const deadline = Date.now() + timeoutMs;
  const api = `https://api.github.com/repos/${repository.toLowerCase()}`;
  const since = new Date(now - windowDays * 86_400_000).toISOString().slice(0, 10);
  const diagnostics = [];
  const get = async (url, { token = githubToken, redirect = 'error' } = {}) => {
    check(Date.now() < deadline);
    return request(url, { method: 'GET', redirect,
      headers: token ? { authorization: `Bearer ${token}`, accept: 'application/json' } : {},
      signal: AbortSignal.timeout(deadline - Date.now()) });
  };
  const json = async url => {
    const response = await get(url);
    check(response.status === 200);
    return JSON.parse((await boundedBytes(response, 4 * 1024 * 1024)).toString('utf8'));
  };
  const pages = async (url, key, maxPages, onPage) => {
    const items = [], ids = new Set();
    let total;
    for (let page = 1; ; page++) {
      if (page > maxPages) { onPage('page-limit-reached'); break; }
      const data = await json(`${url}${url.includes('?') ? '&' : '?'}per_page=${pageCap}&page=${page}`);
      check(Number.isSafeInteger(data.total_count) && data.total_count >= 0);
      total ??= data.total_count;
      check(Array.isArray(data[key]) && data[key].length <= pageCap);
      for (const item of data[key]) {
        check(Number.isSafeInteger(item.id) && item.id > 0);
        if (ids.has(item.id)) continue;
        ids.add(item.id); items.push(item);
      }
      if (items.length >= total || data[key].length < pageCap) break;
    }
    return items;
  };
  let runs;
  try {
    const created = new URLSearchParams({ created: `>=${since}` }).toString();
    runs = await pages(`${api}/actions/workflows/${WORKFLOW}/runs?${created}`, 'workflow_runs', maxRunPages,
      code => diagnostics.push({ scope: 'runs', code }));
  } catch { throw new FlakyCollectionError('runs', 'run-inventory-unavailable'); }
  if (runs.length > maxRuns) { diagnostics.push({ scope: 'runs', code: 'run-limit-reached' }); runs = runs.slice(0, maxRuns); }
  const artifacts = [];
  for (const run of runs) {
    if (Date.now() >= deadline) { diagnostics.push({ scope: 'runs', code: 'deadline-exceeded' }); break; }
    const runId = String(run.id);
    let inventory;
    try {
      inventory = await pages(`${api}/actions/runs/${run.id}/artifacts`, 'artifacts', maxArtifactPages,
        code => diagnostics.push({ scope: 'artifacts', runId, code }));
    } catch { diagnostics.push({ scope: 'artifacts', runId, code: 'artifact-inventory-unavailable' }); continue; }
    for (const artifact of inventory.filter(entry => typeof entry.name === 'string' && entry.name.startsWith(PREFIX))) {
      if (artifact.expired !== false) { diagnostics.push({ scope: 'artifact', runId, code: 'artifact-expired' }); continue; }
      try {
        check(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= archiveCap);
        // The immutable artifact ID selects the fixed API endpoint, which may
        // redirect once to signed storage. archive_download_url is ignored.
        let response = await get(`${api}/actions/artifacts/${artifact.id}/zip`, { redirect: 'manual' });
        if (response.status === 302) {
          const location = new URL(response.headers.get('location'));
          check(location.protocol === 'https:' && !location.username && !location.password && !location.port
            && (/^productionresultssa[a-z0-9]*\.blob\.core\.windows\.net$/.test(location.hostname)
              || location.hostname === 'objects.githubusercontent.com'));
          response = await get(location.href, { token: null });
        }
        check(response.status === 200);
        const bytes = await boundedBytes(response, archiveCap);
        check(bytes.length === artifact.size_in_bytes);
        artifacts.push({ artifactName: artifact.name, runId, runAttempt: run.run_attempt ?? null,
          createdAt: artifact.created_at ?? run.created_at,
          document: await readFlakyDocumentZip(bytes, { timeoutMs: deadline - Date.now() }) });
      } catch { diagnostics.push({ scope: 'artifact', runId, code: 'artifact-unreadable' }); }
    }
  }
  return { artifacts, diagnostics, runsInspected: runs.length };
}

export async function runFlakyTestCollection({ directory, env = process.env, request = fetch, now = Date.now() }) {
  const report = path.join(directory, 'report.json');
  const collection = path.join(directory, 'collection.json');
  await mkdir(directory, { recursive: true });
  await rm(report, { force: true });
  await rm(collection, { force: true });
  const requested = Number(env.FLAKY_WINDOW_DAYS || '7');
  const windowDays = Number.isSafeInteger(requested) && requested >= 1 && requested <= 90 ? requested : 7;
  const diagnostics = { schemaVersion: 1, scope: 'flaky-test-collection', status: 'failed' };
  let aggregated = null;
  try {
    const collected = await collectFlakyArtifacts({ repository: env.GITHUB_REPOSITORY, githubToken: env.GITHUB_TOKEN,
      request, now, windowDays });
    // Every diagnostic is a run or artifact the report could not read, so the
    // window was not fully covered and the summary must not imply otherwise.
    aggregated = aggregateFlakyTests(collected.artifacts, { windowDays, generatedAt: new Date(now).toISOString(),
      coverage: { runsInspected: collected.runsInspected, complete: collected.diagnostics.length === 0,
        limits: collected.diagnostics.map(entry => entry.code) } });
    diagnostics.status = 'collected';
    diagnostics.runsInspected = collected.runsInspected;
    diagnostics.artifactsDownloaded = collected.artifacts.length;
    diagnostics.collection = collected.diagnostics;
    diagnostics.summary = aggregated.summary;
  } catch (error) {
    diagnostics.diagnostic = (error instanceof FlakyCollectionError ? error : new FlakyCollectionError('collection', 'unexpected-error')).diagnostic;
  }
  if (aggregated) await writeFile(report, `${JSON.stringify(aggregated, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(collection, `${JSON.stringify(diagnostics, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (env.GITHUB_STEP_SUMMARY) {
    const summary = aggregated ? renderFlakyTestReport(aggregated)
      : `## Flaky tests\n\nCollection failed.\n\n\`\`\`json\n${JSON.stringify(diagnostics.diagnostic, null, 2)}\n\`\`\`\n`;
    try { await appendFile(env.GITHUB_STEP_SUMMARY, `\n${summary}\n`); }
    catch { throw new FlakyCollectionError('summary-write', 'summary-write-failed'); }
  }
  return diagnostics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? 'test-results/flaky-tests';
  let status = 'failed';
  try {
    const diagnostics = await runFlakyTestCollection({ directory });
    status = diagnostics.status;
    if (status !== 'collected') console.error(`Flaky test collection failed: ${JSON.stringify(diagnostics.diagnostic)}`);
  } catch (error) {
    console.error(`Flaky test collection failed: ${JSON.stringify((error instanceof FlakyCollectionError ? error
      : new FlakyCollectionError('collection', 'unexpected-error')).diagnostic)}`);
  }
  process.exitCode = status === 'collected' ? 0 : 1;
}
