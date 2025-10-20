# Analytics Events Reference

This document provides a comprehensive reference of all analytics events tracked in Alga PSA.

## Event Categories

### 1. Authentication Events

| Event Name | Description | Properties |
|------------|-------------|------------|
| `user_login` | User successfully logs in | `method`, `success` |
| `user_logout` | User logs out | `session_duration_minutes` |
| `user_registration` | New user registers | `method`, `company_size` |

### 2. Ticket Management Events

| Event Name | Description | Properties |
|------------|-------------|------------|
| `ticket_created` | New ticket created | `ticket_type`, `priority`, `has_attachments`, `created_via`, `has_asset` |
| `ticket_updated` | Ticket information updated | `fields_updated`, `update_type` |
| `ticket_status_changed` | Ticket status changed | `old_status`, `new_status` |
| `ticket_viewed` | Ticket details viewed | `ticket_id`, `status_id`, `status_name`, `is_closed`, `priority_id`, `category_id`, `channel_id`, `assigned_to`, `company_id`, `has_comments`, `comment_count`, `has_documents`, `document_count`, `has_additional_agents`, `additional_agent_count`, `has_schedule`, `total_scheduled_minutes`, `view_source` |

### 3. Time Tracking Events

| Event Name | Description | Properties |
|------------|-------------|------------|
| `time_entry_created` | New time entry created | `duration_minutes`, `billable`, `has_notes`, `entry_method` |
| `time_entry_updated` | Time entry modified | `fields_changed` |
| `time_sheet_submitted` | Timesheet submitted for approval | `total_hours`, `billable_hours`, `entries_count`, `submission_day` |

### 4. Billing Events

| Event Name | Description | Properties |
|------------|-------------|------------|
| `invoice_generated` | Invoice created | `invoice_type`, `line_items_count`, `has_tax`, `generation_time_ms` |
| `contract_line_created` | New contract line created | `contract_line_type`, `billing_frequency`, `has_custom_rates` |

### 5. Performance Metrics

| Event Name | Description | Properties |
|------------|-------------|------------|
| `performance_metric` | Performance measurement | `metric_name`, `value`, `unit`, additional context |
| `api_request_duration` | API endpoint performance | `endpoint`, `method`, `status_code`, `duration` |
| `feature_load_time` | Feature loading performance | `feature`, `duration` |

### 6. Feature Adoption Events

| Event Name | Description | Properties |
|------------|-------------|------------|
| `feature_used` | Feature accessed by user | `feature_name`, `feature_category`, `first_time` |
| `feature_discovered` | User discovers new feature | `feature_name`, `discovery_method` |
| `feature_enabled` | Feature enabled | `feature_name` |
| `feature_disabled` | Feature disabled | `feature_name` |
| `feature_first_use` | First time using a feature | `feature_name`, `feature_category` |
| `feature_retention` | Continued feature usage | `feature_name`, `retention_period`, `days_since_first_use` |

### 7. User Behavior Events

| Event Name | Description | Properties |
|------------|-------------|------------|
| `dashboard_viewed` | Dashboard accessed | `dashboard_type`, `widgets_count` |
| `power_user_score_calculated` | Power user score calculated | `score`, `unique_features_used`, `advanced_features_used` |
| `role_based_usage_pattern` | Usage pattern by role | `user_role`, `adoption_rate` |

### 8. Error Tracking Events

| Event Name | Description | Properties |
|------------|-------------|------------|
| `error_occurred` | Error encountered | `error_type`, `error_category`, `severity` |

## Common Properties

All events include these standard properties:
- `deployment_type`: 'hosted' or 'on-premise'
- `app_version`: Current application version
- `environment`: Current environment (development/production)
- `timestamp`: Event timestamp
- `distinct_id`: Anonymized user/instance identifier

## Feature Categories

Features are grouped into the following categories:
- **ticketing**: Ticket management features
- **time_tracking**: Time entry and timesheet features
- **billing**: Invoice and billing features
- **reporting**: Report generation and analytics
- **integrations**: Third-party integrations
- **advanced**: Advanced configuration features
- **collaboration**: Team collaboration features

## Privacy Considerations

1. **No PII**: Events never include personally identifiable information
2. **Anonymization**: User IDs are hashed for on-premise deployments
3. **Opt-out**: Users can disable analytics with `ALGA_USAGE_STATS=false`
4. **Data Retention**: Events are retained according to PostHog's data retention policy

## Testing Events

Test events can be identified by the `test_run: true` property. These are excluded from production analytics.

## Implementation Examples

### Tracking Feature Usage
```typescript
import { featureAdoptionTracker } from '@/lib/analytics/featureAdoption';

// Track when a user uses a feature
featureAdoptionTracker.trackFeatureUsage('invoice_generation', userId, {
  invoice_count: 5,
  template_used: true
});
```

### Tracking Performance
```typescript
import { analytics } from '@/lib/analytics/posthog';

// Track API performance
analytics.capture('performance_metric', {
  metric_name: 'api_request_duration',
  value: responseTime,
  unit: 'ms',
  endpoint: '/api/tickets',
  method: 'GET',
  status_code: 200
}, userId);
```

### Tracking Errors
```typescript
analytics.capture('error_occurred', {
  error_type: 'validation_error',
  error_category: 'form_submission',
  severity: 'medium',
  form_name: 'ticket_create'
}, userId);
```

## Dashboard Metrics

Key metrics derived from these events:
1. **User Engagement**: Daily/Weekly/Monthly active users
2. **Feature Adoption**: Percentage of users using each feature
3. **Performance**: P50/P90/P99 response times
4. **Error Rate**: Errors per user session
5. **Power Users**: Users with high feature adoption
6. **Retention**: Feature usage over time