import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repoRoot = path.resolve(serverDir, '..');
const nextBin = path.join(repoRoot, 'node_modules/next/dist/bin/next');

function loadConfiguredAlias(edition: string): { entry: string; ee: string; eeServicePrincipals?: string } {
  const script = `
    import config from './next.config.mjs';
    console.log(JSON.stringify({
      entry: config.turbopack.resolveAlias['@product/service-principals/entry'],
      ee: config.turbopack.resolveAlias['@ee'],
      eeServicePrincipals: config.turbopack.resolveAlias['@ee/lib/service-principals'],
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: serverDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      EDITION: edition === 'enterprise' ? 'enterprise' : 'community',
      NEXT_PUBLIC_EDITION: edition,
    },
  });

  if (result.status !== 0) {
    throw new Error(`Could not load Next config for ${edition}: ${result.stderr}`);
  }

  return JSON.parse(result.stdout.trim());
}

function copyPackageIntoFixture(packageName: string, fixtureRoot: string): void {
  const source = path.join(repoRoot, 'node_modules', packageName);
  const target = path.join(fixtureRoot, 'node_modules', packageName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
}

function createFixture(): { fixtureRoot: string; fixtureServer: string } {
  const fixtureRoot = fs.mkdtempSync(path.join(serverDir, '.next', 'service-principals-turbo-'));
  const fixtureServer = path.join(fixtureRoot, 'server');
  fs.mkdirSync(path.join(fixtureServer, 'app'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'node_modules'), { recursive: true });
  for (const packageName of [
    'next', 'react', 'react-dom', 'scheduler', 'client-only',
    '@next/env', '@swc/helpers', 'baseline-browser-mapping', 'caniuse-lite', 'postcss', 'styled-jsx',
  ]) {
    copyPackageIntoFixture(packageName, fixtureRoot);
  }
  fs.mkdirSync(path.join(fixtureRoot, 'packages/product-service-principals/oss'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'packages/product-service-principals/ee'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'ee/server/src/lib/service-principals'), { recursive: true });
  for (const source of [
    'packages/product-service-principals/types.ts',
    'packages/product-service-principals/oss/entry.ts',
    'packages/product-service-principals/ee/entry.ts',
    'ee/server/src/lib/service-principals/index.ts',
  ]) {
    const target = path.join(fixtureRoot, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, source), target);
  }

  fs.writeFileSync(path.join(fixtureServer, 'package.json'), JSON.stringify({
    private: true,
    dependencies: { next: '16.4.2', react: '19.2.0', 'react-dom': '19.2.0' },
  }));
  fs.writeFileSync(path.join(fixtureServer, 'app/layout.tsx'), `
    export default function Layout({ children }: { children: React.ReactNode }) {
      return <html><body>{children}</body></html>;
    }
  `);
  fs.writeFileSync(path.join(fixtureServer, 'app/page.tsx'), `
    import { servicePrincipalKeyGate } from '@product/service-principals/entry';
    export default function Page() {
      return <main>{typeof servicePrincipalKeyGate}</main>;
    }
  `);
  fs.writeFileSync(path.join(fixtureServer, 'next.config.mjs'), `
    import path from 'node:path';
    export default {
      distDir: process.env.FIXTURE_DIST_DIR || '.next',
      turbopack: {
        root: process.env.FIXTURE_TURBOPACK_ROOT,
        resolveAlias: {
          '@product/service-principals/entry': process.env.FIXTURE_ENTRY_ALIAS,
          '@product/service-principals/types': '../packages/product-service-principals/types.ts',
          '@ee': '../ee/server/src',
          '@ee/': '../ee/server/src/',
          '@ee/lib/service-principals': '../ee/server/src/lib/service-principals',
        },
      },
    };
  `);

  return { fixtureRoot, fixtureServer };
}

function compileFixture(
  fixtureServer: string,
  aliasTarget: string,
  distDir: string,
  edition: string,
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [
    nextBin,
    'build',
    fixtureServer,
    '--turbopack',
    '--experimental-build-mode=compile',
    '--debug-build-paths=app/page.tsx',
  ], {
    cwd: fixtureServer,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=2048',
      NEXT_BUILD_CPUS: '1',
      EDITION: edition === 'enterprise' ? 'enterprise' : 'community',
      NEXT_PUBLIC_EDITION: edition,
      FIXTURE_ENTRY_ALIAS: aliasTarget,
      FIXTURE_DIST_DIR: distDir,
      FIXTURE_TURBOPACK_ROOT: path.dirname(fixtureServer),
    },
  });
}

describe('service-principals Turbopack entry alias', () => {
  let fixture: { fixtureRoot: string; fixtureServer: string };

  beforeAll(() => {
    fixture = createFixture();
  }, 30_000);

  afterAll(() => {
    if (fixture) fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  });

  it.each(['community', 'enterprise'])(
    'rejects the former absolute alias and compiles the configured alias for %s',
    (edition) => {
      const configuredAlias = loadConfiguredAlias(edition);
      const absoluteAlias = path.resolve(serverDir, configuredAlias.entry);
      const { fixtureServer } = fixture;
      const fixtureRelativeAlias = `../packages/product-service-principals/${edition === 'enterprise' ? 'ee' : 'oss'}/entry.ts`;
      const fixtureRelativeEe = edition === 'enterprise' ? '../ee/server/src' : '../packages/ee/src';
      expect(configuredAlias.entry).toBe(fixtureRelativeAlias);
      expect(configuredAlias.ee).toBe(fixtureRelativeEe);
      if (edition === 'enterprise') {
        expect(configuredAlias.eeServicePrincipals).toBe('../ee/server/src/lib/service-principals');
      }
      const fixtureConfigPath = path.join(fixtureServer, 'next.config.mjs');
      const fixtureConfig = fs.readFileSync(fixtureConfigPath, 'utf8')
        .replace("'../packages/ee/src'", JSON.stringify(fixtureRelativeEe))
        .replace("'../ee/server/src/'", JSON.stringify(`${fixtureRelativeEe}/`))
        .replace("'../packages/ee/src/'", JSON.stringify(`${fixtureRelativeEe}/`));
      fs.writeFileSync(fixtureConfigPath, fixtureConfig);

      const brokenBuild = compileFixture(fixtureServer, absoluteAlias, `.next-absolute-${edition}`, edition);
      const brokenOutput = `${brokenBuild.stdout ?? ''}\n${brokenBuild.stderr ?? ''}`;
      expect(brokenBuild.status, brokenOutput).not.toBe(0);
      expect(brokenOutput).toMatch(/@product\/service-principals\/entry|service-principals\/.*entry\.ts/);

      const repairedBuild = compileFixture(fixtureServer, fixtureRelativeAlias, `.next-relative-${edition}`, edition);
      const repairedOutput = `${repairedBuild.stdout ?? ''}\n${repairedBuild.stderr ?? ''}`;
      expect(repairedBuild.error, repairedOutput).toBeUndefined();
      expect(repairedBuild.status, repairedOutput).toBe(0);
    },
    360_000,
  );
});
