import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo-root-relative file access for source-reading contract tests.
 *
 * These tests assert on source text, so they need repo-relative paths like
 * `packages/billing/src/...`. Resolving those against `process.cwd()` only
 * works when the runner happens to start at the repo root (the nx job does;
 * the server unit suite runs from `server/`, which turns the same path into
 * `server/packages/billing/...`). Walk up from this file instead, so the
 * paths hold no matter who invokes the test.
 */
function findRepoRoot(): string {
  let dir = __dirname;
  while (true) {
    if (fs.existsSync(path.join(dir, 'packages')) && fs.existsSync(path.join(dir, 'server'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the repo root walking up from ${__dirname}`);
    }
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();

/** Absolute path for a repo-root-relative path. */
export const repoPath = (relativePath: string): string => path.resolve(REPO_ROOT, relativePath);

/** Read a repo-root-relative source file as UTF-8 text. */
export const readRepoFile = (relativePath: string): string =>
  fs.readFileSync(repoPath(relativePath), 'utf8');
