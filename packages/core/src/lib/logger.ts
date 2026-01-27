/**
 * @alga-psa/core - Logger
 *
 * Centralized logging utility for Alga PSA.
 * On server, it uses Winston with file and console transports.
 * On client, it uses standard console.
 */

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

const logger = {
  error: (msg: string, meta?: any) => meta !== undefined ? getLogger().error(msg, meta) : getLogger().error(msg),
  warn: (msg: string, meta?: any) => meta !== undefined ? getLogger().warn(msg, meta) : getLogger().warn(msg),
  info: (msg: string, meta?: any) => meta !== undefined ? getLogger().info(msg, meta) : getLogger().info(msg),
  http: (msg: string, meta?: any) => meta !== undefined ? getLogger().log(msg, meta) : getLogger().log(msg),
  verbose: (msg: string, meta?: any) => meta !== undefined ? getLogger().log(msg, meta) : getLogger().log(msg),
  debug: (msg: string, meta?: any) => meta !== undefined ? getLogger().debug(msg, meta) : getLogger().debug(msg),
  trace: (msg: string, meta?: any) => meta !== undefined ? getLogger().debug(msg, meta) : getLogger().debug(msg),
  system: (msg: string, meta?: any) => meta !== undefined ? getLogger().log(msg, meta) : getLogger().log(msg),
};

export default logger;