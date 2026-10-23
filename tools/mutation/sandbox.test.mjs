import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { Minimatch } from 'minimatch';
import strykerConfig from '../../stryker.config.mjs';
import vitestConfig from './vitest.config.ts';

// Stryker copies only the files its ignorePatterns let through. A suite whose
// local import graph leaves that sandbox fails to load there and silently
// contributes no tests, so every local module the suites reach must be copied.
const root = vitestConfig.root;
const aliases = Object.entries(vitestConfig.resolve.alias);
const specifierPattern = /(?:^|\s)(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveLocal(fromFile, specifier) {
  const alias = aliases.find(([key]) => specifier === key);
  const base = alias ? alias[1] : specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : null;
  if (!base) return null; // package import, supplied by Stryker's node_modules
  const candidate = [base, `${base}.ts`, `${base}/index.ts`].find((file) => existsSync(file) && file.endsWith('.ts'));
  assert.ok(candidate, `Cannot resolve ${specifier} from ${relative(root, fromFile)}`);
  return candidate;
}

function localImportClosure(entryFiles) {
  const seen = new Set();
  const pending = entryFiles.map((file) => resolve(root, file));
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, fromSpecifier, bareSpecifier] of readFileSync(file, 'utf8').matchAll(specifierPattern)) {
      const dependency = resolveLocal(file, fromSpecifier ?? bareSpecifier);
      if (dependency) pending.push(dependency);
    }
  }
  return [...seen].map((file) => relative(root, file));
}

// Mirrors Stryker's ProjectReader file rule: the last matching pattern wins.
function copiedIntoSandbox(file) {
  const rules = strykerConfig.ignorePatterns.map((pattern) => new Minimatch(pattern, { dot: true, flipNegate: true, nocase: true }));
  return rules.reduce((included, rule) =>
    rule.negate !== included && (rule.match(file) || rule.match(`/${file}`)) ? rule.negate : included, true);
}

test('the sandbox contains every local module the maintained suites import', () => {
  const closure = localImportClosure(vitestConfig.test.include);
  assert.ok(closure.length > vitestConfig.test.include.length, 'Suites must reach the modules under test');
  assert.deepEqual(closure.filter((file) => !copiedIntoSandbox(file)), [],
    'Add these files to the ignorePatterns allow-list in stryker.config.mjs');
});

test('the sandbox guard rejects a module outside the allow-list', () => {
  assert.equal(copiedIntoSandbox('packages/authorization/src/kernel/scope.ts'), true);
  assert.equal(copiedIntoSandbox('packages/authorization/src/index.ts'), false);
});
