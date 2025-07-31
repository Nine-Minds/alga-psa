import winston from 'winston';
import { format } from 'winston';

export interface LoggerConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  enableConsole: boolean;
  enableFile: boolean;
  filename?: string;
  maxFileSize: string;
  maxFiles: number;
  auditLog: boolean;
  auditFilename?: string;
}

export interface LogContext {
  sessionId?: string;
  toolName?: string;
  processId?: number;
  clientId?: string;
  requestId?: string;
  duration?: number;
  [key: string]: any;
}

/**
 * Structured logger for the MCP debugger server
 * Provides audit logging and contextual information
 */
class Logger {
  private logger: winston.Logger;
  private auditLogger?: winston.Logger;

  constructor(config: LoggerConfig) {
    // Create main logger
    this.logger = this.createMainLogger(config);
    
    // Create audit logger if enabled
    if (config.auditLog) {
      this.auditLogger = this.createAuditLogger(config);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: LogContext): void {
    const errorContext = {
      ...context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    };
    
    this.logger.error(message, errorContext);
  }

  /**
   * Log audit event (security-relevant actions)
   */
  audit(event: string, context: LogContext): void {
    if (this.auditLogger) {
      this.auditLogger.info(event, {
        ...context,
        timestamp: new Date().toISOString(),
        event,
      });
    }
    
    // Also log to main logger with audit tag
    this.logger.info(`AUDIT: ${event}`, context);
  }

  /**
   * Log tool execution
   */
  toolExecution(
    toolName: string,
    success: boolean,
    duration: number,
    context?: LogContext
  ): void {
    const logContext: LogContext = {
      ...context,
      toolName,
      success,
      duration,
      type: 'tool_execution',
    };

    if (success) {
      this.info(`Tool executed successfully: ${toolName}`, logContext);
    } else {
      this.warn(`Tool execution failed: ${toolName}`, logContext);
    }

    // Always audit tool executions
    this.audit('tool_execution', logContext);
  }

  /**
   * Log session lifecycle events
   */
  sessionEvent(
    event: 'created' | 'connected' | 'disconnected' | 'destroyed',
    sessionId: string,
    context?: LogContext
  ): void {
    const logContext: LogContext = {
      ...context,
      sessionId,
      event,
      type: 'session_event',
    };

    this.info(`Session ${event}: ${sessionId}`, logContext);
    this.audit('session_event', logContext);
  }

  /**
   * Log authentication events
   */
  authEvent(
    event: 'login' | 'logout' | 'failed_login' | 'api_key_generated' | 'api_key_revoked',
    context: LogContext
  ): void {
    const logContext: LogContext = {
      ...context,
      event,
      type: 'auth_event',
    };

    this.info(`Authentication ${event}`, logContext);
    this.audit('auth_event', logContext);
  }

  /**
   * Log security events
   */
  securityEvent(
    event: 'rate_limit_exceeded' | 'invalid_request' | 'suspicious_activity',
    context: LogContext
  ): void {
    const logContext: LogContext = {
      ...context,
      event,
      type: 'security_event',
    };

    this.warn(`Security event: ${event}`, logContext);
    this.audit('security_event', logContext);
  }

  /**
   * Log performance metrics
   */
  metrics(metrics: Record<string, number>, context?: LogContext): void {
    const logContext: LogContext = {
      ...context,
      metrics,
      type: 'performance_metrics',
    };

    this.debug('Performance metrics', logContext);
  }

  /**
   * Create child logger with persistent context
   */
  child(context: LogContext): Logger {
    const childLogger = winston.createLogger({
      level: this.logger.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format((info) => {
          return { ...info, ...context };
        })()
      ),
      transports: this.logger.transports,
    });

    // Create new logger instance with child logger
    const child = Object.create(Logger.prototype);
    child.logger = childLogger;
    child.auditLogger = this.auditLogger;
    return child;
  }

  /**
   * Create the main application logger
   */
  private createMainLogger(config: LoggerConfig): winston.Logger {
    const transports: winston.transport[] = [];

    // Console transport
    if (config.enableConsole) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.colorize({ all: true }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length > 0 ? 
                ` ${JSON.stringify(meta)}` : '';
              return `${timestamp} [${level}] ${message}${metaStr}`;
            })
          ),
        })
      );
    }

    // File transport
    if (config.enableFile && config.filename) {
      transports.push(
        new winston.transports.File({
          filename: config.filename,
          maxsize: this.parseSize(config.maxFileSize),
          maxFiles: config.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
          ),
        })
      );
    }

    return winston.createLogger({
      level: config.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
      exitOnError: false,
    });
  }

  /**
   * Create the audit logger
   */
  private createAuditLogger(config: LoggerConfig): winston.Logger {
    const filename = config.auditFilename || config.filename?.replace('.log', '-audit.log') || 'audit.log';
    
    return winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename,
          maxsize: this.parseSize(config.maxFileSize),
          maxFiles: config.maxFiles,
        }),
      ],
      exitOnError: false,
    });
  }

  /**
   * Parse file size string to bytes
   */
  private parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+)([kmg]?)b?$/i);
    if (!match) return 10 * 1024 * 1024; // Default 10MB

    const size = parseInt(match[1], 10);
    const unit = match[2]?.toLowerCase();

    switch (unit) {
      case 'k': return size * 1024;
      case 'm': return size * 1024 * 1024;
      case 'g': return size * 1024 * 1024 * 1024;
      default: return size;
    }
  }
}

// Default logger configuration
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: 'info',
  enableConsole: true,
  enableFile: false,
  maxFileSize: '10MB',
  maxFiles: 5,
  auditLog: true,
};

// Global logger instance
let globalLogger: Logger | null = null;

/**
 * Initialize the global logger
 */
export function initializeLogger(config: LoggerConfig = DEFAULT_LOGGER_CONFIG): Logger {
  globalLogger = new Logger(config);
  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(DEFAULT_LOGGER_CONFIG);
  }
  return globalLogger;
}

/**
 * Create a contextual logger for a specific component
 */
export function createLogger(context: LogContext): Logger {
  return getLogger().child(context);
}

// Export the Logger class
export { Logger };