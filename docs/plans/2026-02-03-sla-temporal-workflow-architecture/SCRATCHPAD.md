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
