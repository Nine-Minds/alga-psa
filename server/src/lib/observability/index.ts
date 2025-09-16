/**
 * OpenTelemetry Observability Module
 *
 * This module provides operational observability for the Grafana stack.
 * It is completely separate from PostHog usage analytics.
 *
 * OBSERVABILITY (this module):
 * • Application performance metrics
 * • Error tracking and debugging
 * • System health monitoring
 * • Database performance monitoring
 * • HTTP request metrics (RED method)
 * 
 * USAGE ANALYTICS (PostHog - separate):
 * • User behavior tracking
 * • Feature usage analytics
 * • Product insights
 * • Business intelligence
 */

// Core initialization
export {
  initializeTelemetry as initializeObservability,
  isTelemetryInitialized as isObservabilityInitialized,
  shutdownTelemetry as shutdownObservability,
} from './initialization';

// Metrics
export {
  ObservabilityMetrics,
  observabilityMetrics,
} from './metrics';

// HTTP and middleware
export {
  createHttpMetricsMiddleware,
  createExpressHttpMetricsMiddleware,
  recordCustomHttpMetrics,
  withDatabaseMetrics,
  withBusinessMetrics,
} from './middleware';

// Logging with trace context
export {
  ObservabilityLogger,
  observabilityLogger,
  traceContextFormat,
  createObservabilityLogger,
  addRequestContextToLogs,
  getCurrentRequestContext,
  logPerformanceTiming,
} from './logging';

// Import instances for internal use
import { observabilityMetrics } from './metrics';
import { observabilityLogger, logPerformanceTiming } from './logging';

// Re-export types and interfaces
export type { RequestMetrics } from './middleware';

/**
 * Quick setup function for common observability patterns
 */
export async function setupObservability(): Promise<{
  metrics: typeof observabilityMetrics;
  logger: typeof observabilityLogger;
  isReady: boolean;
}> {
  const { initializeObservability, isObservabilityInitialized } = await import('./initialization');
  
  // Initialize if not already done
  await initializeObservability();
  
  return {
    metrics: observabilityMetrics,
    logger: observabilityLogger,
    isReady: isObservabilityInitialized(),
  };
}

/**
 * Common observability helper functions
 */
export const observability = {
  /**
   * Record a timed operation with metrics and logging
   */
  async timeOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    context?: {
      tenantId?: string;
      type?: 'http' | 'database' | 'business';
      table?: string;
      method?: string;
      route?: string;
    }
  ): Promise<T> {
    const startTime = Date.now();
    let success = true;
    let result: T;

    try {
      result = await operation();
      return result;
    } catch (error) {
      success = false;
      observabilityLogger.error(`Operation failed: ${operationName}`, error);
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      
      // Record metrics based on operation type
      if (context?.type === 'database' && context.table) {
        observabilityMetrics.recordDatabaseQuery(
          operationName,
          context.table,
          duration / 1000,
          success,
          context.tenantId
        );
      } else if (context?.type === 'http' && context.method && context.route) {
        observabilityMetrics.recordHttpRequest(
          context.method,
          context.route,
          success ? 200 : 500,
          duration / 1000,
          context.tenantId
        );
      }
      
      // Log performance timing
      logPerformanceTiming(operationName, startTime, Date.now(), success, context);
    }
  },

  /**
   * Get observability status and health
   */
  getStatus(): {
    initialized: boolean;
    metricsReady: boolean;
    environment: string;
    serviceName: string;
    serviceVersion: string;
  } {
    const { isObservabilityInitialized } = require('./initialization');
    
    return {
      initialized: isObservabilityInitialized(),
      metricsReady: observabilityMetrics.isReady(),
      environment: process.env.NODE_ENV || 'development',
      serviceName: 'alga-psa',
      serviceVersion: require('../utils/version').getAppVersion(),
    };
  },

  /**
   * Record system health metrics
   */
  recordSystemHealth(): void {
    try {
      const memUsage = process.memoryUsage();
      observabilityMetrics.recordMemoryUsage(memUsage.heapUsed);
      
      observabilityLogger.debug('System health recorded', {
        memory_heap_used: memUsage.heapUsed,
        memory_heap_total: memUsage.heapTotal,
        memory_external: memUsage.external,
        memory_rss: memUsage.rss,
        uptime: process.uptime(),
      });
    } catch (error) {
      observabilityLogger.error('Failed to record system health', error);
    }
  },
};

export default observability;