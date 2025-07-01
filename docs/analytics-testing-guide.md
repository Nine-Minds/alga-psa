# Analytics Testing Guide

## Overview
This guide explains how to test the PostHog analytics implementation in Alga PSA.

## Test Methods

### Method 1: Web UI Test Page
1. Start the development server: `npm run dev`
2. Navigate to Settings > Analytics Test in the sidebar
3. Click "Run All Tests" to send test events
4. Review the results displayed on the page

### Method 2: API Endpoint Test
```bash
# Direct API call
curl -X GET http://localhost:3000/api/test-all-analytics

# Or use the test script
./test-analytics.sh
```

### Method 3: Manual Event Testing
Test individual features that trigger analytics:

1. **Authentication Events**
   - Login: Sign in to the application
   - Logout: Sign out from the application
   - Registration: Create a new user account

2. **Ticket Events**
   - Create a ticket: Navigate to Tickets > New Ticket
   - Update a ticket: Edit an existing ticket
   - Change ticket status: Update ticket workflow state

3. **Time Tracking Events**
   - Create time entry: Add a new time entry
   - Update time entry: Edit an existing entry
   - Submit timesheet: Submit weekly timesheet

4. **Billing Events**
   - Generate invoice: Create a new invoice
   - Create billing plan: Add a new billing plan

## Verifying Events in PostHog

1. Visit [PostHog Dashboard](https://us.posthog.com)
2. Look for events with the following properties:
   - `test_run: true` (for test events)
   - `deployment_type: on-premise` or `hosted`
   - Event names matching the implemented events

## Implemented Events

### Authentication
- `user_login` - User signs in
- `user_logout` - User signs out
- `user_registration` - New user registration

### Tickets
- `ticket_created` - New ticket created
- `ticket_updated` - Ticket modified
- `ticket_status_changed` - Ticket status updated

### Time Tracking
- `time_entry_created` - New time entry
- `time_entry_updated` - Time entry modified
- `time_sheet_submitted` - Timesheet submitted

### Billing
- `invoice_generated` - Invoice created
- `billing_plan_created` - New billing plan

### Performance
- `api_request_duration` - API performance metrics
- `feature_load_time` - Feature performance

### Feature Usage
- `feature_used` - Feature interaction
- `dashboard_viewed` - Dashboard access
- `error_occurred` - Error tracking

## Troubleshooting

### Analytics Not Working?

1. **Check Environment Variables**
   ```bash
   echo $ALGA_USAGE_STATS
   echo $NEXT_PUBLIC_ALGA_USAGE_STATS
   ```
   Both should be `true` (or unset, as true is the default)

2. **Check Console Logs**
   - Look for "Usage statistics enabled" message
   - Check for any PostHog initialization errors

3. **Verify Network Requests**
   - Open browser DevTools > Network tab
   - Look for requests to `us.i.posthog.com`
   - Check if events are being sent

4. **Test with Debug Mode**
   ```javascript
   // In browser console
   window.posthog?.debug()
   ```

### Common Issues

1. **Events not appearing in PostHog**
   - Events may take 1-2 minutes to appear
   - Check if analytics is disabled via env vars
   - Verify network connectivity

2. **Client-side errors**
   - Ensure PostHog JS is loaded
   - Check for content blockers/ad blockers

3. **Server-side errors**
   - Check server logs for PostHog initialization
   - Verify API key is correct

## Privacy & Opt-out

Users can opt out of analytics by setting:
```bash
ALGA_USAGE_STATS=false
```

This completely disables all analytics collection.