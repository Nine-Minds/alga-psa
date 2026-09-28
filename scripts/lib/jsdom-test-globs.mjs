import path from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';
import { globSync } from 'tinyglobby';

// Single source of truth for which server-lane test files run under jsdom.
// The vitest configs partition their lanes with it and
// scripts/verify-react-test-environment.mjs gates new React tests against it,
// so the rule can never mean two different things in two places.
//
// Per-file `@vitest-environment` docblocks still win over whatever project a
// file lands in (verified on vitest 3.2.7 and 4.1.11, both directions), so the
// ~200 files that deliberately pin themselves to `node` keep running on node
// even inside the jsdom project, and the pre-existing jsdom docblocks outside
// these globs keep working untouched.
export const JSDOM_TEST_GLOBS = [
  // Anything with JSX in it renders components.
  '**/*.{test,spec}.?(c|m)[jt]sx',
  // Component suites that assert on rendered output without JSX of their own.
  '**/components/**/*.{test,spec}.?(c|m)[jt]s',
];

// Vitest include globs are relative to the config root (server/), and `**`
// never crosses the literal `..` segment, so lanes that reach into sibling
// workspaces need the parent-relative spelling too.
export const JSDOM_TEST_GLOBS_FROM_SERVER = [
  ...JSDOM_TEST_GLOBS,
  ...JSDOM_TEST_GLOBS.map((glob) => `../${glob}`),
];

// React suites whose path the globs above cannot express. Repository-relative.
export const JSDOM_EXTRA_FILES = [
  'packages/scheduling/tests/schedulingProvider.launchParams.test.ts',
  'server/src/test/unit/app/auth/msp/signin/page.test.ts',
  'server/src/test/unit/app/auth/client-portal/signin/page.test.ts',
];

// Escape hatch for suites the glob claims but that genuinely need node (fetch,
// Buffer, structuredClone and friends differ under jsdom). Repository-relative.
// Prefer fixing the test; a pin is a standing exception, not a resting place.
export const NODE_PINNED_FILES = [];

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matchesGlob = picomatch(JSDOM_TEST_GLOBS);
const extraFiles = new Set(JSDOM_EXTRA_FILES);
const pinnedFiles = new Set(NODE_PINNED_FILES);

for (const file of pinnedFiles) {
  if (extraFiles.has(file)) {
    throw new Error(`A file cannot be both a jsdom extra and a node pin: ${file}`);
  }
}

// Repository-relative POSIX identity, the same spelling the test inventory and
// the execution evidence use.
export function toRepositoryPath(file, from = repositoryRoot) {
  return path.relative(repositoryRoot, path.resolve(from, file)).split(path.sep).join('/');
}

export function matchesJsdomGlob(file) {
  const identity = toRepositoryPath(file);
  if (pinnedFiles.has(identity)) return false;
  return extraFiles.has(identity) || matchesGlob(identity);
}

// Splits an already-resolved file list into the two projects. `files` are
// relative to `cwd` and come back in the same spelling, so the union of the two
// halves reproduces the caller's list exactly.
export function partitionByEnvironment(files, cwd = repositoryRoot) {
  const jsdom = [];
  const node = [];
  for (const file of files) (matchesJsdomGlob(path.resolve(cwd, file)) ? jsdom : node).push(file);
  return { jsdom: jsdom.sort(), node: node.sort() };
}

// Resolves a lane's file set exactly the way vitest does — same globber, same
// options as Vitest#globFiles — and splits it. Vitest cannot intersect two
// include globs, and a project's `include` is concatenated onto the config it
// extends rather than replacing it, so each project narrows through `exclude`
// instead: it drops the other half by explicit path.
export function resolveEnvironmentPartition({ include, exclude, cwd }) {
  const files = globSync(include, { dot: true, cwd, ignore: exclude, expandDirectories: false });
  return partitionByEnvironment(files, cwd);
}

// The two vitest projects a partition becomes. `extends: true` re-reads the
// lane's own config file so each project keeps its aliases, setup files and
// pool settings; vite concatenates merged arrays, so a project can only narrow
// through `exclude` — each one drops the other half by explicit path.
export function environmentProjects({ jsdom, node }) {
  return [
    { extends: true, test: { name: 'jsdom', environment: 'jsdom', exclude: node } },
    { extends: true, test: { name: 'node', environment: 'node', exclude: jsdom } },
  ];
}
