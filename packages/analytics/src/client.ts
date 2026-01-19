'use client';

// Client-side analytics interface
// This file should be used by client components

export const analytics = {
  capture: (event: string, properties?: Record<string, any>, userId?: string) => {
    // Client-side analytics would use PostHog JS SDK
    // For now, this is a no-op to fix the build
    if (typeof window !== 'undefined' && (window as any).posthog) {
      (window as any).posthog.capture(event, properties);
    }
  },
  
  identify: (userId: string, properties?: Record<string, any>) => {
    if (typeof window !== 'undefined' && (window as any).posthog) {
      (window as any).posthog.identify(userId, properties);
    }
  },
  
  trackPerformance: (metricName: string, value: number, metadata?: Record<string, any>) => {
    if (typeof window !== 'undefined' && (window as any).posthog) {
      (window as any).posthog.capture('performance_metric', {
        metric_name: metricName,
        value,
        ...metadata
      });
    }
  }
};

export class PerformanceTracker {
  private timers: Map<string, number> = new Map();

  startTimer(operationId: string): void {
    this.timers.set(operationId, Date.now());
  }

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

    analytics.trackPerformance(metricName, duration, {
      ...metadata,
      unit: 'ms'
    });

    return duration;
  }
}

export const performanceTracker = new PerformanceTracker();

export function usePerformanceTracking(metricName: string, userId?: string) {
  return {
    trackEvent: (duration: number, metadata?: Record<string, any>) => {
      analytics.trackPerformance(metricName, duration, metadata);
    }
  };
}