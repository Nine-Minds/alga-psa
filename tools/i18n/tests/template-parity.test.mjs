import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { checkAllTemplates } = require('../check-template-parity.cjs');
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const translationsRoot = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(readFileSync(join(translationsRoot, 'locales.registry.json'), 'utf8'));
const parityScript = join(translationsRoot, 'check-template-parity.cjs');

for (const locale of Object.keys(registry)) {
  test(`${locale} template parity command runs cleanly`, (t) => {
    const coverage = checkAllTemplates({ locale });
    if (coverage.skipped) {
      t.skip(`${locale}: no templates found`);
      return;
    }

    const result = spawnSync(process.execPath, [parityScript, '--locale', locale], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.ok([0, 1].includes(result.status), `unexpected exit status ${result.status}`);
    if (result.status === 0) {
      assert.match(result.stdout, new RegExp(`${locale} template parity passed`));
    } else {
      assert.match(result.stderr, new RegExp(`${locale} template parity failed with \\d+ error\\(s\\):`));
    }
  });
}
