/**
 * @alga-psa/core - Logger
 *
 * Centralized logging utility for AlgaPSA.
 * On server, it uses Winston with file and console transports.
 * On client, it uses standard console.
 */

import { sanitizeLogMeta } from './providerErrors';

const isServer = typeof window === 'undefined';

// Define custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  trace: 6,
  system: 7
};

export type LogLevelName = keyof typeof levels;
type LevelName = LogLevelName;

export const logLevels = levels;

// LOG_LEVEL is documented (.env.example) with these spellings; map them onto
// the winston-style level names above so both vocabularies work.
const levelAliases: Record<string, LevelName> = {
  warning: 'warn',
  critical: 'error',
  fatal: 'error',
  silly: 'system',
  all: 'system'
};

// Anything noisier than `info` is opt-in. Without this the ~270 logger.debug
// call sites across the codebase print on every request and drown the logs.
const DEFAULT_LEVEL: LevelName = 'info';

/**
 * Resolve a LOG_LEVEL env value to a level name this codebase's loggers accept.
 * Shared with the winston logger in server/src/utils/logger.tsx so both honour
 * the same vocabulary and the same default.
 */
export const resolveLogLevel = (raw?: string): LogLevelName => {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return DEFAULT_LEVEL;
  const name = levelAliases[normalized] ?? normalized;
  return name in levels ? (name as LogLevelName) : DEFAULT_LEVEL;
};

let cachedThreshold: number | undefined;

const getThreshold = (): number => {
  if (cachedThreshold !== undefined) return cachedThreshold;

  const raw = typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined;
  cachedThreshold = levels[resolveLogLevel(raw)];

  return cachedThreshold;
};

const enabled = (level: LevelName): boolean => levels[level] <= getThreshold();

let internalLogger: any;

const getLogger = () => {
  if (internalLogger) return internalLogger;

  if (isServer) {
    // We would like to use Winston on server, but top-level imports of 'winston' 
    // and 'winston-daily-rotate-file' cause bundling issues on the client even 
    // if guarded by if(isServer).
    // For now, we'll use a simple proxy or console on server too until we can 
    // properly isolate the winston dependency.
    
    // NOTE: In a real production app, you'd use a separate package or 
    // entry point for server-only logging.
    
    internalLogger = console; // Fallback to console for now to get things running
  } else {
    internalLogger = console;
  }
  
  return internalLogger;
};

// Defense in depth: structured meta passes through key-based redaction so
// credential-shaped fields (tokens, secrets, Authorization headers, Axios
// request configs) never reach the log backend even if a call site forwards
// a raw error object.
const safeMeta = (meta: unknown): unknown => {
  try {
    return sanitizeLogMeta(meta);
  } catch {
    return '[Unserializable log meta]';
  }
};

// Each level is gated on LOG_LEVEL before the backend call, so a suppressed
// log costs nothing beyond the comparison — meta is never serialized.
const emit = (level: LevelName, method: 'error' | 'warn' | 'info' | 'debug' | 'log') =>
  (msg: string, meta?: any) => {
    if (!enabled(level)) return;
    if (meta !== undefined) {
      getLogger()[method](msg, safeMeta(meta));
    } else {
      getLogger()[method](msg);
    }
  };

const logger = {
  error: emit('error', 'error'),
  warn: emit('warn', 'warn'),
  info: emit('info', 'info'),
  http: emit('http', 'log'),
  verbose: emit('verbose', 'log'),
  debug: emit('debug', 'debug'),
  trace: emit('trace', 'debug'),
  system: emit('system', 'log'),
};

export default logger;
