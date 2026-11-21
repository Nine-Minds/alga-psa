import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repoRoot = path.resolve(serverDir, '..');
const nextBin = path.join(repoRoot, 'node_modules/next/dist/bin/next');

type ResolverAlias = [string, string];

function loadConfiguredAliases(editionEnvironment: { EDITION?: string; NEXT_PUBLIC_EDITION?: string }): ResolverAlias[] {
  const script = `
    import config from './next.config.mjs';
    const relevant = new Set([
      '@product/service-principals/entry',
      '@ee/lib/service-principals',
      '@ee',
      '@ee/',
    ]);
    console.log(JSON.stringify(Object.entries(config.turbopack.resolveAlias)
      .filter(([key]) => relevant.has(key))));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: serverDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      EDITION: editionEnvironment.EDITION ?? '',
      NEXT_PUBLIC_EDITION: editionEnvironment.NEXT_PUBLIC_EDITION ?? '',
    },
  });

  if (result.status !== 0) {
    throw new Error(`Could not load Next config for ${JSON.stringify(editionEnvironment)}: ${result.stderr}`);
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
  // Preserve the repository's tsconfig inheritance and path aliases. The
  // fixture app must exercise the same @ee fallback context as production.
  fs.copyFileSync(path.join(repoRoot, 'tsconfig.base.json'), path.join(fixtureRoot, 'tsconfig.base.json'));
  fs.copyFileSync(path.join(serverDir, 'tsconfig.json'), path.join(fixtureServer, 'tsconfig.json'));
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
      experimental: { agentUpgrade: false },
      turbopack: {
        root: process.env.FIXTURE_TURBOPACK_ROOT,
        resolveAlias: {
          ...Object.fromEntries(JSON.parse(process.env.FIXTURE_RESOLVE_ALIASES || '[]')),
        },
      },
    };
  `);

  return { fixtureRoot, fixtureServer };
}

function compileFixture(
  fixtureServer: string,
  aliases: ResolverAlias[],
  distDir: string,
  edition: 'community' | 'enterprise',
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
      FIXTURE_RESOLVE_ALIASES: JSON.stringify(aliases),
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

  it.each([
    { name: 'community', editionEnvironment: { EDITION: 'community', NEXT_PUBLIC_EDITION: 'community' }, implementation: 'oss' },
    { name: 'enterprise via EDITION=enterprise', editionEnvironment: { EDITION: 'enterprise' }, implementation: 'ee' },
    { name: 'enterprise via EDITION=ee', editionEnvironment: { EDITION: 'ee' }, implementation: 'ee' },
    { name: 'enterprise via NEXT_PUBLIC_EDITION', editionEnvironment: { NEXT_PUBLIC_EDITION: 'enterprise' }, implementation: 'ee' },
  ])('compiles the configured resolver aliases with production tsconfig context for $name', ({ name, editionEnvironment, implementation }) => {
    const edition = implementation === 'ee' ? 'enterprise' : 'community';
    const configuredAliases = loadConfiguredAliases(editionEnvironment);
    const configuredEntry = configuredAliases.find(([key]) => key === '@product/service-principals/entry')?.[1];
    const expectedEntry = `../packages/product-service-principals/${implementation}/entry.ts`;
    expect(configuredEntry).toBe(expectedEntry);
    const fixtureAliases: ResolverAlias[] = [
      ...configuredAliases,
      // Test-fixture plumbing: the production config gets this target from
      // tsconfig paths; the isolated fixture has no project tsconfig.
      ['@product/service-principals/types', '../packages/product-service-principals/types.ts'],
    ];
    const { fixtureServer } = fixture;

    const brokenAliases = fixtureAliases.map(([key, target]) => [
      key,
      key === '@product/service-principals/entry' ? path.resolve(serverDir, target) : target,
    ] as ResolverAlias);
    const brokenBuild = compileFixture(fixtureServer, brokenAliases, `.next-absolute-${name.replaceAll(/[^a-z0-9]+/gi, '-')}`, edition);
    const brokenOutput = `${brokenBuild.stdout ?? ''}\n${brokenBuild.stderr ?? ''}`;
    expect(brokenBuild.status, brokenOutput).not.toBe(0);
    expect(brokenOutput).toMatch(/@product\/service-principals\/entry|service-principals\/.*entry\.ts/);

    const configuredBuild = compileFixture(fixtureServer, fixtureAliases, `.next-configured-${name.replaceAll(/[^a-z0-9]+/gi, '-')}`, edition);
    const configuredOutput = `${configuredBuild.stdout ?? ''}\n${configuredBuild.stderr ?? ''}`;
    expect(configuredBuild.error, configuredOutput).toBeUndefined();
    expect(configuredBuild.status, configuredOutput).toBe(0);

    if (edition === 'enterprise') {
      // Compile again after swapping only the relative order of the EE-specific
      // and broad aliases. This captures Turbopack's resolution behavior and
      // guards against claiming object insertion order changes resolution.
      const reversedAliases = [...fixtureAliases];
      const specificIndex = reversedAliases.findIndex(([key]) => key === '@ee/lib/service-principals');
      const broadIndex = reversedAliases.findIndex(([key]) => key === '@ee');
      if (specificIndex >= 0 && broadIndex >= 0) {
        [reversedAliases[specificIndex], reversedAliases[broadIndex]] = [
          reversedAliases[broadIndex], reversedAliases[specificIndex],
        ];
      }
      const reversedBuild = compileFixture(fixtureServer, reversedAliases, `.next-reversed-${name.replaceAll(/[^a-z0-9]+/gi, '-')}`, edition);
      const reversedOutput = `${reversedBuild.stdout ?? ''}\n${reversedBuild.stderr ?? ''}`;
      expect(reversedBuild.error, reversedOutput).toBeUndefined();
      expect(reversedBuild.status, reversedOutput).toBe(0);
    }
  }, 360_000);
});
