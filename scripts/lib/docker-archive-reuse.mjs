// Find an earlier run whose build of this image had identical inputs, fetch
// its archive, verify it against that run's own record, and re-issue the
// record for the candidate with the reuse proof attached. Every step that
// cannot be verified returns "build it" rather than trusting anything.
import { createWriteStream, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyBuildRecord, verifyDockerArchive } from '../verify-docker-archive-build.mjs';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
import { IMAGE_POLICY_PATH } from './image-inputs.mjs';

const WORKFLOW = 'production-regression.yml';

/** Thin GitHub Actions API client; injected in tests. */
export function createActionsApi({ repository, token, fetch = globalThis.fetch }) {
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const json = async (url) => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url.replace(base, '')}`);
    return response.json();
  };
  return {
    async listRuns(branch) {
      const data = await json(`${base}/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&per_page=10`);
      return (data.workflow_runs ?? []).map(run => ({ id: String(run.id), headSha: run.head_sha, createdAt: run.created_at, status: run.status }));
    },
    async listArtifacts(runId) {
      const data = await json(`${base}/actions/runs/${runId}/artifacts?per_page=100`);
      return (data.artifacts ?? []).map(artifact => ({ id: String(artifact.id), name: artifact.name, expired: artifact.expired, bytes: artifact.size_in_bytes }));
    },
    async downloadArtifact(artifactId, destination) {
      const response = await fetch(`${base}/actions/artifacts/${artifactId}/zip`, { headers, redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`Artifact download failed with ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
    },
  };
}

function unzip(zip, directory) {
  const result = spawnSync('unzip', ['-o', '-q', zip, '-d', directory], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr.trim()}`);
}

/** Newest first, current run excluded, each run once. */
export function orderSourceRuns(runsByBranch, currentRunId) {
  const seen = new Set();
  return runsByBranch.flat()
    .filter(run => run.id !== String(currentRunId) && run.status === 'completed' && !seen.has(run.id) && seen.add(run.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function findReusableBuild({ api, inputsHash, ensureCommit, service, image, dockerfile, artifactName,
  candidate, branches, archivePath, recordPath, log = () => {} }) {
  const candidateHash = inputsHash(candidate.revision);
  log(`inputs at candidate ${candidate.revision.slice(0, 10)}: ${candidateHash.sha256} over ${candidateHash.files} files`);
  const runs = orderSourceRuns(await Promise.all(branches.map(branch => api.listRuns(branch).catch(() => []))), candidate.runId);
  const work = mkdtempSync(path.join(tmpdir(), `reuse-${service}-`));
  try {
    for (const run of runs) {
      const reason = message => log(`run ${run.id} (${run.headSha.slice(0, 10)}): ${message}`);
      let artifacts;
      try { artifacts = await api.listArtifacts(run.id); } catch (error) { reason(error.message); continue; }
      const recordArtifact = artifacts.find(a => a.name === `fresh-install-build-record-${service}` && !a.expired);
      const imageArtifact = artifacts.find(a => a.name === artifactName && !a.expired);
      if (!recordArtifact || !imageArtifact) { reason('no unexpired record and image artifacts'); continue; }
      const recordDir = path.join(work, `record-${run.id}`);
      let source;
      try {
        await api.downloadArtifact(recordArtifact.id, `${recordDir}.zip`);
        unzip(`${recordDir}.zip`, recordDir);
        source = JSON.parse(readFileSync(path.join(recordDir, `${service}-build.json`), 'utf8'));
        verifyBuildRecord(source, { revision: source.revision, runId: source.build?.runId, attempt: source.build?.attempt, service });
      } catch (error) { reason(`record unusable: ${error.message}`); continue; }
      if (source.image !== image || source.dockerfile !== dockerfile) { reason('image or dockerfile differs'); continue; }
      // A record that itself reused an older build carries the original build's revision.
      const original = source.reuse?.sourceRevision ?? source.revision;
      let sourceHash;
      try { ensureCommit(original); sourceHash = inputsHash(original); } catch (error) { reason(`cannot hash ${original.slice(0, 10)}: ${error.message}`); continue; }
      if (sourceHash.sha256 !== candidateHash.sha256) { reason(`inputs differ (${sourceHash.sha256.slice(7, 19)} vs ${candidateHash.sha256.slice(7, 19)})`); continue; }
      const imageDir = path.join(work, `image-${run.id}`);
      try {
        await api.downloadArtifact(imageArtifact.id, `${imageDir}.zip`);
        unzip(`${imageDir}.zip`, imageDir);
        rmSync(`${imageDir}.zip`, { force: true });
        const downloaded = path.join(imageDir, `${service}.tar.gz`);
        await verifyDockerArchive(source, downloaded, { revision: source.revision, runId: source.build.runId, attempt: source.build.attempt, service });
        renameSync(downloaded, archivePath);
      } catch (error) { reason(`archive unusable: ${error.message}`); rmSync(archivePath, { force: true }); continue; }
      const reuse = { sourceRevision: original, sourceRunId: source.reuse?.sourceRunId ?? source.build.runId, sourceAttempt: source.reuse?.sourceAttempt ?? source.build.attempt,
        artifactRunId: run.id, inputs: { policy: IMAGE_POLICY_PATH, sha256: candidateHash.sha256, files: candidateHash.files } };
      const record = await recordDockerArchiveBuild({ ...candidate, service, image: source.image, dockerfile: source.dockerfile, platform: source.platform,
        configImageId: source.configImageId, buildReportedDigest: source.buildReportedDigest, metadata: source.metadata, reuse }, archivePath, recordPath);
      log(`reusing ${service} built at ${original.slice(0, 10)} in run ${reuse.sourceRunId} (artifact from run ${run.id})`);
      return { reused: true, record };
    }
    return { reused: false, reason: runs.length ? 'no earlier run had identical inputs and usable artifacts' : 'no earlier completed runs found' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
