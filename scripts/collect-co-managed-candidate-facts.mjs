#!/usr/bin/env node
/**
 * Collect the candidate facts the readiness manifest needs but cannot invent:
 * PR head, mergeability, worktree cleanliness, and the mandatory CI checks with
 * their real run/job identities and conclusions.
 *
 * Kept separate from `build-co-managed-inventory.mjs` so that the manifest
 * builder stays offline and deterministic, and so this network-dependent step
 * is auditable on its own. It writes a JSON file; the builder reads it if
 * present and records nulls if it is not — absent facts must surface as
 * blocking reasons in the gate, never as silent passes.
 *
 *   node scripts/collect-co-managed-candidate-facts.mjs --run <id> --out <path>
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64e6 }).trim();
const tryJson = (cmd, args) => { try { return JSON.parse(sh(cmd, args)); } catch { return null; } };

const candidate = arg('candidate', sh('git', ['rev-parse', 'HEAD']));
const runId = arg('run', null);
const outPath = path.resolve(root, arg('out', 'candidate-facts.json'));

const pr = tryJson('gh', ['pr', 'view', '3363', '--json', 'number,headRefOid,mergeable,mergeStateStatus,state,isDraft']);
const run = runId ? tryJson('gh', ['run', 'view', runId, '--json', 'databaseId,status,conclusion,headSha,jobs']) : null;

/**
 * Which jobs count as mandatory for this card. The integration shards and the
 * aggregate gates are the ones the correction PRD names; everything else is
 * recorded with mandatory:false so a green count cannot stand in for them.
 */
const MANDATORY = [
  /^integration \/ Integration shard \d+$/,
  /^integration \/ Integration execution complete$/,
  /^integration \/ Infrastructure execution complete$/,
  /Production regression readiness/i,
];

const checks = (run?.jobs ?? []).map((job) => ({
  name: job.name,
  jobId: job.databaseId,
  status: job.status,
  conclusion: job.conclusion,
  headSha: run.headSha,
  mandatory: MANDATORY.some((re) => re.test(job.name)),
}));

/**
 * Content fingerprints for the three components whose *contents* decide whether
 * a review environment matches the candidate.
 *
 * Each is a sha256 over the git tree hashes of the paths that define it, read
 * at the candidate commit rather than from the working tree — so the value is
 * reproducible by anyone with the repo (`git rev-parse <candidate>:<path>`) and
 * cannot be perturbed by uncommitted local edits. A change to any file under
 * those paths changes the fingerprint, which is the only property that makes it
 * worth recording.
 *
 * Deliberately NOT a claim about anything running. `provenance.app.revision`
 * and `provenance.worker.revision` are the running-system half and stay null:
 * nothing in this repo exposes the revision a live app or worker was built
 * from (there is no build-sha surface on /api/health or elsewhere), so the only
 * honest way to fill them is for whoever actually starts the stack to record
 * it. They remain blocking reasons, as does review-environment stability.
 */
const FINGERPRINT_PATHS = {
  // The CE+EE overlay is what the integration lane builds its schema from.
  migrations: ['server/migrations', 'ee/server/migrations'],
  // Deployment shape: the compose files and the env contract they read.
  config: ['docker-compose.yaml', 'docker-compose.ee.yaml', 'docker-compose.e2e-emulators.yaml', '.env.example'],
  // The provider simulator the acceptance journeys drive.
  simulator: ['packages/emulators'],
};

function treeHash(pathspec) {
  try {
    return sh('git', ['rev-parse', `${candidate}:${pathspec}`]);
  } catch {
    return null;
  }
}

function fingerprint(paths) {
  const parts = paths.map((p) => `${p}=${treeHash(p) ?? 'absent'}`);
  // An all-absent input would hash to a stable value and read as a real
  // fingerprint, so refuse rather than record something meaningless.
  if (parts.every((part) => part.endsWith('=absent'))) return null;
  return `sha256:${createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32)}`;
}

const provenance = {
  app: { revision: null },
  worker: { revision: null },
  migrations: fingerprint(FINGERPRINT_PATHS.migrations),
  config: fingerprint(FINGERPRINT_PATHS.config),
  simulator: fingerprint(FINGERPRINT_PATHS.simulator),
  // Recorded so a reader can recompute each value instead of trusting it.
  inputs: Object.fromEntries(
    Object.entries(FINGERPRINT_PATHS).map(([key, paths]) => [
      key,
      paths.map((pathspec) => ({ path: pathspec, tree: treeHash(pathspec) })),
    ]),
  ),
};

const facts = {
  schemaVersion: 1,
  collectedAt: new Date().toISOString(),
  candidate,
  provenance,
  worktreeClean: sh('git', ['status', '--porcelain']) === '',
  pr: pr ? { number: pr.number, head: pr.headRefOid, state: pr.state, isDraft: pr.isDraft } : null,
  mergeability: pr
    ? { mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus, checkedAtSha: pr.headRefOid }
    : null,
  ci: run
    ? { runId: String(run.databaseId), status: run.status, conclusion: run.conclusion, headSha: run.headSha, checks }
    : null,
};

writeFileSync(outPath, `${JSON.stringify(facts, null, 2)}\n`);
const mandatory = checks.filter((c) => c.mandatory);
console.log(`candidate ${candidate.slice(0, 10)} -> ${path.relative(root, outPath)}`);
console.log(`  pr.head=${facts.pr?.head?.slice(0, 10) ?? 'unknown'} mergeable=${facts.mergeability?.mergeable ?? 'unknown'}`
  + ` worktreeClean=${facts.worktreeClean}`);
console.log(`  ci run=${facts.ci?.runId ?? 'none'} checks=${checks.length} mandatory=${mandatory.length}`
  + ` mandatoryGreen=${mandatory.filter((c) => c.conclusion === 'success').length}`);
console.log(`  provenance migrations=${provenance.migrations ? 'ok' : 'MISSING'}`
  + ` config=${provenance.config ? 'ok' : 'MISSING'} simulator=${provenance.simulator ? 'ok' : 'MISSING'}`
  + ` app/worker revision=uncollected (no runtime revision surface exists)`);
