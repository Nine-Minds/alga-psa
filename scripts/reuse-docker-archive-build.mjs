#!/usr/bin/env node
// CI entry point: reuse a verified earlier build of this image when its inputs
// are identical, otherwise tell the workflow to build. Never fails the job.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActionsApi, findReusableBuild } from './lib/docker-archive-reuse.mjs';
import { ensureCommit, imageInputsHash, loadImagePolicy } from './lib/image-inputs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const output = (key, value) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`); };
const log = message => console.log(`reuse: ${message}`);
let result = { reused: false, reason: 'not attempted' };
try {
  if (env.IMAGE_REUSE_DISABLED === 'true') throw new Error('reuse disabled for this run');
  for (const key of ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'BUILD_SERVICE', 'BUILD_IMAGE', 'BUILD_DOCKERFILE', 'BUILD_ARTIFACT', 'IMAGE_ARCHIVE', 'BUILD_RECORD']) {
    if (!env[key]) throw new Error(`${key} is not set`);
  }
  const policy = loadImagePolicy(root);
  const branches = [...new Set((env.REUSE_BRANCHES || '').split(',').map(b => b.trim()).filter(Boolean))];
  if (!branches.length) throw new Error('REUSE_BRANCHES is empty');
  result = await findReusableBuild({
    api: createActionsApi({ repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN }),
    inputsHash: revision => imageInputsHash({ cwd: root, revision, service: env.BUILD_SERVICE, policy }),
    ensureCommit: revision => ensureCommit({ cwd: root, revision }),
    service: env.BUILD_SERVICE, image: env.BUILD_IMAGE, dockerfile: env.BUILD_DOCKERFILE, artifactName: env.BUILD_ARTIFACT,
    candidate: { revision: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT) },
    branches, archivePath: env.IMAGE_ARCHIVE, recordPath: env.BUILD_RECORD, log,
  });
} catch (error) {
  result = { reused: false, reason: error.message };
}
log(result.reused ? `reused=true` : `reused=false (${result.reason})`);
output('reused', result.reused ? 'true' : 'false');
