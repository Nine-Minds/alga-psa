/**
 * Client-safe logger for extension components
 * 
 * This logger works in both server and client contexts without dependencies
 * on Node.js-specific modules like 'fs' that cause build errors in Next.js.
 */

export interface Logger {
  error: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  debug: (message: string, meta?: any) => void;
}

class ClientSafeLogger implements Logger {
  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  error(message: string, meta?: any): void {
    if (typeof window !== 'undefined') {
      // Client-side: use console
      console.error(this.formatMessage('error', message, meta));
    } else {
      // Server-side: try to use the server logger, fallback to console
      try {
        // Dynamic import to avoid build-time resolution issues
        import('../core/logger').then(({ default: serverLogger }) => {
          serverLogger.error(message, meta);
        }).catch(() => {
          console.error(this.formatMessage('error', message, meta));
        });
      } catch {
        console.error(this.formatMessage('error', message, meta));
      }
    }
  }

  warn(message: string, meta?: any): void {
    if (typeof window !== 'undefined') {
      console.warn(this.formatMessage('warn', message, meta));
    } else {
      try {
        import('../core/logger').then(({ default: serverLogger }) => {
          serverLogger.warn(message, meta);
        }).catch(() => {
          console.warn(this.formatMessage('warn', message, meta));
        });
      } catch {
        console.warn(this.formatMessage('warn', message, meta));
      }
    }
  }

  info(message: string, meta?: any): void {
    if (typeof window !== 'undefined') {
      console.info(this.formatMessage('info', message, meta));
    } else {
      try {
        import('../core/logger').then(({ default: serverLogger }) => {
          serverLogger.info(message, meta);
        }).catch(() => {
          console.info(this.formatMessage('info', message, meta));
        });
      } catch {
        console.info(this.formatMessage('info', message, meta));
      }
    }
  }

  debug(message: string, meta?: any): void {
    if (typeof window !== 'undefined') {
      console.debug(this.formatMessage('debug', message, meta));
    } else {
      try {
        import('../core/logger').then(({ default: serverLogger }) => {
          serverLogger.debug(message, meta);
        }).catch(() => {
          console.debug(this.formatMessage('debug', message, meta));
        });
      } catch {
        console.debug(this.formatMessage('debug', message, meta));
      }
    }
  }
}

export const clientLogger = new ClientSafeLogger();
export default clientLogger;