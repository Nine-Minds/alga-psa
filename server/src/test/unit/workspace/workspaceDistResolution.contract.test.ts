import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * Plain-Node consumers -- the workflow worker, the temporal worker and
 * packages/jobs' handlers -- load the *built* workspace barrels through each
 * package's `exports` map. The Next build does not: webpack aliases bare
 * `@alga-psa/*` specifiers straight at `src/` (see the note in
 * server/next.config.mjs), so a package can export a subpath with no dist file,
 * or point its `import` condition at a `.ts` source, and every app-side check
 * still passes while the workers die at startup with ERR_MODULE_NOT_FOUND.
 *
 * The walk itself lives in scripts/check-workspace-dist-resolution.mjs so CI and
 * a developer at a terminal run exactly what this asserts. It must run as a real
 * Node ESM process: the resolution being verified is `import.meta.resolve` under
 * the `import` condition, which a bundled/transformed test cannot reproduce.
 */

const REPO_ROOT = resolvePath(__dirname, '../../../../..');
const CHECKER = resolvePath(REPO_ROOT, 'scripts/check-workspace-dist-resolution.mjs');
const BARREL = resolvePath(REPO_ROOT, 'packages/co-managed/dist/index.js');

describe('built workspace barrels under plain Node', () => {
  it('has a built co-managed barrel to check', () => {
    expect(
      existsSync(BARREL),
      'run `npm run build --workspace=@alga-psa/co-managed` first',
    ).toBe(true);
  });

  it('resolves every @alga-psa/* subpath reachable from the co-managed barrel', () => {
    let stdout = '';
    let failed = false;
    try {
      stdout = execFileSync('node', [CHECKER, '--json'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    } catch (error) {
      failed = true;
      stdout = (error as { stdout?: string }).stdout ?? '';
    }

    const parsed = JSON.parse(stdout) as {
      failures: Array<{ specifier: string; importedFrom: string; reason: string }>;
      visited: number;
    };
    const report = parsed.failures
      .map((f) => `  ${f.specifier}\n    first seen in ${f.importedFrom}\n    ${f.reason}`)
      .join('\n');

    expect(parsed.failures, `unresolvable workspace subpaths:\n${report}`).toEqual([]);
    expect(failed).toBe(false);
    // A graph that suddenly walks almost nothing means the barrel was built
    // empty or the walker stopped early, which would make this test vacuous.
    expect(parsed.visited).toBeGreaterThan(50);
  });

  /**
   * Guards 50b7b97195. `archiveFiles`/`archiveReads` used to bind
   * StorageProviderFactory at module scope, which put Node filesystem builtins
   * on the conversation-event core path and broke four jsdom suites in
   * packages/projects at collection ("Failed to resolve entry for package
   * 'fs'"). The capability is reached through a dynamic import instead, so the
   * built barrel must contain no *static* edge to it.
   */
  it('keeps filesystem capability off the co-managed conversation-event path', () => {
    const seen = new Set<string>();
    const queue = [BARREL];
    const offenders: string[] = [];

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);

      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier.includes('StorageProviderFactory')) {
          offenders.push(`${file.replace(`${REPO_ROOT}/`, '')} -> ${specifier}`);
        }
        if (!specifier.startsWith('.')) continue;
        const base = resolvePath(dirname(file), specifier);
        const next = [base, `${base}.js`, `${base}/index.js`].find((p) => existsSync(p));
        if (next) queue.push(next);
      }
    }

    expect(
      offenders,
      `static StorageProviderFactory edge(s) reachable from the co-managed barrel:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
