import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const guardScript = new URL('../guard-keyboard-shortcuts-boundary.mjs', import.meta.url).pathname;
const repoRoot = new URL('../..', import.meta.url).pathname;

test('keyboard shortcuts boundary guard passes for current engine imports', () => {
  const result = spawnSync(process.execPath, [guardScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('keyboard shortcuts boundary guard fails for feature/user-composition imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyboard-shortcuts-boundary-'));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(
    join(dir, 'nested', 'bad.ts'),
    "import { useUserPreference } from '@alga-psa/user-composition/hooks';\nimport '@alga-psa/tickets';\n",
  );

  const result = spawnSync(process.execPath, [guardScript, '--engine-dir', dir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /@alga-psa\/user-composition\/hooks/);
  assert.match(result.stderr, /@alga-psa\/tickets/);
});

test('keyboard shortcuts boundary guard fails for hand-authored registered action metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyboard-shortcuts-drift-'));
  const badFile = join(dir, 'bad.tsx');
  writeFileSync(
    badFile,
    "useShortcutAction({ id: 'global.search', labelKey: 'x', groupKey: 'y', defaultBindings: ['mod+k'], scope: 'global', handler: () => undefined });\n",
  );

  const result = spawnSync(process.execPath, [guardScript, '--registration-file', badFile], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Catalog drift/);
  assert.match(result.stderr, /defaultBindings:/);
});

test('keyboard shortcuts boundary guard fails for catalog shortcut ids missing from the catalog', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyboard-shortcuts-missing-id-'));
  const badFile = join(dir, 'bad.tsx');
  writeFileSync(badFile, "useCatalogShortcut('missing.action', () => undefined);\n");

  const result = spawnSync(process.execPath, [guardScript, '--registration-file', badFile], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing\.action/);
});
