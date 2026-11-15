import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the `npm run dev` launch wiring: development must run the custom
 * entrypoint that owns the `upgrade` event, not Next's built-in dev server
 * (which leaves unrecognized upgrades hanging).
 */
describe('development launch wiring', () => {
  const serverDir = path.resolve(import.meta.dirname, '../../..');
  const repoRoot = path.resolve(serverDir, '..');

  function runDevScript(
    scriptName: 'dev' | 'dev:turbo',
    callerDistDir?: string,
  ): { args: string[]; cwd: string; distDir: string | null; turbopack: string | null }[] {
    const pkg = JSON.parse(
      readFileSync(path.join(serverDir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'alga-dev-launch-'));
    const fakeNpx = path.join(fixtureDir, 'npx');
    writeFileSync(
      fakeNpx,
      `#!/usr/bin/env node
console.log(JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  distDir: process.env.NEXT_DIST_DIR ?? null,
  turbopack: process.env.DEV_TURBOPACK ?? null,
}));
`,
    );
    chmodSync(fakeNpx, 0o755);

    const env = { ...process.env, PATH: `${fixtureDir}:${process.env.PATH ?? ''}` };
    delete env.NEXT_DIST_DIR;
    delete env.DEV_TURBOPACK;
    if (callerDistDir !== undefined) env.NEXT_DIST_DIR = callerDistDir;

    try {
      const result = spawnSync('/bin/sh', ['-c', pkg.scripts[scriptName]], {
        cwd: serverDir,
        env,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }

  function loadNextConfigDistDir(extraEnv: Record<string, string> = {}): string | null {
    const configPath = path.join(serverDir, 'next.config.mjs');
    const env = { ...process.env, ...extraEnv, NODE_ENV: 'production' };
    if (!Object.hasOwn(extraEnv, 'NEXT_DIST_DIR')) delete env.NEXT_DIST_DIR;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const config = (await import(${JSON.stringify(configPath)})).default; console.log('__NEXT_CONFIG_RESULT__' + JSON.stringify(config.distDir ?? null));`,
      ],
      {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const output = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('__NEXT_CONFIG_RESULT__'));
    expect(output).toBeDefined();
    return JSON.parse(output!.slice('__NEXT_CONFIG_RESULT__'.length)) as string | null;
  }

  describe.each(['dev', 'dev:turbo'] as const)('%s', (scriptName) => {
    it.each([undefined, '', '.next-isolated output'])(
      'launches the custom server with NEXT_DIST_DIR=%j',
      (callerDistDir) => {
        // Plain dev resolves workspace sources directly and skips build-deps.
        // Turbo still builds dependencies before launching the same entrypoint.
        const dependencyBuild = scriptName === 'dev:turbo' ? [{
          args: ['nx', 'build-deps', 'server'],
          cwd: repoRoot,
          distDir: callerDistDir ?? null,
          turbopack: null,
        }] : [];
        expect(runDevScript(scriptName, callerDistDir)).toEqual([
          ...dependencyBuild,
          {
            args: ['tsx', 'dev-server.ts'],
            cwd: serverDir,
            distDir: callerDistDir || '.next-dev',
            turbopack: scriptName === 'dev:turbo' ? '1' : null,
          },
        ]);
      },
    );
  });

  it('keeps production Next output at its default unless explicitly overridden', () => {
    expect(loadNextConfigDistDir()).toBeNull();
    expect(loadNextConfigDistDir({ NEXT_DIST_DIR: '.next-production-isolated' }))
      .toBe('.next-production-isolated');
  });

  it('wires the real upgrade handler with HMR delegation in the dev entrypoint', () => {
    const source = readFileSync(
      path.join(serverDir, 'dev-server.ts'),
      'utf8',
    );

    expect(source).toContain("from './src/lib/http/upgradeHandling'");
    expect(source).toContain('attachNextUpgradeHandler');
    expect(source).toContain('delegateHmrToNext');
  });
});
