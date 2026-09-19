import http from 'node:http';
import type { Duplex } from 'node:stream';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startDevServer,
  type RunningDevServer,
} from '../../../dev-server';

// Load the same singleton used by Next server actions immediately after the
// custom entrypoint, before beforeAll calls app.prepare(). This guards the
// import-time window that previously cached Next's throwing browser fallback
// and poisoned every later integration suite in the shared worker.
const require = createRequire(import.meta.url);
const { workAsyncStorageInstance } = require(
  'next/dist/server/app-render/work-async-storage-instance',
) as { workAsyncStorageInstance: AsyncLocalStorage<unknown> };

/**
 * Regression coverage for the `npm run dev` / `npm run dev:turbo` startup path.
 *
 * The supported dev commands must run a server that owns the HTTP `upgrade`
 * event (server/dev-server.ts), not Next's built-in dev server, which leaves
 * unrecognized upgrades hanging and stalls HMR/hydration.
 *
 * Each suite boots the real entrypoint against a throwaway Next fixture app at
 * the repository root (its own `package.json` boundary and its own `.next`
 * dir). Keeping the fixture out of `server/` avoids inheriting the real
 * project's config/instrumentation, and its own build dir means the suite
 * never contends with the user's running dev service for the shared
 * `server/.next/dev` lock. Hocuspocus is configured explicitly.
 */

const DEADLINE_MS = 5_000;
const SERVER_DIR = path.resolve(import.meta.dirname, '../../..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

type UpgradeOutcome =
  | { kind: 'upgrade'; statusCode: number; socket: Duplex }
  | { kind: 'response'; statusCode: number }
  | { kind: 'error'; error: Error };

function requestUpgrade(port: number, path: string): Promise<UpgradeOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: UpgradeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(
      () =>
        finish({
          kind: 'error',
          error: new Error(`upgrade request to ${path} exceeded ${DEADLINE_MS}ms`),
        }),
      DEADLINE_MS,
    );

    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        Host: `127.0.0.1:${port}`,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket) => {
      finish({ kind: 'upgrade', statusCode: res.statusCode ?? 0, socket });
    });
    req.on('response', (res) => {
      res.resume();
      finish({ kind: 'response', statusCode: res.statusCode ?? 0 });
    });
    req.on('error', (error: Error) => finish({ kind: 'error', error }));
    req.end();
  });
}

function findUnusedPort(): Promise<number> {
  const probe = http.createServer();
  return new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Minimal Next app with its own project boundary and build directory. Lives at
 * the repo root so `next`/`react` resolve through the repo's `node_modules`
 * without a symlink (Turbopack rejects symlinks that leave the project root).
 */
async function createFixtureApp(): Promise<string> {
  const dir = await mkdtemp(path.join(REPO_ROOT, '.tmp-dev-server-fixture-'));
  await mkdir(path.join(dir, 'pages'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'alga-dev-server-fixture', private: true, version: '0.0.0' }),
  );
  await writeFile(
    path.join(dir, 'next.config.mjs'),
    `export default { turbopack: { root: ${JSON.stringify(REPO_ROOT)} } };\n`,
  );
  await writeFile(
    path.join(dir, 'pages', 'index.js'),
    'export default function Home() { return <main>fixture</main>; }\n',
  );
  return dir;
}

async function removeFixtureApp(dir: string | undefined): Promise<void> {
  if (!dir) return;
  // Next/Turbopack can keep flushing files into the fixture's .next for a
  // moment after close, recreating the directory right after a remove. Remove,
  // settle, then verify it stayed gone; retry until the writers stop.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!existsSync(dir)) return;
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

async function bootFixture(
  overrides: Parameters<typeof startDevServer>[0] = {},
): Promise<{ running: RunningDevServer; fixtureDir: string }> {
  const fixtureDir = await createFixtureApp();
  const running = await startDevServer({
    port: 0,
    hostname: '127.0.0.1',
    dir: fixtureDir,
    ...overrides,
  });
  return { running, fixtureDir };
}

describe('development server startup path (npm run dev)', () => {
  let fixtureDir: string;
  let running: RunningDevServer;

  beforeAll(async () => {
    const unusedUpstreamPort = await findUnusedPort();
    ({ running, fixtureDir } = await bootFixture({
      // Controlled Hocuspocus config: configured, but nothing listens there.
      hocuspocusHost: '127.0.0.1',
      hocuspocusPort: unusedUpstreamPort,
    }));
  }, 180_000);

  afterAll(async () => {
    if (running) await running.close();
    await removeFixtureApp(fixtureDir);
  });

  it('initializes Next server actions with Node AsyncLocalStorage at import time', () => {
    expect(workAsyncStorageInstance).toBeInstanceOf(AsyncLocalStorage);
    expect(workAsyncStorageInstance.run('dev-server-context', () =>
      workAsyncStorageInstance.getStore(),
    )).toBe('dev-server-context');
  });

  it('owns exactly one upgrade listener', () => {
    expect(running.server.listenerCount('upgrade')).toBe(1);
  });

  it('rejects unknown upgrade paths with a prompt 404', async () => {
    const startedAt = Date.now();
    const outcome = await requestUpgrade(running.port, '/not-a-websocket');
    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).toBe(404);
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS);
  });

  it('rejects /hocuspocus promptly with non-101 when its configured upstream is down', async () => {
    const startedAt = Date.now();
    const outcome = await requestUpgrade(running.port, '/hocuspocus');
    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).not.toBe(101);
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS);
  });

  it('delegates HMR to Next after an ordinary HTTP request', async () => {
    await fetch(`http://127.0.0.1:${running.port}/`).catch(() => undefined);
    expect(running.server.listenerCount('upgrade')).toBe(1);

    const outcome = await requestUpgrade(
      running.port,
      '/_next/webpack-hmr?id=startup-test',
    );
    expect(outcome.kind).toBe('upgrade');
    if (outcome.kind === 'upgrade') {
      expect(outcome.statusCode).toBe(101);
      outcome.socket.destroy();
    }
  });
});

describe('development server turbopack entrypoint (dev:turbo)', () => {
  let fixtureDir: string;
  let running: RunningDevServer;

  beforeAll(async () => {
    ({ running, fixtureDir } = await bootFixture({
      turbopack: true,
      // No upstream configured: /hocuspocus must still be rejected promptly.
      hocuspocusHost: undefined,
      hocuspocusPort: undefined,
    }));
  }, 240_000);

  afterAll(async () => {
    if (running) await running.close();
    await removeFixtureApp(fixtureDir);
  });

  it('boots with the custom upgrade handler and rejects unknown paths', async () => {
    expect(running.server.listenerCount('upgrade')).toBe(1);
    const outcome = await requestUpgrade(running.port, '/unknown-turbo');
    expect(outcome.kind).toBe('response');
    if (outcome.kind === 'response') expect(outcome.statusCode).toBe(404);
  });

  it('still delegates HMR to Next under turbopack', async () => {
    await fetch(`http://127.0.0.1:${running.port}/`).catch(() => undefined);
    const outcome = await requestUpgrade(
      running.port,
      '/_next/webpack-hmr?id=turbo-test',
    );
    expect(outcome.kind).toBe('upgrade');
    if (outcome.kind === 'upgrade') {
      expect(outcome.statusCode).toBe(101);
      outcome.socket.destroy();
    }
  });
});
