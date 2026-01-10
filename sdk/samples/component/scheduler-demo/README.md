# Scheduler Demo Extension

This sample extension demonstrates how to use the `cap:scheduler.manage` capability to programmatically create, update, and delete scheduled tasks for your extension.

## Features

- **Self-Configuration**: The extension sets up its own scheduled tasks when `/api/setup` is called
- **Schedule Management**: List, create, and delete schedules through the UI
- **Schedulable Endpoints**: Demonstrates endpoints marked as `schedulable: true` in the manifest

## Capabilities Used

- `cap:scheduler.manage` - Manage extension schedules
- `cap:log.emit` - Write logs
- `cap:context.read` - Read execution context

## Endpoints

| Method | Path | Schedulable | Description |
|--------|------|-------------|-------------|
| GET | `/api/status` | Yes | Health check endpoint |
| POST | `/api/setup` | No | Auto-configure schedules |
| GET | `/api/schedules` | No | List all schedules |
| DELETE | `/api/schedules/:id` | No | Delete a schedule |
| POST | `/api/heartbeat` | Yes | Scheduled heartbeat |

## How It Works

### Self-Configuration Pattern

When the extension's `/api/setup` endpoint is called, it:

1. Discovers available schedulable endpoints via `host.scheduler.getEndpoints()`
2. Checks for existing schedules to avoid duplicates
3. Creates new schedules for the heartbeat and status endpoints
4. Returns a summary of what was configured

```typescript
// Example: Creating a schedule from within the extension
const result = await host.scheduler.create({
  endpoint: 'POST /api/heartbeat',
  cron: '*/5 * * * *', // Every 5 minutes
  timezone: 'UTC',
  enabled: true,
  name: 'Heartbeat Check',
  payload: JSON.stringify({ source: 'auto-setup' }),
});
```

### Manifest Configuration

Endpoints must be marked as `schedulable: true` in the manifest to be eligible for scheduling:

```json
{
  "api": {
    "endpoints": [
      { "method": "POST", "path": "/api/heartbeat", "handler": "dist/main", "schedulable": true }
    ]
  }
}
```

## Building

```bash
npm install
npm run build
npm run pack  # Creates a deployable bundle
```

## Testing

```bash
npm test
```

## Usage in Production

1. Install the extension with the `cap:scheduler.manage` capability enabled
2. Navigate to the extension's UI via the app menu
3. Click "Setup Schedules" to auto-configure the scheduled tasks
4. Use "Refresh List" to view current schedules
5. Delete schedules as needed through the UI

## Notes

- Extensions can only manage their own schedules
- Schedules are scoped to the extension installation (tenant + extension)
- The `runNow` functionality remains admin-only and is not exposed to extensions
