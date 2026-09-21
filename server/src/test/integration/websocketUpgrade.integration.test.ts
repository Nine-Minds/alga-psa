import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  attachNextUpgradeHandler,
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

// `import next from 'next'` trips Vitest's CJS interop ("Cannot set property
// default of [object Module]"); reach the real CJS export instead so the test
// drives the installed NextCustomServer.
const requireFromHere = createRequire(import.meta.url);
type NextCustomServerLike = {
  didWebSocketSetup?: boolean;
  getUpgradeHandler: () => (req: unknown, socket: Duplex, head: Buffer) => void;
  getRequestHandler: () => (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl?: unknown,
  ) => Promise<unknown>;
};
function createNextApp(dir: string): NextCustomServerLike {
  const createServer = requireFromHere('next') as (
    options: Record<string, unknown>,
  ) => NextCustomServerLike;
  return createServer({ dev: true, hostname: '127.0.0.1', port: 0, dir });
}

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

const trackedSockets = new WeakMap<net.Server, Set<Duplex>>();

/** Track every TCP connection (including upgraded ones) for deterministic teardown. */
function trackServer<T extends net.Server>(server: T): T {
  const sockets = new Set<Duplex>();
  trackedSockets.set(server, sockets);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return server;
}

function startServer(
  bind: (server: http.Server) => void,
): Promise<{ server: http.Server; port: number }> {
  const server = trackServer(
    http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    }),
  );
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
function closeServer(server: net.Server): Promise<void> {
  for (const socket of trackedSockets.get(server) ?? []) {
    socket.destroy();
  }
  trackedSockets.get(server)?.clear();
  const httpServer = server as http.Server;
  httpServer.closeAllConnections?.();
  httpServer.closeIdleConnections?.();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error('test server did not close within 1500ms')),
      1_500,
    );
    server.close((err) => {
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        finish(err);
      } else {
        finish();
      }
    });
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

function readHttpHead(socket: net.Socket, timeoutMs = DEADLINE_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('raw upgrade response exceeded deadline'));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.includes('\r\n\r\n')) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = DEADLINE_MS,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function findUnusedPort(): Promise<number> {
  const server = trackServer(http.createServer());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await closeServer(server);
  return port;
}

function fakeFirstRequest(server: http.Server): {
  req: http.IncomingMessage;
  res: http.ServerResponse;
} {
  return {
    req: { url: '/', headers: {}, socket: { server } } as unknown as http.IncomingMessage,
    res: {} as http.ServerResponse,
  };
}

describe('websocket upgrade handling', () => {
  const servers: net.Server[] = [];

  afterEach(async () => {
    // Clear before awaiting so one failing teardown cannot cascade an
    // ERR_SERVER_NOT_RUNNING into every later test.
    const current = servers.splice(0, servers.length);
    await Promise.all(current.map((server) => closeServer(server)));
  });

  async function start(options: UpgradeHandlingOptions) {
    const started = await startServer((server) =>
      attachUpgradeHandler(server, options),
    );
    servers.push(started.server);
    return started;
  }

  async function startTracked(server: net.Server) {
    servers.push(server);
    return server;
  }

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

  it('destroys the server socket after flushing a 404 even when the client keeps its half open', async () => {
    const { server, port } = await start({});

    // `allowHalfOpen` keeps the client from reciprocating the server's FIN, so
    // a bare socket.end() would leave the server-side socket alive and retained.
    const client = net.connect({ host: '127.0.0.1', port, allowHalfOpen: true });
    await once(client, 'connect');
    client.write(
      'GET /unknown HTTP/1.1\r\n' +
        'Host: 127.0.0.1\r\n' +
        'Connection: Upgrade\r\n' +
        'Upgrade: websocket\r\n' +
        '\r\n',
    );

    const response = await readHttpHead(client);
    expect(response).toMatch(/^HTTP\/1\.1 404/);

    await waitFor(() => (trackedSockets.get(server)?.size ?? 0) === 0);
    expect(trackedSockets.get(server)?.size ?? 0).toBe(0);
    client.destroy();
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

  it('reproduces Next adding its own upgrade listener on the first HTTP request', async () => {
    const app = createNextApp(path.resolve(__dirname, '../..'));
    const { server } = await startServer(() => {});
    await startTracked(server);

    const requestHandler = app.getRequestHandler();
    const { req, res } = fakeFirstRequest(server);
    await Promise.resolve(requestHandler(req, res)).catch(() => undefined);

    // Next's NextCustomServer.getRequestHandler() -> setupWebSocketHandler()
    // installs exactly one upgrade listener; a second one would race ours.
    expect(server.listenerCount('upgrade')).toBe(1);
  });

  it('takes over Next wiring so HMR is handled once after an HTTP request and rejected paths never reach Next', async () => {
    const app = createNextApp(path.resolve(__dirname, '../..'));
    let nextUpgradeCalls = 0;
    // `upgradeHandler` is a prototype getter in NextCustomServer; shadow it on
    // this instance so the test does not need a full (compiled) Next server.
    Object.defineProperty(app, 'upgradeHandler', {
      configurable: true,
      value: (_req: unknown, socket: Duplex) => {
        nextUpgradeCalls += 1;
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: test-accept\r\n' +
            '\r\n',
        );
      },
    });

    const { server, port } = await startServer((server) =>
      attachNextUpgradeHandler(
        server,
        app as unknown as Parameters<typeof attachNextUpgradeHandler>[1],
        { delegateHmrToNext: true },
      ),
    );
    await startTracked(server);

    // The ordinary HTTP request runs setupWebSocketHandler() and must not add a
    // second upgrade listener now that we own it.
    const requestHandler = app.getRequestHandler();
    const { req, res } = fakeFirstRequest(server);
    await Promise.resolve(requestHandler(req, res)).catch(() => undefined);
    expect(server.listenerCount('upgrade')).toBe(1);

    const hmr = await requestUpgrade(port, `${HMR_UPGRADE_PATH}?id=1`);
    expect(hmr.kind).toBe('upgrade');
    if (hmr.kind === 'upgrade') hmr.socket.destroy();
    expect(nextUpgradeCalls).toBe(1);

    const unknown = await requestUpgrade(port, '/definitely-unknown');
    expect(unknown.kind).toBe('response');
    if (unknown.kind === 'response') expect(unknown.statusCode).toBe(404);
    expect(nextUpgradeCalls).toBe(1);

    const hocuspocus = await requestUpgrade(port, '/hocuspocus');
    expect(hocuspocus.kind).toBe('response');
    if (hocuspocus.kind === 'response') expect(hocuspocus.statusCode).toBe(404);
    expect(nextUpgradeCalls).toBe(1);
  });

  it('proxies a configured /hocuspocus upgrade and preserves the path and payload', async () => {
    const upstreamHttp = trackServer(http.createServer());
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
    await startTracked(upstreamHttp);

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
      const timer = setTimeout(resolve, 1_500);
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

  it('applies the connection and handshake deadlines independently', async () => {
    // A raw TCP upstream reads the upgrade request and never answers it. Unlike
    // an HTTP server's upgraded socket, it observes the proxy's FIN/RST on
    // teardown, so the test can prove the upstream connection was cancelled.
    const stalled = trackServer(
      net.createServer((socket) => {
        socket.resume();
      }),
    );
    await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', resolve));
    await startTracked(stalled);
    const stalledAddress = stalled.address();
    if (!stalledAddress || typeof stalledAddress === 'string') {
      throw new Error('Failed to bind stalled upstream');
    }

    const { port } = await start({
      hocuspocusHost: '127.0.0.1',
      hocuspocusPort: stalledAddress.port,
      upstreamConnectTimeoutMs: 100,
      upstreamUpgradeTimeoutMs: 500,
    });

    const startedAt = Date.now();
    const outcome = await requestUpgrade(port, '/hocuspocus');
    const elapsed = Date.now() - startedAt;

    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).toBe(504);
    // The connect deadline must not cap the handshake: the connection
    // establishes immediately and only the 500ms handshake deadline fires.
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(DEADLINE_MS);

    // The proxy must tear the stalled upstream socket down, not leave it for
    // test teardown to time out on.
    await waitFor(() => (trackedSockets.get(stalled)?.size ?? 0) === 0);
    expect(trackedSockets.get(stalled)?.size ?? 0).toBe(0);
  });

  it('cancels the upstream connection when the downstream aborts', async () => {
    // Hold the connection open; only a downstream abort should close it. A raw
    // TCP upstream observes the proxy's FIN/RST so the cancellation is provable.
    const stalled = trackServer(
      net.createServer((socket) => {
        socket.resume();
      }),
    );
    await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', resolve));
    await startTracked(stalled);
    const stalledAddress = stalled.address();
    if (!stalledAddress || typeof stalledAddress === 'string') {
      throw new Error('Failed to bind stalled upstream');
    }

    const { port } = await start({
      hocuspocusHost: '127.0.0.1',
      hocuspocusPort: stalledAddress.port,
      upstreamConnectTimeoutMs: 30_000,
      upstreamUpgradeTimeoutMs: 30_000,
    });

    const client = net.connect({ host: '127.0.0.1', port });
    await once(client, 'connect');
    client.write(
      'GET /hocuspocus HTTP/1.1\r\n' +
        'Host: 127.0.0.1\r\n' +
        'Connection: Upgrade\r\n' +
        'Upgrade: websocket\r\n' +
        '\r\n',
    );

    await waitFor(() => (trackedSockets.get(stalled)?.size ?? 0) === 1);
    client.destroy();

    await waitFor(() => (trackedSockets.get(stalled)?.size ?? 0) === 0);
    expect(trackedSockets.get(stalled)?.size ?? 0).toBe(0);
  });

  it('answers 502 without crashing when the proxy request cannot be built', async () => {
    const { port } = await start({
      hocuspocusHost: '127.0.0.1',
      hocuspocusPort: 70_000,
    });

    const outcome = await requestUpgrade(port, '/hocuspocus');
    expect(outcome.kind).toBe('response');
    if (outcome.kind !== 'response') return;
    expect(outcome.statusCode).toBe(502);

    // The server process survived the synchronous construction failure.
    const again = await requestUpgrade(port, '/unknown');
    expect(again.kind).toBe('response');
    if (again.kind === 'response') expect(again.statusCode).toBe(404);
  });

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
    await waitFor(() => (trackedSockets.get(server)?.size ?? 0) === 0);
    expect(trackedSockets.get(server)?.size ?? 0).toBe(0);
  });
});
