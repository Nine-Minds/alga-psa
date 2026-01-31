import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Snapshot = {
  isEE: boolean;
  turbo: string | null;
  turboSlash: string | null;
  webpack: string | null;
};

function getAliasSnapshot(env: Record<string, string | undefined>): Snapshot {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.resolve(testDir, '../../..');
  const marker = 'ENTERPRISE_ALIAS_SNAPSHOT=';

  const stdout = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import nextConfig from './next.config.mjs';

        const turbo = nextConfig?.turbopack?.resolveAlias?.['@enterprise'] ?? null;
        const turboSlash = nextConfig?.turbopack?.resolveAlias?.['@enterprise/'] ?? null;

        const baseConfig = {
          resolve: { alias: {}, modules: [] },
          plugins: [],
          module: { rules: [] },
          output: {},
        };

        let webpackAlias = null;
        try {
          const configured = await nextConfig.webpack(baseConfig, { isServer: true, dev: false });
          webpackAlias = configured?.resolve?.alias?.['@enterprise'] ?? null;
        } catch {}

        const isEE = process.env.EDITION === 'ee' || process.env.EDITION === 'enterprise' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

        console.log(${JSON.stringify(marker)} + JSON.stringify({ isEE, turbo, turboSlash, webpack: webpackAlias }));
      `,
    ],
    {
      cwd: serverDir,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    }
  );

  const lines = stdout.trim().split('\n').filter(Boolean);
  const markerLine = [...lines].reverse().find((line) => line.includes(marker));
  if (!markerLine) {
    throw new Error(`Expected marker ${marker} in child process output.\n${stdout}`);
  }
  const payload = markerLine.slice(markerLine.indexOf(marker) + marker.length);
  return JSON.parse(payload) as Snapshot;
}

describe('@enterprise alias selection is deterministic', () => {
  it('selects CE stubs when EDITION is not enterprise', () => {
    const snapshot = getAliasSnapshot({ EDITION: '', NEXT_PUBLIC_EDITION: '' });

    expect(snapshot.isEE).toBe(false);
    expect(snapshot.turbo).toBe('../packages/ee/src');
    expect(snapshot.turboSlash).toBe('../packages/ee/src/');
    expect(snapshot.webpack).toMatch(/packages[\\\/]ee[\\\/]src$/);
  });

  it('selects EE sources when EDITION=ee', () => {
    const snapshot = getAliasSnapshot({ EDITION: 'ee', NEXT_PUBLIC_EDITION: 'enterprise' });

    expect(snapshot.isEE).toBe(true);
    expect(snapshot.turbo).toBe('../ee/server/src');
    expect(snapshot.turboSlash).toBe('../ee/server/src/');
    expect(snapshot.webpack).toMatch(/ee[\\\/]server[\\\/]src$/);
  });
});

