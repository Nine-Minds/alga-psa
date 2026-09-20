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

const facts = {
  schemaVersion: 1,
  collectedAt: new Date().toISOString(),
  candidate,
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
