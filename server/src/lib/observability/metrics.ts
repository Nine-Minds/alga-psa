/**
 * OpenTelemetry Metrics for Operational Observability
 * 
 * IMPORTANT: This is for OPERATIONAL METRICS only - NOT usage analytics.
 * This sends metrics to Grafana Alloy → Prometheus for monitoring system health.
 * 
 * PostHog handles separate usage analytics and should not be mixed with this.
 */

import { metrics } from '@opentelemetry/api';
import logger from './simple-logger';

export class ObservabilityMetrics {
  private meter = metrics.getMeter('alga-psa-observability');
  private isInitialized = false;

  // HTTP Metrics (RED method: Rate, Errors, Duration)
  private httpRequestDuration: any;
  private httpRequestCount: any;
  private httpErrorCount: any;

  // Database Metrics
  private dbQueryDuration: any;
  private dbQueryCount: any;
  private dbConnectionCount: any;

  // Business Metrics
  private ticketOperations: any;
  private billingOperations: any;
  private userSessions: any;

  // System Metrics
  private activeConnections: any;
  private memoryUsage: any;

  // Authentication Metrics
  private authAttempts: any;
  private authSuccess: any;
  private authFailures: any;
  private authDuration: any;
  private activeAuthSessions: any;

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Initialize all metric instruments
   */
  private initializeMetrics(): void {
    try {
      // HTTP Metrics (RED method)
      this.httpRequestDuration = this.meter.createHistogram('http_request_duration_seconds', {
        description: 'HTTP request latency in seconds',
        unit: 's',
      });

      this.httpRequestCount = this.meter.createCounter('http_requests_total', {
        description: 'Total number of HTTP requests',
      });

      this.httpErrorCount = this.meter.createCounter('http_errors_total', {
        description: 'Total number of HTTP errors',
      });

      // Database Metrics
      this.dbQueryDuration = this.meter.createHistogram('db_query_duration_seconds', {
        description: 'Database query duration in seconds',
        unit: 's',
      });

      this.dbQueryCount = this.meter.createCounter('db_queries_total', {
        description: 'Total number of database queries',
      });

      this.dbConnectionCount = this.meter.createUpDownCounter('db_connections_active', {
        description: 'Number of active database connections',
      });

      // Business Metrics (operational focus, not user analytics)
      this.ticketOperations = this.meter.createCounter('ticket_operations_total', {
        description: 'Total ticket operations for system monitoring',
      });

      this.billingOperations = this.meter.createCounter('billing_operations_total', {
        description: 'Total billing operations for system monitoring',
      });

      this.userSessions = this.meter.createUpDownCounter('user_sessions_active', {
        description: 'Number of active user sessions',
      });

      // System Metrics
      this.activeConnections = this.meter.createUpDownCounter('system_connections_active', {
        description: 'Number of active system connections',
      });

      this.memoryUsage = this.meter.createGauge('system_memory_usage_bytes', {
        description: 'System memory usage in bytes',
      });

      // Authentication Metrics
      this.authAttempts = this.meter.createCounter('auth_attempts_total', {
        description: 'Total number of authentication attempts',
      });

      this.authSuccess = this.meter.createCounter('auth_success_total', {
        description: 'Total number of successful authentications',
      });

      this.authFailures = this.meter.createCounter('auth_failures_total', {
        description: 'Total number of failed authentication attempts',
      });

      this.authDuration = this.meter.createHistogram('auth_duration_seconds', {
        description: 'Authentication process duration in seconds',
        unit: 's',
      });

      this.activeAuthSessions = this.meter.createUpDownCounter('auth_sessions_active', {
        description: 'Number of active authenticated sessions',
      });

      this.isInitialized = true;
      logger.debug('Observability metrics initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize observability metrics:', error);
    }
  }

  /**
   * Record HTTP request metrics (RED method)
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    tenantId?: string
  ): void {
    if (!this.isInitialized) return;

    try {
      const baseAttributes = {
        method,
        route,
        status_code: statusCode.toString(),
        ...(tenantId ? { tenant_id: tenantId } : {}),
      };

      // Request count (Rate)
      this.httpRequestCount.add(1, baseAttributes);

      // Request duration (Duration)
      this.httpRequestDuration.record(duration, baseAttributes);

      // Error count (Errors)
      if (statusCode >= 400) {
        this.httpErrorCount.add(1, {
          ...baseAttributes,
          error_type: statusCode >= 500 ? 'server_error' : 'client_error',
        });
      }
    } catch (error) {
      logger.error('Failed to record HTTP request metrics:', error);
    }
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(
    operation: string,
    table: string,
    duration: number,
    success: boolean,
    tenantId?: string
  ): void {
    if (!this.isInitialized) return;

    try {
      const attributes = {
        operation,
        table,
        success: success.toString(),
        ...(tenantId ? { tenant_id: tenantId } : {}),
      };

      this.dbQueryCount.add(1, attributes);
      this.dbQueryDuration.record(duration, attributes);
    } catch (error) {
      logger.error('Failed to record database query metrics:', error);
    }
  }

  /**
   * Record database connection changes
   */
  recordDatabaseConnection(change: number, tenantId?: string): void {
    if (!this.isInitialized) return;

    try {
      const attributes = tenantId ? { tenant_id: tenantId } : {};
      this.dbConnectionCount.add(change, attributes);
    } catch (error) {
      logger.error('Failed to record database connection metrics:', error);
    }
  }

  /**
   * Record ticket operations for system monitoring
   * NOTE: This is for operational metrics, not user behavior analytics
   */
  recordTicketOperation(action: string, tenantId?: string): void {
    if (!this.isInitialized) return;

    try {
      const attributes = {
        action,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      };

      this.ticketOperations.add(1, attributes);
    } catch (error) {
      logger.error('Failed to record ticket operation metrics:', error);
    }
  }

  /**
   * Record billing operations for system monitoring
   * NOTE: This is for operational metrics, not business analytics
   */
  recordBillingOperation(action: string, tenantId?: string): void {
    if (!this.isInitialized) return;

    try {
      const attributes = {
        action,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      };

      this.billingOperations.add(1, attributes);
    } catch (error) {
      logger.error('Failed to record billing operation metrics:', error);
    }
  }

  /**
   * Record user session changes for system capacity monitoring
   */
  recordUserSession(change: number, tenantId?: string): void {
    if (!this.isInitialized) return;

    try {
      const attributes = tenantId ? { tenant_id: tenantId } : {};
      this.userSessions.add(change, attributes);
    } catch (error) {
      logger.error('Failed to record user session metrics:', error);
    }
  }

  /**
   * Record system connection changes
   */
  recordSystemConnection(change: number): void {
    if (!this.isInitialized) return;

    try {
      this.activeConnections.add(change);
    } catch (error) {
      logger.error('Failed to record system connection metrics:', error);
    }
  }

  /**
   * Record system memory usage
   */
  recordMemoryUsage(usage: number): void {
    if (!this.isInitialized) return;

    try {
      this.memoryUsage.record(usage);
    } catch (error) {
      logger.error('Failed to record memory usage metrics:', error);
    }
  }

  /**
   * Record authentication attempt
   */
  recordAuthAttempt(
    method: string,
    success: boolean,
    duration: number,
    reason?: string,
    tenantId?: string
  ): void {
    if (!this.isInitialized) return;

    try {
      const attributes = {
        method, // e.g., 'password', 'oauth', 'sso', 'api_key'
        ...(tenantId ? { tenant_id: tenantId } : {}),
      };

      // Record attempt
      this.authAttempts.add(1, attributes);

      // Record duration
      this.authDuration.record(duration, attributes);

      if (success) {
        this.authSuccess.add(1, attributes);
      } else {
        this.authFailures.add(1, {
          ...attributes,
          reason: reason || 'unknown', // e.g., 'invalid_credentials', 'account_locked', 'mfa_failed'
        });
      }
    } catch (error) {
      logger.error('Failed to record authentication metrics:', error);
    }
  }

  /**
   * Record active authentication session changes
   */
  recordAuthSession(change: number, method?: string, tenantId?: string): void {
    if (!this.isInitialized) return;

    try {
      const attributes = {
        ...(method ? { method } : {}),
        ...(tenantId ? { tenant_id: tenantId } : {}),
      };
      this.activeAuthSessions.add(change, attributes);
    } catch (error) {
      logger.error('Failed to record auth session metrics:', error);
    }
  }

  /**
   * Get all available metric names for dashboard creation
   */
  getAvailableMetrics(): string[] {
    return [
      'http_request_duration_seconds',
      'http_requests_total',
      'http_errors_total',
      'db_query_duration_seconds',
      'db_queries_total',
      'db_connections_active',
      'ticket_operations_total',
      'billing_operations_total',
      'user_sessions_active',
      'system_connections_active',
      'system_memory_usage_bytes',
      'auth_attempts_total',
      'auth_success_total',
      'auth_failures_total',
      'auth_duration_seconds',
      'auth_sessions_active',
    ];
  }

  /**
   * Check if metrics are initialized and ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Export singleton instance
export const observabilityMetrics = new ObservabilityMetrics();
export default observabilityMetrics;