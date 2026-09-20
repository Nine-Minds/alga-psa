#!/usr/bin/env node
/**
 * CF030 — the read-only readiness gate for PR #3363.
 *
 * Reads `docs/evidence/co-managed-completion/<candidate>/manifest.json`, checks
 * it against the requirement IDs read independently from the plans, and prints
 * `implementationReady`, `humanReviewReady` and `productionReady` as three
 * separate calculated results with their blocking reasons.
 *
 * It writes nothing and changes nothing. It does not touch workflow-board
 * templates or state: binding this verdict to review eligibility is the XO's
 * job, and merging and human approval are later board actions that an agent
 * must never assert here.
 *
 * Exit 0 only when `humanReviewReady` is true. Anything else — a missing
 * manifest, an unreadable plan, an unknown status, a stale SHA — exits 1.
 *
 * The calculation lives in `scripts/lib/co-managed-completion.mjs` and is pure,
 * so `scripts/tests/co-managed-completion.test.mjs` proves it rejects before it
 * is trusted to accept. Run those tests first:
 *
 *   node --test scripts/tests/co-managed-completion.test.mjs
 *   node scripts/verify-co-managed-completion.mjs [--candidate <sha>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCoManagedCompletion } from './lib/co-managed-completion.mjs';
import { coManagedRequirementKeys } from './lib/co-managed-plan-ids.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const evidenceRoot = path.join(root, 'docs/evidence/co-managed-completion');

function resolveManifestPath() {
  const explicit = arg('manifest');
  if (explicit) return path.resolve(root, explicit);
  const candidate = arg('candidate');
  if (candidate) return path.join(evidenceRoot, candidate, 'manifest.json');
  // No candidate given: find the manifests that exist and refuse to guess
  // between several. Picking one silently is how a stale candidate gets
  // relabelled as current.
  const found = existsSync(evidenceRoot)
    ? readdirSync(evidenceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(evidenceRoot, entry.name, 'manifest.json'))
      .filter((file) => existsSync(file))
    : [];
  if (found.length === 1) return found[0];
  if (found.length === 0) return null;
  console.error(`Several manifests exist; pass --candidate:\n  ${found.map((f) => path.relative(root, f)).join('\n  ')}`);
  process.exit(1);
}

const manifestPath = resolveManifestPath();
let manifest = null;
let readError = null;
if (manifestPath && existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    readError = `manifest is not valid JSON: ${error.message}`;
  }
} else {
  readError = `no manifest at ${manifestPath ? path.relative(root, manifestPath) : evidenceRoot}`;
}

let expectedRequirementIds;
let planFailures = [];
try {
  const plans = coManagedRequirementKeys(root);
  expectedRequirementIds = plans.keys;
  planFailures = plans.failures;
} catch (error) {
  planFailures = [`could not read the plans: ${error.message}`];
}

const verdict = evaluateCoManagedCompletion({ manifest, expectedRequirementIds });

if (readError) {
  for (const list of Object.values(verdict.blocking)) list.unshift(readError);
  verdict.implementationReady = false;
  verdict.humanReviewReady = false;
  verdict.productionReady = false;
}
if (planFailures.length) {
  for (const failure of planFailures) {
    for (const list of Object.values(verdict.blocking)) list.unshift(`plan: ${failure}`);
  }
  verdict.implementationReady = false;
  verdict.humanReviewReady = false;
  verdict.productionReady = false;
}

// Reported, never an input: what the repository actually is right now. A
// manifest that disagrees with it is stale by definition.
let headRevision = null;
try {
  headRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  headRevision = null;
}
if (headRevision && manifest?.candidate && manifest.candidate !== headRevision) {
  const reason = `manifest candidate ${manifest.candidate.slice(0, 10)} is not the current HEAD ${headRevision.slice(0, 10)}`;
  verdict.blocking.humanReview.unshift(reason);
  verdict.humanReviewReady = false;
  verdict.blocking.production.unshift(reason);
  verdict.productionReady = false;
}

if (arg('json') !== undefined || argv.includes('--json')) {
  console.log(JSON.stringify({ ...verdict, manifestPath: manifestPath && path.relative(root, manifestPath) }, null, 2));
} else {
  console.log(`co-managed completion gate — ${manifestPath ? path.relative(root, manifestPath) : 'no manifest'}`);
  console.log(`candidate: ${verdict.candidate ?? 'unknown'}`);
  if (Object.keys(verdict.counts).length) {
    console.log(`requirements: ${Object.entries(verdict.counts).sort().map(([s, n]) => `${s}=${n}`).join(' ')}`);
  }
  for (const [predicate, key] of [
    ['implementationReady', 'implementation'],
    ['humanReviewReady', 'humanReview'],
    ['productionReady', 'production'],
  ]) {
    const reasons = verdict.blocking[key];
    console.log(`\n${predicate}: ${verdict[predicate]}`);
    const shown = reasons.slice(0, 40);
    for (const reason of shown) console.log(`  - ${reason}`);
    if (reasons.length > shown.length) console.log(`  … and ${reasons.length - shown.length} more`);
  }
}

process.exit(verdict.humanReviewReady ? 0 : 1);
