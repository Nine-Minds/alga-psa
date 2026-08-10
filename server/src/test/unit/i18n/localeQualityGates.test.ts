import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Runs the `tools/i18n` locale audits as part of the unit suite.
 *
 * That toolchain — per-locale glossaries, forbidden-term matchers, allowlists
 * and review ledgers — already existed but ran in no suite and no workflow, so
 * nothing enforced it. These are the checks a pack-parity comparison cannot
 * make: `validate-translations.cjs` proves the locales have the same keys as
 * English, not that the values are in the right language.
 *
 * Correctness counters are gated. Review coverage is reported by
 * `audit-all.cjs` but deliberately not asserted: a key is not wrong for being
 * new, and self-certifying a translation as reviewed would empty the ledger of
 * meaning.
 */

const repoRoot = path.resolve(process.cwd(), '..');
const registry = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tools/i18n/locales.registry.json'), 'utf8'),
) as Record<string, { dir: string; glossary: string; reviewState: string; dialect: string }>;

const locales = Object.keys(registry);

interface AuditSummary {
  locale: string;
  keyCount: number;
  untranslatedCount: number;
  forbiddenViolationCount: number;
  parseErrorCount: number;
  missingFileCount: number;
  unreviewedCount: number;
}

// One child process for the whole matrix rather than one per locale: the audit
// re-reads all 48 English namespaces each time it starts.
function runAuditAll(): { summaries: AuditSummary[]; failures: Array<Record<string, unknown>> } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(repoRoot, 'tools/i18n/audit-all.cjs'), '--json'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch (error) {
    // Non-zero exit still carries the JSON report on stdout.
    const execError = error as { stdout?: string };
    if (execError.stdout) return JSON.parse(execError.stdout);
    throw error;
  }
}

const report = runAuditAll();
const summaryFor = (locale: string) => report.summaries.find((s) => s.locale === locale);

describe('locale quality gates', () => {
  it('audits every registered locale', () => {
    expect(report.summaries.map((s) => s.locale).sort()).toEqual([...locales].sort());
    expect(locales.length).toBeGreaterThanOrEqual(7);
  });

  it.each(locales)('%s has no English left in its pack', (locale) => {
    const summary = summaryFor(locale)!;

    // Strings identical to English that are not in the glossary's
    // identicalAllowlist — the shape a machine-filled pack leaves behind.
    expect(summary.untranslatedCount, `run: node tools/i18n/audit.cjs --locale ${locale}`).toBe(0);
  });

  it.each(locales)('%s violates none of its glossary forbidden terms', (locale) => {
    const summary = summaryFor(locale)!;

    // Catches the false-friend class directly: "Gasoduto" for a sales pipeline,
    // "Conselho" for a kanban board, "Deska" for a plank of wood.
    expect(summary.forbiddenViolationCount, `run: node tools/i18n/audit.cjs --locale ${locale}`).toBe(0);
  });

  it.each(locales)('%s parses cleanly and is missing no namespace', (locale) => {
    const summary = summaryFor(locale)!;

    expect(summary.parseErrorCount).toBe(0);
    expect(summary.missingFileCount).toBe(0);
  });

  it.each(locales)('%s has a glossary with domain and forbidden terms', (locale) => {
    const entry = registry[locale];
    const glossaryPath = path.join(repoRoot, entry.dir, entry.glossary);

    expect(fs.existsSync(glossaryPath), `${locale} has no glossary at ${entry.dir}/${entry.glossary}`).toBe(true);

    const glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
    expect(glossary.locale).toBe(locale);
    expect(glossary.dialect).toBe(entry.dialect);
    expect(Array.isArray(glossary.domainTerms) && glossary.domainTerms.length).toBeTruthy();
    expect(Array.isArray(glossary.forbiddenTerms) && glossary.forbiddenTerms.length).toBeTruthy();
  });

  it('audited a meaningful number of keys', () => {
    // A registry or path change that quietly audited nothing would otherwise
    // leave every assertion above trivially green.
    for (const summary of report.summaries) {
      expect(summary.keyCount, `${summary.locale} audited no keys`).toBeGreaterThan(1_000);
    }
  });
});
