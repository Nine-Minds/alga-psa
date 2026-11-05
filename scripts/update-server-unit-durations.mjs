#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { durationsFromProgressJournal, SERVER_UNIT_DURATIONS_PATH } from './lib/server-unit-durations.mjs';

// Rewrites scripts/server-unit-durations.json from the newest main run's
// `server-unit-execution` artifact (30-day retention): the merged progress
// journal of all four shards. Run it from the repository root and commit the
// result whenever the shards drift apart again; it needs GITHUB_TOKEN or a
// logged-in `gh`.
const execute = promisify(execFile);
const ARTIFACT = 'server-unit-execution';
const MEMBER = 'test-results/server-coverage/progress.jsonl';

export async function newestMainExecutionArtifact({ repository, token, request = fetch, maxPages = 25 }) {
  const api = `https://api.github.com/repos/${repository}/actions/artifacts`;
  for (let page = 1; page <= maxPages; page++) {
    const response = await request(`${api}?${new URLSearchParams({ name: ARTIFACT, per_page: '100', page: String(page) })}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (response.status !== 200) throw new Error(`Artifact listing answered ${response.status}`);
    const { artifacts } = await response.json();
    if (!artifacts.length) break;
    const hit = artifacts.find(artifact => artifact.expired === false && artifact.workflow_run?.head_branch === 'main');
    if (hit) return hit;
  }
  throw new Error(`No unexpired ${ARTIFACT} artifact from main in the first ${maxPages} pages`);
}

export async function updateServerUnitDurations({ root, repository, token, request = fetch, now = new Date() }) {
  const artifact = await newestMainExecutionArtifact({ repository, token, request });
  const response = await request(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
    { headers: { authorization: `Bearer ${token}` } });
  if (response.status !== 200) throw new Error(`Artifact download answered ${response.status}`);
  const directory = await mkdtemp(path.join(tmpdir(), 'server-unit-durations-'));
  try {
    const archive = path.join(directory, 'artifact.zip');
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    const { stdout } = await execute('unzip', ['-p', archive, MEMBER], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
    const durationsMs = durationsFromProgressJournal(stdout);
    const document = { schemaVersion: 1, generatedAt: now.toISOString(),
      source: { artifactId: artifact.id, createdAt: artifact.created_at, runId: artifact.workflow_run.id, headSha: artifact.workflow_run.head_sha },
      files: Object.keys(durationsMs).length, durationsMs };
    await writeFile(path.join(root, SERVER_UNIT_DURATIONS_PATH), `${JSON.stringify(document, null, 1)}\n`);
    return document;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const token = process.env.GITHUB_TOKEN || (await execute('gh', ['auth', 'token'])).stdout.trim();
  const document = await updateServerUnitDurations({ root, repository: process.env.GITHUB_REPOSITORY || 'Nine-Minds/alga-psa', token });
  console.log(`${SERVER_UNIT_DURATIONS_PATH}: ${document.files} files from main run ${document.source.runId} (${document.source.createdAt})`);
}
