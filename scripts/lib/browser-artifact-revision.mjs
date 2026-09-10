import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateBrowserArtifactManifest } from './browser-artifact-manifest.mjs';

const execute = promisify(execFile);
const member = '_temp/browser-artifact-manifest.json';
const archiveCap = 50 * 1024 * 1024, manifestCap = 512 * 1024;
const check = condition => { if (!condition) throw new Error('Invalid artifact evidence'); };
const unknown = (code, conflicting = false) => ({ revision: null,
  revisionEvidence: conflicting ? 'conflicting' : 'unavailable', revisionDiagnostics: [code] });

// Inspect central-directory lengths before asking unzip to decompress the one
// fixed member. No archive paths are extracted and no artifact code is executed.
export async function readBrowserManifestZip(bytes, { timeoutMs = 10_000 } = {}) {
  check(Buffer.isBuffer(bytes) && bytes.length <= archiveCap && bytes.length >= 22);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  check(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0);
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  check(count > 0 && count <= 2000 && bytes.readUInt16LE(end + 8) === count && start + centralSize === end);
  let offset = start, found = 0, totalSize = 0;
  for (let index = 0; index < count; index++) {
    check(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    check(offset + 46 + nameLength + extra + comment <= end);
    totalSize += size; check(totalSize <= 200 * 1024 * 1024 && compressed <= archiveCap);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === member) {
      found++; check(found === 1 && size > 0 && size <= manifestCap && !(bytes.readUInt16LE(offset + 8) & 1));
      check([0, 8].includes(bytes.readUInt16LE(offset + 10)));
    }
    offset += 46 + nameLength + extra + comment;
  }
  check(offset === end && found === 1 && timeoutMs > 0);
  const directory = await mkdtemp(path.join(tmpdir(), 'browser-revision-'));
  try {
    const archive = path.join(directory, 'evidence.zip');
    await writeFile(archive, bytes, { mode: 0o600, flag: 'wx' });
    const { stdout } = await execute('unzip', ['-p', archive, member], {
      timeout: Math.min(timeoutMs, 10_000), maxBuffer: manifestCap, killSignal: 'SIGKILL', encoding: 'utf8' });
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
export async function resolveBrowserArtifactRevisions({ repository, run, githubToken, request = fetch,
  deadline = Date.now() + 60_000, maxPages = 10 } = {}) {
  const editions = ['community', 'enterprise'];
  const unavailable = code => Object.fromEntries(editions.map(edition => [edition, unknown(code)]));
  const api = `https://api.github.com/repos/${repository}`;
  const get = async (url, token, redirect = 'error') => {
    check(deadline > Date.now());
    return request(url, { method: 'GET', redirect,
      headers: token ? { authorization: `Bearer ${token}`, accept: 'application/json' } : {},
      signal: AbortSignal.timeout(deadline - Date.now()) });
  };
  const json = async url => {
    const response = await get(url, githubToken); check(response.status === 200);
    return JSON.parse((await boundedBytes(response, 2 * 1024 * 1024)).toString('utf8'));
  };
  const artifacts = [], ids = new Set();
  try {
    let total;
    for (let page = 1; ; page++) {
      check(page <= maxPages);
      const data = await json(`${api}/actions/runs/${run.id}/artifacts?per_page=100&page=${page}`);
      check(Number.isSafeInteger(data.total_count) && data.total_count >= 0 && data.total_count <= maxPages * 100);
      total ??= data.total_count;
      check(data.total_count === total && Array.isArray(data.artifacts) && data.artifacts.length <= 100);
      for (const artifact of data.artifacts) {
        check(Number.isSafeInteger(artifact.id) && artifact.id > 0 && !ids.has(artifact.id));
        ids.add(artifact.id); artifacts.push(artifact);
      }
      check(artifacts.length <= total); if (artifacts.length === total) break;
      check(data.artifacts.length === 100);
    }
  } catch { return unavailable('artifact-inventory-unavailable'); }
  const result = {};
  for (const edition of editions) {
    const matches = artifacts.filter(artifact => artifact.name === `fresh-install-playwright-${edition}`);
    if (matches.length !== 1) { result[edition] = unknown(matches.length ? 'artifact-duplicate' : 'artifact-missing', matches.length > 1); continue; }
    const artifact = matches[0];
    if (artifact.expired === true) { result[edition] = unknown('artifact-expired'); continue; }
    try {
      check(artifact.expired === false && artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === run.head_sha);
      check(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= archiveCap);
      // Ignore arbitrary archive_download_url fields: the immutable ID selects
      // the fixed GitHub API endpoint, which may redirect once to signed storage.
      let response = await get(`${api}/actions/artifacts/${artifact.id}/zip`, githubToken, 'manual');
      if (response.status === 302) {
        const location = new URL(response.headers.get('location'));
        check(location.protocol === 'https:' && !location.username && !location.password && !location.port
          && (/^productionresultssa[a-z0-9]*\.blob\.core\.windows\.net$/.test(location.hostname)
            || location.hostname === 'objects.githubusercontent.com'));
        response = await get(location.href, null, 'error');
      }
      check(response.status === 200);
      const bytes = await boundedBytes(response, archiveCap);
      check(bytes.length === artifact.size_in_bytes);
      const manifest = await readBrowserManifestZip(bytes, { timeoutMs: deadline - Date.now() });
      if (manifest.runAttempt !== run.run_attempt) { result[edition] = unknown('artifact-stale-attempt'); continue; }
      validateBrowserArtifactManifest(manifest, { edition, revision: manifest.revision, runId: String(run.id), runAttempt: run.run_attempt });
      try {
        if (run.event === 'pull_request') {
          const commit = await json(`${api}/git/commits/${manifest.revision}`);
          check(commit.sha === manifest.revision && Array.isArray(commit.parents) && commit.parents.length === 2);
          const parents = commit.parents.map(parent => parent.sha);
          check(parents.every(parent => /^[a-f0-9]{40}$/.test(parent ?? '')) && new Set(parents).size === 2 && parents.includes(run.head_sha));
        } else check(manifest.revision === run.head_sha);
      } catch { result[edition] = unknown('revision-unverified'); continue; }
      result[edition] = { revision: manifest.revision, revisionEvidence: 'candidate-artifact', revisionDiagnostics: [] };
    } catch { result[edition] = unknown('artifact-invalid'); }
  }
  const revisions = editions.map(edition => result[edition].revision).filter(Boolean);
  if (new Set(revisions).size > 1) for (const edition of editions) result[edition] = unknown('revision-conflicting', true);
  return result;
}
