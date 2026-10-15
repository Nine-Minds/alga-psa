#!/usr/bin/env node
/**
 * Verify that every `@alga-psa/*` subpath reachable from a built workspace
 * barrel actually resolves under plain Node ESM.
 *
 * Why this exists: the Next build resolves bare `@alga-psa/*` specifiers
 * through webpack aliases pointed at `src/` (see the note in
 * server/next.config.mjs), so it never consults a package's `exports` map. The
 * plain-Node consumers -- the workflow worker, the temporal worker and
 * packages/jobs' handlers -- do. A package can therefore export a subpath with
 * no dist file, or point its `import` condition at a `.ts` source, and every
 * app-side check still passes while the workers die at startup with
 * ERR_MODULE_NOT_FOUND.
 *
 * Importing the barrel only reports the FIRST broken specifier, so fixing one
 * merely uncovers the next. This walks the whole reachable graph with Node's
 * own ESM resolver and reports every failure at once.
 *
 * Usage: node scripts/check-workspace-dist-resolution.mjs [entry ...] [--json]
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_ENTRIES = [
  // packages/jobs' coManagedUploadCleanupHandler imports this barrel directly,
  // which makes it the widest graph any plain-Node worker loads.
  'packages/co-managed/dist/index.js',
];

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function specifiersIn(source) {
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

const rel = (p) => p.replace(`${REPO_ROOT}/`, '');

function walk(entryPath) {
  const failures = [];
  const seen = new Set();
  const queue = [entryPath];

  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    let source;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const parentUrl = pathToFileURL(file).href;

    for (const specifier of specifiersIn(source)) {
      if (specifier.startsWith('node:')) continue;

      if (specifier.startsWith('.')) {
        const base = resolvePath(dirname(file), specifier);
        const next = [base, `${base}.js`, `${base}/index.js`].find((p) => existsSync(p));
        // A missing relative path inside a bundle is a bundler defect, not an
        // exports-map defect; Node surfaces it directly on import.
        if (next) queue.push(next);
        continue;
      }

      if (!specifier.startsWith('@alga-psa/')) continue;

      let resolvedUrl;
      try {
        // Node's real ESM resolver, with the `import` condition -- exactly what
        // a worker does. `createRequire().resolve` would apply the `require`
        // condition instead and report false failures for import-only exports.
        resolvedUrl = import.meta.resolve(specifier, parentUrl);
      } catch (error) {
        failures.push({ specifier, importedFrom: rel(file), reason: error?.code ?? String(error) });
        continue;
      }

      if (!resolvedUrl.startsWith('file:')) continue;
      const resolvedPath = fileURLToPath(resolvedUrl);

      if (/\.tsx?$/.test(resolvedPath)) {
        failures.push({
          specifier,
          importedFrom: rel(file),
          reason: `exports map points at TypeScript source (${rel(resolvedPath)}); plain Node cannot load it`,
        });
        continue;
      }
      if (!existsSync(resolvedPath)) {
        failures.push({
          specifier,
          importedFrom: rel(file),
          reason: `resolves to ${rel(resolvedPath)}, which does not exist (is the package built?)`,
        });
        continue;
      }
      queue.push(resolvedPath);
    }
  }
  return { failures, visited: seen.size };
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const entries = args.filter((a) => !a.startsWith('--'));
const targets = (entries.length > 0 ? entries : DEFAULT_ENTRIES).map((e) => resolvePath(REPO_ROOT, e));

const all = [];
let visited = 0;
for (const target of targets) {
  if (!existsSync(target)) {
    all.push({ specifier: rel(target), importedFrom: '(entry)', reason: 'entry not built' });
    continue;
  }
  const result = walk(target);
  all.push(...result.failures);
  visited += result.visited;
}

// One row per (specifier, reason); which bundler chunk saw it first is noise.
const unique = [...new Map(all.map((f) => [`${f.specifier} ${f.reason}`, f])).values()];

if (asJson) {
  console.log(JSON.stringify({ failures: unique, visited }, null, 2));
} else if (unique.length === 0) {
  console.log(`OK: ${visited} built modules walked, every @alga-psa/* subpath resolves under plain Node.`);
} else {
  console.error(`${unique.length} unresolvable workspace subpath(s):`);
  console.error('');
  for (const f of unique) {
    console.error(`  ${f.specifier}`);
    console.error(`    first seen in ${f.importedFrom}`);
    console.error(`    ${f.reason}`);
    console.error('');
  }
}
process.exit(unique.length === 0 ? 0 : 1);
