# Scheduler Host API Guide

This guide explains how to use the `cap:scheduler.manage` capability to programmatically create, update, and delete scheduled tasks for your extension.

## Overview

The Scheduler Host API allows extensions to manage their own scheduled tasks at runtime. This is useful for:

- **Self-configuration on install**: Set up default schedules when your extension is first installed
- **Dynamic scheduling**: Create or modify schedules based on user configuration
- **Cleanup on uninstall**: Remove schedules when no longer needed

## Prerequisites

Your extension must declare the `cap:scheduler.manage` capability in its manifest:

```json
{
  "capabilities": ["cap:scheduler.manage", "cap:log.emit"]
}
```

## API Reference

### SchedulerHost Interface

```typescript
interface SchedulerHost {
  list(): Promise<ScheduleInfo[]>;
  get(scheduleId: string): Promise<ScheduleInfo | null>;
  create(input: CreateScheduleInput): Promise<CreateScheduleResult>;
  update(scheduleId: string, input: UpdateScheduleInput): Promise<UpdateScheduleResult>;
  delete(scheduleId: string): Promise<DeleteScheduleResult>;
  getEndpoints(): Promise<EndpointInfo[]>;
}
```

### Types

```typescript
interface ScheduleInfo {
  id: string;
  endpointPath: string;
  endpointMethod: string;
  name?: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  payload?: string;  // JSON-encoded
  lastRunAt?: string;
  lastRunStatus?: string;
  lastError?: string;
  createdAt?: string;
}

interface EndpointInfo {
  id: string;
  method: string;
  path: string;
  handler: string;
  schedulable: boolean;
}

interface CreateScheduleInput {
  endpoint: string;       // "METHOD /path" e.g., "POST /api/sync"
  cron: string;           // Standard 5-field cron expression
  timezone?: string;      // IANA timezone (default: "UTC")
  enabled?: boolean;      // Whether to activate immediately (default: true)
  name?: string;          // Human-readable name (max 128 chars)
  payload?: string;       // JSON-encoded payload for scheduled requests
}

interface CreateScheduleResult {
  success: boolean;
  scheduleId?: string;
  error?: string;
  fieldErrors?: string;   // JSON-encoded map of field -> error
}

interface UpdateScheduleInput {
  endpoint?: string;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  name?: string;
  payload?: string;       // JSON-encoded, use empty string to clear
}

interface UpdateScheduleResult {
  success: boolean;
  error?: string;
  fieldErrors?: string;
}

interface DeleteScheduleResult {
  success: boolean;
  error?: string;
}
```

## Usage Examples

### Listing Schedules

```typescript
const schedules = await host.scheduler.list();
console.log(`Found ${schedules.length} schedules`);

for (const schedule of schedules) {
  console.log(`${schedule.name}: ${schedule.cron} (${schedule.enabled ? 'enabled' : 'disabled'})`);
}
```

### Creating a Schedule

```typescript
const result = await host.scheduler.create({
  endpoint: 'POST /api/sync',
  cron: '0 */6 * * *',  // Every 6 hours
  timezone: 'America/New_York',
  enabled: true,
  name: 'Data Sync',
  payload: JSON.stringify({ fullSync: false }),
});

if (result.success) {
  console.log(`Created schedule: ${result.scheduleId}`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

### Discovering Schedulable Endpoints

```typescript
const endpoints = await host.scheduler.getEndpoints();
const schedulable = endpoints.filter(e => e.schedulable);

console.log('Schedulable endpoints:');
for (const ep of schedulable) {
  console.log(`  ${ep.method} ${ep.path}`);
}
```

### Self-Configuration Pattern

A common pattern is to set up schedules when the extension is first used:

```typescript
async function setupSchedules(host: HostBindings): Promise<void> {
  // Check for existing schedules
  const existing = await host.scheduler.list();

  // Skip if already configured
  if (existing.some(s => s.name === 'Daily Sync')) {
    return;
  }

  // Create default schedule
  const result = await host.scheduler.create({
    endpoint: 'POST /api/sync',
    cron: '0 9 * * *',  // Every day at 9 AM
    timezone: 'UTC',
    enabled: true,
    name: 'Daily Sync',
  });

  if (!result.success) {
    await host.logging.error(`Failed to create schedule: ${result.error}`);
  }
}
```

## Constraints and Limits

| Constraint | Value |
|------------|-------|
| Max schedules per extension install | 50 |
| Minimum schedule interval | 5 minutes |
| Max schedule name length | 128 characters |
| Max cron expression length | 128 characters |
| Max payload size | 100 KB |
| Allowed endpoint methods | GET, POST |

## Cron Expression Format

Use standard 5-field cron expressions:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

Examples:
- `0 * * * *` - Every hour
- `*/15 * * * *` - Every 15 minutes
- `0 9 * * *` - Every day at 9 AM
- `0 0 1 * *` - First day of every month at midnight
- `0 9 * * 1` - Every Monday at 9 AM

**Note**: You cannot set both day-of-month and day-of-week in the same expression.

## Error Handling

Always check the `success` field in results:

```typescript
const result = await host.scheduler.create(input);

if (!result.success) {
  // Check for field-specific errors
  if (result.fieldErrors) {
    const errors = JSON.parse(result.fieldErrors);
    for (const [field, message] of Object.entries(errors)) {
      console.error(`${field}: ${message}`);
    }
  } else {
    console.error(result.error);
  }
}
```

Common errors:
- `Endpoint not found or not schedulable` - The endpoint doesn't exist or has path parameters
- `Cron too frequent` - Schedule interval is less than 5 minutes
- `Too many schedules` - Extension has reached the 50 schedule limit
- `Schedule name already in use` - Another schedule has the same name

## Security Notes

- Extensions can only manage their own schedules
- Schedules are scoped to the extension installation (tenant + extension)
- The `runNow` functionality is admin-only and not exposed to extensions
- All operations are logged for audit purposes

## See Also

- [Sample Scheduler Demo Extension](../../samples/component/scheduler-demo/)
- [Extension Manifest Reference](../references/manifest.md)
