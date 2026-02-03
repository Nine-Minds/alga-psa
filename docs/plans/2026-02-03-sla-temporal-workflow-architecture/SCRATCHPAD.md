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
