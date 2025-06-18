# Notification System API Reference

This document provides a comprehensive reference for all notification system APIs, server actions, and endpoints.

## Server Actions

### Notification Management

#### `getNotifications()`
Retrieves notifications for the current user.

```typescript
import { getNotifications } from 'server/src/lib/actions/notification-actions/notificationActions';

const notifications = await getNotifications();
```

**Returns:** `InternalNotification[]`
- `internal_notification_id`: UUID
- `title`: string  
- `message`: string
- `data`: JSON object with template data
- `action_url`: string (optional)
- `is_read`: boolean
- `created_at`: timestamp
- `type_name`: string
- `category_name`: string
- `priority_name`: string

#### `markNotificationAsRead(notificationId: string)`
Marks a specific notification as read.

```typescript
import { markNotificationAsRead } from 'server/src/lib/actions/notification-actions/notificationActions';

await markNotificationAsRead('notification-uuid');
```

**Parameters:**
- `notificationId`: UUID of the notification

**Returns:** `void`

#### `markAllNotificationsAsRead()`
Marks all notifications as read for the current user.

```typescript
import { markAllNotificationsAsRead } from 'server/src/lib/actions/notification-actions/notificationActions';

await markAllNotificationsAsRead();
```

**Returns:** `void`

#### `getUnreadNotificationCount()`
Gets the count of unread notifications for the current user.

```typescript
import { getUnreadNotificationCount } from 'server/src/lib/actions/notification-actions/notificationActions';

const count = await getUnreadNotificationCount();
```

**Returns:** `number`

### Notification Preferences

#### `getUserInternalNotificationPreferences(userIds: string[], tenantId?: string)`
Retrieves notification preferences for specified users.

```typescript
import { getUserInternalNotificationPreferences } from 'server/src/lib/actions/notification-actions/internalNotificationSettingsActions';

const preferences = await getUserInternalNotificationPreferences(['user-id'], 'tenant-id');
```

**Parameters:**
- `userIds`: Array of user UUIDs
- `tenantId`: Tenant UUID (required for background operations)

**Returns:** `InternalNotificationPreference[]`

#### `setUserInternalNotificationPreference(userId: string, typeId: string, enabled: boolean, tenantId?: string)`
Sets a user's preference for a specific notification type.

```typescript
import { setUserInternalNotificationPreference } from 'server/src/lib/actions/notification-actions/internalNotificationSettingsActions';

await setUserInternalNotificationPreference('user-id', 'type-id', false, 'tenant-id');
```

**Parameters:**
- `userId`: User UUID
- `typeId`: Notification type UUID
- `enabled`: Boolean preference
- `tenantId`: Tenant UUID (required for background operations)

**Returns:** `void`

#### `getAllInternalNotificationTypes(tenantId?: string)`
Gets all available notification types.

```typescript
import { getAllInternalNotificationTypes } from 'server/src/lib/actions/notification-actions/internalNotificationSettingsActions';

const types = await getAllInternalNotificationTypes('tenant-id');
```

**Parameters:**
- `tenantId`: Tenant UUID (required for background operations)

**Returns:** `Array<{ internal_notification_type_id: string; type_name: string; category_name: string }>`

### Direct Messaging

#### `getConversations()`
Retrieves user's direct message conversations.

```typescript
import { getConversations } from 'server/src/lib/actions/notification-actions/directMessagingActions';

const conversations = await getConversations();
```

**Returns:** `Conversation[]`

#### `createConversation(participants: string[])`
Creates a new conversation with specified participants.

```typescript
import { createConversation } from 'server/src/lib/actions/notification-actions/directMessagingActions';

const conversation = await createConversation(['user-id-1', 'user-id-2']);
```

**Parameters:**
- `participants`: Array of user UUIDs

**Returns:** `Conversation`

#### `getConversationMessages(conversationId: string)`
Gets messages for a specific conversation.

```typescript
import { getConversationMessages } from 'server/src/lib/actions/notification-actions/directMessagingActions';

const messages = await getConversationMessages('conversation-id');
```

**Parameters:**
- `conversationId`: Conversation UUID

**Returns:** `Message[]`

## REST API Endpoints

### SSE Stream

#### `GET /api/notifications/stream`
Establishes Server-Sent Events connection for real-time notifications.

**Headers:**
- `Authorization`: Required (session-based)

**Response:** `text/event-stream`

**Events:**
- `notification`: New notification received
- `notification-read`: Notification marked as read
- `connection`: Connection status updates

**Example:**
```javascript
const eventSource = new EventSource('/api/notifications/stream');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.event === 'notification') {
    // Handle new notification
    console.log('New notification:', data.data);
  }
};
```

### WebSocket (Hocuspocus)

#### Direct Messaging WebSocket
Real-time messaging via Hocuspocus provider.

**URL:** `ws://localhost:1234` (configurable via `HOCUSPOCUS_PORT`)

**Document Names:**
- `messages:{conversationId}` - Conversation messages
- `presence:{conversationId}` - User presence in conversation

**Example:**
```typescript
import { HocuspocusProvider } from '@hocuspocus/provider';

const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: `messages:${conversationId}`,
});

const yDoc = provider.document;
const yMessages = yDoc.getArray('messages');

// Add message
yMessages.push([{
  id: crypto.randomUUID(),
  content: 'Hello world',
  sender_id: currentUserId,
  timestamp: new Date().toISOString()
}]);
```

## Debug API Endpoints

### System Debugging

#### `POST /api/notifications/debug/system`
Comprehensive system debug check.

**Returns:** Debug information including:
- Notification types count
- Templates count  
- Recent notifications
- EventBus status
- Redis connection status

#### `POST /api/notifications/debug/test-notification`
Creates a test notification for the current user.

**Returns:** Created notification object

#### `POST /api/notifications/debug/preferences`
Returns current user's notification preferences.

**Returns:** User preference settings

## EventBus Integration

### Publishing Events

```typescript
import { getEventBus } from 'server/src/lib/eventBus';

const eventBus = getEventBus();
await eventBus.publish({
  eventType: 'TICKET_ASSIGNED',
  payload: {
    ticketId: 'ticket-uuid',
    assignedTo: 'user-uuid',
    tenantId: 'tenant-uuid'
  }
});
```

### Subscribing to Events

```typescript
import { getEventBus } from 'server/src/lib/eventBus';

const eventBus = getEventBus();
await eventBus.subscribe('TICKET_ASSIGNED', async (event) => {
  console.log('Ticket assigned:', event.payload);
});
```

## Notification Publisher API

### Creating Notifications

```typescript
import { NotificationPublisher } from 'server/src/lib/notifications/publisher';

const publisher = new NotificationPublisher();

const notification = await publisher.publishNotification({
  user_id: 'user-uuid',
  type_id: 'notification-type-uuid',
  title: 'Custom Title', // Optional - uses template if not provided
  message: 'Custom Message', // Optional - uses template if not provided
  data: {
    ticket_number: 'FLOW-123',
    ticket_title: 'Server Issue'
  },
  action_url: '/msp/tickets/ticket-uuid',
  priority_id: 'priority-uuid', // Optional
  expires_at: new Date('2024-12-31') // Optional
}, 'tenant-uuid');
```

### Broadcasting Read Status

```typescript
await publisher.publishNotificationRead('user-id', 'notification-id', 'tenant-id');
```

## Data Types

### InternalNotification

```typescript
interface InternalNotification {
  internal_notification_id: string;
  tenant: string;
  user_id: string;
  type_id: string;
  title: string;
  message?: string;
  data?: Record<string, any>;
  action_url?: string;
  priority_id?: string;
  is_read: boolean;
  read_at?: Date;
  created_at: Date;
  expires_at?: Date;
}
```

### CreateNotificationData

```typescript
interface CreateNotificationData {
  user_id: string;
  type_id: string;
  title?: string;
  message?: string;
  data?: Record<string, any>;
  action_url?: string;
  priority_id?: string;
  expires_at?: Date;
}
```

### NotificationSseEvent

```typescript
interface NotificationSseEvent {
  internal_notification_id: string;
  tenant: string;
  user_id: string;
  title: string;
  message?: string;
  data?: any;
  action_url?: string;
  created_at: string;
  type_name: string;
  category_name: string;
  priority_name?: string;
  priority_color?: string;
}
```

### InternalNotificationPreference

```typescript
interface InternalNotificationPreference {
  user_id: string;
  internal_notification_type_id: string;
  channel: 'in_app';
  enabled: boolean;
}
```

### Event Types

```typescript
type EventType = 
  | 'TICKET_CREATED'
  | 'TICKET_ASSIGNED' 
  | 'TICKET_UPDATED'
  | 'TICKET_CLOSED'
  | 'TICKET_COMMENT_ADDED'
  | 'PROJECT_CREATED'
  | 'PROJECT_ASSIGNED'
  | 'PROJECT_TASK_ASSIGNED'
  | 'PROJECT_CLOSED'
  | 'INVOICE_GENERATED'
  | 'INVOICE_FINALIZED'
  | 'TIME_ENTRY_SUBMITTED'
  | 'TIME_ENTRY_APPROVED';
```

## Error Handling

### Common Error Responses

```typescript
// Unauthorized access
{
  error: "Unauthorized",
  status: 401
}

// Missing tenant
{
  error: "Tenant ID is required for background operations",
  status: 400
}

// Notification not found
{
  error: "Notification not found",
  status: 404
}

// Template not found
{
  error: "Notification template for type {type} not found",
  status: 400
}
```

### Error Handling Example

```typescript
try {
  const notifications = await getNotifications();
} catch (error) {
  if (error.message === 'Unauthorized') {
    // Redirect to login
  } else {
    // Handle other errors
    console.error('Failed to load notifications:', error);
  }
}
```

## Rate Limiting

### SSE Connections
- Maximum 1 connection per user per session
- Automatic reconnection on disconnect
- 5-minute timeout for idle connections

### Notification Creation
- No explicit rate limiting (handled by business logic)
- Bulk operations process in batches of 10

### WebSocket Connections
- Maximum 5 concurrent connections per user
- Automatic cleanup of stale connections

## Authentication & Authorization

### Session-Based Authentication
All API endpoints require valid Next.js session:

```typescript
import { getServerSession } from 'next-auth';
import { options } from 'server/src/app/api/auth/[...nextauth]/options';

const session = await getServerSession(options);
if (!session?.user) {
  throw new Error('Unauthorized');
}
```

### Permission-Based Access
Notifications respect user permissions:

- Users only see their own notifications
- Admin users can access debug endpoints
- Direct messaging requires both participants to have access

### Tenant Isolation
All operations are tenant-isolated:

- Database connections use tenant-specific schemas
- Redis channels include tenant prefix
- WebSocket documents are tenant-scoped