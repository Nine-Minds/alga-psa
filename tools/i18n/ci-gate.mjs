#!/usr/bin/env node
/**
 * Run one translation gate, publish its result, and decide whether it fails.
 *
 * The gates are being rolled out report-only: they run on every PR and publish
 * what they found, but exit 0 so nothing blocks a merge while the team sees
 * what the signal looks like in practice. Set I18N_ENFORCE=true (one line in
 * the workflow) to make them blocking; nothing else changes.
 *
 *   node tools/i18n/ci-gate.mjs "<label>" <command> [args...]
 *
 * Always exits 0 unless I18N_ENFORCE=true and the command failed.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const [label, command, ...args] = process.argv.slice(2);

if (!label || !command) {
  console.error('usage: ci-gate.mjs "<label>" <command> [args...]');
  process.exit(2);
}

const enforcing = process.env.I18N_ENFORCE === 'true';

const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const failed = result.status !== 0;

process.stdout.write(output);

if (process.env.GITHUB_STEP_SUMMARY) {
  const verdict = failed ? (enforcing ? '❌ failed' : '⚠️ findings (report-only)') : '✅ passed';
  const lines = [`### ${label} — ${verdict}`, ''];

  if (failed) {
    lines.push('```', output.trimEnd().split('\n').slice(-40).join('\n'), '```', '');
  }

  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

if (failed && !enforcing) {
  console.log(`\n[report-only] "${label}" found problems but is not blocking the merge.`);
  console.log('Set I18N_ENFORCE=true in .github/workflows/validate-translations.yml to enforce.');
}

process.exit(failed && enforcing ? 1 : 0);
