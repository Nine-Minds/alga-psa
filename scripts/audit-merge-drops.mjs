#!/usr/bin/env node
/**
 * Find content one side added that a merge silently dropped.
 *
 * Motivation: merge `1064ee7384` on this branch was resolved by concatenating
 * both sides and, in `server/src/middleware.ts`, by keeping main's *declaration*
 * (`exactApiKeySkipPaths`) while dropping main's *use* of it. That compiles,
 * typechecks and passes review; the allowlist just silently stops allowlisting.
 * Because main has not touched that region since, no later merge ever conflicts
 * there and the loss is permanent and invisible.
 *
 * So: take the lines one side ADDED between the fork point and its tip, and
 * report the ones absent from the merge result. Ranked by how much went
 * missing. Deliberate deletions show up too -- this produces a review list, not
 * a verdict.
 *
 * Usage:
 *   node scripts/audit-merge-drops.mjs --added-by <rev> --against <rev> --result <rev> [--min 1]
 * Example (audit what main added before 1064ee7384 that the branch now lacks):
 *   node scripts/audit-merge-drops.mjs --added-by 9a59114991 --against 0af97e5c61 --result HEAD
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const ADDED_BY = arg('added-by');
const AGAINST = arg('against');
const RESULT = arg('result', 'HEAD');
const MIN = Number(arg('min', '1'));

if (!ADDED_BY || !AGAINST) {
  console.error('usage: --added-by <rev> --against <rev> [--result <rev>] [--min N]');
  process.exit(2);
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512e6 });
const forkPoint = git(['merge-base', ADDED_BY, AGAINST]).trim();

const changedBySide = new Set(git(['diff', '--name-only', forkPoint, ADDED_BY]).trim().split('\n').filter(Boolean));
const changedByOther = new Set(git(['diff', '--name-only', forkPoint, AGAINST]).trim().split('\n').filter(Boolean));
// Only files BOTH sides touched can have been mis-resolved.
const contested = [...changedBySide].filter((f) => changedByOther.has(f));

/** Meaningful lines only: blank lines and lone braces match everywhere. */
const meaningful = (line) => {
  const t = line.trim();
  return t.length > 6 && !/^[{}()[\],;]+$/.test(t) && !t.startsWith('*') && !t.startsWith('//');
};

/** `--result worktree` reads the files on disk, so fixes can be verified
 * before they are committed. */
const show = (rev, file) => {
  try {
    if (rev === 'worktree') return readFileSync(file, 'utf8');
    return git(['show', `${rev}:${file}`]);
  } catch {
    return null;
  }
};

const findings = [];
for (const file of contested) {
  const diff = git(['diff', '--unified=0', forkPoint, ADDED_BY, '--', file]);
  const added = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .filter(meaningful);
  if (added.length === 0) continue;

  const result = show(RESULT, file);
  if (result === null) {
    findings.push({ file, missing: added.length, total: added.length, sample: ['(file absent from result)'] });
    continue;
  }
  const resultLines = new Set(result.split('\n').map((l) => l.trim()));
  const missing = added.filter((l) => !resultLines.has(l.trim()));
  if (missing.length >= MIN) {
    findings.push({ file, missing: missing.length, total: added.length, sample: missing.slice(0, 4) });
  }
}

findings.sort((a, b) => b.missing / b.total - a.missing / a.total || b.missing - a.missing);

if (argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  console.log(`fork point ${forkPoint.slice(0, 10)} | ${contested.length} contested files | ${findings.length} with dropped content\n`);
  for (const f of findings) {
    console.log(`${String(f.missing).padStart(4)}/${String(f.total).padEnd(4)} lines missing  ${f.file}`);
    for (const line of f.sample) console.log(`      - ${line.trim().slice(0, 130)}`);
  }
}
