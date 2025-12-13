# Job Scheduler System

## Overview

The job scheduler system provides a robust and scalable solution for managing background tasks and scheduled jobs. It supports two execution backends:

- **PG Boss** (Community Edition) - PostgreSQL-based job queue
- **Temporal** (Enterprise Edition) - Workflow orchestration with enhanced durability

Both backends write to the same database tables (`jobs` and `job_details`), providing a unified monitoring experience regardless of the underlying execution engine.

## Key Features

- Immediate job execution
- Scheduled jobs with specific run times
- Recurring jobs with cron-like syntax
- Job monitoring and metrics
- Automatic retries with backoff
- Job history tracking
- **Edition-based backend selection** (CE: PG Boss, EE: Temporal)
- **Unified job monitoring dashboard**

## Architecture

### Community Edition (PG Boss)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Application                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   JobRunnerFactory                           ││
│  │              Creates PgBossJobRunner                         ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   PgBossJobRunner                            ││
│  │  - Wraps JobScheduler (pg-boss)                             ││
│  │  - Writes to jobs/job_details tables                        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Enterprise Edition (Temporal)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Application                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   JobRunnerFactory                           ││
│  │             Creates TemporalJobRunner                        ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   TemporalJobRunner                          ││
│  │  - Schedules Temporal workflows                             ││
│  │  - Writes to jobs/job_details tables                        ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │               Temporal Worker (separate process)             ││
│  │  - Executes genericJobWorkflow                              ││
│  │  - Updates job status in database                           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JOB_RUNNER_TYPE` | `pgboss` | Backend: `pgboss` or `temporal` |
| `JOB_RUNNER_FALLBACK_TO_PGBOSS` | `true` | Fall back to PG Boss if Temporal unavailable |

#### Temporal-specific (EE only)

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMPORAL_ADDRESS` | `temporal-frontend...` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_JOB_TASK_QUEUE` | `alga-jobs` | Task queue for jobs |

## Usage

### Using the Job Runner Factory (Recommended)

```typescript
import { JobRunnerFactory } from 'server/src/lib/jobs';

// Get the singleton job runner instance
const runner = await JobRunnerFactory.getInstance();

// Schedule an immediate job
await runner.scheduleJob('generate-invoice', {
  tenantId: 'tenant-123',
  billingCycleId: 'cycle-456',
});

// Schedule a job for later
await runner.scheduleJobAt('send-reminder', {
  tenantId: 'tenant-123',
  userId: 'user-789',
}, new Date('2024-12-01T09:00:00Z'));

// Schedule a recurring job
await runner.scheduleRecurringJob('daily-cleanup', {
  tenantId: 'tenant-123',
}, '0 0 * * *'); // Daily at midnight
```

### Legacy API (PG Boss Direct)

The legacy `JobScheduler` API is still available for backward compatibility:

```typescript
import { JobScheduler } from 'server/src/lib/jobs';

const scheduler = await JobScheduler.getInstance();

// Immediate job
await scheduler.scheduleImmediateJob('process-order', { orderId: 123 });

// Scheduled job
const runAt = new Date(Date.now() + 3600 * 1000);
await scheduler.scheduleScheduledJob('send-reminder', runAt, { userId: 456 });

// Recurring job
await scheduler.scheduleRecurringJob('daily-report', '0 0 * * *', {});
```

## Registered Job Handlers

| Job Name | Description | Timeout |
|----------|-------------|---------|
| `generate-invoice` | Generate invoices for billing cycles | 5 min |
| `invoice_zip` | Create ZIP archives of invoices | 10 min |
| `invoice_email` | Send invoice emails | default |
| `expired-credits` | Mark expired credits | default |
| `expiring-credits-notification` | Send expiration notifications | default |
| `credit-reconciliation` | Reconcile credit balances | default |
| `asset_import` | Process asset import batches | 10 min |
| `reconcile-bucket-usage` | Reconcile usage records | default |
| `cleanup-temporary-workflow-forms` | Clean up temporary forms | default |
| `renew-microsoft-calendar-webhooks` | Renew MS calendar subscriptions | default |
| `verify-google-calendar-pubsub` | Verify Google calendar setup | default |
| `cleanup-ai-session-keys` | Clean up AI sessions (EE only) | default |
| `createClientContractLineCycles` | Create billing cycles | default |
| `createNextTimePeriods` | Create time periods | default |

## Adding a New Job Handler

### 1. Create the Handler

```typescript
// server/src/lib/jobs/handlers/myNewHandler.ts
import { BaseJobData } from '../interfaces';

export interface MyJobData extends BaseJobData {
  tenantId: string;
  customField: string;
}

export async function myNewHandler(data: MyJobData): Promise<void> {
  // Your job logic here
  console.log('Processing job for tenant:', data.tenantId);
}
```

### 2. Register the Handler

Add to `server/src/lib/jobs/registerAllHandlers.ts`:

```typescript
import { myNewHandler, MyJobData } from './handlers/myNewHandler';

// Inside registerAllJobHandlers():
JobHandlerRegistry.register<MyJobData & BaseJobData>(
  {
    name: 'my-new-job',
    handler: async (_jobId, data) => {
      await myNewHandler(data);
    },
    retry: { maxAttempts: 3 },
    timeoutMs: 300000, // 5 minutes
  },
  registerOpts
);
```

### 3. Schedule the Job

```typescript
const runner = await JobRunnerFactory.getInstance();
await runner.scheduleJob('my-new-job', {
  tenantId: 'tenant-123',
  customField: 'value',
});
```

## Monitoring and Metrics

### Dashboard

The job monitoring dashboard is available at `/msp/jobs` and displays:

- Real-time job metrics (active, queued, completed, failed)
- Job history with filtering
- Job details and error inspection
- Runner type indicator (PG Boss vs Temporal)

### Programmatic Access

```typescript
const runner = await JobRunnerFactory.getInstance();

// Get job status
const status = await runner.getJobStatus('job-id', 'tenant-id');
// { status: 'completed', progress: 100, metadata: {...} }

// Check health
const healthy = await runner.isHealthy();
```

### Database Queries

```sql
-- Get all jobs for a tenant
SELECT * FROM jobs WHERE tenant = 'tenant-id' ORDER BY created_at DESC;

-- Get job details/steps
SELECT * FROM job_details WHERE job_id = 'job-id' ORDER BY processed_at;

-- Find jobs by runner type
SELECT * FROM jobs WHERE runner_type = 'temporal';

-- Find job by Temporal workflow ID
SELECT * FROM jobs WHERE external_id = 'workflow-id';
```

## Error Handling

The system implements:

- Automatic retries (3 attempts by default)
- Exponential backoff between retries
- Error logging and monitoring
- Manual job cancellation
- Graceful degradation (Temporal → PG Boss fallback)

### Retry Configuration

```typescript
JobHandlerRegistry.register({
  name: 'my-job',
  handler: async (jobId, data) => { /* ... */ },
  retry: {
    maxAttempts: 5,
    backoffCoefficient: 2.0,
    initialIntervalMs: 1000,
    maxIntervalMs: 60000,
  },
  timeoutMs: 600000,
});
```

## Database Schema

### jobs Table

```sql
CREATE TABLE jobs (
  tenant UUID NOT NULL,
  job_id UUID DEFAULT gen_random_uuid() NOT NULL,
  type VARCHAR NOT NULL,
  metadata JSONB,
  status job_status NOT NULL,  -- pending, processing, completed, failed, active, queued
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,
  user_id UUID NOT NULL,
  runner_type VARCHAR DEFAULT 'pgboss' NOT NULL,  -- 'pgboss' or 'temporal'
  external_id VARCHAR,          -- PG Boss job ID or Temporal workflow ID
  external_run_id VARCHAR,      -- Temporal run ID
  PRIMARY KEY (tenant, job_id)
);
```

### job_details Table

```sql
CREATE TABLE job_details (
  tenant UUID NOT NULL,
  detail_id UUID DEFAULT gen_random_uuid() NOT NULL,
  job_id UUID NOT NULL,
  step_name VARCHAR NOT NULL,
  status job_status NOT NULL,
  result JSONB,
  processed_at TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  metadata JSONB,
  PRIMARY KEY (tenant, detail_id),
  FOREIGN KEY (tenant, job_id) REFERENCES jobs(tenant, job_id)
);
```

## Temporal-Specific Features (EE)

When using Temporal as the backend, additional features are available:

### Workflow Signals

```typescript
import { Client } from '@temporalio/client';

const client = new Client({ /* ... */ });
const handle = client.workflow.getHandle(workflowId);

// Cancel a job
await handle.signal('cancelJob', {
  reason: 'User requested cancellation',
  cancelledBy: 'admin@example.com',
});

// Update progress
await handle.signal('updateProgress', {
  progress: 50,
  message: 'Halfway done',
});
```

### Workflow Queries

```typescript
// Get current job state
const state = await handle.query('getJobState');
// { step: 'executing', progress: 50, startedAt: '...' }
```

## Troubleshooting

### Job Handler Not Found

If you see "No handler registered for job: X":

1. Verify the handler is registered in `registerAllHandlers.ts`
2. Check that `registerAllJobHandlers()` was called at startup
3. For Temporal: ensure `initializeJobHandlersForWorker()` was called

### Jobs Not Processing

1. Check PG Boss is connected: verify database connection
2. Check Temporal worker is running: `kubectl get pods -l app=temporal-worker`
3. Check task queues match between scheduler and worker

### Temporal Connection Issues

1. Verify `TEMPORAL_ADDRESS` is correct
2. Check Temporal server is running
3. If `JOB_RUNNER_FALLBACK_TO_PGBOSS=true`, jobs will use PG Boss

## See Also

- [Enterprise Temporal Documentation](../../ee/docs/temporal-workflows/job-runner-abstraction.md)
- [Temporal Worker Deployment](../../ee/docs/temporal-workflows/deployment.md)
- [Configuration Guide](../getting-started/configuration_guide.md)
