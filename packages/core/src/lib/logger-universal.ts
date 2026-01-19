/**
 * @alga-psa/core - Universal Logger
 * 
 * Provides a logger that works on both client and server.
 * On server, it uses the winston-based logger.
 * On client, it uses the standard console.
 */

const isServer = typeof window === 'undefined';

let logger: any;

if (isServer) {
  // Use dynamic import to avoid bundling winston on the client
  // However, top-level await is not supported in all environments.
  // We'll use a proxy or a lazily initialized object.
  logger = {
    error: (...args: any[]) => import('./logger').then(m => m.default.error(...args)),
    warn: (...args: any[]) => import('./logger').then(m => m.default.warn(...args)),
    info: (...args: any[]) => import('./logger').then(m => m.default.info(...args)),
    http: (...args: any[]) => import('./logger').then(m => m.default.http(...args)),
    verbose: (...args: any[]) => import('./logger').then(m => m.default.verbose(...args)),
    debug: (...args: any[]) => import('./logger').then(m => m.default.debug(...args)),
    trace: (...args: any[]) => import('./logger').then(m => m.default.trace(...args)),
    system: (...args: any[]) => import('./logger').then(m => m.default.system(...args)),
  };
} else {
  logger = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    http: console.log.bind(console),
    verbose: console.log.bind(console),
    debug: console.debug.bind(console),
    trace: console.debug.bind(console),
    system: console.log.bind(console),
  };
}

export default logger;
