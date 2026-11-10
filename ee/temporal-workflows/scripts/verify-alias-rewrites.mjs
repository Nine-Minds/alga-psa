#!/usr/bin/env node
// tsc-alias resolves an import to the deepest alias in its prefix trie and gives
// up silently when that alias does not actually match. An exact alias such as
// `@alga-psa/db/tenant` therefore shadows the `@alga-psa/db/*` wildcard for
// `@alga-psa/db/tenantDb`, and the emitted worker keeps a bare specifier that
// only resolves when the package's own dist happens to have been built.
// This check fails the build whenever any emitted import still names a
// tsconfig `paths` alias that targets in-repo source, whatever the reason
// tsc-alias skipped it. Aliases that point into node_modules name installed
// packages and are meant to stay bare.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

export function aliasMatcher(paths) {
  const exact = new Set();
  const prefixes = [];
  for (const [alias, targets] of Object.entries(paths ?? {})) {
    if (targets.every((target) => /(?:^|\/)node_modules\//.test(target))) continue;
    if (alias.endsWith('*')) prefixes.push(alias.slice(0, -1));
    else exact.add(alias);
  }
  return (specifier) =>
    exact.has(specifier) || prefixes.some((prefix) => specifier.startsWith(prefix) && specifier.length > prefix.length);
}

export function findUnrewrittenAliases({ paths, files }) {
  const isAlias = aliasMatcher(paths);
  const findings = [];
  for (const { file, source } of files) {
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[2];
      if (isAlias(specifier)) findings.push({ file, specifier });
    }
  }
  return findings;
}

function* emittedJs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* emittedJs(path);
    else if (/\.(?:m|c)?js$/.test(entry.name)) yield path;
  }
}

export function verifyDist({ tsconfigPath, distDir }) {
  const { compilerOptions } = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  const files = [...emittedJs(distDir)].map((file) => ({
    file: relative(distDir, file),
    source: readFileSync(file, 'utf8'),
  }));
  return findUnrewrittenAliases({ paths: compilerOptions?.paths, files });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = verifyDist({ tsconfigPath: join(root, 'tsconfig.json'), distDir: join(root, 'dist') });
  if (findings.length > 0) {
    console.error('Emitted worker imports still use tsconfig path aliases (tsc-alias did not rewrite them):');
    for (const { file, specifier } of findings) console.error(`  ${file}: ${specifier}`);
    process.exit(1);
  }
  console.log('Every tsconfig path alias in the emitted worker was rewritten to a relative import.');
}
