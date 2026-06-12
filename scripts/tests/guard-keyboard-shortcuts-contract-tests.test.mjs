import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('../..', import.meta.url).pathname;

function runGuard(testDir) {
  const script = `
    import { readdirSync, readFileSync } from 'node:fs';
    import { join } from 'node:path';
    const dir = ${JSON.stringify(testDir)};
    const violations = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.contract.test.ts')) continue;
      const source = readFileSync(join(dir, entry.name), 'utf8');
      const grepsSource = source.includes('readFileSync') && source.includes('toContain');
      const hasBehavior = /@behavioralCoverage\\s+\\S+/.test(source) || /\\b(render|fireEvent|dispatchShortcut|userEvent)\\b/.test(source) || /\\.toHaveBeenCalled/.test(source);
      if (grepsSource && !hasBehavior) violations.push(entry.name);
    }
    if (violations.length) {
      console.error(violations.join('\\n'));
      process.exit(1);
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('contract-test guard fails grep-only contract tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyboard-contract-guard-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'bad.contract.test.ts'),
    "import { readFileSync } from 'node:fs';\nit('bad', () => expect(readFileSync('x','utf8')).toContain('y'));\n",
  );

  const result = runGuard(dir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bad\.contract\.test\.ts/);
});

test('contract-test guard passes contract tests with behavioral coverage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyboard-contract-guard-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'good.contract.test.ts'),
    "import { readFileSync } from 'node:fs';\n/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/gap-hardening.behavior.test.tsx */\nit('good', () => expect(readFileSync('x','utf8')).toContain('y'));\n",
  );

  const result = runGuard(dir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
