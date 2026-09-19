import http from 'node:http';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
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
 * The proxy bounds both the upstream TCP connect and the upgrade handshake so a
 * misconfigured or stalled upstream cannot recreate the hanging handshake.
 */

export const HMR_UPGRADE_PATH = '/_next/webpack-hmr';
export const HOCUSPOCUS_UPGRADE_PATH = '/hocuspocus';

const NOT_FOUND = 'Not Found';
const DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_UPSTREAM_UPGRADE_TIMEOUT_MS = 5_000;

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

function parsePathname(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  const queryIndex = rawUrl.indexOf('?');
  const withoutQuery = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const hashIndex = withoutQuery.indexOf('#');
  return hashIndex === -1 ? withoutQuery : withoutQuery.slice(0, hashIndex);
}

function sendUpgradeError(
  socket: Duplex,
  statusCode: number,
  statusMessage: string,
): void {
  if (!socket.destroyed && socket.writable) {
    // `end(data)` flushes the response and sends a FIN, so the client sees a
    // complete HTTP response and the socket cannot linger half-open.
    socket.end(
      `HTTP/1.1 ${statusCode} ${statusMessage}\r\n` +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n' +
        '\r\n',
    );
    return;
  }
  socket.destroy();
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
  const lines: string[] = [];
  if (!rawHeaders) return lines.join('\r\n');
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
  let upgradeTimer: NodeJS.Timeout | null = null;

  const cleanupTimers = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    if (upgradeTimer) {
      clearTimeout(upgradeTimer);
      upgradeTimer = null;
    }
  };

  const upstreamReq = http.request({
    host,
    port: Number(port),
    method: 'GET',
    path: req.url || '/',
    headers: buildUpstreamHeaders(req, host, port),
  });

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
    upstreamSocket?.destroy();
    upstreamReq.destroy();
    sendUpgradeError(socket, statusCode, statusMessage);
  };

  upstreamReq.on('upgrade', (upstreamRes, upstreamSocketRaw, upstreamHead) => {
    if (settled) {
      upstreamSocketRaw.destroy();
      return;
    }
    settled = true;
    cleanupTimers();
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

  connectTimer = setTimeout(() => {
    fail(504, 'Gateway Timeout', 'upstream connect timed out');
  }, connectTimeoutMs);

  upgradeTimer = setTimeout(() => {
    fail(504, 'Gateway Timeout', 'upstream did not complete the upgrade');
  }, connectTimeoutMs + upgradeTimeoutMs);

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
