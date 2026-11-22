#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { durationsFromProgressJournal, SHARD_DURATIONS } from './lib/server-unit-durations.mjs';

// Rewrites a lane's committed durations file (see SHARD_DURATIONS) from the
// newest main run that published every one of the lane's artifacts (30-day
// retention): the unit lane's merged journal, or the integration lane's four
// shard journals of one full run. Run it from the repository root and commit
// the result whenever the shards drift apart again; it needs GITHUB_TOKEN or
// a logged-in `gh`.
const execute = promisify(execFile);

const listed = async ({ repository, token, request, name, maxPages }) => {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await request(`https://api.github.com/repos/${repository}/actions/artifacts?${new URLSearchParams({ name, per_page: '100', page: String(page) })}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (response.status !== 200) throw new Error(`Artifact listing answered ${response.status}`);
    const { artifacts } = await response.json();
    if (!artifacts.length) break;
    items.push(...artifacts.filter(artifact => artifact.expired === false && artifact.workflow_run?.head_branch === 'main'));
  }
  return items;
};

/** The newest main run holding every artifact the lane needs, with those artifacts. */
export async function newestMainLaneArtifacts({ lane, repository, token, request = fetch, maxPages = 25 }) {
  const names = SHARD_DURATIONS[lane]?.artifacts;
  if (!names) throw new Error(`No shard durations are kept for lane ${lane}`);
  const byRun = new Map();
  for (const name of names) {
    for (const artifact of await listed({ repository, token, request, name, maxPages })) {
      const run = byRun.get(artifact.workflow_run.id) ?? new Map();
      if (!run.has(name)) run.set(name, artifact);
      byRun.set(artifact.workflow_run.id, run);
    }
  }
  const complete = [...byRun.values()].filter(run => run.size === names.length)
    .sort((a, b) => Date.parse([...b.values()][0].created_at) - Date.parse([...a.values()][0].created_at));
  if (!complete.length) throw new Error(`No unexpired main run publishes all of ${names.join(', ')} in the first ${maxPages} pages`);
  return names.map(name => complete[0].get(name));
}

export async function updateShardDurations({ lane, root, repository, token, request = fetch, now = new Date() }) {
  const { path: relativePath, member } = SHARD_DURATIONS[lane];
  const artifacts = await newestMainLaneArtifacts({ lane, repository, token, request });
  const directory = await mkdtemp(path.join(tmpdir(), 'shard-durations-'));
  try {
    const journals = [];
    for (const artifact of artifacts) {
      const response = await request(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
        { headers: { authorization: `Bearer ${token}` } });
      if (response.status !== 200) throw new Error(`Artifact download answered ${response.status}`);
      const archive = path.join(directory, `${artifact.id}.zip`);
      await writeFile(archive, Buffer.from(await response.arrayBuffer()));
      const { stdout } = await execute('unzip', ['-p', archive, member], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
      journals.push(stdout);
    }
    const durationsMs = durationsFromProgressJournal(journals.join('\n'));
    const [first] = artifacts;
    const document = { schemaVersion: 1, lane, generatedAt: now.toISOString(),
      source: { artifactIds: artifacts.map(artifact => artifact.id), createdAt: first.created_at,
        runId: first.workflow_run.id, headSha: first.workflow_run.head_sha },
      files: Object.keys(durationsMs).length, durationsMs };
    await writeFile(path.join(root, relativePath), `${JSON.stringify(document, null, 1)}\n`);
    return document;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lane = process.argv[2];
  if (!SHARD_DURATIONS[lane]) { console.error(`Usage: node scripts/update-shard-durations.mjs <${Object.keys(SHARD_DURATIONS).join('|')}>`); process.exit(2); }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const token = process.env.GITHUB_TOKEN || (await execute('gh', ['auth', 'token'])).stdout.trim();
  const document = await updateShardDurations({ lane, root, repository: process.env.GITHUB_REPOSITORY || 'Nine-Minds/alga-psa', token });
  console.log(`${SHARD_DURATIONS[lane].path}: ${document.files} files from main run ${document.source.runId} (${document.source.createdAt})`);
}
