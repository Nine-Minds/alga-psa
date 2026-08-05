# Internal Notifications Test Suite

Comprehensive test suite for the internal notifications system in AlgaPSA.

## Overview

This test suite covers all aspects of the internal notifications system, including:

- Template rendering
- Mention parsing and user lookup
- CRUD operations (Create, Read, Update, Delete)
- User preferences
- Mention notifications in comments
- Event bus subscribers
- Real-time delivery via WebSocket

## Test Structure

```
server/src/test/
├── unit/
│   └── internal-notifications/
│       ├── templateRendering.test.ts          # Template variable substitution
│       ├── mentionParser.test.ts              # @mention parsing logic
│       └── userLookup.test.ts                 # User lookup by username/display name
├── integration/
│   └── internal-notifications/
│       ├── notificationCrud.integration.test.ts         # CRUD operations
│       ├── notificationPreferences.integration.test.ts  # User preferences
│       ├── mentionNotifications.integration.test.ts     # Mention flow
│       └── eventSubscribers.integration.test.ts         # Event bus integration
└── e2e/
    └── internal-notifications/
        └── (Playwright tests for UI interactions)
```

## Test Categories

### Unit Tests

**Template Rendering** (`templateRendering.test.ts`)
- ✅ Single variable replacement
- ✅ Multiple variables
- ✅ Missing variables (preserved)
- ✅ Edge cases (empty strings, numbers, booleans, special characters)
- ✅ Repeated variables
- ✅ Malformed placeholders

**Mention Parser** (`mentionParser.test.ts`)
- ✅ Extract @username mentions
- ✅ Extract @[Display Name] mentions
- ✅ Multiple mentions
- ✅ Deduplication (case-insensitive)
- ✅ Ignore @ in emails
- ✅ Handle punctuation, start/end of text
- ✅ Edge cases (empty, null, malformed, unicode)

**User Lookup** (`userLookup.test.ts`)
- ✅ Find by exact username (case-insensitive)
- ✅ Find by display name (case-insensitive)
- ✅ Multiple users
- ✅ Filter inactive users
- ✅ Tenant isolation
- ✅ Handle not found gracefully

### Integration Tests

**Notification CRUD** (`notificationCrud.integration.test.ts`)
- 📝 Create notifications from templates
- 📝 Render with user locale (fallback to English)
- 📝 Respect user preferences (don't create if disabled)
- 📝 Get notifications (pagination, filtering by read status and category)
- 📝 Get unread counts (total and by category)
- 📝 Mark as read (single and bulk)
- 📝 Soft delete notifications
- 📝 Multi-tenant isolation

**Notification Preferences** (`notificationPreferences.integration.test.ts`)
- 📝 Get user preferences
- 📝 Update category-level preferences
- 📝 Update subtype-level preferences
- 📝 Preference hierarchy (subtype > category > default)
- 📝 System-wide enable/disable
- 📝 Get categories and subtypes
- 📝 Filter by client portal availability

**Mention Notifications** (`mentionNotifications.integration.test.ts`)
- 📝 Parse mentions from ticket/project comments
- 📝 Look up mentioned users
- 📝 Create notifications for mentioned users
- 📝 Include comment preview, author, context
- 📝 Generate correct links (#anchor)
- 📝 Don't notify comment author
- 📝 Handle @username and @[Display Name]
- 📝 Respect user preferences
- 📝 Handle internal comments correctly
- 📝 Support comment updates (new mentions)

**Event Subscribers** (`eventSubscribers.integration.test.ts`)
- 📝 Subscribe to ticket events (created, assigned, updated, closed, comment added)
- 📝 Subscribe to project events (created, assigned, task assigned)
- 📝 Subscribe to invoice and message events
- 📝 Validate event payloads
- 📝 Create appropriate notifications
- 📝 Handle errors gracefully
- 📝 Process events asynchronously
- 📝 High volume handling

## Running Tests

### Run All Tests
```bash
npm run test:unit              # Unit tests only
npm run test:integration        # Integration tests only
npm run test:local              # All tests
```

### Run Specific Test File
```bash
npm run test:unit -- templateRendering.test.ts
npm run test:integration -- notificationCrud.integration.test.ts
```

### Watch Mode (for development)
```bash
npm run test:unit -- --watch
```

### Run Tests with Coverage
```bash
npm run test:unit -- --coverage
```

## Test Data Setup

### Database Requirements

Integration tests require:
1. **Test database connection** with proper migrations
2. **Test tenant** with seeded data
3. **Test users** (internal and client types)
4. **Notification templates** in multiple languages
5. **Categories and subtypes** properly configured

### Mock Data Structure

```typescript
// Test Users
const testUsers = {
  john: { user_id: 'user-1', username: 'john', first_name: 'John', last_name: 'Doe' },
  sarah: { user_id: 'user-2', username: 'sarah', first_name: 'Sarah', last_name: 'Smith' },
  mike: { user_id: 'user-3', username: 'mike', first_name: 'Mike', last_name: 'Johnson' }
};

// Test Templates
const testTemplates = {
  'ticket-assigned': {
    en: { title: 'Ticket {{ticketId}} assigned', message: '...' },
    es: { title: 'Ticket {{ticketId}} asignado', message: '...' }
  },
  'user-mentioned-in-comment': {
    en: { title: '{{authorName}} mentioned you', message: '...' }
  }
};
```

## Implementation Checklist

### Core Functionality

- [ ] **Template rendering** - Already implemented in `internalNotificationActions.ts:121`
- [ ] **Mention parser utility** - Need to create `server/src/lib/utils/mentionParser.ts`
- [ ] **User lookup utility** - Need to create `server/src/lib/utils/userLookup.ts`
- [ ] **Mention notification handler** - Add to comment event subscriber
- [ ] **Comment event publishing** - Update comment actions to publish events

### Utilities to Create

1. **Mention Parser** (`server/src/lib/utils/mentionParser.ts`)
```typescript
export function parseMentions(text: string): string[] {
  // Extract @username and @[Display Name] mentions
  // Return deduplicated array of mentions
}
```

2. **User Lookup** (`server/src/lib/utils/userLookup.ts`)
```typescript
export async function lookupUsersByMentions(
  trx: Knex.Transaction,
  tenant: string,
  mentions: string[]
): Promise<User[]> {
  // Look up users by username or display name
  // Filter inactive users
  // Respect tenant isolation
}
```

3. **Mention Notification Handler**
   - Add to `internalNotificationSubscriber.ts`
   - Parse mentions from comment text
   - Look up mentioned users
   - Create notifications with proper metadata

## Test Implementation Status

### Completed ✅
- Template rendering unit tests
- Mention parser unit tests
- User lookup unit tests

### To Implement 📝
All integration tests are written with `.todo()` markers and need:
1. **Database setup** - Real database connection for integration tests
2. **Test data seeding** - Users, templates, categories, subtypes
3. **Mock cleanup** - Replace mocks with real implementations
4. **Test helpers** - Reusable functions for creating test data

## Key Testing Patterns

### Database Testing Pattern
```typescript
let db: Knex;
let testTenantId: string;

beforeAll(async () => {
  db = await createTestDbConnection();
  await runMigrations(db);
  testTenantId = await createTestTenant(db);
});

afterAll(async () => {
  await cleanupTestData(db, testTenantId);
  await db.destroy();
});
```

### Action Testing Pattern
```typescript
it('should create notification', async () => {
  const notification = await createNotificationFromTemplateAction({
    tenant: testTenantId,
    user_id: testUserId,
    template_name: 'ticket-assigned',
    data: { ticketId: 'T-123', ticketTitle: 'Test' }
  });

  expect(notification).toBeDefined();
  expect(notification.user_id).toBe(testUserId);
});
```

### Event Testing Pattern
```typescript
it('should create notification on event', async () => {
  // Publish event
  await publishEvent({
    eventType: 'TICKET_CREATED',
    payload: { tenantId, ticketId, userId }
  });

  // Wait for async processing
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify notification created
  const notifications = await getNotificationsAction({
    tenant: tenantId,
    user_id: userId
  });

  expect(notifications.notifications.length).toBeGreaterThan(0);
});
```

## Code Coverage Goals

Target coverage:
- **Unit tests**: 95%+ for utilities (parser, lookup, rendering)
- **Integration tests**: 85%+ for actions and event handlers
- **E2E tests**: Critical user journeys

## Common Issues and Solutions

### Issue: Tests failing due to missing templates
**Solution**: Ensure test database has templates seeded
```sql
INSERT INTO internal_notification_templates (name, language_code, title, message, subtype_id)
VALUES ('ticket-assigned', 'en', 'Ticket {{ticketId}} assigned', '...', 1);
```

### Issue: Multi-tenant isolation not working
**Solution**: Always include `tenant` in WHERE clauses and JOIN conditions
```typescript
.where('users.tenant', tenant)
.andWhere('users.is_active', true)
```

### Issue: Async event processing not completing
**Solution**: Add proper waiting in tests
```typescript
await new Promise(resolve => setTimeout(resolve, 100));
```

## Next Steps

1. ✅ Create test files with `.todo()` markers
2. 📝 Implement mention parser utility
3. 📝 Implement user lookup utility
4. 📝 Add mention notification handler to comment subscriber
5. 📝 Update comment actions to publish events
6. 📝 Set up integration test database
7. 📝 Implement integration tests (remove `.todo()`)
8. 📝 Add E2E tests with Playwright
9. 📝 Add test to CI/CD pipeline

## References

- Implementation Plan: `.ai/inappnotifications/inappnotifications.md`
- Actions: `server/src/lib/actions/internal-notification-actions/`
- Models: `server/src/lib/models/internalNotification.ts`
- Event Subscriber: `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts`
- Real-time Broadcaster: `server/src/lib/realtime/internalNotificationBroadcaster.ts`
