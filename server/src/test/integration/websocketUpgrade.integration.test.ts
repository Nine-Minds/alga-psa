import http from 'node:http';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  attachUpgradeHandler,
  HMR_UPGRADE_PATH,
  type UpgradeHandlingOptions,
} from '@/lib/http/upgradeHandling';

/**
 * Real-socket coverage for the custom server's HTTP `upgrade` handling.
 *
 * The regression this guards is subtle: an upgrade request that receives no
 * HTTP response leaves the TCP socket open, which fills Chromium's per-origin
 * WebSocket slot and delays HMR and hydration. Every case below therefore has
 * an explicit deadline so a regression fails instead of hanging the runner.
 */

const DEADLINE_MS = 2_000;

type UpgradeOutcome =
  | {
      kind: 'upgrade';
      statusCode: number;
      headers: http.IncomingHttpHeaders;
      socket: Duplex;
    }
  | {
      kind: 'response';
      statusCode: number;
      headers: http.IncomingHttpHeaders;
      body: string;
    }
  | { kind: 'error'; error: Error };

const trackedSockets = new WeakMap<http.Server, Set<Duplex>>();

function startServer(
  bind: (server: http.Server) => void,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  const sockets = new Set<Duplex>();
  trackedSockets.set(server, sockets);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  bind(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind test HTTP server');
      }
      resolve({ server, port: address.port });
    });
  });
}

/**
 * `server.close()` waits for every open connection, and Node's
 * `closeAllConnections()` does not close sockets that were upgraded out of the
 * HTTP server. Destroy tracked sockets explicitly so a test failure can never
 * look like a runner hang.
 */
function closeServer(server: http.Server): Promise<void> {
  const sockets = trackedSockets.get(server);
  if (sockets) {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  }
  server.closeAllConnections?.();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 3_000);
    server.close(() => finish());
  });
}

function requestUpgrade(
  port: number,
  path: string,
  deadlineMs = DEADLINE_MS,
): Promise<UpgradeOutcome> {
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
          error: new Error(`upgrade request to ${path} exceeded ${deadlineMs}ms`),
        }),
      deadlineMs,
    );

    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (res, socket) => {
      finish({
        kind: 'upgrade',
        statusCode: res.statusCode ?? 0,
        headers: res.headers,
        socket,
      });
    });
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        finish({
          kind: 'response',
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body,
        });
      });
    });
    req.on('error', (error: Error) => finish({ kind: 'error', error }));
    req.end();
  });
}

async function findUnusedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await closeServer(server);
  return port;
}

describe('websocket upgrade handling', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => closeServer(server)));
    servers.length = 0;
  });

  async function start(options: UpgradeHandlingOptions) {
    const started = await startServer((server) =>
      attachUpgradeHandler(server, options),
    );
    servers.push(started.server);
    return started;
  }

  it('closes every repeated rejected upgrade instead of leaving sockets open', async () => {
    const { server, port } = await start({});

    for (let i = 0; i < 5; i += 1) {
      const outcome = await requestUpgrade(port, `/unknown-${i}`);
      expect(outcome.kind).toBe('response');
      if (outcome.kind !== 'response') return;
      expect(outcome.statusCode).toBe(404);
    }

    // The server must not retain the rejected sockets (the CLOSE-WAIT
    // accumulation the live check looks for on the running dev server).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(trackedSockets.get(server)?.size ?? 0).toBe(0);
  });

  it('answers /hocuspocus with 404 and closes when no upstream is configured', async () => {
    const { port } = await start({});
    const startedAt = Date.now();

    const outcome = await requestUpgrade(port, '/hocuspocus');

    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).toBe(404);
    expect(outcome.headers.connection).toBe('close');
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS);
  });

  it('answers unknown upgrade paths with 404 and closes promptly', async () => {
    const { port } = await start({});
    const startedAt = Date.now();

    const outcome = await requestUpgrade(port, '/not-a-websocket');

    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).toBe(404);
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS);
  });

  it('delegates /_next/webpack-hmr, including query strings, to Next', async () => {
    const handledPaths: string[] = [];
    const { port } = await start({
      nextUpgradeHandler: (req, socket) => {
        handledPaths.push(req.url ?? '');
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: test-accept\r\n' +
            '\r\n',
        );
      },
    });

    const outcome = await requestUpgrade(
      port,
      `${HMR_UPGRADE_PATH}?id=123&ts=456`,
    );

    expect(outcome.kind).toBe('upgrade');
    if (outcome.kind !== 'upgrade') return;
    expect(outcome.statusCode).toBe(101);
    expect(handledPaths).toEqual([`${HMR_UPGRADE_PATH}?id=123&ts=456`]);
    outcome.socket.destroy();
  });

  it('proxies a configured /hocuspocus upgrade and preserves the path and payload', async () => {
    const upstreamHttp = http.createServer();
    const upstream = new WebSocketServer({ noServer: true });
    upstreamHttp.on('upgrade', (req, socket, head) => {
      upstream.handleUpgrade(req, socket, head, (ws, request) => {
        upstream.emit('connection', ws, request);
      });
    });
    await new Promise<void>((resolve) =>
      upstreamHttp.listen(0, '127.0.0.1', resolve),
    );
    const upstreamAddress = upstreamHttp.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('Failed to bind upstream server');
    }
    servers.push(upstreamHttp);

    const upstreamPaths: string[] = [];
    upstream.on('connection', (ws, req) => {
      upstreamPaths.push(req.url ?? '');
      ws.on('message', (data) => ws.send(data));
    });

    const { port } = await start({
      hocuspocusHost: '127.0.0.1',
      hocuspocusPort: upstreamAddress.port,
    });

    const client = new WebSocket(`ws://127.0.0.1:${port}/hocuspocus?room=test`);
    const received = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('proxy echo exceeded deadline')),
        DEADLINE_MS,
      );
      client.on('message', (data) => {
        clearTimeout(timer);
        resolve(data.toString());
      });
      client.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('proxy connect exceeded deadline')),
        DEADLINE_MS,
      );
      client.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      client.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    client.send('hello-through-proxy');
    await expect(received).resolves.toBe('hello-through-proxy');
    expect(upstreamPaths).toEqual(['/hocuspocus?room=test']);

    client.terminate();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      upstream.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });

  it('terminates when the upstream is unavailable', async () => {
    const unusedPort = await findUnusedPort();
    const { port } = await start({
      hocuspocusHost: '127.0.0.1',
      hocuspocusPort: unusedPort,
      upstreamConnectTimeoutMs: 200,
      upstreamUpgradeTimeoutMs: 200,
    });

    const startedAt = Date.now();
    const outcome = await requestUpgrade(port, '/hocuspocus');

    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).toBeGreaterThanOrEqual(500);
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS);
  });

  it('terminates within the configured bound when the upstream stalls', async () => {
    const stalled = http.createServer();
    stalled.on('upgrade', () => {
      // Accept the TCP connection but never answer the handshake.
    });
    await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', resolve));
    servers.push(stalled);
    const stalledAddress = stalled.address();
    if (!stalledAddress || typeof stalledAddress === 'string') {
      throw new Error('Failed to bind stalled upstream');
    }

    const { port } = await start({
      hocuspocusHost: '127.0.0.1',
      hocuspocusPort: stalledAddress.port,
      upstreamConnectTimeoutMs: 200,
      upstreamUpgradeTimeoutMs: 300,
    });

    const startedAt = Date.now();
    const outcome = await requestUpgrade(port, '/hocuspocus');

    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).toBeGreaterThanOrEqual(500);
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS);
  });

});
