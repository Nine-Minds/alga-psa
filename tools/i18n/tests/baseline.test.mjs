import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { compareBaseline, runAudit } = require('../audit.cjs');
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const translationsRoot = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(readFileSync(join(translationsRoot, 'locales.registry.json'), 'utf8'));

for (const [locale, config] of Object.entries(registry)) {
  test(`${locale} audit does not regress from baseline`, (t) => {
    const glossaryPath = join(repoRoot, config.dir, config.glossary);
    const baselinePath = join(repoRoot, config.dir, 'baseline.json');
    if (!existsSync(glossaryPath) || !existsSync(baselinePath)) {
      const missing = [
        !existsSync(glossaryPath) ? 'glossary' : null,
        !existsSync(baselinePath) ? 'baseline' : null,
      ].filter(Boolean).join(' and ');
      t.skip(`${locale}: ${missing} not found`);
      return;
    }

    const result = runAudit({ locale, writeReport: false });
    assert.equal(result.skipped, false, result.message);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const comparison = compareBaseline(result.report, baseline);
    assert.equal(comparison.regressed, false, JSON.stringify(comparison.deltas, null, 2));
  });
}
