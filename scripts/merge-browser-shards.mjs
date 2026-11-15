#!/usr/bin/env node
// Merge one edition's downloaded browser shard artifacts into the per-edition
// evidence layout the fresh-install gate and the readiness recorder read.
//
//   node scripts/merge-browser-shards.mjs --edition enterprise \
//     --input <dir holding fresh-install-browser-shard-<edition>-<lane>/ trees> \
//     --output <dir to receive e2e-tests/execution-evidence/ and _temp/>
//
// Exit 0 only when the merged evidence passed. Files are written either way.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowserArtifactFiles } from './lib/browser-artifact-files.mjs';
import { mergeBrowserShardEvidence } from './lib/browser-shard-evidence.mjs';
import { publishFlakyTests, resetFlakyPublication } from './lib/flaky-policy.mjs';

export const SHARD_ARTIFACT_PREFIX = 'fresh-install-browser-shard-';

// A shard artifact directory is named after the artifact; its lane follows the
// edition. Each evidence file is read only when the tree holds exactly one.
export function readBrowserShardArtifacts(input, edition) {
  let entries;
  try { entries = readdirSync(input, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const prefix = `${SHARD_ARTIFACT_PREFIX}${edition}-`;
  const read = (directory, filename) => {
    const found = findBrowserArtifactFiles(directory, filename);
    if (found.length !== 1) return null;
    try { return JSON.parse(readFileSync(found[0], 'utf8')); } catch { return null; }
  };
  return entries.filter(entry => entry.isDirectory() && entry.name.startsWith(prefix) && entry.name.length > prefix.length)
    .map(entry => {
      const directory = path.join(input, entry.name);
      return { lane: entry.name.slice(prefix.length), descriptor: read(directory, 'browser-shard.json'),
        collected: read(directory, 'collected.json'), report: read(directory, 'results.json'),
        evidence: read(directory, 'evidence.json'), manifest: read(directory, 'browser-artifact-manifest.json') };
    });
}

export function writeMergedBrowserEvidence(output, merged) {
  const evidenceDirectory = path.join(output, 'e2e-tests', 'execution-evidence');
  mkdirSync(evidenceDirectory, { recursive: true });
  const save = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  save(path.join(evidenceDirectory, 'collected.json'), merged.collected);
  save(path.join(evidenceDirectory, 'results.json'), merged.report);
  save(path.join(evidenceDirectory, 'evidence.json'), merged.evidence);
  save(path.join(evidenceDirectory, 'metrics.json'), merged.metrics);
  save(path.join(evidenceDirectory, 'flaky-tests.json'), merged.flakyDocument);
  const flakyUpload = path.join(evidenceDirectory, 'flaky');
  resetFlakyPublication(flakyUpload);
  publishFlakyTests({ documentPath: path.join(evidenceDirectory, 'flaky-tests.json'), directory: flakyUpload });
  if (merged.manifest) {
    mkdirSync(path.join(output, '_temp'), { recursive: true });
    save(path.join(output, '_temp', 'browser-artifact-manifest.json'), merged.manifest);
  }
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) throw new Error(`Missing --${name}`);
  return process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const edition = argument('edition'), input = path.resolve(argument('input')), output = path.resolve(argument('output'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const merged = mergeBrowserShardEvidence({ edition, root, shards: readBrowserShardArtifacts(input, edition),
    revision: process.env.GITHUB_SHA || undefined, runId: process.env.GITHUB_RUN_ID,
    runAttempt: Number.isSafeInteger(attempt) && attempt > 0 ? attempt : undefined });
  writeMergedBrowserEvidence(output, merged);
  const published = merged.evidence.selection.shards.length;
  const total = merged.evidence.selection.shards.find(shard => shard.total)?.total ?? 'unknown';
  const summary = `Browser shard evidence (${edition}): ${merged.evidence.status}; ${published} of ${total} shards published; journeys ${merged.metrics.executed}/${merged.metrics.collected}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `complete=${merged.complete}\nstatus=${merged.evidence.status}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}.\n`);
  for (const failure of merged.evidence.failures) console.error(failure);
  console.log(summary);
  process.exitCode = merged.evidence.status === 'passed' ? 0 : 1;
}
