import http from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { pathToFileURL } from 'node:url';
import {
  attachNextUpgradeHandler,
  type NextUpgradeApp,
} from './src/lib/http/upgradeHandling';
import { installTurbopackHmrSubscriptionDiagnostics } from './hmr-subscription-diagnostics';

// `import next from 'next'` trips Vitest's CJS interop ("Cannot set property
// default of [object Module]"); the CJS export works identically under tsx.
const require = createRequire(import.meta.url);
// The programmatic `next` entrypoint does not install Next's Node globals until
// `app.prepare()`.  Importers can load server-action modules in the gap between
// importing this entrypoint and starting the app (Vitest's collection phase is
// one example).  Those modules snapshot `globalThis.AsyncLocalStorage` and
// permanently fall back to Next's throwing browser shim when it is absent.
// Next documents this environment module as needing to load before any other
// server modules, so do that before exposing the custom server entrypoint.
require('next/dist/server/node-environment');
type CreateNext = (options: Record<string, unknown>) => NextUpgradeApp & {
  prepare: () => Promise<void>;
  getRequestHandler: () => (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => Promise<unknown>;
  close?: () => Promise<void>;
};
const createNext = require('next') as CreateNext;

/**
 * Development entrypoint for `npm run dev`.
 *
 * The `nx next:dev` path runs Next's built-in server, which owns the HTTP
 * `upgrade` event itself and silently leaves unrecognized upgrades open. An
 * unanswered handshake occupies Chromium's per-origin WebSocket slot and stalls
 * HMR and hydration, so development must run through a server that owns the
 * upgrade listener.
 *
 * This is the same Next app as the built-in dev server, but wrapped in an
 * `http.Server` whose single `upgrade` listener is `attachNextUpgradeHandler`:
 * `/_next/hmr` (and the legacy `/_next/webpack-hmr`) is delegated back to Next,
 * `/hocuspocus` is proxied when
 * configured, and every other upgrade is promptly rejected. It intentionally
 * omits the production Express auth middleware from `index.ts` (which imports
 * client-only modules such as the `@alga-psa/auth` barrel and their CSS); the
 * built-in dev server it replaces does not run that middleware either.
 */

export interface DevServerOptions {
  port?: number;
  hostname?: string;
  /** Next project directory; defaults to this file's directory (`server/`). */
  dir?: string;
  delegateHmrToNext?: boolean;
  /** Hocuspocus upstream; falls back to HOCUSPOCUS_HOST/PORT when omitted. */
  hocuspocusHost?: string;
  hocuspocusPort?: string | number;
  /** Enable Turbopack (mirrors `next dev --turbo`). */
  turbopack?: boolean;
  /** Force the Webpack dev bundler; mainly for isolated fixture servers. */
  webpack?: boolean;
}

export interface RunningDevServer {
  app: NextUpgradeApp;
  server: http.Server;
  port: number;
  hostname: string;
  close: () => Promise<void>;
}

/**
 * Next 16 defaults to Turbopack when a custom server omits both bundler flags.
 * Keep the ordinary `dev` command on Webpack and make Turbopack opt-in through
 * the explicit `dev:turbo` command/environment flag. The captured session
 * shows repeated Turbopack restart events for a shared server entry chunk and
 * HMR hash-mismatch reload messages. It does not establish the underlying
 * cause; this keeps ordinary dev off the captured Turbo path.
 */
export function resolveNextDevBundlerOptions(
  options: Pick<DevServerOptions, 'turbopack' | 'webpack'> = {},
  environment: Pick<NodeJS.ProcessEnv, 'DEV_TURBOPACK'> = process.env,
): { turbopack: true } | { webpack: true } {
  const useTurbopack = options.turbopack ?? (
    options.webpack === true ? false : environment.DEV_TURBOPACK === '1'
  );
  if (useTurbopack && options.webpack === true) {
    throw new Error('Development server cannot enable Webpack and Turbopack together');
  }
  return useTurbopack ? { turbopack: true } : { webpack: true };
}

export async function startDevServer(
  options: DevServerOptions = {},
  createNextApp: CreateNext = createNext,
): Promise<RunningDevServer> {
  if (process.env.NEXT_TURBOPACK_HMR_SUBSCRIPTION_DIAGNOSTICS === '1') {
    const swc = require('next/dist/build/swc') as {
      loadBindings: Parameters<typeof installTurbopackHmrSubscriptionDiagnostics>[0];
    };
    await installTurbopackHmrSubscriptionDiagnostics(swc.loadBindings);
  }

  const port = options.port ?? Number.parseInt(process.env.PORT || '3000', 10);
  const hostname = options.hostname ?? process.env.HOSTNAME ?? '0.0.0.0';
  const dir = options.dir ?? import.meta.dirname;
  const bundlerOptions = resolveNextDevBundlerOptions(options);

  const app = createNextApp({
    dev: true,
    hostname,
    port,
    dir,
    ...bundlerOptions,
  });
  await app.prepare();

  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => handle(req, res));

  // Track every TCP connection (including upgraded sockets, which leave the
  // HTTP server's own accounting) so teardown can close them deterministically.
  const sockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  const nextApp = app as unknown as NextUpgradeApp;
  attachNextUpgradeHandler(server, nextApp, {
    delegateHmrToNext: options.delegateHmrToNext ?? true,
    hocuspocusHost: options.hocuspocusHost ?? process.env.HOCUSPOCUS_HOST,
    hocuspocusPort: options.hocuspocusPort ?? process.env.HOCUSPOCUS_PORT,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, hostname);
  });

  const address = server.address();
  const actualPort =
    typeof address === 'object' && address ? address.port : port;
  console.log(
    `[dev-server] ready on http://${hostname}:${actualPort}${'turbopack' in bundlerOptions ? ' (turbopack)' : ' (webpack)'} (custom upgrade handler active)`,
  );

  return {
    app: nextApp,
    server,
    port: actualPort,
    hostname,
    close: async () => {
      // Close Next's own resources first, then upgraded sockets, then the
      // listener. `server.close()` never closes sockets upgraded out of it, so
      // without the explicit destroy the test/process would hang.
      await app.close?.().catch(() => undefined);
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

const invokedPath = process.argv[1];
const isMain =
  Boolean(invokedPath) && import.meta.url === pathToFileURL(invokedPath).href;

if (isMain) {
  startDevServer().catch((error) => {
    console.error('Failed to start the development server:', error);
    process.exit(1);
  });
}
