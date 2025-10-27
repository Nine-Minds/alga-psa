/**
 * Analytics Middleware
 * Tracks API usage and performance metrics
 */

import { NextRequest } from 'next/server';
import { analytics } from '@server/lib/analytics/posthog';
import { AnalyticsEvents } from '@server/lib/analytics/events';
import { ApiRequest } from './apiMiddleware';

export interface AnalyticsContext {
  startTime: number;
  endpoint: string;
  method: string;
  hasAuth: boolean;
  userId?: string;
}

/**
 * Middleware to track API analytics
 */
export function withAnalytics(handler: Function) {
  return async (req: ApiRequest, ...args: any[]) => {
    const startTime = Date.now();
    const method = req.method || 'GET';
    const url = new URL(req.url || '', `http://${req.headers?.get?.('host') || 'localhost'}`);
    const endpoint = url.pathname;
    
    try {
      // Execute the handler
      const response = await handler(req, ...args);
      
      // Track successful API call
      const duration = Date.now() - startTime;
      analytics.capture('api_request', {
        endpoint: endpoint.replace(/\/[a-f0-9-]{36}/g, '/:id'), // Replace UUIDs with :id
        method,
        status: response.status || 200,
        duration,
        has_auth: !!req.context?.userId,
        is_slow: duration > 1000, // Flag slow requests
      }, req.context?.userId);
      
      // Track slow queries separately
      if (duration > 2000) {
        analytics.capture(AnalyticsEvents.SLOW_QUERY, {
          endpoint,
          method,
          duration,
          threshold_exceeded: '2s',
        }, req.context?.userId);
      }
      
      return response;
    } catch (error: any) {
      // Track API errors
      const duration = Date.now() - startTime;
      analytics.capture(AnalyticsEvents.API_ERROR, {
        endpoint: endpoint.replace(/\/[a-f0-9-]{36}/g, '/:id'),
        method,
        error_type: error.name || 'UnknownError',
        error_code: error.statusCode || 500,
        duration,
        has_auth: !!req.context?.userId,
      }, req.context?.userId);
      
      // Re-throw the error
      throw error;
    }
  };
}

/**
 * Lightweight performance tracking middleware
 */
export function trackPerformance(operationName: string) {
  return function decorator(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const context = args.find(arg => arg?.userId && arg?.tenant);
      
      try {
        const result = await originalMethod.apply(this, args);
        
        // Track performance metrics
        const duration = Date.now() - startTime;
        if (duration > 500) { // Only track operations over 500ms
          analytics.capture('slow_operation', {
            operation: operationName,
            duration,
            class_name: target.constructor.name,
            method_name: propertyName,
          }, context?.userId);
        }
        
        return result;
      } catch (error) {
        // Track operation errors
        analytics.capture('operation_error', {
          operation: operationName,
          error_type: (error as Error).name || 'UnknownError',
          class_name: target.constructor.name,
          method_name: propertyName,
        }, context?.userId);
        
        throw error;
      }
    };
    
    return descriptor;
  };
}