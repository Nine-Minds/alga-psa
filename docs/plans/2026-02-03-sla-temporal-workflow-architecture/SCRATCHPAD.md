# Scratchpad — SLA Temporal Workflow Architecture (CE/EE Split)

- Plan slug: `sla-temporal-workflow-architecture`
- Created: `2026-02-03`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-02-03) Use separate `ISlaBackend` interface rather than extending `IJobRunner` - SLA tracking has different semantics (signals, queries, per-ticket workflows) vs. generic job execution
- (2026-02-03) Don't migrate existing tickets - new tickets get workflows (EE) or polling (CE), existing continue with polling
- (2026-02-03) Database remains source of truth for SLA status - workflow is for timer orchestration only
- (2026-02-03) Workflow ID format `sla-ticket-{tenantId}-{ticketId}` allows easy lookup and ensures uniqueness
- (2026-02-03) Added `ISlaBackend` interface in `packages/sla/src/services/backends/ISlaBackend.ts` and exported via services index
- (2026-02-03) Added `SlaBackendFactory` in `packages/sla/src/services/backends/SlaBackendFactory.ts` to select EE vs CE backend using `server/src/lib/features.ts`
- (2026-02-03) Implemented `PgBossSlaBackend` to delegate pause/resume/complete/status operations via existing SLA services using tenant resolution helpers
- (2026-02-03) Added `sla-ticket-workflow.ts` with response/resolution phase tracking and threshold orchestration (Temporal)
- (2026-02-03) SLA workflow input includes ticketId, tenantId, policyTargets, and businessHoursSchedule
- (2026-02-03) SLA workflow state tracks phase, pause state, notified thresholds, and response/resolution deadlines
- (2026-02-03) SLA workflow uses Temporal sleep + condition race to wake at threshold times
- (2026-02-03) Pause signal sets pauseStartedAt and pauses timers via condition wake-up
- (2026-02-03) Resume signal clears pauseStartedAt, increments totalPauseMinutes, and triggers recalculation on next loop
- (2026-02-03) Complete response signal sets response complete and transitions workflow to resolution phase
- (2026-02-03) Complete resolution signal marks workflow completed and allows termination
- (2026-02-03) Cancel signal marks workflow cancelled and stops further threshold handling
- (2026-02-03) Added getState query returning status, remaining time minutes, and pause state
- (2026-02-03) Added SLA activities including calculateNextWakeTime using business hours calculator
- (2026-02-03) calculateNextWakeTime leverages calculateDeadline to advance into next business period when starting outside hours
- (2026-02-03) calculateNextWakeTime adds accumulated pause minutes to computed deadline
- (2026-02-03) sendSlaNotification activity delegates to slaNotificationService.sendSlaNotification
- (2026-02-03) checkAndEscalate activity calls escalationService check + escalate paths
- (2026-02-03) updateSlaStatus activity updates ticket SLA met fields on breach
- (2026-02-03) recordSlaAuditLog activity writes entries to sla_audit_log
- (2026-02-03) Implemented EE TemporalSlaBackend to start SLA ticket workflows via Temporal client
- (2026-02-03) Temporal workflow IDs follow `sla-ticket-{tenantId}-{ticketId}` format in TemporalSlaBackend
- (2026-02-03) TemporalSlaBackend pause/resume/complete/cancel methods signal workflows
- (2026-02-03) TemporalSlaBackend resume signals resume to workflows
- (2026-02-03) TemporalSlaBackend completes SLA phases via completeResponse/completeResolution signals
- (2026-02-03) TemporalSlaBackend cancelSla sends cancel signal to workflow
- (2026-02-03) TemporalSlaBackend getSlaStatus queries workflow state via getState
- (2026-02-03) slaService.startSlaForTicket now triggers backend.startSlaTracking after recording SLA start
- (2026-02-03) slaPauseService pause/resume now signal SLA backend unless skipBackend is set
- (2026-02-03) slaPauseService.resumeSla now signals backend resume by default
- (2026-02-03) slaService.recordFirstResponse now signals backend completeSla('response') unless skipped
- (2026-02-03) slaService.recordResolution now signals backend completeSla('resolution') unless skipped
- (2026-02-03) SlaBackendFactory falls back to PgBoss backend when Temporal backend load fails, with warning log
- (2026-02-03) Fallback path logs warning via core logger
- (2026-02-03) TemporalSlaBackend start is idempotent by ignoring duplicate workflow start errors
- (2026-02-03) Ticket deletion actions now cancel SLA backend workflows via SlaBackendFactory
- (2026-02-03) SLA policy change handling restarts backend workflows via handlePolicyChange in slaService and slaSubscriber
- (2026-02-03) SLA workflow sends threshold notifications at 50/75/90% and breaches at 100%, with escalation checks
- (2026-02-03) Temporal worker now includes `sla-workflows` task queue by default
- (2026-02-03) SLA ticket workflow exported in Temporal workflows index for worker registration
- (2026-02-03) SLA activities exported in Temporal activities index for worker registration
- (2026-02-03) Added CE stub TemporalSlaBackend that throws Enterprise-only error
- (2026-02-03) PgBossSlaBackend startSlaTracking remains a no-op for CE polling
- (2026-02-03) PgBossSlaBackend cancelSla remains a no-op for CE polling
- (2026-02-03) PgBossSlaBackend getSlaStatus delegates to slaService.getSlaStatus
- (2026-02-03) SLA workflow respects 24x7 schedules via business hours calculator
- (2026-02-03) Tests: added ISlaBackend interface signature test (T001)
- (2026-02-03) Tests: SlaBackendFactory returns PgBoss in CE (T002)
- (2026-02-03) Tests: SlaBackendFactory returns Temporal backend in EE when available (T003)
- (2026-02-03) Tests: SlaBackendFactory falls back to PgBoss when Temporal unavailable (T004)
- (2026-02-03) Tests: PgBossSlaBackend startSlaTracking no-op (T005)
- (2026-02-03) Tests: PgBossSlaBackend.pauseSla delegates to slaPauseService (T006)
- (2026-02-03) Tests: PgBossSlaBackend.resumeSla delegates to slaPauseService (T007)
- (2026-02-03) Tests: PgBossSlaBackend.completeSla(response) delegates to slaService.recordFirstResponse (T008)
- (2026-02-03) Tests: PgBossSlaBackend.completeSla(resolution) delegates to slaService.recordResolution (T009)
- (2026-02-03) Tests: PgBossSlaBackend.cancelSla no-op (T010)
- (2026-02-03) Tests: PgBossSlaBackend.getSlaStatus delegates to slaService (T011)
- (2026-02-03) Tests: SLA ticket workflow initialization and input coverage (T012-T024)
- (2026-02-03) Tests: SLA workflow initializes with input parameters (T012)
- (2026-02-03) Tests: SLA workflow initial state phase and thresholds (T013)
- (2026-02-03) Tests: SLA workflow threshold calculations include 50% (T014)
- (2026-02-03) Tests: SLA workflow threshold calculations include 75% (T015)
- (2026-02-03) Tests: SLA workflow threshold calculations include 90% (T016)
- (2026-02-03) Tests: SLA workflow threshold calculations include 100% (T017)
- (2026-02-03) Tests: SLA workflow pause signal sets pauseStartedAt (T018)
- (2026-02-03) Tests: SLA workflow resume clears pauseStartedAt and increments total pause minutes (T019)
- (2026-02-03) Tests: SLA workflow recalculates wake time after resume with pause minutes (T020)
- (2026-02-03) Tests: SLA workflow transitions to resolution on completeResponse (T021)
- (2026-02-03) Tests: SLA workflow terminates on completeResolution (T022)
- (2026-02-03) Tests: SLA workflow cancel signal terminates workflow (T023)
- (2026-02-03) Tests: SLA workflow getState query returns status/remaining time (T024)
- (2026-02-03) Tests: calculateNextWakeTime weekday schedule (T025)
- (2026-02-03) Tests: calculateNextWakeTime advances across weekend (T026)
- (2026-02-03) Tests: calculateNextWakeTime skips holidays (T027)
- (2026-02-03) Tests: calculateNextWakeTime handles recurring holidays (T028)
- (2026-02-03) Tests: calculateNextWakeTime accounts for pause minutes (T029)
- (2026-02-03) Tests: calculateNextWakeTime for 24x7 schedule (T030)
- (2026-02-03) Tests: sendSlaNotification activity calls notification service (T031)
- (2026-02-03) Tests: checkAndEscalate activity calls escalation check (T032)
- (2026-02-03) Tests: checkAndEscalate triggers escalation when needed (T033)
- (2026-02-03) Tests: updateSlaStatus updates response met field (T034)
- (2026-02-03) Tests: updateSlaStatus updates resolution met field (T035)
- (2026-02-03) Tests: recordSlaAuditLog inserts audit entry (T036)
- (2026-02-03) Tests: TemporalSlaBackend starts SLA workflow with correct ID (T037)
- (2026-02-03) Tests: TemporalSlaBackend workflow ID format validated (T038)
- (2026-02-03) Tests: TemporalSlaBackend.pauseSla sends pause signal (T039)
- (2026-02-03) Tests: TemporalSlaBackend.resumeSla sends resume signal (T040)
- (2026-02-03) Tests: TemporalSlaBackend.completeSla(response) signals workflow (T041)
- (2026-02-03) Tests: TemporalSlaBackend.completeSla(resolution) signals workflow (T042)
- (2026-02-03) Tests: TemporalSlaBackend.cancelSla sends cancel signal (T043)
- (2026-02-03) Tests: TemporalSlaBackend.getSlaStatus queries workflow state (T044)
- (2026-02-03) Tests: slaService.startSlaForTicket calls backend.startSlaTracking (T045)
- (2026-02-03) Tests: slaPauseService.pauseSla calls backend.pauseSla (T046)
- (2026-02-03) Tests: slaPauseService.resumeSla calls backend.resumeSla (T047)
- (2026-02-03) Tests: slaService.recordFirstResponse calls backend.completeSla(response) (T048)
- (2026-02-03) Tests: slaService.recordResolution calls backend.completeSla(resolution) (T049)
- (2026-02-03) Tests: TemporalSlaBackend handles duplicate workflow ID (T050)
- (2026-02-03) Tests: CE TemporalSlaBackend stub throws Enterprise-only error (T051)

## Discoveries / Constraints

- (2026-02-03) Current `sla-timer` pgboss job runs every 5 minutes per tenant
- (2026-02-03) Business hours calculator uses minute-by-minute iteration - inefficient for long periods
- (2026-02-03) Existing `JobRunnerFactory` pattern can be reused for `SlaBackendFactory`
- (2026-02-03) `isEnterprise` check in `server/src/lib/features.ts` is the edition detection source
- (2026-02-03) Temporal worker already supports multiple task queues - can add `sla-workflows` queue
- (2026-02-03) Generic job workflow pattern shows how to structure activities and signals
- (2026-02-03) TIMEZONE BUG INVESTIGATION NEEDED - User reported mismatch in time calculations

## Commands / Runbooks

- Run SLA tests: `cd packages/sla && npm test`
- Run Temporal worker locally: `docker compose -f docker-compose.temporal.ee.yaml up`
- Check Temporal UI: http://localhost:8088

## Links / References

- Current SLA services: `packages/sla/src/services/`
- Business hours calculator: `packages/sla/src/services/businessHoursCalculator.ts`
- SLA timer handler: `server/src/lib/jobs/handlers/slaTimerHandler.ts`
- Temporal workflows: `ee/temporal-workflows/src/workflows/`
- Job runner factory: `server/src/lib/jobs/JobRunnerFactory.ts`
- Edition detection: `server/src/lib/features.ts`
- Generic job workflow pattern: `ee/temporal-workflows/src/workflows/generic-job-workflow.ts`

## Open Questions

- What specific timezone issues have been observed? Need to investigate and document
- Should workflow query replace database reads for real-time SLA status display?
- How to handle Temporal worker scaling for high-volume tenants?

## Progress Log

- (2026-02-03) Added integration coverage for EE ticket start triggering Temporal workflow in `packages/sla/src/services/__tests__/slaBackendIntegration.test.ts` (T052).
- (2026-02-03) Added Temporal workflow integration test covering 50% notification threshold in `ee/temporal-workflows/src/workflows/__tests__/sla-ticket-workflow.integration.test.ts` (T053).
- (2026-02-03) Validated 75% SLA threshold notification via workflow integration test (T054).
- (2026-02-03) Validated 90% SLA threshold notification via workflow integration test (T055).
- (2026-02-03) Confirmed 100% threshold breach update via workflow integration test (T056).
- (2026-02-03) Verified escalation checks at each SLA threshold via workflow integration test (T057).
- (2026-02-03) Added integration coverage confirming pause stops SLA notifications until resume (T058).
- (2026-02-03) Verified resume recalculates timers with pause minutes in workflow integration test (T059).
- (2026-02-03) Confirmed completeResponse transitions workflow into resolution phase in integration lifecycle test (T060).
- (2026-02-03) Verified completeResolution terminates the workflow in integration lifecycle test (T061).
- (2026-02-03) Added ticket deletion test ensuring SLA workflow cancellation in `packages/tickets/src/actions/__tests__/ticketActions.sla.test.ts` (T062).
- (2026-02-03) Confirmed policy change cancels and restarts SLA backend in integration test (T063).
- (2026-02-03) Verified CE ticket start avoids Temporal backend in integration test (T064).
- (2026-02-03) Added slaTimerHandler integration test confirming polling path still processes tickets (T065).
- (2026-02-03) Added worker registration test validating workflow export for Temporal startup (T066).
- (2026-02-03) Confirmed SLA activities are exported for worker startup (T067).
- (2026-02-03) Added full EE SLA lifecycle workflow integration test with pause/resume and resolution notifications (T068).
- (2026-02-03) Added CE lifecycle test covering create, poll notification, pause/resume, response, and resolution in `packages/sla/src/services/__tests__/slaCeLifecycle.test.ts` (T069).
- (2026-02-03) Verified EE fallback to PgBoss backend when Temporal is unavailable in integration test (T070).
