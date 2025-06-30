import { analytics } from './posthog';

export interface PerformanceMetric {
  metric_name: string;
  value: number;
  unit: 'ms' | 'seconds' | 'bytes' | 'count';
  tags?: Record<string, string>;
}

export class PerformanceTracker {
  private timers: Map<string, number> = new Map();

  /**
   * Start timing an operation
   */
  startTimer(operationId: string): void {
    this.timers.set(operationId, Date.now());
  }

  /**
   * End timing and track the duration
   */
  endTimer(
    operationId: string,
    metricName: string,
    userId?: string,
    metadata?: Record<string, any>
  ): number | null {
    const startTime = this.timers.get(operationId);
    if (!startTime) return null;

    const duration = Date.now() - startTime;
    this.timers.delete(operationId);

    // Track the performance metric
    analytics.capture('performance_metric', {
      metric_name: metricName,
      duration_ms: duration,
      ...metadata
    }, userId);

    // Track slow operations
    if (this.isSlowOperation(metricName, duration)) {
      analytics.capture('slow_operation_detected', {
        operation: metricName,
        duration_ms: duration,
        threshold_exceeded: this.getThreshold(metricName),
        ...metadata
      }, userId);
    }

    return duration;
  }

  /**
   * Track page load performance (client-side)
   */
  trackPageLoad(
    pageName: string,
    metrics: {
      time_to_first_byte?: number;
      dom_content_loaded?: number;
      page_load_complete?: number;
      largest_contentful_paint?: number;
      first_input_delay?: number;
      cumulative_layout_shift?: number;
    },
    userId?: string
  ): void {
    analytics.capture('page_performance', {
      page_name: pageName,
      ...metrics,
      performance_score: this.calculatePerformanceScore(metrics)
    }, userId);
  }

  /**
   * Track API performance (already partially implemented in middleware)
   */
  trackApiPerformance(
    endpoint: string,
    method: string,
    duration: number,
    statusCode: number,
    userId?: string,
    metadata?: Record<string, any>
  ): void {
    const isError = statusCode >= 400;
    const isSlow = duration > this.getThreshold(`api_${method.toLowerCase()}`);

    analytics.capture('api_performance', {
      endpoint,
      method,
      duration_ms: duration,
      status_code: statusCode,
      is_error: isError,
      is_slow: isSlow,
      ...metadata
    }, userId);
  }

  /**
   * Track search performance
   */
  trackSearchPerformance(
    searchType: 'ticket' | 'company' | 'contact' | 'global',
    query: string,
    resultCount: number,
    duration: number,
    userId?: string,
    metadata?: Record<string, any>
  ): void {
    // Don't track the actual query content for privacy
    analytics.capture('search_performance', {
      search_type: searchType,
      query_length: query.length,
      result_count: resultCount,
      duration_ms: duration,
      has_results: resultCount > 0,
      results_per_ms: resultCount / duration,
      ...metadata
    }, userId);
  }

  /**
   * Track report generation performance
   */
  trackReportGeneration(
    reportType: string,
    dataPoints: number,
    duration: number,
    format: 'pdf' | 'excel' | 'csv' | 'json',
    userId?: string,
    metadata?: Record<string, any>
  ): void {
    analytics.capture('report_generation_performance', {
      report_type: reportType,
      data_points: dataPoints,
      duration_ms: duration,
      format,
      data_points_per_second: (dataPoints / duration) * 1000,
      ...metadata
    }, userId);
  }

  /**
   * Track database query performance
   */
  trackDatabaseQuery(
    queryType: 'select' | 'insert' | 'update' | 'delete',
    tableName: string,
    duration: number,
    rowCount: number,
    metadata?: Record<string, any>
  ): void {
    // Only track slow queries to avoid noise
    if (duration > this.getThreshold('database_query')) {
      analytics.capture('slow_database_query', {
        query_type: queryType,
        table_name: tableName,
        duration_ms: duration,
        row_count: rowCount,
        rows_per_ms: rowCount / duration,
        ...metadata
      });
    }
  }

  /**
   * Track bulk operation performance
   */
  trackBulkOperation(
    operationType: string,
    itemCount: number,
    duration: number,
    successCount: number,
    userId?: string,
    metadata?: Record<string, any>
  ): void {
    analytics.capture('bulk_operation_performance', {
      operation_type: operationType,
      total_items: itemCount,
      duration_ms: duration,
      success_count: successCount,
      failure_count: itemCount - successCount,
      items_per_second: (itemCount / duration) * 1000,
      success_rate: (successCount / itemCount) * 100,
      ...metadata
    }, userId);
  }

  /**
   * Helper to determine if an operation is slow
   */
  private isSlowOperation(metricName: string, duration: number): boolean {
    return duration > this.getThreshold(metricName);
  }

  /**
   * Get performance thresholds for different operations
   */
  private getThreshold(metricName: string): number {
    const thresholds: Record<string, number> = {
      // API thresholds (ms)
      api_get: 500,
      api_post: 1000,
      api_put: 1000,
      api_delete: 500,
      
      // Page load thresholds (ms)
      page_load: 3000,
      time_to_first_byte: 600,
      largest_contentful_paint: 2500,
      
      // Operation thresholds (ms)
      database_query: 100,
      search_query: 500,
      report_generation: 5000,
      invoice_generation: 3000,
      
      // Default threshold
      default: 1000
    };

    return thresholds[metricName] || thresholds.default;
  }

  /**
   * Calculate a performance score based on web vitals
   */
  private calculatePerformanceScore(metrics: any): number {
    let score = 100;

    // Deduct points for slow metrics
    if (metrics.largest_contentful_paint > 2500) score -= 20;
    else if (metrics.largest_contentful_paint > 1800) score -= 10;

    if (metrics.first_input_delay > 100) score -= 20;
    else if (metrics.first_input_delay > 50) score -= 10;

    if (metrics.cumulative_layout_shift > 0.1) score -= 20;
    else if (metrics.cumulative_layout_shift > 0.05) score -= 10;

    if (metrics.time_to_first_byte > 600) score -= 10;
    if (metrics.page_load_complete > 3000) score -= 10;

    return Math.max(0, score);
  }
}

// Singleton instance
export const performanceTracker = new PerformanceTracker();

// React hook for client-side performance tracking
export function usePerformanceTracking(pageName: string) {
  if (typeof window === 'undefined') return;

  // Track web vitals when available
  if ('PerformanceObserver' in window) {
    try {
      // LCP
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        performanceTracker.trackPageLoad(pageName, {
          largest_contentful_paint: lastEntry.startTime
        });
      });
      lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });

      // FID
      const fidObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const firstEntry = entries[0];
        performanceTracker.trackPageLoad(pageName, {
          first_input_delay: firstEntry.processingStart - firstEntry.startTime
        });
      });
      fidObserver.observe({ entryTypes: ['first-input'] });

      // CLS
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
        performanceTracker.trackPageLoad(pageName, {
          cumulative_layout_shift: clsValue
        });
      });
      clsObserver.observe({ entryTypes: ['layout-shift'] });
    } catch (e) {
      // Silently fail if performance observers are not supported
    }
  }

  // Track basic page load metrics
  window.addEventListener('load', () => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navigation) {
      performanceTracker.trackPageLoad(pageName, {
        time_to_first_byte: navigation.responseStart - navigation.requestStart,
        dom_content_loaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        page_load_complete: navigation.loadEventEnd - navigation.loadEventStart
      });
    }
  });
}