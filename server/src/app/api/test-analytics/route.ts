import { NextResponse } from 'next/server';
import { analytics } from '@/lib/analytics/posthog';
import { AnalyticsEvents } from '@/lib/analytics/events';

export async function GET() {
  // Test analytics tracking
  analytics.capture(AnalyticsEvents.API_ERROR, {
    endpoint: '/api/test-analytics',
    method: 'GET',
    test: true,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    success: true,
    message: 'Analytics event sent',
    analyticsEnabled: analytics.getDistinctId() !== null,
    instanceId: analytics.getDistinctId(),
  });
}