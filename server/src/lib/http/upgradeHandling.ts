import http from 'node:http';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * HTTP upgrade handling for the custom Express + Next server.
 *
 * With a custom server, Next does not own the `http.Server`, so nothing closes
 * upgrade requests it does not recognize. Chromium serializes WebSocket
 * handshakes per origin, so an upgrade socket that is accepted by TCP but never
 * answered occupies that origin's connection slot and delays HMR and hydration.
 *
 * This module owns the server's single `upgrade` listener:
 *   - Next's own upgrade handler stays responsible for `/_next/webpack-hmr`
 *     (including query strings) so HMR keeps working.
 *   - `/hocuspocus` is proxied to the configured Hocuspocus upstream.
 *   - Every other upgrade request is answered with a prompt 404 and closed.
 *
 * The proxy bounds the upstream TCP connect and the upgrade handshake
 * separately and cancels the upstream as soon as the downstream goes away, so
 * a misconfigured or stalled upstream cannot recreate the hanging handshake.
 */

export const HMR_UPGRADE_PATH = '/_next/webpack-hmr';
export const HOCUSPOCUS_UPGRADE_PATH = '/hocuspocus';

const NOT_FOUND = 'Not Found';
const DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_UPSTREAM_UPGRADE_TIMEOUT_MS = 5_000;
const REJECT_FLUSH_TIMEOUT_MS = 1_000;

export type UpgradeListener = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

export interface UpgradeHandlingOptions {
  /**
   * Next.js request-upgrade handler (`app.getUpgradeHandler()`). Supplied in
   * development so HMR requests are delegated to Next rather than rejected.
   */
  nextUpgradeHandler?: UpgradeListener;
  /** Upstream host for `/hocuspocus`; the path stays unavailable when unset. */
  hocuspocusHost?: string;
  /** Upstream port for `/hocuspocus`; the path stays unavailable when unset. */
  hocuspocusPort?: string | number;
  /** Deadline for establishing the upstream TCP connection. */
  upstreamConnectTimeoutMs?: number;
  /** Deadline for the upstream to complete the WebSocket upgrade. */
  upstreamUpgradeTimeoutMs?: number;
  logger?: Pick<Console, 'warn' | 'error'>;
}

/**
 * The slice of Next's `NextCustomServer` this module needs.
 *
 * `NextCustomServer.getRequestHandler()` lazily installs its own `upgrade`
 * listener on the first ordinary HTTP request (`setupWebSocketHandler()`), which
 * would make two listeners race on every upgrade. `didWebSocketSetup` is the
 * one-time guard that call checks (next/dist/server/next.js).
 */
export interface NextUpgradeApp {
  didWebSocketSetup?: boolean;
  /**
   * Next's real request-upgrade handler. In NextCustomServer this is the
   * `upgradeHandler` getter (what `setupWebSocketHandler` itself calls);
   * `getUpgradeHandler()` is a different, no-op path.
   */
  upgradeHandler?: UpgradeListener;
  getUpgradeHandler?: () => UpgradeListener;
}

function parsePathname(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  const queryIndex = rawUrl.indexOf('?');
  const withoutQuery = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const hashIndex = withoutQuery.indexOf('#');
  return hashIndex === -1 ? withoutQuery : withoutQuery.slice(0, hashIndex);
}

/**
 * Flush a complete HTTP response and then destroy the socket.
 *
 * `socket.end()` only sends a FIN; with a peer that does not reciprocate (for
 * example a client opened with `allowHalfOpen`), the server-side socket stays
 * alive, which is exactly the retained-socket condition being fixed. Destroy
 * after the response flushes, with a bounded fallback for a peer that stops
 * reading.
 */
function sendUpgradeError(
  socket: Duplex,
  statusCode: number,
  statusMessage: string,
): void {
  if (socket.destroyed) return;
  if (!socket.writable) {
    socket.destroy();
    return;
  }

  let destroyed = false;
  const destroyOnce = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(flushTimer);
    socket.destroy();
  };
  const flushTimer = setTimeout(destroyOnce, REJECT_FLUSH_TIMEOUT_MS);
  flushTimer.unref?.();
  socket.once('close', () => clearTimeout(flushTimer));
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusMessage}\r\n` +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      '\r\n',
    destroyOnce,
  );
}

function buildUpstreamHeaders(
  req: IncomingMessage,
  host: string,
  port: string | number,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  headers.host = `${host}:${port}`;
  headers.connection = 'Upgrade';
  headers.upgrade = req.headers.upgrade ?? 'websocket';
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  return headers;
}

function rawHeadersToLines(rawHeaders: string[] | undefined): string {
  if (!rawHeaders) return '';
  const lines: string[] = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    lines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`);
  }
  return lines.join('\r\n');
}

function proxyHocuspocusUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  host: string,
  port: string | number,
  options: UpgradeHandlingOptions,
): void {
  const logger = options.logger ?? console;
  const connectTimeoutMs =
    options.upstreamConnectTimeoutMs ?? DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS;
  const upgradeTimeoutMs =
    options.upstreamUpgradeTimeoutMs ?? DEFAULT_UPSTREAM_UPGRADE_TIMEOUT_MS;

  let settled = false;
  let upstreamSocket: Duplex | null = null;
  let connectTimer: NodeJS.Timeout | null = null;
  let handshakeTimer: NodeJS.Timeout | null = null;

  const clearConnectTimer = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };
  const clearHandshakeTimer = () => {
    if (handshakeTimer) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  };
  const cleanupTimers = () => {
    clearConnectTimer();
    clearHandshakeTimer();
  };

  let upstreamReq: http.ClientRequest;
  try {
    upstreamReq = http.request({
      host,
      port: Number(port),
      method: 'GET',
      path: req.url || '/',
      headers: buildUpstreamHeaders(req, host, port),
    });
  } catch (err) {
    // Malformed host/port/header values throw synchronously. Never let that
    // escape the `upgrade` listener and take down the server process.
    logger.warn?.(
      `[websocket-upgrade] hocuspocus proxy request could not be built: ${String(err)}`,
    );
    sendUpgradeError(socket, 502, 'Bad Gateway');
    return;
  }

  // Node pauses the socket when it emits `upgrade`, so without this the server
  // never notices the client aborting and the timers become the only cleanup.
  // Read early bytes into a buffer so nothing is lost before the upstream
  // handshake completes.
  const earlyChunks: Buffer[] = [];
  const onDownstreamData = (chunk: Buffer) => {
    earlyChunks.push(chunk);
  };
  socket.on('data', onDownstreamData);
  socket.resume();

  const fail = (
    statusCode: number,
    statusMessage: string,
    reason?: unknown,
  ) => {
    if (settled) return;
    settled = true;
    cleanupTimers();
    if (reason !== undefined) {
      logger.warn?.(
        `[websocket-upgrade] hocuspocus proxy failed: ${String(reason)}`,
      );
    }
    socket.off('data', onDownstreamData);
    upstreamSocket?.destroy();
    upstreamReq.destroy();
    sendUpgradeError(socket, statusCode, statusMessage);
  };

  // Stop all upstream work the moment the downstream socket goes away; the
  // bounded timers are a fallback, not the primary cancellation. An upgraded
  // socket can emit `end` without ever emitting `close`, so listen to both.
  const onDownstreamGone = () => {
    if (settled) return;
    settled = true;
    cleanupTimers();
    socket.off('data', onDownstreamData);
    upstreamReq.destroy();
    socket.destroy();
  };
  socket.once('end', onDownstreamGone);
  socket.once('close', onDownstreamGone);

  connectTimer = setTimeout(() => {
    fail(504, 'Gateway Timeout', 'upstream connect timed out');
  }, connectTimeoutMs);

  upstreamReq.on('socket', (upstreamConn: Socket) => {
    if (settled) return;
    // The connect deadline covers only the TCP connection. Once it is
    // established, hand off to the (separate) upgrade-handshake deadline.
    const startHandshakeDeadline = () => {
      clearConnectTimer();
      if (settled || handshakeTimer) return;
      handshakeTimer = setTimeout(() => {
        fail(504, 'Gateway Timeout', 'upstream did not complete the upgrade');
      }, upgradeTimeoutMs);
    };
    if (upstreamConn.connecting) {
      upstreamConn.once('connect', startHandshakeDeadline);
    } else {
      startHandshakeDeadline();
    }
  });

  upstreamReq.on('upgrade', (upstreamRes, upstreamSocketRaw, upstreamHead) => {
    if (settled) {
      upstreamSocketRaw.destroy();
      return;
    }
    settled = true;
    cleanupTimers();
    socket.off('data', onDownstreamData);
    upstreamSocket = upstreamSocketRaw;

    upstreamSocketRaw.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocketRaw.destroy());
    upstreamSocketRaw.on('close', () => socket.destroy());
    socket.on('close', () => upstreamSocketRaw.destroy());

    const statusLine = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
    const headerLines = rawHeadersToLines(upstreamRes.rawHeaders);
    socket.write(`${statusLine}${headerLines}\r\n\r\n`);
    if (upstreamHead?.length) {
      socket.write(upstreamHead);
    }
    if (head?.length) {
      upstreamSocketRaw.write(head);
    }
    for (const chunk of earlyChunks) {
      upstreamSocketRaw.write(chunk);
    }

    upstreamSocketRaw.pipe(socket);
    socket.pipe(upstreamSocketRaw);
  });

  upstreamReq.on('response', (upstreamRes) => {
    upstreamRes.resume();
    fail(
      502,
      'Bad Gateway',
      `upstream answered ${upstreamRes.statusCode} instead of upgrading`,
    );
  });

  upstreamReq.on('error', (err: Error) => {
    fail(502, 'Bad Gateway', err.message);
  });

  upstreamReq.end();
}

/**
 * Build the server's single `upgrade` listener. Exposed for tests that exercise
 * real sockets against a throwaway server.
 */
export function createUpgradeHandler(
  options: UpgradeHandlingOptions = {},
): UpgradeListener {
  const host = options.hocuspocusHost;
  const port = options.hocuspocusPort;

  return (req, socket, head) => {
    // A client that aborts mid-handshake must not surface as an uncaught
    // 'error' event that takes down the server process.
    req.on('error', () => undefined);
    socket.on('error', () => undefined);

    const pathname = parsePathname(req.url);

    if (pathname === HMR_UPGRADE_PATH && options.nextUpgradeHandler) {
      options.nextUpgradeHandler(req, socket, head);
      return;
    }

    if (pathname === HOCUSPOCUS_UPGRADE_PATH && host && port) {
      proxyHocuspocusUpgrade(req, socket, head, host, port, options);
      return;
    }

    sendUpgradeError(socket, 404, NOT_FOUND);
  };
}

/** Attach the upgrade listener to an HTTP server. */
export function attachUpgradeHandler(
  server: HttpServer,
  options: UpgradeHandlingOptions = {},
): void {
  server.on('upgrade', createUpgradeHandler(options));
}

export interface AttachNextUpgradeHandlerOptions extends UpgradeHandlingOptions {
  /**
   * Delegate `/_next/webpack-hmr` to Next's own upgrade handler. Enabled in
   * development; production keeps the path rejected.
   */
  delegateHmrToNext?: boolean;
}

/**
 * Wire upgrade handling against a live Next app.
 *
 * Next's `NextCustomServer.getRequestHandler()` installs its own `upgrade`
 * listener on the first HTTP request. Mark that one-time setup as done first so
 * our listener is the only one, then (in development) forward HMR to Next's
 * upgrade handler from inside it. Rejected and proxied paths therefore never
 * reach Next.
 */
export function attachNextUpgradeHandler(
  server: HttpServer,
  app: NextUpgradeApp | undefined,
  options: AttachNextUpgradeHandlerOptions = {},
): void {
  const { delegateHmrToNext = false, ...rest } = options;
  if (app) {
    app.didWebSocketSetup = true;
    if (delegateHmrToNext) {
      // Prefer the getter Next's own setupWebSocketHandler uses; fall back to
      // the method for older/newer shapes.
      const nextUpgrade =
        app.upgradeHandler ?? app.getUpgradeHandler?.();
      if (nextUpgrade) {
        rest.nextUpgradeHandler = nextUpgrade;
      }
    }
  }
  attachUpgradeHandler(server, rest);
}
