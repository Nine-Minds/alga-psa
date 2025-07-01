import { NextRequest, NextResponse } from 'next/server';
import { analytics } from '../../../lib/analytics/posthog';
import { getServerSession } from "next-auth/next";
import { options as authOptions } from "../auth/[...nextauth]/options";

// Test all implemented analytics events
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  
  const results: Record<string, any> = {
    timestamp: new Date().toISOString(),
    analytics_enabled: analytics.isEnabled,
    test_results: {}
  };

  try {
    // Test Authentication Events
    console.log('Testing Authentication Events...');
    
    // User Login
    analytics.capture('user_login', {
      method: 'test',
      success: true,
      test_run: true
    }, userId);
    results.test_results.user_login = 'sent';

    // User Logout
    analytics.capture('user_logout', {
      session_duration_minutes: 30,
      test_run: true
    }, userId);
    results.test_results.user_logout = 'sent';

    // User Registration
    analytics.capture('user_registration', {
      method: 'test',
      company_size: 'test',
      test_run: true
    });
    results.test_results.user_registration = 'sent';

    // Test Ticket Events
    console.log('Testing Ticket Events...');
    
    // Ticket Created
    analytics.capture('ticket_created', {
      ticket_type: 'test',
      priority: 'medium',
      has_attachments: false,
      created_via: 'api_test',
      test_run: true
    }, userId);
    results.test_results.ticket_created = 'sent';

    // Ticket Updated
    analytics.capture('ticket_updated', {
      fields_updated: ['status', 'priority'],
      update_type: 'manual',
      test_run: true
    }, userId);
    results.test_results.ticket_updated = 'sent';

    // Ticket Status Changed
    analytics.capture('ticket_status_changed', {
      old_status: 'open',
      new_status: 'in_progress',
      test_run: true
    }, userId);
    results.test_results.ticket_status_changed = 'sent';

    // Ticket Viewed
    analytics.capture('ticket_viewed', {
      ticket_id: 'test-ticket-123',
      status_id: 'status-123',
      status_name: 'Open',
      is_closed: false,
      priority_id: 'priority-123',
      has_comments: true,
      comment_count: 5,
      has_documents: false,
      document_count: 0,
      view_source: 'test',
      test_run: true
    }, userId);
    results.test_results.ticket_viewed = 'sent';

    // Test Time Tracking Events
    console.log('Testing Time Tracking Events...');
    
    // Time Entry Created
    analytics.capture('time_entry_created', {
      duration_minutes: 60,
      billable: true,
      has_notes: true,
      entry_method: 'manual',
      test_run: true
    }, userId);
    results.test_results.time_entry_created = 'sent';

    // Time Entry Updated
    analytics.capture('time_entry_updated', {
      fields_changed: ['duration', 'notes'],
      test_run: true
    }, userId);
    results.test_results.time_entry_updated = 'sent';

    // Time Sheet Submitted
    analytics.capture('time_sheet_submitted', {
      total_hours: 40,
      billable_hours: 35,
      entries_count: 10,
      submission_day: 'friday',
      test_run: true
    }, userId);
    results.test_results.time_sheet_submitted = 'sent';

    // Test Billing Events
    console.log('Testing Billing Events...');
    
    // Invoice Generated
    analytics.capture('invoice_generated', {
      invoice_type: 'manual',
      line_items_count: 5,
      has_tax: true,
      generation_time_ms: 250,
      test_run: true
    }, userId);
    results.test_results.invoice_generated = 'sent';

    // Billing Plan Created
    analytics.capture('billing_plan_created', {
      plan_type: 'fixed',
      billing_frequency: 'monthly',
      has_custom_rates: false,
      test_run: true
    }, userId);
    results.test_results.billing_plan_created = 'sent';

    // Test Performance Metrics
    console.log('Testing Performance Metrics...');
    
    // API Performance
    analytics.capture('performance_metric', {
      metric_name: 'api_request_duration',
      value: 150,
      unit: 'ms',
      endpoint: '/api/test-all-analytics',
      method: 'GET',
      status_code: 200,
      test_run: true
    }, userId);
    results.test_results.api_performance = 'sent';

    // Feature Performance
    analytics.capture('performance_metric', {
      metric_name: 'feature_load_time',
      value: 500,
      unit: 'ms',
      feature: 'analytics_test',
      test_run: true
    }, userId);
    results.test_results.feature_performance = 'sent';

    // Test Feature Adoption
    console.log('Testing Feature Adoption Events...');
    
    // Test feature adoption tracker
    const { featureAdoptionTracker } = await import('../../../lib/analytics/featureAdoption');
    
    // Track feature usage
    featureAdoptionTracker.trackFeatureUsage('analytics_testing', userId || 'test-user', {
      test_run: true
    });
    results.test_results.feature_adoption_usage = 'sent';
    
    // Track feature discovery
    featureAdoptionTracker.trackFeatureDiscovery('analytics_testing', userId || 'test-user', 'navigation', {
      test_run: true
    });
    results.test_results.feature_adoption_discovery = 'sent';
    
    // Track feature toggle
    featureAdoptionTracker.trackFeatureToggle('analytics_testing', true, userId || 'test-user', {
      test_run: true
    });
    results.test_results.feature_adoption_toggle = 'sent';
    
    // Feature Used (direct analytics call)
    analytics.capture('feature_used', {
      feature_name: 'analytics_testing',
      feature_category: 'testing',
      first_time: true,
      test_run: true
    }, userId);
    results.test_results.feature_used = 'sent';

    // Dashboard Viewed
    analytics.capture('dashboard_viewed', {
      dashboard_type: 'main',
      widgets_count: 6,
      test_run: true
    }, userId);
    results.test_results.dashboard_viewed = 'sent';

    // Test Error Tracking
    console.log('Testing Error Events...');
    
    // Error Occurred
    analytics.capture('error_occurred', {
      error_type: 'test_error',
      error_category: 'testing',
      severity: 'low',
      test_run: true
    }, userId);
    results.test_results.error_occurred = 'sent';

    // Flush events immediately for testing
    if (analytics.isEnabled && (analytics as any).client) {
      await (analytics as any).client.flush();
      results.events_flushed = true;
    }

    results.status = 'success';
    results.total_events_sent = Object.keys(results.test_results).length;

  } catch (error) {
    console.error('Error testing analytics:', error);
    results.status = 'error';
    results.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return NextResponse.json(results, { 
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    }
  });
}