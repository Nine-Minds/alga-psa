# Temporal Job Runner Abstraction Plan

**Date:** November 30, 2025
**Status:** In Progress (Phase 1, 2, & 3 Partial Complete)
**Edition:** Community Edition (PG Boss) / Enterprise Edition (Temporal)

---

## 1. Executive Summary

This plan outlines the implementation of an abstraction layer for background job processing that allows the Community Edition (CE) to continue using PG Boss while the Enterprise Edition (EE) can leverage Temporal for enhanced workflow orchestration, durability, and observability. Both implementations will write runtime information to the same database tables (`jobs` and `job_details`), ensuring a unified job monitoring experience regardless of the underlying execution engine.

### Key Outcomes
- **Unified Interface**: A single `IJobRunner` interface that abstracts job scheduling and execution
- **Seamless Migration Path**: EE customers can upgrade without losing job history or monitoring capabilities
- **Shared Monitoring Dashboard**: Both PG Boss and Temporal jobs visible in the same UI
- **Maintained Compatibility**: All existing jobs continue to work without modification

---

## 2. Problem Statement

### Current State
The Alga PSA application currently uses PG Boss exclusively for background job processing:
- Jobs are initialized during Next.js startup via `instrumentation.ts` → `initializeApp.ts`
- Job handlers are registered in `server/src/lib/jobs/index.ts`
- Job records are stored in the `jobs` and `job_details` tables
- The job monitoring dashboard queries these tables to display job status

### Challenges
1. **No EE Differentiation**: Temporal workflows exist in `ee/temporal-workflows/` but are separate from the general job system
2. **Limited Orchestration**: PG Boss handles simple queued jobs but lacks Temporal's workflow capabilities (signals, queries, long-running processes, automatic retries with backoff)
3. **Operational Visibility**: EE customers want the power of Temporal with unified monitoring in the existing dashboard

### Desired State
- CE continues using PG Boss with no changes to behavior
- EE can configure Temporal as the job runner backend
- Both backends write to the same `jobs` and `job_details` tables
- The job monitoring dashboard works identically for both editions

---

## 3. Goals and Non-Goals

### Goals
1. Create a unified `IJobRunner` interface that abstracts job scheduling and execution
2. Implement a PG Boss adapter that wraps the existing `JobScheduler`
3. Implement a Temporal adapter for EE that converts jobs to Temporal workflows
4. Ensure both adapters write consistent data to `jobs` and `job_details` tables
5. Provide a factory that selects the appropriate implementation based on edition/configuration
6. Maintain backward compatibility with all existing job handlers
7. Enable incremental migration of individual jobs from PG Boss to Temporal

### Non-Goals
- Rewriting existing Temporal workflows (tenant-creation, portal-domains, etc.) to use this abstraction
- Modifying the job monitoring dashboard UI (it already works with the database tables)
- Supporting hybrid mode where some jobs use PG Boss and others use Temporal simultaneously (may be future enhancement)
- Adding new job types as part of this work

---

## 4. Architecture Overview

### 4.1 Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Application                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ instrumentation.ts → initializeApp.ts → initializeScheduler ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      JobScheduler (PG Boss)                  ││
│  │  - scheduleImmediateJob()                                   ││
│  │  - scheduleScheduledJob()                                   ││
│  │  - scheduleRecurringJob()                                   ││
│  │  - registerJobHandler()                                     ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      JobService                              ││
│  │  - createJob() → writes to `jobs` table                     ││
│  │  - updateJobStatus() → updates `jobs` table                 ││
│  │  - createJobDetail() → writes to `job_details` table        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js Application                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ instrumentation.ts → initializeApp.ts → initializeJobRunner ││
│  └──────────────────────────────┬──────────────────────────────┘│
│                                 │                                │
│                                 ▼                                │
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
│  │  - Wraps existing       │         │  - Converts jobs to     ││
│  │    JobScheduler         │         │    Temporal workflows   ││
│  └───────────┬─────────────┘         └───────────┬─────────────┘│
│              │                                    │              │
│              └──────────────────┬─────────────────┘              │
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      JobService                              ││
│  │  - createJob() → writes to `jobs` table                     ││
│  │  - updateJobStatus() → updates `jobs` table                 ││
│  │  - createJobDetail() → writes to `job_details` table        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                 │                                │
│                                 ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   Job Monitoring Dashboard                   ││
│  │  - Queries `jobs` and `job_details` tables                  ││
│  │  - Works identically for both PG Boss and Temporal          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Detailed Design

### 5.1 Core Interfaces

#### IJobRunner Interface

Location: `server/src/lib/jobs/interfaces/IJobRunner.ts`

```typescript
import { JobStatus } from '../../types/job';

/**
 * Configuration for a job handler
 */
export interface JobHandlerConfig<T extends Record<string, unknown>> {
  /** Unique name for this job type */
  name: string;
  /** The handler function that processes the job */
  handler: (jobId: string, data: T) => Promise<void>;
  /** Optional retry configuration */
  retry?: {
    maxAttempts?: number;
    backoffCoefficient?: number;
    initialIntervalMs?: number;
    maxIntervalMs?: number;
  };
  /** Optional timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Options for scheduling a job
 */
export interface ScheduleJobOptions {
  /** For scheduled jobs: when to run */
  runAt?: Date;
  /** For recurring jobs: cron expression or interval string */
  interval?: string;
  /** Unique key to prevent duplicate jobs */
  singletonKey?: string;
  /** Priority (higher = more important) */
  priority?: number;
}

/**
 * Result of scheduling a job
 */
export interface ScheduleJobResult {
  /** The job ID in our database (jobs table) */
  jobId: string;
  /** The external ID (PG Boss job ID or Temporal workflow ID) */
  externalId: string | null;
}

/**
 * Abstraction for background job execution
 *
 * This interface is implemented by both PgBossJobRunner (CE) and TemporalJobRunner (EE)
 * to provide a unified API for background job processing.
 */
export interface IJobRunner {
  /**
   * Register a job handler
   * @param config Job handler configuration
   */
  registerHandler<T extends Record<string, unknown>>(config: JobHandlerConfig<T>): void;

  /**
   * Schedule a job for immediate execution
   * @param jobName The name of the job type
   * @param data The job data (must include tenantId)
   * @returns The job ID and external ID
   */
  scheduleJob<T extends Record<string, unknown>>(
    jobName: string,
    data: T & { tenantId: string }
  ): Promise<ScheduleJobResult>;

  /**
   * Schedule a job to run at a specific time
   * @param jobName The name of the job type
   * @param data The job data (must include tenantId)
   * @param runAt When to execute the job
   * @returns The job ID and external ID
   */
  scheduleJobAt<T extends Record<string, unknown>>(
    jobName: string,
    data: T & { tenantId: string },
    runAt: Date
  ): Promise<ScheduleJobResult>;

  /**
   * Schedule a recurring job
   * @param jobName The name of the job type
   * @param data The job data (must include tenantId)
   * @param interval Cron expression or interval string (e.g., "0 0 * * *" or "24 hours")
   * @returns The job ID and external ID
   */
  scheduleRecurringJob<T extends Record<string, unknown>>(
    jobName: string,
    data: T & { tenantId: string },
    interval: string
  ): Promise<ScheduleJobResult>;

  /**
   * Cancel a scheduled job
   * @param jobId The job ID
   * @returns True if the job was cancelled
   */
  cancelJob(jobId: string): Promise<boolean>;

  /**
   * Get the status of a job
   * @param jobId The job ID
   * @returns The job status and metadata
   */
  getJobStatus(jobId: string): Promise<{
    status: JobStatus;
    progress?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }>;

  /**
   * Start the job runner (begin processing jobs)
   */
  start(): Promise<void>;

  /**
   * Stop the job runner gracefully
   */
  stop(): Promise<void>;
}
```

#### IJobRunnerFactory Interface

Location: `server/src/lib/jobs/interfaces/IJobRunnerFactory.ts`

```typescript
import { IJobRunner } from './IJobRunner';

/**
 * Configuration for the job runner
 */
export interface JobRunnerConfig {
  /** The job runner type: 'pgboss' or 'temporal' */
  type: 'pgboss' | 'temporal';

  /** PG Boss specific configuration */
  pgboss?: {
    connectionString?: string;
    retryLimit?: number;
    retryBackoff?: boolean;
  };

  /** Temporal specific configuration */
  temporal?: {
    address: string;
    namespace: string;
    taskQueue: string;
  };
}

/**
 * Factory for creating job runner instances
 */
export interface IJobRunnerFactory {
  /**
   * Create a job runner based on configuration
   * @param config The job runner configuration
   * @returns The job runner instance
   */
  createJobRunner(config: JobRunnerConfig): Promise<IJobRunner>;
}
```

### 5.2 PG Boss Job Runner (CE)

Location: `server/src/lib/jobs/runners/PgBossJobRunner.ts`

This implementation wraps the existing `JobScheduler` class and ensures compatibility with all existing job handlers.

Key responsibilities:
1. Delegate job scheduling to the existing `JobScheduler`
2. Ensure job records are created in the `jobs` table via `JobService`
3. Update job status on completion/failure
4. Maintain backward compatibility with existing handler registration

### 5.3 Temporal Job Runner (EE)

Location: `ee/server/src/lib/jobs/runners/TemporalJobRunner.ts`

This implementation converts job requests into Temporal workflows.

Key responsibilities:
1. Connect to the Temporal cluster
2. Convert job scheduling requests to workflow executions
3. Create/update job records in the database to mirror Temporal workflow state
4. Provide a generic workflow that wraps job handlers
5. Support Temporal-specific features (signals, queries, long-running processes)

#### Generic Job Workflow

Location: `ee/temporal-workflows/src/workflows/generic-job-workflow.ts`

```typescript
/**
 * Generic workflow that wraps any job handler
 *
 * This workflow provides Temporal's durability and observability
 * while executing jobs through the standard handler interface.
 */
export async function genericJobWorkflow(input: {
  jobId: string;
  jobName: string;
  tenantId: string;
  data: Record<string, unknown>;
}): Promise<{
  success: boolean;
  error?: string;
  result?: Record<string, unknown>;
}>;
```

### 5.4 Job Runner Factory

Location: `server/src/lib/jobs/JobRunnerFactory.ts`

```typescript
import { IJobRunner, IJobRunnerFactory, JobRunnerConfig } from './interfaces';
import { PgBossJobRunner } from './runners/PgBossJobRunner';
import { isEnterprise } from '../features';

export class JobRunnerFactory implements IJobRunnerFactory {
  private static instance: IJobRunner | null = null;

  async createJobRunner(config?: Partial<JobRunnerConfig>): Promise<IJobRunner> {
    if (JobRunnerFactory.instance) {
      return JobRunnerFactory.instance;
    }

    // Determine runner type based on edition and configuration
    const runnerType = config?.type ?? (isEnterprise ? 'temporal' : 'pgboss');

    if (runnerType === 'temporal' && isEnterprise) {
      // Dynamically import EE module to avoid bundling in CE
      const { TemporalJobRunner } = await import('@ee/lib/jobs/runners/TemporalJobRunner');
      JobRunnerFactory.instance = await TemporalJobRunner.create(config?.temporal);
    } else {
      JobRunnerFactory.instance = await PgBossJobRunner.create(config?.pgboss);
    }

    return JobRunnerFactory.instance;
  }

  static async getInstance(): Promise<IJobRunner> {
    const factory = new JobRunnerFactory();
    return factory.createJobRunner();
  }
}
```

### 5.5 Database Schema Updates

The existing `jobs` and `job_details` tables are sufficient, but we need to add a column to track the runner type and external workflow ID:

#### Migration: Add runner metadata columns

Location: `server/migrations/YYYYMMDDHHMMSS_add_job_runner_metadata.cjs`

```javascript
exports.up = async (knex) => {
  await knex.schema.alterTable('jobs', (table) => {
    // Track which runner executed this job
    table.string('runner_type').defaultTo('pgboss').notNullable();
    // Store external reference (PG Boss job ID or Temporal workflow ID)
    table.string('external_id').nullable();
    // Store Temporal run ID for workflow tracking
    table.string('external_run_id').nullable();
  });

  // Add index for external ID lookups
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_jobs_external_id ON jobs(external_id) WHERE external_id IS NOT NULL;
  `);
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS idx_jobs_external_id');
  await knex.schema.alterTable('jobs', (table) => {
    table.dropColumn('runner_type');
    table.dropColumn('external_id');
    table.dropColumn('external_run_id');
  });
};
```

### 5.6 Temporal Worker Updates

The existing Temporal worker needs to be updated to handle generic jobs alongside existing workflows.

#### Updates to worker.ts

- Add new task queue for generic jobs (e.g., `alga-jobs`)
- Register generic job workflow and activities
- Ensure proper activity implementations that call job handlers

#### Generic Job Activities

Location: `ee/temporal-workflows/src/activities/job-activities.ts`

```typescript
/**
 * Activities for generic job execution
 */
export const jobActivities = {
  /**
   * Execute a job handler
   */
  async executeJobHandler(input: {
    jobId: string;
    jobName: string;
    tenantId: string;
    data: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string; result?: unknown }>,

  /**
   * Update job status in the database
   */
  async updateJobStatus(input: {
    jobId: string;
    tenantId: string;
    status: JobStatus;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>,

  /**
   * Create a job detail record
   */
  async createJobDetail(input: {
    jobId: string;
    tenantId: string;
    stepName: string;
    status: string;
    metadata?: Record<string, unknown>;
  }): Promise<string>
};
```

---

## 6. Phased Implementation Plan

### Phase 1: Foundation (Core Interfaces & PG Boss Adapter) ✅ COMPLETE

**Goal:** Create the abstraction layer and ensure the CE implementation works identically to the current system.

#### Tasks

1. **Create interface definitions** ✅
   - [x] Create `server/src/lib/jobs/interfaces/` directory
   - [x] Create `IJobRunner.ts` interface file
   - [x] Create `IJobRunnerFactory.ts` interface file
   - [x] Create `index.ts` barrel export file
   - [x] Add TypeScript types for job data, status, and results

2. **Implement PG Boss Job Runner** ✅
   - [x] Create `server/src/lib/jobs/runners/` directory
   - [x] Create `PgBossJobRunner.ts` class implementing `IJobRunner`
   - [x] Wrap existing `JobScheduler` methods
   - [x] Ensure `JobService` integration for database writes
   - [x] Add proper error handling and logging
   - [ ] Create unit tests for PgBossJobRunner

3. **Create Job Runner Factory** ✅
   - [x] Create `server/src/lib/jobs/JobRunnerFactory.ts`
   - [x] Implement edition-based runner selection logic
   - [x] Add configuration validation
   - [ ] Create unit tests for factory

4. **Create database migration** ✅
   - [x] Create migration file for `runner_type`, `external_id`, and `external_run_id` columns
   - [x] Add indexes for external ID lookups
   - [ ] Test migration up and down

5. **Update initialization code** ✅
   - [x] Create `server/src/lib/jobs/initializeJobRunner.ts`
   - [ ] Update `server/src/lib/initializeApp.ts` to use new initialization
   - [x] Ensure backward compatibility with existing handler registration
   - [ ] Add feature flag for gradual rollout

6. **Integration testing**
   - [ ] Test all existing jobs work with the new abstraction
   - [ ] Verify job monitoring dashboard displays jobs correctly
   - [ ] Test job scheduling (immediate, scheduled, recurring)
   - [ ] Test job cancellation
   - [ ] Test error handling and retries

### Phase 2: Temporal Adapter (EE Implementation) ✅ COMPLETE

**Goal:** Implement the Temporal job runner for Enterprise Edition.

#### Tasks

1. **Create Temporal Job Runner** ✅
   - [x] Create `ee/server/src/lib/jobs/` directory structure
   - [x] Create `ee/server/src/lib/jobs/runners/TemporalJobRunner.ts`
   - [x] Implement `IJobRunner` interface methods
   - [x] Add Temporal client connection management
   - [x] Implement job-to-workflow conversion logic
   - [x] Add configuration for Temporal connection

2. **Create Generic Job Workflow** ✅
   - [x] Create `ee/temporal-workflows/src/workflows/generic-job-workflow.ts`
   - [x] Implement workflow state management
   - [x] Add signal handlers for job control
   - [x] Add query handlers for status retrieval
   - [x] Implement proper error handling and compensation

3. **Create Job Activities** ✅
   - [x] Create `ee/temporal-workflows/src/activities/job-activities.ts`
   - [x] Implement `executeJobHandler` activity
   - [x] Implement `updateJobStatus` activity
   - [x] Implement `createJobDetail` activity
   - [x] Register activities in `ee/temporal-workflows/src/activities/index.ts`

4. **Update Temporal Worker**
   - [ ] Add `alga-jobs` task queue to worker configuration
   - [x] Register generic job workflow
   - [x] Register job activities
   - [ ] Update `ee/temporal-workflows/src/config/startupValidation.ts`
   - [x] Add environment variable documentation

5. **Database Synchronization** ✅
   - [x] Implement real-time status sync from Temporal to database
   - [x] Create interceptors/middleware for workflow events
   - [x] Handle workflow completion/failure updates
   - [x] Add retry logic for database updates

6. **Update Factory for EE** ✅
   - [x] Add dynamic import for `TemporalJobRunner`
   - [x] Add Temporal configuration validation
   - [x] Implement graceful fallback to PG Boss if Temporal unavailable
   - [x] Add health check for Temporal connection

7. **Testing**
   - [ ] Unit tests for TemporalJobRunner
   - [ ] Integration tests with local Temporal server
   - [ ] Test workflow execution and status updates
   - [ ] Test signal/query functionality
   - [ ] Test database synchronization
   - [ ] Test fallback behavior

### Phase 3: Migration & Polish

**Goal:** Ensure smooth migration path and production readiness.

#### Tasks

1. **Job Handler Registry** ✅ COMPLETE
   - [x] Create centralized job handler registry (`server/src/lib/jobs/jobHandlerRegistry.ts`)
   - [x] Implement handler lookup by job name
   - [x] Add validation for handler registration
   - [x] Document handler registration process
   - [x] Create `registerAllHandlers.ts` for unified handler registration
   - [x] Update Temporal worker to initialize handlers at startup

2. **Migration utilities** ⏭️ SKIPPED
   - [x] Skipped per user request - no need to handle in-flight PG Boss jobs

3. **Monitoring enhancements**
   - [ ] Add runner type indicator to job monitoring dashboard
   - [ ] Add external ID display for debugging
   - [ ] Add Temporal workflow link for EE jobs
   - [ ] Update job metrics to include runner breakdown

4. **Configuration management** ✅ COMPLETE
   - [x] Update `.env.example` with new variables
   - [x] Create configuration documentation (`ee/docs/temporal-workflows/job-runner-abstraction.md`)
   - [ ] Add runtime configuration validation
   - [ ] Implement configuration reload without restart

5. **Error handling & resilience**
   - [ ] Implement circuit breaker for Temporal connection
   - [ ] Add graceful degradation to PG Boss
   - [ ] Implement job recovery mechanisms
   - [ ] Add comprehensive error logging

6. **Documentation** ✅ COMPLETE
   - [x] Create developer guide for adding new jobs (`docs/job_scheduler.md`)
   - [x] Document EE-specific features (signals, queries)
   - [x] Create troubleshooting guide
   - [x] Update API documentation
   - [x] Create architecture diagrams

7. **Production readiness**
   - [ ] Performance testing with high job volume
   - [ ] Load testing for concurrent job execution
   - [ ] Chaos testing for failure scenarios
   - [ ] Security review of Temporal integration
   - [ ] Create runbook for operations team

### Phase 4: Advanced Features (Future Enhancement)

**Goal:** Enable advanced Temporal features for complex jobs.

#### Tasks

1. **Workflow-specific jobs**
   - [ ] Define interface for workflow-aware job handlers
   - [ ] Implement step tracking with activities
   - [ ] Add progress reporting through queries
   - [ ] Support long-running jobs with heartbeats

2. **Hybrid mode support**
   - [ ] Implement per-job runner selection
   - [ ] Add job routing configuration
   - [ ] Create migration path for individual jobs
   - [ ] Document hybrid mode usage

3. **Enhanced monitoring**
   - [ ] Add Temporal workflow visualization
   - [ ] Implement real-time job progress updates
   - [ ] Add job dependency tracking
   - [ ] Create alerting integrations

---

## 7. Configuration

### Environment Variables

#### CE Configuration (PG Boss)

```bash
# Job Runner Configuration
JOB_RUNNER_TYPE=pgboss  # Default for CE

# PG Boss Configuration (existing)
# Uses DATABASE_URL or individual connection params
```

#### EE Configuration (Temporal)

```bash
# Job Runner Configuration
JOB_RUNNER_TYPE=temporal  # Enable Temporal for EE

# Temporal Configuration
TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_JOB_TASK_QUEUE=alga-jobs

# Optional: Fallback behavior
JOB_RUNNER_FALLBACK_TO_PGBOSS=true  # If Temporal unavailable
```

---

## 8. Existing Job Handlers

The following jobs are currently registered and must work with the new abstraction:

| Job Name | Handler File | Description |
|----------|--------------|-------------|
| `generate-invoice` | `generateInvoiceHandler.ts` | Generates invoices for billing cycles |
| `asset_import` | `assetImportHandler.ts` | Processes asset import batches |
| `expired-credits` | `expiredCreditsHandler.ts` | Marks expired credits |
| `expiring-credits-notification` | `expiringCreditsNotificationHandler.ts` | Sends expiration notifications |
| `credit-reconciliation` | `creditReconciliationHandler.ts` | Reconciles credit balances |
| `invoice_zip` | `invoiceZipHandler.ts` | Creates ZIP archives of invoices |
| `invoice_email` | `invoiceEmailHandler.ts` | Sends invoice emails |
| `reconcile-bucket-usage` | `reconcileBucketUsageHandler.ts` | Reconciles usage records |
| `cleanup-temporary-workflow-forms` | `cleanupTemporaryFormsJob.ts` | Cleans up temporary forms |
| `cleanup-ai-session-keys` | `cleanupAiSessionKeysHandler.ts` | Cleans up AI sessions (EE) |
| `renew-microsoft-calendar-webhooks` | `calendarWebhookMaintenanceHandler.ts` | Renews MS calendar subs |
| `verify-google-calendar-pubsub` | `calendarWebhookMaintenanceHandler.ts` | Verifies Google calendar |
| `createClientContractLineCycles` | `initializeApp.ts` | Creates billing cycles |
| `createNextTimePeriods` | `initializeApp.ts` | Creates time periods |

---

## 9. Database Tables

### jobs Table

```sql
CREATE TABLE jobs (
  tenant UUID NOT NULL,
  job_id UUID DEFAULT gen_random_uuid() NOT NULL,
  type VARCHAR NOT NULL,              -- Job name/type
  metadata JSONB,                     -- Job-specific data
  status job_status NOT NULL,         -- pending, processing, completed, failed, active, queued
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,
  user_id UUID NOT NULL,
  runner_type VARCHAR DEFAULT 'pgboss' NOT NULL,  -- NEW: 'pgboss' or 'temporal'
  external_id VARCHAR,                            -- NEW: PG Boss job ID or Temporal workflow ID
  external_run_id VARCHAR,                        -- NEW: Temporal run ID
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

---

## 10. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Temporal unavailability | EE jobs fail to execute | Medium | Implement fallback to PG Boss with configuration flag |
| Database sync failures | Job status mismatch | Medium | Implement retry logic with dead-letter handling |
| Performance regression | Slower job processing | Low | Benchmark before/after, optimize hot paths |
| Breaking existing jobs | Production outages | High | Comprehensive testing, feature flag rollout |
| Configuration complexity | Deployment failures | Medium | Clear documentation, validation on startup |
| Migration issues | Lost job history | Medium | Database migration testing, rollback procedures |

---

## 11. Success Metrics

### Phase 1 Completion Criteria
- [ ] All existing jobs work with PgBossJobRunner
- [ ] Job monitoring dashboard displays jobs correctly
- [ ] No regression in job processing performance
- [ ] Unit test coverage > 80%

### Phase 2 Completion Criteria
- [ ] TemporalJobRunner passes all IJobRunner interface tests
- [ ] Jobs execute successfully via Temporal workflows
- [ ] Database correctly reflects Temporal job status
- [ ] Integration tests pass with local Temporal server

### Phase 3 Completion Criteria
- [ ] Documentation complete and reviewed
- [ ] Production deployment successful
- [ ] No critical issues after 1 week in production
- [ ] Operations team trained on new system

---

## 12. Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Foundation | 1-2 weeks | None |
| Phase 2: Temporal Adapter | 2-3 weeks | Phase 1 complete |
| Phase 3: Migration & Polish | 1-2 weeks | Phase 2 complete |
| Phase 4: Advanced Features | TBD | Phase 3 complete |

**Total estimated time:** 4-7 weeks for Phases 1-3

---

## 13. File Structure Summary

```
server/
├── src/
│   ├── lib/
│   │   └── jobs/
│   │       ├── interfaces/
│   │       │   ├── index.ts
│   │       │   ├── IJobRunner.ts
│   │       │   └── IJobRunnerFactory.ts
│   │       ├── runners/
│   │       │   ├── index.ts
│   │       │   └── PgBossJobRunner.ts
│   │       ├── JobRunnerFactory.ts
│   │       ├── initializeJobRunner.ts
│   │       ├── jobHandlerRegistry.ts    # Centralized handler registry
│   │       ├── registerAllHandlers.ts   # Handler registration function
│   │       ├── jobScheduler.ts          # Existing (kept for backward compat)
│   │       ├── index.ts                 # Updated exports
│   │       └── handlers/                # Existing handlers (unchanged)
│   └── services/
│       └── job.service.ts               # Existing (minor updates)
└── migrations/
    └── 20251130000000_add_job_runner_metadata.cjs

ee/
├── docs/
│   └── temporal-workflows/
│       ├── deployment.md                # Existing deployment guide
│       └── job-runner-abstraction.md    # New configuration/usage docs
├── server/
│   └── src/
│       └── lib/
│           └── jobs/
│               └── runners/
│                   └── TemporalJobRunner.ts
└── temporal-workflows/
    └── src/
        ├── workflows/
        │   ├── index.ts                 # Updated exports
        │   └── generic-job-workflow.ts  # New workflow
        ├── activities/
        │   ├── index.ts                 # Updated exports
        │   └── job-activities.ts        # New activities (with initializeJobHandlersForWorker)
        └── worker.ts                    # Updated task queues + handler initialization
```

---

## 14. Open Questions

1. **Hybrid mode priority:** Should we support per-job runner selection in Phase 3 or defer to Phase 4?
2. **Retry configuration:** Should Temporal retry configuration mirror PG Boss defaults or use Temporal best practices?
3. **Job cancellation:** How should we handle cancellation of in-flight Temporal workflows?
4. **Monitoring integration:** Should we add Temporal UI links in the job monitoring dashboard?
5. **Multi-tenant task queues:** Should we use separate Temporal task queues per tenant for isolation?

---

## 15. References

- [PG Boss Documentation](https://github.com/timgit/pg-boss)
- [Temporal TypeScript SDK](https://docs.temporal.io/dev-guide/typescript)
- [Existing JobScheduler Implementation](server/src/lib/jobs/jobScheduler.ts)
- [Existing Temporal Workflows](ee/temporal-workflows/src/workflows/)
- [Job Monitoring Dashboard](server/src/app/msp/jobs/page.tsx)

---

**Document Owner:** Engineering Team
**Last Updated:** November 30, 2025
**Status:** Draft - Pending Review
