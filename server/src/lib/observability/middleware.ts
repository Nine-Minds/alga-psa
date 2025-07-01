/**
 * OpenTelemetry HTTP Middleware for Request Metrics
 * 
 * Automatically captures HTTP request metrics (RED method) for all routes.
 * This is for operational observability, not user behavior analytics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { observabilityMetrics } from './metrics';
import { getCurrentTenantId } from '../db';
import logger from '../../utils/logger';

export interface RequestMetrics {
  startTime: number;
  route: string;
  method: string;
}

/**
 * HTTP request metrics middleware for Next.js API routes
 * Automatically measures request duration, count, and errors
 */
export function createHttpMetricsMiddleware() {
  return async function httpMetricsMiddleware(
    request: NextRequest,
    response: NextResponse
  ) {
    const startTime = Date.now();
    const method = request.method || 'UNKNOWN';
    const pathname = request.nextUrl?.pathname || request.url || '/unknown';
    
    // Sanitize route for metrics (remove dynamic segments)
    const route = sanitizeRouteForMetrics(pathname);
    
    try {
      // Get tenant ID for hosted deployments (if available)
      let tenantId: string | undefined;
      try {
        if (process.env.DEPLOYMENT_TYPE === 'hosted') {
          tenantId = await getCurrentTenantId();
        }
      } catch (error) {
        // Tenant ID not available, continue without it
        logger.debug('Could not get tenant ID for metrics:', error);
      }

      // Continue with the request processing
      const responsePromise = Promise.resolve(response);
      
      responsePromise.finally(() => {
        const duration = (Date.now() - startTime) / 1000; // Convert to seconds
        const statusCode = response?.status || 500;

        // Record HTTP metrics
        observabilityMetrics.recordHttpRequest(
          method,
          route,
          statusCode,
          duration,
          tenantId
        );

        logger.debug('HTTP request metrics recorded', {
          method,
          route,
          statusCode,
          duration,
          tenantId: tenantId ? '[present]' : '[none]',
        });
      });

      return responsePromise;
    } catch (error) {
      // Record error metrics
      const duration = (Date.now() - startTime) / 1000;
      
      observabilityMetrics.recordHttpRequest(
        method,
        route,
        500,
        duration,
        undefined // Don't include tenant ID for errors
      );

      logger.error('Error in HTTP metrics middleware:', error);
      throw error;
    }
  };
}

/**
 * Sanitize route paths for metrics to avoid high cardinality
 * Replaces dynamic segments with placeholders
 */
function sanitizeRouteForMetrics(pathname: string): string {
  // Remove query parameters
  const path = pathname.split('?')[0];
  
  // Replace common dynamic segments
  return path
    // UUIDs
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    // Numeric IDs
    .replace(/\/\d+/g, '/:id')
    // Next.js dynamic routes
    .replace(/\/\[.*?\]/g, '/:param')
    // Remove trailing slashes
    .replace(/\/$/, '') || '/';
}

/**
 * Express-style middleware wrapper for compatibility
 */
export function createExpressHttpMetricsMiddleware() {
  return function expressHttpMetricsMiddleware(
    req: any,
    res: any,
    next: any
  ) {
    const startTime = Date.now();
    const method = req.method || 'UNKNOWN';
    const route = sanitizeRouteForMetrics(req.path || req.url || '/unknown');
    
    // Hook into response finish event
    const originalSend = res.send;
    res.send = function(body: any) {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = res.statusCode || 500;
      
      // Get tenant ID if available
      const tenantId = req.tenantId || req.user?.tenantId;
      
      observabilityMetrics.recordHttpRequest(
        method,
        route,
        statusCode,
        duration,
        tenantId
      );
      
      return originalSend.call(this, body);
    };
    
    next();
  };
}

/**
 * Manual request metrics recording for custom use cases
 */
export function recordCustomHttpMetrics(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number,
  tenantId?: string
): void {
  const duration = durationMs / 1000; // Convert to seconds
  observabilityMetrics.recordHttpRequest(method, route, statusCode, duration, tenantId);
}

/**
 * Database query metrics decorator
 * Use this to wrap database operations for automatic metrics
 */
export function withDatabaseMetrics<T>(
  operation: string,
  table: string,
  tenantId?: string
) {
  return function decorator(
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]): Promise<T> {
      const startTime = Date.now();
      let success = true;

      try {
        const result = await method.apply(this, args);
        return result;
      } catch (error) {
        success = false;
        throw error;
      } finally {
        const duration = (Date.now() - startTime) / 1000;
        observabilityMetrics.recordDatabaseQuery(
          operation,
          table,
          duration,
          success,
          tenantId
        );
      }
    };

    return descriptor;
  };
}

/**
 * Business operation metrics decorator
 * Use this to wrap business operations for automatic metrics
 */
export function withBusinessMetrics(
  action: string,
  type: 'ticket' | 'billing',
  tenantId?: string
) {
  return function decorator(
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await method.apply(this, args);
      
      // Record business operation metrics
      if (type === 'ticket') {
        observabilityMetrics.recordTicketOperation(action, tenantId);
      } else if (type === 'billing') {
        observabilityMetrics.recordBillingOperation(action, tenantId);
      }
      
      return result;
    };

    return descriptor;
  };
}