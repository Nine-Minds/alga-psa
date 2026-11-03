/**
 * @alga-psa/core - Universal Logger
 * 
 * Provides a logger that works on both client and server.
 * On server, it uses the winston-based logger.
 * On client, it uses the standard console.
 */

const isServer = typeof window === 'undefined';

type Level = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'trace' | 'system';
const LEVELS: readonly Level[] = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'trace', 'system'];

const consoleLogger: Record<Level, (...args: any[]) => void> = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  http: console.log.bind(console),
  verbose: console.log.bind(console),
  debug: console.debug.bind(console),
  trace: console.debug.bind(console),
  system: console.log.bind(console),
};

let logger: any;

if (isServer) {
  // Load winston lazily so the client bundle never pulls it in. The import is
  // memoised, and once it lands every call is synchronous. A failed load (or a
  // log call that throws) falls back to the console: logging is fire-and-forget,
  // so a rejection here would surface as an unhandled rejection in the caller.
  let serverLogger: any;
  let loading: Promise<any> | undefined;

  const loadServerLogger = (): Promise<any> => {
    loading ??= import('./logger').then(
      (m) => (serverLogger = m.default),
      () => {
        loading = undefined;
        return consoleLogger;
      },
    );
    return loading;
  };

  const emit = (target: any, level: Level, args: any[]) => {
    try {
      target[level](...args);
    } catch {
      consoleLogger[level](...args);
    }
  };

  logger = Object.fromEntries(
    LEVELS.map((level) => [
      level,
      (...args: any[]): Promise<void> => {
        if (serverLogger) {
          emit(serverLogger, level, args);
          return Promise.resolve();
        }
        return loadServerLogger().then((target) => emit(target, level, args));
      },
    ]),
  );
} else {
  logger = consoleLogger;
}

export default logger;
