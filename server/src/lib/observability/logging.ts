/**
 * OpenTelemetry Logging Integration
 * 
 * Adds trace context to Winston logs for correlation in Grafana.
 * This enables linking logs to traces for better observability.
 * 
 * IMPORTANT: This is for operational logging, not user behavior analytics.
 */

import winston from 'winston';
import { trace, context } from '@opentelemetry/api';
import logger from '../../utils/logger';

/**
 * Winston format that adds OpenTelemetry trace context to log entries
 * This enables log-to-trace correlation in Grafana
 */
export const traceContextFormat = winston.format((info) => {
  try {
    // Get the active span from OpenTelemetry context
    const span = trace.getActiveSpan();
    
    if (span) {
      const spanContext = span.spanContext();
      
      if (spanContext && spanContext.traceId && spanContext.spanId) {
        // Add trace context to log entry
        info.trace_id = spanContext.traceId;
        info.span_id = spanContext.spanId;
        info.trace_flags = spanContext.traceFlags;
        
        // Add service information for better filtering in Grafana
        info.service_name = 'alga-psa';
        info.deployment_type = process.env.DEPLOYMENT_TYPE || 'on-premise';
        
        // Add tenant ID for hosted deployments (if available)
        if (process.env.DEPLOYMENT_TYPE === 'hosted' && process.env.TENANT_ID) {
          info.tenant_id = process.env.TENANT_ID;
        }
      }
    }
  } catch (error) {
    // Don't break logging if trace context fails
    // Just log the error at debug level to avoid spam
    console.debug('Failed to add trace context to log:', error);
  }
  
  return info;
});

/**
 * Create a logger with OpenTelemetry trace context integration
 * This logger automatically adds trace IDs to all log entries
 */
export function createObservabilityLogger(): winston.Logger {
  return winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      traceContextFormat(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        level: process.env.LOG_LEVEL || 'info',
      }),
      // Add file transport for persistent logs
      new winston.transports.File({
        filename: 'logs/observability.log',
        level: 'debug',
        maxsize: 10485760, // 10MB
        maxFiles: 5,
      }),
    ],
    // Prevent Winston from exiting on uncaught exceptions
    exitOnError: false,
  });
}

/**
 * Enhanced logger that includes trace context and structured logging
 */
export class ObservabilityLogger {
  private logger: winston.Logger;
  
  constructor() {
    this.logger = createObservabilityLogger();
  }

  /**
   * Log with automatic trace context
   */
  info(message: string, meta?: any): void {
    this.logger.info(message, this.enrichMeta(meta));
  }

  /**
   * Log warning with automatic trace context
   */
  warn(message: string, meta?: any): void {
    this.logger.warn(message, this.enrichMeta(meta));
  }

  /**
   * Log error with automatic trace context
   */
  error(message: string, error?: Error | any, meta?: any): void {
    const enrichedMeta = this.enrichMeta(meta);
    
    if (error) {
      if (error instanceof Error) {
        enrichedMeta.error_name = error.name;
        enrichedMeta.error_message = error.message;
        enrichedMeta.error_stack = error.stack;
      } else {
        enrichedMeta.error_details = error;
      }
    }
    
    this.logger.error(message, enrichedMeta);
  }

  /**
   * Log debug information with automatic trace context
   */
  debug(message: string, meta?: any): void {
    this.logger.debug(message, this.enrichMeta(meta));
  }

  /**
   * Log HTTP request information with trace context
   */
  logHttpRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    userAgent?: string,
    tenantId?: string
  ): void {
    this.info('HTTP Request', {
      http_method: method,
      http_url: url,
      http_status_code: statusCode,
      http_duration_ms: duration,
      http_user_agent: userAgent,
      tenant_id: tenantId,
      event_type: 'http_request',
    });
  }

  /**
   * Log database operation with trace context
   */
  logDatabaseOperation(
    operation: string,
    table: string,
    duration: number,
    success: boolean,
    tenantId?: string
  ): void {
    this.info('Database Operation', {
      db_operation: operation,
      db_table: table,
      db_duration_ms: duration,
      db_success: success,
      tenant_id: tenantId,
      event_type: 'database_operation',
    });
  }

  /**
   * Log business operation with trace context
   */
  logBusinessOperation(
    operation: string,
    type: string,
    success: boolean,
    tenantId?: string,
    details?: any
  ): void {
    this.info('Business Operation', {
      business_operation: operation,
      business_type: type,
      business_success: success,
      tenant_id: tenantId,
      business_details: details,
      event_type: 'business_operation',
    });
  }

  /**
   * Log system event with trace context
   */
  logSystemEvent(
    event: string,
    level: 'info' | 'warn' | 'error' = 'info',
    details?: any
  ): void {
    const logMethod = this.logger[level].bind(this.logger);
    logMethod('System Event', {
      system_event: event,
      system_details: details,
      event_type: 'system_event',
    });
  }

  /**
   * Enrich metadata with common observability fields
   */
  private enrichMeta(meta: any = {}): any {
    return {
      ...meta,
      timestamp: new Date().toISOString(),
      service_name: 'alga-psa',
      service_version: process.env.npm_package_version || '1.0.0',
      deployment_type: process.env.DEPLOYMENT_TYPE || 'on-premise',
      node_env: process.env.NODE_ENV || 'development',
    };
  }
}

/**
 * Singleton observability logger instance
 */
export const observabilityLogger = new ObservabilityLogger();

/**
 * Middleware to add request context to logs
 */
export function addRequestContextToLogs(req: any, res: any, next: any): void {
  // Store request information in context for logging
  const requestContext = {
    request_id: req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    user_id: req.user?.id,
    tenant_id: req.tenantId || req.user?.tenantId,
    session_id: req.sessionID,
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
  };

  // Add to request for downstream use
  req.observabilityContext = requestContext;
  
  next();
}

/**
 * Get current request context for logging
 */
export function getCurrentRequestContext(req?: any): any {
  return req?.observabilityContext || {};
}

/**
 * Log performance timing with trace context
 */
export function logPerformanceTiming(
  operation: string,
  startTime: number,
  endTime: number,
  success: boolean,
  details?: any
): void {
  const duration = endTime - startTime;
  
  observabilityLogger.info('Performance Timing', {
    performance_operation: operation,
    performance_duration_ms: duration,
    performance_start_time: startTime,
    performance_end_time: endTime,
    performance_success: success,
    performance_details: details,
    event_type: 'performance_timing',
  });
}

export default observabilityLogger;