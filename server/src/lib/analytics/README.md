# Analytics Integration Guide

This guide explains how to use the PostHog analytics integration in alga-psa.

## Overview

The analytics system is designed to:
- Collect anonymous usage statistics to improve the product
- Respect user privacy with easy opt-out
- Separate operational metrics (Grafana) from product analytics (PostHog)
- Provide configurable privacy controls

## Configuration

### Environment Variables

```env
# Enable/disable usage statistics
ALGA_USAGE_STATS=true  # Set to false to opt out

# Analytics anonymization
ANALYTICS_ANONYMIZE_USER_IDS=true  # Set to false to use actual user IDs
NEXT_PUBLIC_ANALYTICS_ANONYMIZE_USER_IDS=true  # Must match ANALYTICS_ANONYMIZE_USER_IDS

# Instance identification (optional)
INSTANCE_ID=my-company-instance

# Note: PostHog API key is configured in server/src/config/posthog.config.ts
```

## Usage Examples

### Server-Side Analytics

```typescript
import { analytics } from '@/lib/analytics/posthog';
import { AnalyticsEvents } from '@/lib/analytics/events';

// Track a simple event
analytics.capture(AnalyticsEvents.TICKET_CREATED, {
  ticket_type: 'support',
  priority: 'high',
  has_attachments: true,
});

// Track with user context (when anonymization is disabled)
analytics.capture(AnalyticsEvents.USER_LOGGED_IN, {
  login_method: 'email',
  two_factor_enabled: true,
}, userId);

// Identify a user (when anonymization is disabled)
analytics.identify(userId, {
  plan: 'enterprise',
  company_size: 'medium',
  industry: 'technology',
});
```

### Client-Side Analytics

```typescript
import { usePostHog } from 'posthog-js/react';

export function MyComponent() {
  const posthog = usePostHog();
  
  const handleAction = () => {
    // Track client-side events
    posthog?.capture('button_clicked', {
      button_name: 'create_ticket',
      location: 'dashboard',
    });
  };
  
  return <button onClick={handleAction}>Create Ticket</button>;
}
```

### API Route Example

```typescript
// app/api/tickets/route.ts
import { analytics } from '@/lib/analytics/posthog';
import { AnalyticsEvents, createEventProperties } from '@/lib/analytics/events';

export async function POST(req: Request) {
  const startTime = Date.now();
  
  try {
    const data = await req.json();
    const ticket = await createTicket(data);
    
    // Track successful creation
    analytics.capture(AnalyticsEvents.TICKET_CREATED, createEventProperties({
      ticket_type: ticket.type,
      priority: ticket.priority,
      response_time: Date.now() - startTime,
      source: 'api',
    }));
    
    return Response.json(ticket);
  } catch (error) {
    // Track errors (without sensitive data)
    analytics.capture(AnalyticsEvents.API_ERROR, {
      endpoint: '/api/tickets',
      method: 'POST',
      error_type: error.name,
      response_time: Date.now() - startTime,
    });
    
    throw error;
  }
}
```

## Privacy Considerations

### Data Collection Principles

1. **No PII**: Never collect personally identifiable information
2. **Anonymization**: Configurable user ID anonymization via ANALYTICS_ANONYMIZE_USER_IDS
3. **Transparency**: Show notice on first load
4. **User Control**: Easy opt-out via environment variable

### What We Collect

**When Anonymization is Disabled (ANALYTICS_ANONYMIZE_USER_IDS=false):**
- Feature usage with user context
- Performance metrics per user
- Error patterns with user association
- User journeys

**When Anonymization is Enabled (ANALYTICS_ANONYMIZE_USER_IDS=true):**
- Anonymous feature usage
- Aggregate performance data
- Error types (no user association)
- Version information

### What We Don't Collect

- Names, emails, or other PII
- Customer data
- Sensitive business information
- IP addresses (anonymized)
- Detailed error messages

## Testing Analytics

1. **Check if enabled:**
```typescript
import { PrivacyHelper } from '@/lib/analytics/privacy';

if (PrivacyHelper.shouldCollectTelemetry()) {
  // Analytics is enabled
}
```

2. **Test event capture:**
```bash
# Set environment variable
export ALGA_USAGE_STATS=true

# Run your application and check console logs
# You should see: "Usage statistics enabled (user IDs anonymized)" or "Usage statistics enabled (user IDs preserved)"
# Plus a notice box on first run
```

3. **Test opt-out:**
```bash
# Set environment variable
export ALGA_USAGE_STATS=false

# Run your application and check console logs
# You should see: "Usage statistics disabled by ALGA_USAGE_STATS=false"
```

## Common Events to Track

- User authentication (login/logout/signup)
- Feature usage (which features are used most)
- Performance metrics (slow queries, API response times)
- Errors (types and frequency, not details)
- User journeys (how users navigate the app)
- Search patterns (what users search for)
- Export/report generation

## Best Practices

1. **Always sanitize data** before sending to analytics
2. **Use consistent event names** from AnalyticsEvents enum
3. **Include relevant context** but avoid PII
4. **Track errors** without exposing sensitive information
5. **Measure performance** to identify bottlenecks
6. **Respect user privacy** - when in doubt, don't track it

## Troubleshooting

### Analytics not working?

1. Check environment variables are set correctly
2. Verify ALGA_USAGE_STATS is not set to 'false'
3. Check terminal output for the usage stats notice
4. Check browser console for errors
5. Verify network requests to PostHog

### Events not showing up?

1. PostHog batches events - wait 30 seconds
2. Check if running in development mode
3. Verify event names match what's in PostHog
4. Check for sanitization removing all properties

### Privacy concerns?

1. Review what data is being sent in browser network tab
2. Check PrivacyHelper.sanitizeProperties output
3. Ensure no PII is included in event properties
4. Set ALGA_USAGE_STATS=false to disable completely