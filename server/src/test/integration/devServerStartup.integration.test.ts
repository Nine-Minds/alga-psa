import http from 'node:http';
import type { Duplex } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startDevServer,
  type RunningDevServer,
} from '../../../dev-server';

/**
 * Regression coverage for the `npm run dev` startup path.
 *
 * The supported dev command must run a server that owns the HTTP `upgrade`
 * event (server/dev-server.ts), not Next's built-in dev server, which leaves
 * unrecognized upgrades hanging and stalls HMR/hydration. This boots the real
 * entrypoint and exercises it with real sockets.
 */

const DEADLINE_MS = 5_000;

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

describe('development server startup path (npm run dev)', () => {
  let running: RunningDevServer;

  beforeAll(async () => {
    running = await startDevServer({ port: 0, hostname: '127.0.0.1' });
  }, 180_000);

  afterAll(async () => {
    if (running) await running.close();
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

  it('rejects /hocuspocus with a prompt non-101 when no upstream is configured', async () => {
    const startedAt = Date.now();
    const outcome = await requestUpgrade(running.port, '/hocuspocus');
    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).not.toBe(101);
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS);
  });

  it('delegates HMR to Next after an ordinary HTTP request', async () => {
    // The first HTTP request is what would make Next install its own listener;
    // the custom entrypoint must have suppressed that and kept HMR working.
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
