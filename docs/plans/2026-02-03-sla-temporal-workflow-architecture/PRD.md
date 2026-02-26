# PRD — SLA Temporal Workflow Architecture (CE/EE Split)

- Slug: `sla-temporal-workflow-architecture`
- Date: `2026-02-03`
- Status: Draft

## Summary

Move SLA time calculation and monitoring from the current pgboss-only polling approach to a dual-backend architecture where Enterprise Edition (EE) uses Temporal workflows for durable, event-driven SLA tracking while Community Edition (CE) continues using pgboss for periodic polling.

## Problem

The current SLA implementation uses a pgboss job (`sla-timer`) that polls every 5 minutes to check all active tickets for threshold crossings. This approach has limitations:

1. **Polling inefficiency**: Checking all tickets every 5 minutes regardless of their actual SLA deadlines
2. **Resolution granularity**: Can only detect breaches within 5-minute windows
3. **No per-ticket orchestration**: Cannot wake up precisely when a specific ticket's threshold is about to be crossed
4. **Limited durability**: Job failures require re-scanning all tickets rather than resuming per-ticket workflows
5. **Business hours complexity**: Minute-by-minute iteration for business hours calculations is inefficient for long periods

For EE customers with large ticket volumes and strict SLA requirements, a Temporal-based approach provides:
- Per-ticket workflow orchestration with durable timers
- Precise threshold notifications timed to exact business-hours-adjusted deadlines
- Workflow state queries for real-time SLA status
- Automatic retry and recovery

## Goals

1. **EE: Temporal-based SLA workflows** — Create a dedicated Temporal workflow per ticket that sleeps until each SLA threshold and wakes to send notifications or escalate
2. **CE: Keep pgboss polling** — Maintain the existing `sla-timer` job for CE edition with no changes to functionality
3. **Unified service interface** — Abstract the backend choice behind a common interface so SLA services remain edition-agnostic
4. **Business hours-aware timers** — Both backends must correctly calculate wake times respecting business hours, holidays, and pause states
5. **Graceful degradation** — EE falls back to pgboss if Temporal is unavailable

## Non-goals

- Changing the SLA data model or database schema
- Modifying the existing SLA policy configuration UI
- Adding new notification channels beyond what exists
- Real-time WebSocket push for SLA status updates
- Historical SLA analytics or reporting changes
- Migration tooling for existing tickets (new tickets get workflows; existing tickets continue with polling)

## Users and Primary Flows

### Primary Users
- **MSP technicians**: See accurate SLA status badges and receive timely threshold notifications
- **Board managers**: Receive escalation notifications at configured thresholds
- **System administrators**: Configure SLA policies, business hours, and escalation rules

### Primary Flows

#### Flow 1: Ticket Created (EE with Temporal)
1. Ticket is created with SLA policy assigned
2. `slaService.startSlaForTicket()` is called
3. Service detects EE edition and starts a `SlaTicketWorkflow` via Temporal
4. Workflow calculates response/resolution deadlines considering business hours
5. Workflow sleeps until first threshold (e.g., 50% of response time)
6. On wake, sends notification and sleeps until next threshold
7. Continues until ticket is resolved or SLA is breached

#### Flow 2: Ticket Created (CE with pgboss)
1. Ticket is created with SLA policy assigned
2. `slaService.startSlaForTicket()` is called
3. Service detects CE edition and records deadlines in ticket record
4. Existing `sla-timer` pgboss job polls every 5 minutes
5. Job calculates elapsed percentage and sends notifications for crossed thresholds

#### Flow 3: SLA Paused/Resumed
1. Ticket status changes to one configured to pause SLA (or awaiting_client)
2. `slaPauseService.pauseSla()` is called
3. **EE**: Signal sent to workflow to pause; workflow records pause start and cancels pending timers
4. **CE**: `sla_paused_at` timestamp set; polling job skips paused tickets
5. On resume: **EE**: Signal sent; workflow recalculates remaining time and sets new timers. **CE**: `sla_total_pause_minutes` incremented; polling resumes

#### Flow 4: Ticket Resolved
1. Ticket is closed/resolved
2. `slaService.recordResolution()` is called
3. **EE**: Signal sent to workflow to complete; workflow records met/breached status and terminates
4. **CE**: SLA fields updated; polling job naturally excludes resolved tickets

## UX / UI Notes

No UI changes required. The SLA status badges and notifications work identically regardless of backend. The only user-facing difference is potentially more precise notification timing in EE.

## Requirements

### Functional Requirements

#### FR-1: Edition Detection and Routing
- [ ] Create `SlaBackendFactory` that returns appropriate backend based on edition
- [ ] Factory checks `isEnterprise` from `server/src/lib/features.ts`
- [ ] Returns `TemporalSlaBackend` for EE, `PgBossSlaBackend` for CE

#### FR-2: Common SLA Backend Interface
- [ ] Define `ISlaBackend` interface with methods:
  - `startSlaTracking(ticketId, policyId, targets, schedule)`: Start tracking for a ticket
  - `pauseSla(ticketId, reason)`: Pause SLA timer
  - `resumeSla(ticketId)`: Resume SLA timer
  - `completeSla(ticketId, type: 'response' | 'resolution', met: boolean)`: Complete response or resolution
  - `cancelSla(ticketId)`: Cancel SLA tracking (ticket deleted or policy removed)
  - `getSlaStatus(ticketId)`: Get current SLA status

#### FR-3: Temporal Workflow for EE (SlaTicketWorkflow)
- [ ] Create `sla-ticket-workflow.ts` in `ee/temporal-workflows/src/workflows/`
- [ ] Workflow input: ticket ID, tenant ID, policy targets, business hours schedule
- [ ] Workflow maintains state: current phase (response/resolution), pause state, notified thresholds
- [ ] Workflow uses Temporal timers (`sleep()`) to wake at threshold times
- [ ] On wake: send notification via activity, check for escalation, sleep until next threshold
- [ ] Support signals: `pause`, `resume`, `completeResponse`, `completeResolution`, `cancel`
- [ ] Support queries: `getState` (returns current status, remaining time, etc.)

#### FR-4: Business Hours Timer Calculation
- [ ] Create activity `calculateNextWakeTime(currentTime, targetTime, schedule, pauseMinutes)`
- [ ] Activity uses existing `businessHoursCalculator` logic
- [ ] Returns actual wall-clock time to sleep until, accounting for business hours
- [ ] Handles edge cases: start outside business hours, holidays, timezone changes

#### FR-5: Temporal Activities for SLA Operations
- [ ] `sendSlaNotification`: Sends threshold notification (reuses existing notification service)
- [ ] `checkAndEscalate`: Checks escalation thresholds and escalates if needed
- [ ] `updateSlaStatus`: Updates ticket SLA fields in database
- [ ] `recordSlaAuditLog`: Writes to sla_audit_log table

#### FR-6: pgboss Backend for CE
- [ ] Create `PgBossSlaBackend` implementing `ISlaBackend`
- [ ] `startSlaTracking`: No-op (deadlines already stored by slaService)
- [ ] `pauseSla`/`resumeSla`: Delegate to existing `slaPauseService`
- [ ] `completeSla`: Delegate to existing `slaService` methods
- [ ] Existing `sla-timer` job continues polling for threshold notifications

#### FR-7: Integration with Existing SLA Services
- [ ] Modify `slaService.startSlaForTicket()` to call backend's `startSlaTracking()`
- [ ] Modify `slaPauseService.pauseSla()`/`resumeSla()` to call backend methods
- [ ] Modify `slaService.recordFirstResponse()`/`recordResolution()` to signal backend

#### FR-8: Workflow Lifecycle Management
- [ ] Workflow ID format: `sla-ticket-{tenantId}-{ticketId}`
- [ ] On ticket deletion: cancel workflow if running
- [ ] On SLA policy change: cancel existing workflow and start new one
- [ ] Workflow gracefully handles duplicate starts (idempotent)

### Non-functional Requirements

#### NFR-1: Fallback Behavior
- [ ] EE with Temporal unavailable falls back to pgboss polling
- [ ] Log warning when fallback occurs
- [ ] Existing tickets continue with polling; new tickets also use polling until Temporal recovers

#### NFR-2: Workflow Durability
- [ ] Workflows survive Temporal worker restarts
- [ ] Workflow state reconstructed from Temporal history on replay

## Data / API / Integrations

### Database
No schema changes. Uses existing:
- `tickets` table: `sla_*` fields for tracking
- `sla_audit_log`: Audit trail
- `sla_policies`, `sla_policy_targets`: Policy configuration
- `business_hours_schedules`, `business_hours_entries`, `holidays`: Business hours

### Temporal Task Queue
- Queue name: `sla-workflows` (or reuse `alga-jobs` with workflow routing)
- Workflows: `SlaTicketWorkflow`
- Activities: `sla-activities` (notification, escalation, DB updates)

### Integration Points
- `@alga-psa/notifications`: For sending threshold notifications
- `@alga-psa/sla`: For business hours calculations
- `JobRunnerFactory`: For fallback to pgboss when Temporal unavailable

## Security / Permissions

No changes. Existing tenant isolation via `tenant` column and `runWithTenant()` context.

## Observability

- Temporal UI provides workflow visibility for debugging
- Existing logger calls in activities for audit trail
- Workflow queries allow real-time status inspection

## Rollout / Migration

### Phase 1: Backend Interface
1. Define `ISlaBackend` interface
2. Implement `PgBossSlaBackend` wrapping existing behavior
3. Wire up factory with CE-only support
4. Verify no behavioral changes

### Phase 2: Temporal Workflow Implementation
1. Create `SlaTicketWorkflow` and activities
2. Implement `TemporalSlaBackend`
3. Add EE branch to factory
4. Test in EE environment

### Phase 3: Integration
1. Integrate backend calls into existing SLA services
2. Handle pause/resume signals
3. Handle ticket resolution signals
4. Test full lifecycle

### Migration Strategy
- New tickets get workflows (EE) or polling (CE)
- Existing active tickets continue with polling (no migration needed)
- Workflows only started for tickets created after deployment

## Open Questions

1. **Q: Should we migrate existing active tickets to workflows?**
   A: No - too complex, let them naturally resolve via polling. Only new tickets get workflows.

2. **Q: How long should workflows remain after ticket resolution?**
   A: Workflow completes immediately on resolution. Temporal history retained per server config.

3. **Q: Should workflow query replace database reads for SLA status?**
   A: No - database remains source of truth. Workflow is for timer orchestration only.

## Acceptance Criteria (Definition of Done)

1. [ ] EE edition starts Temporal workflow for new tickets with SLA policies
2. [ ] Workflow wakes at correct business-hours-adjusted times for each threshold
3. [ ] Notifications sent at configured thresholds (50%, 75%, 90%, 100%)
4. [ ] Escalations triggered when thresholds crossed
5. [ ] Pause signal stops workflow timers; resume recalculates remaining time
6. [ ] Resolution signal completes workflow and records met/breached status
7. [ ] CE edition continues using pgboss polling with no changes
8. [ ] Fallback to pgboss works when Temporal unavailable in EE
9. [ ] Unit tests for backend interface and workflow logic
10. [ ] Integration test for full ticket SLA lifecycle in EE
