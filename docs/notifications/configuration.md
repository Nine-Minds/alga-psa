# Notification System Configuration

This guide explains how to configure and customize the notification system behavior.

## Event Configuration

### Adding New Event Types

To add support for a new event type, update the configuration in `server/src/lib/eventBus/subscribers/notificationSubscriber.ts`:

```typescript
const eventNotificationConfigs: Partial<Record<EventType, NotificationEventConfig>> = {
  'NEW_EVENT_TYPE': {
    notificationType: 'NEW_NOTIFICATION_TYPE',
    permission: 'resource:action', // Who gets notified by default
    getAdditionalUsers: async (event, tenantKnex) => {
      // Custom logic to determine specific users
      return ['user-id-1', 'user-id-2'];
    },
    getTemplateData: async (event, tenantKnex) => {
      // Data for template rendering
      return {
        title: 'Dynamic Title',
        description: 'Event details'
      };
    },
    getActionUrl: async (event, tenantKnex) => {
      // URL for "View" button in notification
      return `/msp/some-page/${event.payload.id}`;
    },
    priority: 'normal' // low, normal, high, urgent
  }
};
```

### Modifying Existing Events

#### Change Who Gets Notified

```typescript
// Only notify specific users (disable permission-based notifications)
permission: 'nonexistent:permission',
getAdditionalUsers: async (event, tenantKnex) => {
  // Your custom logic here
  return ['specific-user-id'];
}

// Notify users with specific permission
permission: 'resource:action',
getAdditionalUsers: async (event, tenantKnex) => {
  // Additional users beyond permission-based ones
  return [];
}
```

#### Update Notification Content

```typescript
getTemplateData: async (event, tenantKnex) => {
  // Fetch related data
  const record = await tenantKnex('some_table')
    .where('id', event.payload.recordId)
    .first();
    
  return {
    record_name: record?.name || '',
    status: record?.status || '',
    created_by: record?.created_by || ''
  };
}
```

#### Change Priority Levels

```typescript
// Static priority
priority: 'high'

// Dynamic priority based on event data
// Note: This requires custom logic in the handler
```

## Database Configuration

### Notification Types

Add new notification types to the database:

```sql
INSERT INTO internal_notification_types (type_name, category_name, description)
VALUES ('NEW_NOTIFICATION_TYPE', 'Custom', 'Description of the notification');
```

### Notification Templates

Create templates for your notification types:

```sql
INSERT INTO internal_notification_templates (type_id, title_template, message_template)
VALUES (
  (SELECT internal_notification_type_id FROM internal_notification_types WHERE type_name = 'NEW_NOTIFICATION_TYPE'),
  'New {{record_name}} Created',
  'A new {{record_name}} has been created with status {{status}} by {{created_by}}'
);
```

### Priority Configuration

Ensure priorities exist in your system:

```sql
INSERT INTO standard_priorities (priority_name, item_type, color, sort_order)
VALUES 
  ('low', 'internal_notification', '#6b7280', 1),
  ('normal', 'internal_notification', '#3b82f6', 2),
  ('high', 'internal_notification', '#f59e0b', 3),
  ('urgent', 'internal_notification', '#ef4444', 4);
```

## Permission System Configuration

### Understanding Permission Format

Permissions use the format `resource:action`:

- `user:read` - Can read user information (typically managers)
- `ticket:read` - Can read tickets
- `project:read` - Can read projects  
- `billing:read` - Can read billing information
- `nonexistent:permission` - Disables permission-based notifications

### Custom Permission Logic

For complex permission scenarios, use the `getAdditionalUsers` function:

```typescript
getAdditionalUsers: async (event, tenantKnex) => {
  // Example: Notify all project team members
  if (event.eventType === 'PROJECT_UPDATED') {
    const teamMembers = await tenantKnex('project_team_members')
      .where('project_id', event.payload.projectId)
      .pluck('user_id');
    return teamMembers.map(id => String(id));
  }
  
  // Example: Notify user's manager
  if (event.eventType === 'TIME_ENTRY_SUBMITTED') {
    const user = await tenantKnex('users')
      .where('user_id', event.payload.userId)
      .first();
    return user?.manager_id ? [user.manager_id] : [];
  }
  
  return [];
}
```

## User Preferences

### Default Preferences

Users start with all notifications enabled. To change defaults:

```typescript
// In your user creation logic
const defaultPreferences = [
  { type_name: 'TICKET_CREATED', enabled: false }, // Disable by default
  { type_name: 'TICKET_ASSIGNED', enabled: true },  // Enable by default
];

for (const pref of defaultPreferences) {
  await setUserInternalNotificationPreference(
    userId, 
    typeId, 
    pref.enabled,
    tenantId
  );
}
```

### Bulk Preference Updates

```typescript
// Example: Disable all ticket notifications for a user
const ticketNotificationTypes = await tenantKnex('internal_notification_types')
  .where('category_name', 'ticket')
  .pluck('internal_notification_type_id');

for (const typeId of ticketNotificationTypes) {
  await setUserInternalNotificationPreference(userId, typeId, false, tenantId);
}
```

## Environment Configuration

### Required Environment Variables

```bash
# Redis configuration (required for real-time notifications)
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password

# SSE timeout (optional, default: 300000ms = 5 minutes)
NOTIFICATION_SSE_TIMEOUT=300000

# Hocuspocus WebSocket port (optional, default: 1234)
HOCUSPOCUS_PORT=1234
```

### Optional Features

```bash
# Enable debug logging
NOTIFICATION_DEBUG=true

# Disable real-time delivery (notifications still saved to database)
NOTIFICATION_DISABLE_REALTIME=true

# Custom notification retention period (days)
NOTIFICATION_RETENTION_DAYS=30
```

## Template System

### Template Syntax

Templates use `{{variable}}` syntax:

```typescript
// Template
title_template: "Ticket {{ticket_number}} assigned to you"
message_template: "{{ticket_title}} has been assigned to you by {{assigned_by}}"

// Data
{
  ticket_number: "FLOW-123",
  ticket_title: "Server down",
  assigned_by: "John Smith"
}

// Result
title: "Ticket FLOW-123 assigned to you"
message: "Server down has been assigned to you by John Smith"
```

### Advanced Template Logic

For complex template logic, modify the `compileTemplate` function in `publisher.ts`:

```typescript
function compileTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    // Add custom logic here
    if (key === 'formatted_date') {
      return new Date(data.date).toLocaleDateString();
    }
    if (key === 'priority_emoji') {
      return data.priority === 'high' ? '🔥' : '📋';
    }
    return data[key] || '';
  });
}
```

## Multi-Tenant Configuration

### Tenant-Specific Settings

Each tenant can have different notification configurations:

```typescript
// Check tenant-specific features
const tenantConfig = await tenantKnex('tenant_configurations')
  .where('tenant', tenantId)
  .where('config_key', 'notifications_enabled')
  .first();

if (!tenantConfig?.config_value) {
  // Skip notifications for this tenant
  return;
}
```

### Tenant Isolation

The system automatically handles tenant isolation through:

- Database connections: `getConnection(tenantId)`
- Row-level security policies
- Event payload validation

## Performance Tuning

### Database Indexing

Ensure these indexes exist for optimal performance:

```sql
CREATE INDEX idx_internal_notifications_user_unread 
ON internal_notifications (user_id, is_read, created_at);

CREATE INDEX idx_internal_notifications_tenant_recent 
ON internal_notifications (tenant, created_at DESC);

CREATE INDEX idx_notification_preferences_user_type 
ON internal_notification_preferences (user_id, internal_notification_type_id);
```

### Redis Configuration

For high-volume environments:

```bash
# Increase Redis memory
redis-server --maxmemory 1gb --maxmemory-policy allkeys-lru

# Connection pooling
REDIS_MAX_CONNECTIONS=50
REDIS_MIN_CONNECTIONS=5
```

### Notification Cleanup

Set up automatic cleanup of old notifications:

```sql
-- Delete notifications older than 30 days
DELETE FROM internal_notifications 
WHERE created_at < NOW() - INTERVAL '30 days';

-- Or mark as expired
UPDATE internal_notifications 
SET expires_at = NOW() 
WHERE created_at < NOW() - INTERVAL '30 days' 
AND expires_at IS NULL;
```

## Testing Configuration

### Debug Mode

Enable comprehensive logging:

```typescript
// In notificationSubscriber.ts
const DEBUG_MODE = process.env.NOTIFICATION_DEBUG === 'true';

if (DEBUG_MODE) {
  console.log('🔔 [DEBUG] Event received:', event);
  console.log('🔔 [DEBUG] Users to notify:', userIds);
  console.log('🔔 [DEBUG] Template data:', templateData);
}
```

### Test Environment

For testing, use the debug interface at `/msp/debug/notifications`:

- Test individual event types
- Verify user permissions
- Check template rendering
- Trace notification flow

## Common Configuration Patterns

### Pattern 1: Manager-Only Notifications

```typescript
'IMPORTANT_EVENT': {
  notificationType: 'IMPORTANT_EVENT',
  permission: 'user:read', // Managers only
  getAdditionalUsers: async () => [], // No additional users
  priority: 'high'
}
```

### Pattern 2: Assignee-Only Notifications

```typescript
'TASK_ASSIGNED': {
  notificationType: 'TASK_ASSIGNED',
  permission: 'nonexistent:permission', // Disable permission-based
  getAdditionalUsers: async (event, tenantKnex) => {
    return [event.payload.assignedTo]; // Only the assigned user
  },
  priority: 'normal'
}
```

### Pattern 3: Team + Manager Notifications

```typescript
'PROJECT_MILESTONE': {
  notificationType: 'PROJECT_MILESTONE',
  permission: 'project:read', // Base permission
  getAdditionalUsers: async (event, tenantKnex) => {
    // Add project team members
    const teamMembers = await tenantKnex('project_team_members')
      .where('project_id', event.payload.projectId)
      .pluck('user_id');
    return teamMembers.map(id => String(id));
  },
  priority: 'normal'
}
```

### Pattern 4: Escalation-Based Notifications

```typescript
'CRITICAL_ISSUE': {
  notificationType: 'CRITICAL_ISSUE',
  permission: 'ticket:read',
  getAdditionalUsers: async (event, tenantKnex) => {
    // Notify escalation team for critical issues
    if (event.payload.severity === 'critical') {
      return await getUsersWithPermission('escalation', 'read', tenantKnex);
    }
    return [];
  },
  priority: 'urgent'
}
```