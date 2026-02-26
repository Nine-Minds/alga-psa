# SLA System Architecture

## Overview

The SLA system tracks ticket response and resolution times against configurable service level targets. It supports two execution backends:

- **PgBoss** (Community Edition) — Polling-based timer that checks active tickets every 5 minutes
- **Temporal** (Enterprise Edition) — Per-ticket durable workflows with precise threshold-based timers

Both backends use the same database tables and SLA services, providing identical business logic regardless of the timer engine. The backend is selected at runtime by `SlaBackendFactory` based on the edition flag.

## Key Features

- Two-phase SLA tracking (response + resolution) per ticket
- Business hours-aware deadline calculation with timezone and DST support
- Configurable notification thresholds (50%, 75%, 90%, 100%)
- 3-level escalation with automatic manager assignment
- Pause/resume with deadline shifting
- Edition-based backend selection (CE: PgBoss, EE: Temporal)
- Graceful fallback from Temporal to PgBoss

## Architecture

### Community Edition (PgBoss)

```
┌──────────────────────────────────────────────────────────────┐
│                     Next.js Application                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              SlaBackendFactory                           │ │
│  │           Creates PgBossSlaBackend                       │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                            │                                  │
│                            ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              PgBossSlaBackend                            │ │
│  │  - start/cancel: no-op (polling handles lifecycle)       │ │
│  │  - pause/resume/complete: delegates to service layer     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              slaTimerHandler (Job Scheduler)              │ │
│  │  - Runs every 5 min via PgBoss cron                      │ │
│  │  - Queries active tickets with SLA tracking               │ │
│  │  - Calculates elapsed SLA % using business hours          │ │
│  │  - Publishes TICKET_SLA_THRESHOLD_REACHED events          │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Enterprise Edition (Temporal)

```
┌──────────────────────────────────────────────────────────────┐
│                     Next.js Application                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              SlaBackendFactory                           │ │
│  │         Creates TemporalSlaBackend                       │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                            │                                  │
│                            ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │            TemporalSlaBackend                            │ │
│  │  - Starts sla-ticket-workflow per ticket                  │ │
│  │  - Sends signals: pause/resume/complete/cancel            │ │
│  │  - Queries workflow state for real-time SLA status        │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                            │                                  │
│                            ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │          Temporal Worker (separate process)               │ │
│  │  Task queue: "sla-workflows"                              │ │
│  │  Workflow: slaTicketWorkflow                              │ │
│  │  Activities: calculate, notify, escalate, update, audit   │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## ISlaBackend Interface

The `ISlaBackend` interface abstracts timer operations so SLA services are edition-agnostic:

```typescript
interface ISlaBackend {
  startSlaTracking(ticketId, policyId, targets, schedule, notificationThresholds?): Promise<void>;
  pauseSla(ticketId, reason: SlaPauseReason): Promise<void>;
  resumeSla(ticketId): Promise<void>;
  completeSla(ticketId, type: 'response' | 'resolution', met: boolean): Promise<void>;
  cancelSla(ticketId): Promise<void>;
  getSlaStatus(ticketId): Promise<ISlaStatus | null>;
}
```

**PgBossSlaBackend** (CE): `startSlaTracking` and `cancelSla` are no-ops — the polling job handles timing. `pauseSla`/`resumeSla`/`completeSla` delegate to the service layer with `skipBackend: true` to prevent infinite recursion.

**TemporalSlaBackend** (EE): All methods map to Temporal operations — workflow start, signals, and queries. Falls back to PgBoss if the Temporal client cannot connect.

## SlaBackendFactory

Singleton factory that resolves the backend at runtime:

1. Checks `isEnterprise` flag from `@alga-psa/core/features`
2. If enterprise: dynamically imports `TemporalSlaBackend` from the EE package
3. On import failure or non-enterprise: falls back to `PgBossSlaBackend` with a warning log
4. Caches the resolved backend instance for the process lifetime

## Temporal Workflow Lifecycle (EE)

### Workflow: slaTicketWorkflow

Each ticket with an SLA policy gets one workflow instance. The workflow processes two sequential phases: **response** then **resolution**.

**Input:**
```typescript
interface SlaTicketWorkflowInput {
  ticketId: string;
  tenantId: string;
  policyTargets: ISlaPolicyTarget[];
  businessHoursSchedule: IBusinessHoursScheduleWithEntries;
  notificationThresholds?: number[];  // e.g., [50, 75, 90] — 100 is always added
}
```

**Workflow ID format:** `sla-ticket-{tenantId}-{ticketId}`

**Phase loop:**
For each phase (response, resolution):
1. Look up `targetMinutes` from policy targets for the ticket's priority
2. If no target, skip the phase
3. For each threshold (sorted, always includes 100%):
   a. Call `calculateNextWakeTime` activity to get the wall-clock deadline
   b. Sleep until deadline (interruptible by signals)
   c. If paused during sleep: skip to next threshold iteration
   d. If cancelled/completed: exit phase
   e. Send notification, check escalation, update status (at 100%)
4. Move to next phase

**Execution timeout:** 365 days. **Activity retry:** 3 attempts, 1s initial interval, 2x backoff, 30s max.

### Signals

| Signal | Payload | Effect |
|--------|---------|--------|
| `pause` | `{ reason: SlaPauseReason }` | Sets paused state, records pause start time |
| `resume` | (none) | Calculates pause duration, adds to `totalPauseMinutes`, unblocks |
| `completeResponse` | `{ met: boolean }` | Marks response phase complete, logs audit event |
| `completeResolution` | `{ met: boolean }` | Marks workflow completed, logs audit event |
| `cancel` | (none) | Terminates workflow |

### Query

| Query | Returns |
|-------|---------|
| `getState` | `SlaTicketWorkflowQueryResult` — current phase, status, pause state, deadlines, notified thresholds, remaining time in minutes |

### Activities

| Activity | Purpose |
|----------|---------|
| `calculateNextWakeTime` | Convert business-minute threshold to wall-clock UTC deadline using schedule + pause offset |
| `sendSlaNotification` | Publish `TICKET_SLA_THRESHOLD_REACHED` event to Redis stream |
| `checkAndEscalate` | Check escalation thresholds and trigger escalation if needed |
| `updateSlaStatus` | Mark `sla_response_met` / `sla_resolution_met` in tickets table (100% threshold only) |
| `recordSlaAuditLog` | Write event to `sla_audit_log` table |

## Event Bus Integration

```
Ticket Action
    │
    ▼
Event Bus (Redis Stream)
    │
    ├──► slaSubscriber
    │     ├── TICKET_CREATED              → startSlaForTicket()
    │     ├── TICKET_UPDATED              → handlePriorityChange() / handleStatusChange()
    │     ├── TICKET_CLOSED               → recordResolution()
    │     ├── TICKET_COMMENT_ADDED        → recordFirstResponse()
    │     └── TICKET_RESPONSE_STATE_CHANGED → handleResponseStateChange()
    │
    └──► slaNotificationSubscriber
          └── TICKET_SLA_THRESHOLD_REACHED → sendSlaNotification()
```

### Events Consumed

| Event | Source | Handler |
|-------|--------|---------|
| `TICKET_CREATED` | Ticket creation | Starts SLA tracking with resolved policy |
| `TICKET_UPDATED` | Status/priority/policy changes | Recalculates deadlines or pauses/resumes |
| `TICKET_CLOSED` | Ticket closure | Records resolution and SLA met/breached |
| `TICKET_COMMENT_ADDED` | New comment | Records first response (public, internal-user only) |
| `TICKET_RESPONSE_STATE_CHANGED` | Response state toggle | Pauses/resumes for awaiting_client |

### Events Produced

| Event | Source | Consumer |
|-------|--------|----------|
| `TICKET_SLA_THRESHOLD_REACHED` | Timer job (CE) or Temporal activity (EE) | `slaNotificationSubscriber` — sends in-app/email notifications |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_EDITION` | `community` | Controls backend selection (`community` or `enterprise`) |
| `TEMPORAL_ADDRESS` | `temporal-frontend.temporal.svc.cluster.local:7233` | Temporal server address (EE only) |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace (EE only) |
| `TEMPORAL_TASK_QUEUES` | `tenant-workflows,...,sla-workflows` | Comma-separated task queues for worker (EE only) |

### Feature Flags

- `isEnterprise` (from `@alga-psa/core/features`) — determines whether `SlaBackendFactory` attempts to load the Temporal backend

### SLA Timer Job (CE)

| Setting | Value |
|---------|-------|
| Job name | `sla-timer` |
| Schedule | `*/5 * * * *` (every 5 minutes) |
| Retry | 2 attempts |
| Timeout | 5 minutes |

## Key File Paths

### Core Package
| File | Purpose |
|------|---------|
| `packages/sla/src/types/index.ts` | All SLA type definitions |
| `packages/sla/src/services/slaService.ts` | SLA lifecycle (start, response, resolution) |
| `packages/sla/src/services/slaPauseService.ts` | Pause/resume with deadline shifting |
| `packages/sla/src/services/businessHoursCalculator.ts` | Timezone-aware time calculations |
| `packages/sla/src/services/slaNotificationService.ts` | Threshold notification delivery |
| `packages/sla/src/services/escalationService.ts` | 3-level escalation management |
| `packages/sla/src/services/itilSlaService.ts` | ITIL standard auto-configuration |
| `packages/sla/src/services/backends/ISlaBackend.ts` | Backend interface |
| `packages/sla/src/services/backends/PgBossSlaBackend.ts` | CE backend implementation |
| `packages/sla/src/services/backends/SlaBackendFactory.ts` | Backend factory (singleton) |
| `packages/sla/src/actions/` | Server actions (policy, schedule, pause, escalation, reporting) |
| `packages/sla/src/components/` | UI components (settings, badges, dashboard) |

### EE Temporal
| File | Purpose |
|------|---------|
| `ee/server/src/lib/sla/TemporalSlaBackend.ts` | EE Temporal backend (starts workflows, sends signals) |
| `ee/temporal-workflows/src/workflows/sla-ticket-workflow.ts` | Temporal workflow (2-phase, threshold-based) |
| `ee/temporal-workflows/src/activities/sla-activities.ts` | 5 activities (calculate, notify, escalate, update, audit) |
| `packages/ee/src/lib/sla/TemporalSlaBackend.ts` | CE stub (throws "enterprise only") |

### Server Integration
| File | Purpose |
|------|---------|
| `server/src/lib/eventBus/subscribers/slaSubscriber.ts` | Ticket event handlers for SLA lifecycle |
| `server/src/lib/eventBus/subscribers/slaNotificationSubscriber.ts` | Threshold notification dispatch |
| `server/src/lib/jobs/handlers/slaTimerHandler.ts` | CE polling job (every 5 min) |
| `server/src/app/msp/settings/sla/page.tsx` | Settings page (5 tabs) |

### Database
| File | Purpose |
|------|---------|
| `server/migrations/20260219000001_create_sla_policies.cjs` | Policies, targets, settings, pause config |
| `server/migrations/20260219000002_create_business_hours.cjs` | Schedules, entries, holidays |
| `server/migrations/20260219000003_add_board_manager_and_sla_notifications.cjs` | Board manager, notification thresholds, sent tracking |
| `server/migrations/20260219000004_add_sla_tracking_to_tickets.cjs` | Ticket SLA columns |
| `server/migrations/20260219000005_create_sla_audit_log.cjs` | Audit log |
| `server/migrations/20260219000006_add_sla_internal_notification_templates.cjs` | In-app notification templates |
| `server/migrations/20260219000007_add_sla_email_templates.cjs` | Email templates |
| `server/migrations/20260219000008_create_escalation_managers.cjs` | Escalation managers |

### Tests
| Location | Coverage |
|----------|----------|
| `packages/sla/src/services/__tests__/` | Business hours, SLA lifecycle, pause, escalation, notifications, backends |
| `ee/temporal-workflows/src/workflows/__tests__/` | Workflow logic, integration |
| `ee/temporal-workflows/src/activities/__tests__/` | Activity implementations |
| `server/src/test/integration/sla/` | 8 integration test suites |
| `server/src/test/unit/sla/` | 3 unit test suites (hierarchy, status resolver, time calculator) |

## Error Handling

- **Backend fallback**: If `TemporalSlaBackend` import fails (missing Temporal client, connection error), `SlaBackendFactory` silently falls back to `PgBossSlaBackend` and logs a warning
- **skipBackend flag**: `PgBossSlaBackend` calls service methods with `{ skipBackend: true }` to prevent infinite recursion between the backend and service layer
- **Idempotent workflow start**: `TemporalSlaBackend.startSlaTracking()` catches `WorkflowExecutionAlreadyStartedError` and returns gracefully
- **Ticket isolation**: The CE timer job processes tickets individually — a failure on one ticket does not block others
- **Activity retries**: Temporal activities use 3 attempts with exponential backoff (1s initial, 2x coefficient, 30s max)

## See Also

- [SLA Feature Documentation](../features/sla.md) — Business logic, database schema, and feature descriptions
- [Event System Architecture](./event_system.md) — Redis-based event streaming
- [Job Scheduler](./job_scheduler.md) — PgBoss/Temporal job system
- [Temporal Workflow PRD](../plans/2026-02-03-sla-temporal-workflow-architecture/PRD.md) — Original design document
