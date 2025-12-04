# Job Runner Abstraction Layer

This guide documents the unified job runner abstraction that allows Alga PSA to use either PG Boss (Community Edition) or Temporal (Enterprise Edition) for background job processing, while maintaining a consistent job monitoring experience through the shared `jobs` and `job_details` database tables.

## Overview

The job runner abstraction provides:

- **Unified Interface**: A single `IJobRunner` interface for scheduling and managing background jobs
- **Edition-Based Selection**: Automatic selection of PG Boss (CE) or Temporal (EE) based on configuration
- **Shared Monitoring**: Both implementations write to the same database tables for unified job visibility
- **Backward Compatibility**: All existing job handlers work without modification

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application Layer                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   JobRunnerFactory                           ││
│  │  - Creates PgBossJobRunner (CE) or TemporalJobRunner (EE)   ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│              ┌──────────────────┴──────────────────┐             │
│              ▼                                      ▼             │
│  ┌─────────────────────────┐         ┌─────────────────────────┐│
│  │   PgBossJobRunner (CE)  │         │  TemporalJobRunner (EE) ││
│  │  implements IJobRunner  │         │  implements IJobRunner  ││
│  └───────────┬─────────────┘         └───────────┬─────────────┘│
│              │                                    │              │
│              └──────────────────┬─────────────────┘              │
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      JobService                              ││
│  │  - Writes to `jobs` and `job_details` tables                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JOB_RUNNER_TYPE` | `pgboss` | Job runner backend: `pgboss` or `temporal` |
| `JOB_RUNNER_FALLBACK_TO_PGBOSS` | `true` | Fall back to PG Boss if Temporal is unavailable |
| `TEMPORAL_ADDRESS` | `temporal-frontend.temporal.svc.cluster.local:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_JOB_TASK_QUEUE` | `alga-jobs` | Task queue for generic job workflows |

### Community Edition (PG Boss)

For CE deployments, PG Boss is used automatically. No additional configuration is needed beyond the existing database connection settings.

```bash
# .env for CE
JOB_RUNNER_TYPE=pgboss
```

### Enterprise Edition (Temporal)

For EE deployments, configure Temporal as the job runner:

```bash
# .env for EE
JOB_RUNNER_TYPE=temporal
TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_JOB_TASK_QUEUE=alga-jobs
JOB_RUNNER_FALLBACK_TO_PGBOSS=true
```

## Job Handler Registry

The `JobHandlerRegistry` provides centralized registration and lookup of job handlers. This is essential for the Temporal worker, which runs as a separate process from the Next.js server.

### Registering Handlers

All job handlers are registered via `registerAllJobHandlers()`:

```typescript
import { registerAllJobHandlers } from 'server/src/lib/jobs';

// During application startup
await registerAllJobHandlers({
  jobService: myJobService,
  storageService: myStorageService,
  includeEnterprise: process.env.EDITION === 'enterprise',
});
```

### Adding a New Handler

1. Create your handler in `server/src/lib/jobs/handlers/`:

```typescript
// server/src/lib/jobs/handlers/myNewHandler.ts
import { BaseJobData } from '../interfaces';

export interface MyNewJobData extends BaseJobData {
  tenantId: string;
  customField: string;
}

export async function myNewHandler(data: MyNewJobData): Promise<void> {
  // Your job logic here
}
```

2. Register it in `registerAllHandlers.ts`:

```typescript
import { myNewHandler, MyNewJobData } from './handlers/myNewHandler';

// In registerAllJobHandlers function:
JobHandlerRegistry.register<MyNewJobData & BaseJobData>(
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

3. Add it to `getAvailableJobHandlers()` for documentation.

## Temporal Worker Configuration

The Temporal worker handles generic job workflows alongside specialized workflows (tenant creation, portal domains, etc.).

### Task Queues

The worker listens on multiple task queues:

| Queue | Purpose |
|-------|---------|
| `tenant-workflows` | Tenant creation and management |
| `portal-domain-workflows` | Portal domain provisioning |
| `email-domain-workflows` | Email domain configuration |
| `alga-jobs` | Generic job execution via `genericJobWorkflow` |

### Worker Startup

The worker initializes job handlers before starting:

```typescript
// In worker main()
await initializeJobHandlersForWorker();
```

This loads all job handlers into the registry so the `executeJobHandler` activity can find and invoke them.

### Activity Configuration

Generic job activities use these default timeouts:

| Setting | Value |
|---------|-------|
| `startToCloseTimeout` | 10 minutes |
| `maximumAttempts` | 3 |
| `initialInterval` | 1 second |
| `maximumInterval` | 30 seconds |
| `backoffCoefficient` | 2.0 |

## Generic Job Workflow

The `genericJobWorkflow` wraps any registered job handler, providing Temporal's durability features.

### Workflow Interface

```typescript
interface GenericJobInput {
  jobId: string;      // Our database job ID
  jobName: string;    // Handler name (e.g., 'generate-invoice')
  tenantId: string;   // Tenant context
  data: Record<string, unknown>;  // Job-specific data
}

interface GenericJobResult {
  success: boolean;
  jobId: string;
  error?: string;
  result?: Record<string, unknown>;
  completedAt: string;
}
```

### Signals

| Signal | Purpose |
|--------|---------|
| `cancelJob` | Cancel a running job with a reason |
| `updateProgress` | Update job progress (0-100) |

### Queries

| Query | Returns |
|-------|---------|
| `getJobState` | Current workflow state (step, progress, errors) |

### Example: Canceling a Job

```typescript
import { Client } from '@temporalio/client';

const client = new Client({ /* connection config */ });
const handle = client.workflow.getHandle(workflowId);
await handle.signal('cancelJob', {
  reason: 'User requested cancellation',
  cancelledBy: 'user@example.com',
});
```

## Database Schema

### jobs Table Extensions

The abstraction adds these columns to the `jobs` table:

| Column | Type | Description |
|--------|------|-------------|
| `runner_type` | VARCHAR | `'pgboss'` or `'temporal'` |
| `external_id` | VARCHAR | PG Boss job ID or Temporal workflow ID |
| `external_run_id` | VARCHAR | Temporal run ID (for workflow history) |

### Querying Jobs by Runner

```sql
-- Find all Temporal-executed jobs
SELECT * FROM jobs WHERE runner_type = 'temporal';

-- Find a job by Temporal workflow ID
SELECT * FROM jobs WHERE external_id = 'my-workflow-id';
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

## Troubleshooting

### Job Handler Not Found

If you see "No handler registered for job: X":

1. Verify the handler is registered in `registerAllHandlers.ts`
2. Check that `registerAllJobHandlers()` was called before job execution
3. For Temporal worker: ensure `initializeJobHandlersForWorker()` was called at startup

### Temporal Connection Issues

If jobs fail to schedule in EE mode:

1. Check `TEMPORAL_ADDRESS` is correct and accessible
2. Verify Temporal server is running: `kubectl get pods -n temporal`
3. Check worker logs for connection errors
4. If `JOB_RUNNER_FALLBACK_TO_PGBOSS=true`, jobs will fall back to PG Boss

### Database Sync Issues

If job status in database doesn't match Temporal:

1. Check Temporal worker logs for `updateJobStatus` activity failures
2. Verify database connectivity from the worker
3. Check for any retry exhaustion in the activity

### Missing Jobs in Dashboard

1. Verify `runner_type` column exists (run migrations)
2. Check that jobs are being created via `JobService.createJob()`
3. For Temporal jobs, verify the workflow is reaching the `updateJobStatus` activity

## Best Practices

### Handler Design

1. **Idempotency**: Design handlers to be safely re-runnable
2. **Timeouts**: Set appropriate `timeoutMs` for long-running jobs
3. **Tenant Isolation**: Always include `tenantId` in job data
4. **Error Handling**: Throw errors for retryable failures; log and complete for non-retryable

### Scheduling Jobs

```typescript
import { JobRunnerFactory } from 'server/src/lib/jobs';

// Get the job runner
const runner = await JobRunnerFactory.getInstance();

// Schedule an immediate job
const result = await runner.scheduleJob('generate-invoice', {
  tenantId: 'tenant-123',
  billingCycleId: 'cycle-456',
});

// Schedule a job for later
await runner.scheduleJobAt('cleanup-task', {
  tenantId: 'tenant-123',
}, new Date('2024-12-01T00:00:00Z'));

// Schedule a recurring job
await runner.scheduleRecurringJob('daily-report', {
  tenantId: 'tenant-123',
}, '0 0 * * *'); // Daily at midnight
```

## See Also

- [Temporal Worker Deployment Guide](./deployment.md)
- [Job Monitoring Dashboard](/msp/jobs)
- [PG Boss Documentation](https://github.com/timgit/pg-boss)
- [Temporal TypeScript SDK](https://docs.temporal.io/dev-guide/typescript)
