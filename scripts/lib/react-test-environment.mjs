import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isAdditionalWorkspaceTest } from './test-discovery.mjs';
import { matchesJsdomGlob } from './jsdom-test-globs.mjs';

// A React test that reaches neither a jsdom glob nor a docblock runs under
// `environment: 'node'` and fails on the first `window`/`document` it touches —
// the most common flake in the server unit shards. This is the rule that keeps
// new ones from landing.

// Value imports that need a browser environment. Type-only imports do not, and
// neither does a string that merely mentions react inside a comment, so the
// pattern anchors on the import/require forms.
const REACT_MODULES = String.raw`react|react-dom(?:/[\w./-]+)?|@testing-library/react|next/navigation`;
const REACT_IMPORT = new RegExp(
  String.raw`(?:^|\n)\s*import\s+(?!type\b)[^;'"]*?from\s*['"](?:${REACT_MODULES})['"]`
  + String.raw`|(?:^|\n)\s*import\s*['"](?:${REACT_MODULES})['"]`
  + String.raw`|(?:require|import)\s*\(\s*['"](?:${REACT_MODULES})['"]\s*\)`,
);

const DOCBLOCK = /@vitest-environment\s+(\S+)/;

// Only the two lanes this card covers. The server unit lane is the shard
// selection scripts/run-server-unit-shard.mjs passes to vitest; the colocated
// lane already has a predicate in test-discovery.mjs.
export function isGatedReactTestLane(file) {
  if (isAdditionalWorkspaceTest(file, 'server-colocated')) return true;
  return /^(server\/src\/test\/unit|packages|shared|ee\/packages\/workflows\/src\/actions)\//.test(file)
    && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
    && !/(^|\/)(node_modules|dist)\//.test(file)
    && !/\.db\.test\.[cm]?[jt]sx?$/.test(file);
}

export function importsReact(source) {
  return REACT_IMPORT.test(source);
}

export function declaredEnvironment(source) {
  // Vitest only reads the docblock at the top of the file.
  return DOCBLOCK.exec(source.slice(0, 2000))?.[1] ?? null;
}

export function inspectReactTest({ file, source }) {
  const react = importsReact(source);
  const environment = declaredEnvironment(source);
  const covered = matchesJsdomGlob(file);
  return { file, react, environment, covered };
}

// `read` is injected so the unit tests can drive fixtures without a repository.
export function reconcileReactTestEnvironments({ root, files, read = (file) => readFileSync(path.resolve(root, file), 'utf8') }) {
  const failures = [];
  const tests = [];
  for (const file of files) {
    if (!isGatedReactTestLane(file)) continue;
    const result = inspectReactTest({ file, source: read(file) });
    if (!result.react) continue;
    tests.push(result);
    if (result.covered || result.environment) continue;
    failures.push(`React test runs under node: ${file}`
      + ' — rename it to *.test.tsx, move it beside its components, or add it to'
      + ' JSDOM_EXTRA_FILES in scripts/lib/jsdom-test-globs.mjs');
  }
  return {
    schemaVersion: 1,
    scope: 'react-test-environment',
    status: failures.length ? 'failed' : 'passed',
    tests: tests.map(({ file, environment, covered }) => ({ file, environment, covered })),
    failures,
  };
}
