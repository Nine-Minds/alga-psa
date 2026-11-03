import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tsupConfig from '../tsup.config';

/**
 * `@alga-psa/*` imports matched by `noExternal` in `shared/tsup.config.ts` are
 * bundled into shared/dist. Image builds (e.g. ee/temporal-workflows/Dockerfile)
 * run `tsup` in /app/shared before any workspace install, so there is no
 * node_modules/@alga-psa symlink to resolve them through; they must resolve via
 * shared/tsconfig.json `paths`. This bundles each such import from an isolated
 * tree (shared tsconfig + ../packages, no node_modules) to mirror that build.
 */

const repoRoot = path.resolve(__dirname, '../..');
const sharedRoot = path.resolve(repoRoot, 'shared');

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') return [];
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return collectSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function inlinedAlgaSpecifiers(): string[] {
  const patterns = (tsupConfig as { noExternal?: (string | RegExp)[] }).noExternal ?? [];
  const matches = (specifier: string) =>
    patterns.some((p) => (typeof p === 'string' ? p === specifier : p.test(specifier)));
  const specifiers = new Set<string>();
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](@alga-psa\/[^"']+)["']/g;
  for (const file of collectSourceFiles(sharedRoot)) {
    for (const match of readFileSync(file, 'utf8').matchAll(importPattern)) {
      if (matches(match[1])) specifiers.add(match[1]);
    }
  }
  return [...specifiers].sort();
}

let isolatedShared: string;

beforeAll(() => {
  const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), 'shared-noexternal-'));
  isolatedShared = path.join(isolatedRoot, 'shared');
  mkdirSync(isolatedShared);
  copyFileSync(path.join(sharedRoot, 'tsconfig.json'), path.join(isolatedShared, 'tsconfig.json'));
  symlinkSync(path.join(repoRoot, 'packages'), path.join(isolatedRoot, 'packages'), 'dir');
});

afterAll(() => {
  if (isolatedShared) rmSync(path.dirname(isolatedShared), { recursive: true, force: true });
});

describe('shared noExternal @alga-psa imports', () => {
  const specifiers = inlinedAlgaSpecifiers();

  it('finds the inlined @alga-psa imports used by shared source', () => {
    expect(specifiers).toContain('@alga-psa/licensing/lifecycle-error');
  });

  it.each(specifiers)('bundles %s without workspace node_modules', async (specifier) => {
    const entry = path.join(isolatedShared, `${specifier.replace(/\W+/g, '_')}.ts`);
    writeFileSync(entry, `export * from '${specifier}';\n`);

    const result = await build({
      entryPoints: [entry],
      absWorkingDir: isolatedShared,
      tsconfig: path.join(isolatedShared, 'tsconfig.json'),
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
    });

    expect(result.errors).toEqual([]);
    expect(result.outputFiles[0].text).not.toContain('@alga-psa/');
  });
});
