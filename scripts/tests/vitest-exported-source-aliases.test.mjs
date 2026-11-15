import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportedSourceAliases } from '../lib/vitest-exported-source-aliases.mjs';

test('aliases each exported source subpath to its types entry, exactly', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'exported-aliases-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      exports: {
        '.': { types: './src/index.ts' },
        './config/deletion': { types: './src/config/deletion/index.ts' },
        './features': { types: './src/lib/features.ts' },
        './built': { types: './dist/built.d.ts' },
      },
    }));
    const aliases = exportedSourceAliases('@scope/pkg', dir);
    assert.deepEqual(aliases.map((a) => a.replacement), [
      path.join(dir, 'src/config/deletion/index.ts'),
      path.join(dir, 'src/lib/features.ts'),
    ]);
    const [deletion] = aliases;
    assert.ok(deletion.find.test('@scope/pkg/config/deletion'));
    assert.ok(!deletion.find.test('@scope/pkg/config/deletion/extra'));
    assert.ok(!deletion.find.test('@scope/pkgXconfig/deletion'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
