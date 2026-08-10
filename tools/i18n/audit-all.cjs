#!/usr/bin/env node

/**
 * Run the locale audit across every registered locale.
 *
 * `audit.cjs` audits one locale at a time, which is what a translator working a
 * single pack wants. CI and the test suite want the whole matrix and a single
 * exit code, so this walks `locales.registry.json` and aggregates.
 *
 * Reports the three things worth acting on: English left in a locale pack
 * (`untranslated`), glossary violations (`forbidden`), and anything the audit
 * could not read (`parseError`, `missingFile`). Each fails the run.
 *
 * The audit's `unreviewed` tally is deliberately not surfaced. It counts keys
 * absent from a review ledger whose entries record that a machine pass ran, not
 * that a human validated anything — `isReviewed` only increments a counter and
 * never suppresses a finding, so the number cannot catch a mistranslation and
 * grows with every new key.
 *
 *   node tools/i18n/audit-all.cjs
 *   node tools/i18n/audit-all.cjs --json
 *   node tools/i18n/audit-all.cjs --markdown   # GitHub step-summary table
 *   node tools/i18n/audit-all.cjs --locale de --locale fr
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REGISTRY = require('./locales.registry.json');
const AUDIT = path.join(__dirname, 'audit.cjs');

// Counters that mean the packs are wrong, as opposed to merely un-reviewed.
const FAILING_COUNTERS = [
  ['untranslatedCount', 'English left in the locale pack'],
  ['forbiddenViolationCount', 'glossary forbidden-term violations'],
  ['parseErrorCount', 'locale files that would not parse'],
  ['missingFileCount', 'namespaces missing from the locale'],
];

function parseLocales(argv) {
  const requested = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--locale' && argv[i + 1]) requested.push(argv[++i]);
  }
  return requested.length ? requested : Object.keys(REGISTRY);
}

function auditLocale(locale) {
  // audit.cjs exits nonzero when it finds violations, which is precisely the
  // case worth reporting — spawnSync rather than execFileSync so a finding
  // arrives as data instead of a thrown stack trace.
  const result = spawnSync(
    process.execPath,
    [AUDIT, '--locale', locale, '--json', '--no-write-report'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (!result.stdout) {
    throw new Error(
      `audit for '${locale}' produced no report (exit ${result.status}): ${result.stderr || 'no stderr'}`,
    );
  }

  return JSON.parse(result.stdout).summary;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const asMarkdown = argv.includes('--markdown');
  const locales = parseLocales(argv);

  const summaries = [];
  const failures = [];

  for (const locale of locales) {
    if (!REGISTRY[locale]) {
      console.error(`Unknown locale '${locale}' — not in locales.registry.json`);
      return 2;
    }

    const summary = auditLocale(locale);
    summaries.push(summary);

    for (const [counter, description] of FAILING_COUNTERS) {
      const count = summary[counter] ?? 0;
      if (count > 0) failures.push({ locale, counter, count, description });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ summaries, failures }, null, 2));
    return failures.length ? 1 : 0;
  }

  if (asMarkdown) {
    console.log('| locale | keys | English left | forbidden terms | parse/missing |');
    console.log('|---|---:|---:|---:|---:|');
    for (const s of summaries) {
      console.log(
        `| ${s.locale} | ${s.keyCount} | ${s.untranslatedCount ?? 0} | ${s.forbiddenViolationCount ?? 0} | ` +
          `${(s.parseErrorCount ?? 0) + (s.missingFileCount ?? 0)} |`,
      );
    }
    console.log('');
    console.log(
      failures.length === 0
        ? '**No locale-quality regressions.**'
        : `**${failures.length} locale-quality regression(s).**`,
    );
    for (const failure of failures) {
      console.log(`- \`${failure.locale}\`: ${failure.count} ${failure.description}`);
    }
    return failures.length ? 1 : 0;
  }

  const pad = (value, width) => String(value).padEnd(width);
  console.log(`${pad('locale', 8)}${pad('keys', 8)}${pad('untransl.', 11)}${pad('forbidden', 11)}parse/missing`);
  for (const s of summaries) {
    console.log(
      pad(s.locale, 8) +
        pad(s.keyCount, 8) +
        pad(s.untranslatedCount ?? 0, 11) +
        pad(s.forbiddenViolationCount ?? 0, 11) +
        `${s.parseErrorCount ?? 0}/${s.missingFileCount ?? 0}`,
    );
  }

  if (failures.length === 0) {
    console.log('\nPASSED');
    return 0;
  }

  console.log('\nFAILED');
  for (const failure of failures) {
    console.log(`  ${failure.locale}: ${failure.count} ${failure.description}`);
  }
  console.log('\nRun `node tools/i18n/audit.cjs --locale <code>` for the per-key detail.');
  return 1;
}

process.exit(main());
