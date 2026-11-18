import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * `shared/tsup.config.ts` externalizes `@alga-psa/*`, so every such import left
 * in `shared/dist` is resolved by native Node (server, Temporal worker) through
 * the target package's exports map. A package whose export points at
 * TypeScript source (e.g. `@alga-psa/licensing`) loads under Vitest/Next but
 * fails natively with ERR_MODULE_NOT_FOUND, so it must be inlined via
 * `noExternal` instead. This checks every emitted specifier statically, which
 * also covers lazily imported modules that a single native load never reaches.
 * CI builds the workspace packages before these tests run.
 */

const repoRoot = path.resolve(__dirname, '../..');
const sharedDist = path.resolve(repoRoot, 'shared/dist');

function collectJsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return collectJsFiles(full);
    return entry.endsWith('.js') ? [full] : [];
  });
}

function collectAlgaSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](@alga-psa\/[^"']+)["']/g;
  for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  return [...specifiers];
}

type ExportTarget = string | null | { [condition: string]: ExportTarget } | ExportTarget[];

// Native ESM import resolution: first matching condition in declaration order.
function pickTarget(target: ExportTarget): string | null {
  if (target === null) return null;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const picked = pickTarget(item);
      if (picked) return picked;
    }
    return null;
  }
  for (const [condition, value] of Object.entries(target)) {
    if (condition === 'import' || condition === 'node' || condition === 'default') {
      const picked = pickTarget(value);
      if (picked) return picked;
    }
  }
  return null;
}

function resolveExport(pkg: { exports?: Record<string, ExportTarget> | string; main?: string }, subpath: string): string | null {
  const exportsField = pkg.exports;
  if (exportsField === undefined) return subpath === '.' ? pkg.main ?? 'index.js' : subpath;
  if (typeof exportsField === 'string') return subpath === '.' ? exportsField : null;
  if (subpath in exportsField) return pickTarget(exportsField[subpath]);
  for (const [key, value] of Object.entries(exportsField)) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= key.length - 1) {
      const target = pickTarget(value);
      return target ? target.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length)) : null;
    }
  }
  return null;
}

describe('shared dist external @alga-psa imports', () => {
  it('pickTarget/resolveExport flag a source-only export and accept a dist export', () => {
    const sourceOnly = { exports: { './lifecycle-error': { types: './src/lifecycle-error.ts', import: './src/lifecycle-error.ts' } } };
    expect(resolveExport(sourceOnly, './lifecycle-error')).toBe('./src/lifecycle-error.ts');
    const built = { exports: { './handlers/*': { types: './src/handlers/*.ts', import: './dist/handlers/*.js' } } };
    expect(resolveExport(built, './handlers/x')).toBe('./dist/handlers/x.js');
  });

  it('resolves every externalized @alga-psa import to a JavaScript export natively', () => {
    const files = collectJsFiles(sharedDist);
    expect(files.length, 'Expected shared/dist; build @alga-psa/shared first.').toBeGreaterThan(0);

    const specifiers = new Map<string, string>();
    for (const file of files) {
      for (const specifier of collectAlgaSpecifiers(readFileSync(file, 'utf8'))) {
        if (!specifiers.has(specifier)) specifiers.set(specifier, path.relative(repoRoot, file));
      }
    }
    expect(specifiers.size).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const [specifier, file] of specifiers) {
      const [scope, name, ...rest] = specifier.split('/');
      const pkgJson = path.join(repoRoot, 'node_modules', scope, name, 'package.json');
      if (!existsSync(pkgJson)) {
        problems.push(`${specifier} (from ${file}): package ${scope}/${name} is not installed`);
        continue;
      }
      const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
      const subpath = rest.length ? `./${rest.join('/')}` : '.';
      const target = resolveExport(pkg, subpath);
      if (!target) {
        problems.push(`${specifier} (from ${file}): not exported`);
      } else if (/\.(c|m)?tsx?$/.test(target)) {
        problems.push(`${specifier} (from ${file}): exports TypeScript source ${target}; add it to noExternal`);
      }
    }
    expect(problems).toEqual([]);
  });
});
