# Notification System Troubleshooting

This guide helps diagnose and resolve common issues with the notification system.

## Quick Diagnostics

### Debug Interface

Visit `/msp/debug/notifications` for interactive debugging tools:

- **🔍 Debug Notification System** - Comprehensive system check
- **✨ Create Test Notification** - Test notification creation
- **⚙️ Check User Preferences** - View user notification settings
- **🎯 Test Real Assignment** - Test real ticket assignment flow
- **🔧 Test Handler Directly** - Test notification handler logic
- **🚀 Force Register & Test** - Force EventBus registration

### System Health Check

```bash
# Check Redis connection
redis-cli ping

# Check database connection
npm run migrate -- --dry-run

# Check EventBus status
curl http://localhost:3000/api/notifications/debug/eventbus
```

## Common Issues

### 1. Notifications Not Appearing

#### Symptoms
- Events are triggered but no notifications appear in the UI
- Notification bell shows no unread count

#### Diagnosis Steps

1. **Check if events are being published:**
   ```bash
   # Check server logs for event publishing
   grep "Event published" logs/server.log
   ```

2. **Verify notification subscriber is registered:**
   - Use "🚀 Force Register & Test" button in debug interface
   - Check logs for "Registered notification subscriber for" messages

3. **Test the complete flow:**
   - Use "🎯 Test Real Assignment" button
   - Check if notification appears in bell icon

#### Common Causes & Solutions

**EventBus not initialized:**
```typescript
// Check if EventBus is properly initialized
const eventBus = getEventBus();
await eventBus.initialize();
```

**Redis connection issues:**
- Verify `REDIS_URL` environment variable
- Check Redis server is running: `redis-cli ping`
- Look for Redis connection errors in logs

**Database connection issues:**
- Verify tenant connection is working
- Check for "tenant not found" errors
- Ensure proper database migration status

### 2. Too Many Notifications

#### Symptoms
- Multiple notifications for single events
- Notifications going to wrong users

#### Diagnosis
- Check logs for "Created X notifications for event" messages
- Review user permission assignments
- Check event configuration in `notificationSubscriber.ts`

#### Solutions

**Reduce TICKET_CREATED recipients:**
```typescript
'TICKET_CREATED': {
  permission: 'nonexistent:permission', // Disable broad notifications
  getAdditionalUsers: async () => [], // No additional users
}
```

**Limit to specific roles:**
```typescript
getAdditionalUsers: async (event, tenantKnex) => {
  // Only notify managers
  const managers = await getUsersWithPermission('manager', 'read', tenantKnex);
  return managers;
}
```

### 3. Real-Time Updates Not Working

#### Symptoms
- Notifications appear after page refresh
- SSE connection not working

#### Diagnosis
1. **Check SSE endpoint:**
   ```bash
   curl -N http://localhost:3000/api/notifications/stream
   ```

2. **Browser DevTools:**
   - Open Network tab
   - Look for EventSource connection to `/api/notifications/stream`
   - Check for connection errors

3. **Redis pub/sub:**
   ```bash
   redis-cli
   > SUBSCRIBE notifications:user:YOUR_USER_ID
   ```

#### Solutions

**SSE Connection Issues:**
- Check browser CORS settings
- Verify session authentication
- Look for connection timeout errors

**Redis Pub/Sub Issues:**
- Verify Redis is running and accessible
- Check Redis password configuration
- Monitor Redis logs for connection errors

### 4. Database Errors

#### Symptoms
- "tenant not found" errors
- Database connection failures
- Transaction rollback errors

#### Common Database Issues

**Wrong connection pattern:**
```typescript
// ❌ Old deprecated pattern
const { knex, tenant } = await createTenantKnex();

// ✅ Correct pattern
const tenantKnex = await getConnection(tenantId);
```

**Missing tenant ID:**
```typescript
// Ensure tenantId is extracted from event payload
const tenantId = (event.payload as any)?.tenantId;
if (!tenantId) {
  logger.error('No tenant information in event');
  return;
}
```

**Database schema issues:**
```sql
-- Check if tables exist
\dt internal_notification*

-- Verify foreign key relationships
SELECT * FROM internal_notification_types;
SELECT * FROM internal_notification_templates;
```

### 5. Permission Issues

#### Symptoms
- Users not receiving expected notifications
- Permission-based filtering not working

#### Diagnosis

```typescript
// Test user permissions
const permissions = await getUsersWithPermission('ticket', 'read', tenantKnex);
console.log('Users with ticket:read permission:', permissions);
```

#### Solutions

**Check permission format:**
- Use `resource:action` format (e.g., `ticket:read`)
- Verify permissions exist in database
- Check user role assignments

**Debug permission logic:**
```typescript
logger.info('Permission check:', {
  resource,
  action,
  usersFound: usersWithPermission.length,
  userIds: usersWithPermission
});
```

### 6. Template Rendering Issues

#### Symptoms
- Empty notification titles/messages
- Template variables not replaced

#### Diagnosis

```typescript
// Check template data
logger.info('Template data:', templateData);

// Verify template exists
const template = await knex('internal_notification_templates')
  .where('type_id', notificationType.internal_notification_type_id)
  .first();
console.log('Template found:', template);
```

#### Solutions

**Missing templates:**
```sql
-- Create missing template
INSERT INTO internal_notification_templates (type_id, title_template, message_template)
VALUES (
  (SELECT internal_notification_type_id FROM internal_notification_types WHERE type_name = 'YOUR_TYPE'),
  'Default Title: {{title}}',
  'Default Message: {{message}}'
);
```

**Template variable mismatches:**
- Ensure template variables match data keys
- Check for typos in variable names
- Verify data is being passed correctly

## Performance Issues

### 1. Slow Notification Creation

#### Symptoms
- Long delays in notification appearance
- High database load

#### Solutions

**Database optimization:**
```sql
-- Add indexes for frequent queries
CREATE INDEX idx_notifications_user_unread ON internal_notifications (user_id, is_read);
CREATE INDEX idx_notifications_recent ON internal_notifications (created_at DESC);
```

**Batch processing:**
```typescript
// Process multiple users in batches
const batchSize = 10;
for (let i = 0; i < userIds.length; i += batchSize) {
  const batch = userIds.slice(i, i + batchSize);
  await Promise.all(batch.map(userId => 
    publisher.publishNotification({...}, tenantId)
  ));
}
```

### 2. Redis Memory Issues

#### Symptoms
- Redis out of memory errors
- Slow pub/sub performance

#### Solutions

```bash
# Configure Redis memory management
redis-cli CONFIG SET maxmemory 1gb
redis-cli CONFIG SET maxmemory-policy allkeys-lru

# Monitor Redis memory usage
redis-cli INFO memory
```

## Debugging Workflows

### Complete Notification Flow Debug

1. **Event Publishing:**
   ```typescript
   // Add logging to event publisher
   console.log('Publishing event:', eventType, payload);
   ```

2. **Subscriber Processing:**
   ```typescript
   // Check subscriber receives event
   console.log('🔔 Event received in subscriber:', event);
   ```

3. **User Determination:**
   ```typescript
   // Log users being notified
   console.log('Users to notify:', userIds);
   ```

4. **Database Storage:**
   ```typescript
   // Confirm notification saved
   console.log('Notification saved:', savedNotification);
   ```

5. **Redis Broadcasting:**
   ```typescript
   // Verify Redis pub/sub
   console.log('Broadcasting to channels:', channels);
   ```

6. **Client Reception:**
   ```javascript
   // Browser console
   eventSource.onmessage = (event) => {
     console.log('SSE received:', event.data);
   };
   ```

### Permission Debug Workflow

```typescript
// Complete permission debugging
async function debugPermissions(userId: string, tenantId: string) {
  const tenantKnex = await getConnection(tenantId);
  
  // 1. Check user exists
  const user = await tenantKnex('users').where('user_id', userId).first();
  console.log('User found:', !!user);
  
  // 2. Check user roles
  const roles = await tenantKnex('user_roles').where('user_id', userId);
  console.log('User roles:', roles);
  
  // 3. Check role permissions
  for (const role of roles) {
    const permissions = await tenantKnex('role_permissions')
      .where('role_id', role.role_id);
    console.log(`Role ${role.role_id} permissions:`, permissions);
  }
  
  // 4. Test specific permission
  const hasPermission = await getUsersWithPermission('ticket', 'read', tenantKnex);
  console.log('Users with ticket:read:', hasPermission);
}
```

## Error Codes and Messages

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Tenant not found` | Wrong database connection pattern | Use `getConnection(tenantId)` |
| `Cannot access 'client' before initialization` | EventBus not initialized | Call `await eventBus.initialize()` |
| `headers was called outside a request scope` | Using Next.js headers in background | Get tenant from event payload |
| `Redis not connected` | Redis connection failed | Check Redis server and credentials |
| `Notification template not found` | Missing template in database | Create template record |
| `Permission denied` | User lacks required permissions | Check user role assignments |

### Log Analysis

**Successful notification flow:**
```
[INFO] Event published: TICKET_ASSIGNED
[INFO] 🔔 Event received in subscriber: TICKET_ASSIGNED
[INFO] Users to notify for TICKET_ASSIGNED: 1 users
[INFO] Created 1 notifications for event TICKET_ASSIGNED
[INFO] SSE broadcast to channels: notifications:user:123
```

**Failed notification flow:**
```
[ERROR] No tenant information in event TICKET_ASSIGNED
[ERROR] Notification subscriber failed to process event
```

## Prevention Best Practices

### 1. Monitoring

Set up monitoring for:
- Notification creation rates
- Redis connection health
- Database performance metrics
- SSE connection counts

### 2. Testing

- Test notification flow after each deployment
- Verify permissions after role changes
- Test Redis failover scenarios
- Monitor notification delivery times

### 3. Maintenance

- Regular cleanup of old notifications
- Monitor Redis memory usage
- Keep database indexes optimized
- Update notification templates as needed

## Getting Help

If issues persist after following this guide:

1. Check the debug interface at `/msp/debug/notifications`
2. Review server logs for error patterns
3. Use the "🚀 Force Register & Test" function
4. Verify database schema and migrations
5. Test Redis connectivity independently

For complex issues, gather this information:
- Error logs with timestamps
- Debug interface output
- Database query results
- Redis connection status
- Event payload examples