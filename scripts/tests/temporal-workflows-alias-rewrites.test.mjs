import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findUnrewrittenAliases,
  verifyDist,
} from '../../ee/temporal-workflows/scripts/verify-alias-rewrites.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const tscAlias = join(repoRoot, 'node_modules/tsc-alias/dist/bin/index.js');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

// Builds a miniature worker whose emitted file imports `@db/tenantDb` and runs
// the real tsc-alias over it, so the test exercises the resolver behaviour the
// worker build depends on rather than a model of it.
function aliasProject(paths) {
  const root = mkdtempSync(join(tmpdir(), 'tw-alias-'));
  mkdirSync(join(root, 'dist/db/lib'), { recursive: true });
  mkdirSync(join(root, 'dist/app'), { recursive: true });
  writeFileSync(join(root, 'dist/db/lib/tenant.js'), 'export const tenant = 1;\n');
  writeFileSync(join(root, 'dist/db/lib/tenantDb.js'), 'export const tenantDb = 1;\n');
  writeFileSync(
    join(root, 'dist/app/consumer.js'),
    "import { tenant } from '@db/tenant';\nimport { tenantDb } from '@db/tenantDb';\nexport { tenant, tenantDb };\n",
  );
  writeJson(join(root, 'tsconfig.json'), {
    compilerOptions: { baseUrl: '.', rootDir: 'src', outDir: 'dist', paths },
  });
  mkdirSync(join(root, 'src/db/lib'), { recursive: true });
  mkdirSync(join(root, 'src/app'), { recursive: true });
  execFileSync(process.execPath, [tscAlias, '-p', join(root, 'tsconfig.json')], { cwd: root, stdio: 'pipe' });
  return root;
}

test('an exact alias that prefixes a sibling wildcard target leaves the sibling import bare, and the verifier reports it', () => {
  const root = aliasProject({
    '@db/tenant': ['src/db/lib/tenant.ts'],
    '@db/*': ['src/db/lib/*'],
  });
  try {
    const emitted = readFileSync(join(root, 'dist/app/consumer.js'), 'utf8');
    assert.match(emitted, /from '@db\/tenantDb'/, 'tsc-alias still shadows the wildcard with the exact alias');

    const findings = verifyDist({ tsconfigPath: join(root, 'tsconfig.json'), distDir: join(root, 'dist') });
    assert.deepEqual(findings, [{ file: join('app', 'consumer.js'), specifier: '@db/tenantDb' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the wildcard alone rewrites every in-repo import and the verifier passes', () => {
  const root = aliasProject({ '@db/*': ['src/db/lib/*'] });
  try {
    const emitted = readFileSync(join(root, 'dist/app/consumer.js'), 'utf8');
    assert.doesNotMatch(emitted, /from '@db\//);
    assert.deepEqual(verifyDist({ tsconfigPath: join(root, 'tsconfig.json'), distDir: join(root, 'dist') }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('aliases that point into node_modules name installed packages and may stay bare', () => {
  const findings = findUnrewrittenAliases({
    paths: {
      '@temporalio/client': ['../../node_modules/@temporalio/client'],
      '@alga-psa/db/*': ['../../packages/db/src/lib/*'],
    },
    files: [{
      file: 'worker.js',
      source: [
        "import { Client } from '@temporalio/client';",
        "import { x } from '../packages/db/src/lib/tenantDb.js';",
        "const m = await import('@alga-psa/db/tenantTableManifest');",
      ].join('\n'),
    }],
  });
  assert.deepEqual(findings, [{ file: 'worker.js', specifier: '@alga-psa/db/tenantTableManifest' }]);
});

test('the worker tsconfig declares no exact alias that shadows the @alga-psa/db wildcard', () => {
  const { compilerOptions } = JSON.parse(
    readFileSync(join(repoRoot, 'ee/temporal-workflows/tsconfig.json'), 'utf8'),
  );
  const shadowing = Object.keys(compilerOptions.paths)
    .filter((alias) => alias.startsWith('@alga-psa/db/') && !alias.endsWith('*'));
  assert.deepEqual(shadowing, []);
});
