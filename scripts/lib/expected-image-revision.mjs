// The revision label a candidate image must carry: the candidate's own, or
// the original build's when the image was reused under a verified record.
// The record directory is the one the browser job verified while loading
// images. Without a record every image must carry the candidate revision;
// a malformed or foreign record fails closed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { builtRevision, verifyBuildRecord } from '../verify-docker-archive-build.mjs';

export function buildRecordDirectory(env = process.env) {
  return env.BUILD_RECORD_DIRECTORY ?? (env.RUNNER_TEMP ? path.join(env.RUNNER_TEMP, 'fresh-install-build-records') : null);
}

export function readBuildRecord(service, env = process.env) {
  const directory = buildRecordDirectory(env);
  if (!directory) return null;
  try { return JSON.parse(readFileSync(path.join(directory, `${service}-build.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function expectedImageRevision({ service, env = process.env, record = readBuildRecord(service, env) }) {
  const expected = { revision: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT), service };
  if (!/^[a-f0-9]{40}$/.test(expected.revision ?? '')) throw new Error('Candidate revision is required');
  if (!record) return expected.revision;
  verifyBuildRecord(record, expected);
  return builtRevision(record, expected);
}
