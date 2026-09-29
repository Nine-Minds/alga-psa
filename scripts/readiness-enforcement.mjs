#!/usr/bin/env node
/**
 * F008: register "Production regression readiness" as a required check on main.
 *
 * The parent workflow reduces every child suite to that one always-running job,
 * so it is the only stable name worth requiring: reusable-workflow calls rename
 * the child checks, and the browser matrix names are generated and truncated.
 *
 * This adds its own ruleset rather than editing the existing guards, so the
 * ext-v2/ESLint and circular-dependency rules are untouched and enforcement can
 * be withdrawn in one call without disturbing them.
 *
 * Ordering matters: the workflow must already exist on main. Requiring a check
 * that a branch's workflows never produce blocks that branch forever, so this
 * runs after the pull request merges, not before.
 *
 *   node scripts/readiness-enforcement.mjs status
 *   node scripts/readiness-enforcement.mjs enable [--dry-run]
 *   node scripts/readiness-enforcement.mjs disable
 */
import { execFileSync } from 'node:child_process';

const REPO = process.env.READINESS_REPO || 'nine-minds/alga-psa';
const NAME = 'production regression readiness';
const CHECK = 'Production regression readiness';
const BRANCH = 'refs/heads/main';
const WORKFLOW = '.github/workflows/production-regression.yml';
// The Release Bot already bypasses both existing active rulesets; matching that
// keeps release automation working. It is a deliberate, documented hole.
const RELEASE_BOT = 2787854;

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
const api = (path, extra = [], input) => JSON.parse(gh(['api', path, ...extra], input));

const body = {
  name: NAME, target: 'branch', enforcement: 'active',
  conditions: { ref_name: { include: [BRANCH], exclude: [] } },
  bypass_actors: [{ actor_id: RELEASE_BOT, actor_type: 'Integration', bypass_mode: 'always' }],
  rules: [{ type: 'required_status_checks', parameters: {
    required_status_checks: [{ context: CHECK }],
    // Matches the existing guards. Strict would force every open PR to rebase
    // before merging; the cost of that is not obviously worth the freshness.
    strict_required_status_checks_policy: false } }],
};

const find = () => api(`repos/${REPO}/rulesets`).find(ruleset => ruleset.name === NAME);

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (command === 'status') {
  const existing = find();
  const rulesets = api(`repos/${REPO}/rulesets`);
  console.log(`repository: ${REPO}`);
  console.log(`readiness ruleset: ${existing ? `${existing.id} (${existing.enforcement})` : 'not present'}`);
  console.log('\nall rulesets:');
  for (const ruleset of rulesets) {
    const detail = api(`repos/${REPO}/rulesets/${ruleset.id}`);
    const checks = detail.rules.flatMap(rule => (rule.parameters?.required_status_checks ?? []).map(check => check.context));
    console.log(`  ${ruleset.id}  ${ruleset.enforcement.padEnd(8)}  ${ruleset.name}${checks.length ? ` -> ${checks.join(', ')}` : ''}`);
  }
  process.exit(0);
}

if (command === 'enable') {
  // A required check the default branch cannot produce blocks every pull request.
  try {
    execFileSync('git', ['cat-file', '-e', `origin/main:${WORKFLOW}`], { stdio: 'ignore' });
  } catch {
    console.error(`Refusing to enable: ${WORKFLOW} is not on origin/main yet.`);
    console.error('Merge the production-regression work first, then re-run. Requiring a check that');
    console.error('main cannot produce would permanently block every open pull request.');
    process.exit(1);
  }
  const existing = find();
  if (dryRun) {
    console.log(existing ? `Would update ruleset ${existing.id}` : 'Would create a new ruleset');
    console.log(JSON.stringify(body, null, 2));
    process.exit(0);
  }
  const send = JSON.stringify(body);
  const result = existing
    ? api(`repos/${REPO}/rulesets/${existing.id}`, ['-X', 'PUT', '--input', '-'], send)
    : api(`repos/${REPO}/rulesets`, ['-X', 'POST', '--input', '-'], send);
  console.log(`${existing ? 'Updated' : 'Created'} ruleset ${result.id} (${result.enforcement}) requiring "${CHECK}"`);
  console.log(`Roll back with: node scripts/readiness-enforcement.mjs disable`);
  process.exit(0);
}

if (command === 'disable') {
  const existing = find();
  if (!existing) { console.log('Nothing to remove.'); process.exit(0); }
  gh(['api', `repos/${REPO}/rulesets/${existing.id}`, '-X', 'DELETE']);
  console.log(`Removed ruleset ${existing.id}. Existing guards are untouched.`);
  process.exit(0);
}

console.error('Usage: readiness-enforcement.mjs status|enable [--dry-run]|disable');
process.exit(2);
