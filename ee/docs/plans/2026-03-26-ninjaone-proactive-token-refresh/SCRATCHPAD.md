# Scratchpad — NinjaOne Proactive Token Refresh

- Plan slug: `ninjaone-proactive-token-refresh`
- Created: `2026-03-26`

## What This Is

Rolling notes for implementing per-integration proactive NinjaOne OAuth token refresh scheduling through Temporal.

## Decisions

- (2026-03-26) Use per-integration delayed Temporal refresh scheduling rather than a global scanner.
- (2026-03-26) Keep existing lazy refresh in `NinjaOneClient` as fallback; proactive refresh reduces user-facing failures but does not replace request-time safety checks.
- (2026-03-26) Treat terminal provider responses like `invalid_token` as reconnect-required lifecycle failures, not ordinary sync failures.
- (2026-03-26) Store proactive lifecycle state in `rmm_integrations.settings.tokenLifecycle` (non-secret metadata only) with a monotonic `scheduleNonce` and `activeWorkflowId` so stale scheduled workflows safely no-op.
- (2026-03-26) Use one-off delayed workflows (`startDelay`) on the existing `TEMPORAL_JOB_TASK_QUEUE` (`alga-jobs` default) and terminate prior active workflow handles during reschedule to keep at most one active future refresh.
- (2026-03-26) Consider NinjaOne refresh failures terminal when provider response indicates invalid refresh token (`400 invalid_token` / `invalid_grant`), mark reconnect-required, and stop rescheduling until reconnect.

## Discoveries / Constraints

- (2026-03-26) Current NinjaOne credentials are stored only in tenant secret storage under `ninjaone_credentials`; `rmm_integrations` does not currently store OAuth expiry.
- (2026-03-26) Production logs from `msp/temporal-worker-868df5f5fb-g2744` showed a new organization sync starting at `2026-03-26T19:00:19.652Z`.
- (2026-03-26) Production logs from `msp/temporal-worker-868df5f5fb-jbrx9` showed the sync failing during token refresh at `2026-03-26T19:00:20.071Z` with `400 Bad Request`, `ERR_BAD_REQUEST`, and `data: { error: 'invalid_token' }` from `https://ca.ninjarmm.com/oauth/token`.
- (2026-03-26) That proves NinjaOne refresh is already attempted inside the Temporal worker during sync execution, but only on demand.
- (2026-03-26) The current code already emits `INTEGRATION_TOKEN_EXPIRING` and `INTEGRATION_TOKEN_REFRESH_FAILED`, but no code currently schedules a future refresh off those signals.
- (2026-03-26) `ee/temporal-workflows` imports `ee/server` NinjaOne integration code at runtime; avoid `@/` aliases in shared NinjaOne modules and prefer relative imports so temporal workspace compilation can resolve modules consistently.
- (2026-03-26) Local test/typecheck execution is currently environment-limited by missing workspace deps (e.g. `pathe`, `knex`, `@temporalio/*` resolution in this checkout), so verification is restricted to static inspection and targeted test file creation in this run.

## Commands / Runbooks

- (2026-03-26) Confirm current NinjaOne refresh implementation:
  - `rg -n "refreshAccessToken\\(|grant_type: 'refresh_token'|oauth/token" ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`
- (2026-03-26) Confirm NinjaOne sync workflow entrypoints:
  - `rg -n "ninjaOneSyncWorkflow|syncOrganizations" ee/server/src/lib/integrations/ninjaone/sync ee/temporal-workflows/src/workflows ee/temporal-workflows/src/activities`
- (2026-03-26) Inspect recent MSP Temporal worker logs:
  - `kubectl -n msp logs temporal-worker-868df5f5fb-g2744 -c temporal-worker --since=10m --timestamps`
  - `kubectl -n msp logs temporal-worker-868df5f5fb-jbrx9 -c temporal-worker --since=10m --timestamps`
- (2026-03-26) Validate plan artifacts:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-26-ninjaone-proactive-token-refresh`
- (2026-03-26) Validate new proactive scheduling implementation references:
  - `rg -n "ninjaone-token-refresh|ninjaOneProactiveTokenRefreshWorkflow|proactiveNinjaOneTokenRefreshActivity|scheduleNinjaOneProactiveRefresh" ee/server/src ee/temporal-workflows/src`
- (2026-03-26) Attempt targeted tests (blocked by missing local dependency graph):
  - `cd ee/server && npm run test:unit -- src/__tests__/unit/ninjaoneProactiveRefresh.schedule.test.ts src/__tests__/unit/ninjaOneClient.baseUrl.test.ts`
  - `cd ee/temporal-workflows && npm run test -- src/__tests__/worker-registration.test.ts`
- (2026-03-26) Attempt type checks (blocked by pre-existing missing modules in workspace bootstrap):
  - `cd ee/server && npm run typecheck`
  - `cd ee/temporal-workflows && npm run type-check`

## Implementation Notes

- (2026-03-26) Added new server lifecycle module: `ee/server/src/lib/integrations/ninjaone/proactiveRefresh.ts`
  - Computes refresh target using configurable buffer/min-delay.
  - Starts delayed Temporal workflow per integration and records lifecycle metadata in `settings.tokenLifecycle`.
  - Reloads latest credentials on execution, refreshes token, persists rotated credentials, updates lifecycle metadata, and reschedules next refresh.
  - Marks terminal failures reconnect-required and prevents further scheduling until reconnect.
  - Marks unreadable/missing credentials unschedulable with explicit lifecycle failure metadata.
- (2026-03-26) Added dedicated Temporal pair:
  - Workflow: `ee/temporal-workflows/src/workflows/ninjaone-token-refresh-workflow.ts`
  - Activity: `ee/temporal-workflows/src/activities/ninjaone-token-refresh-activities.ts`
  - Exported from workflow/activity indexes and worker-registration coverage.
- (2026-03-26) Wired scheduling hooks:
  - OAuth callback now clears reconnect-required state and seeds proactive refresh schedule after successful connect/reconnect.
  - Lazy refresh success in `NinjaOneClient.refreshAccessToken` now reschedules proactive workflow.
  - Disconnect action now cancels/inactivates pending proactive refresh workflow lifecycle.
- (2026-03-26) Added unit test coverage:
  - `ee/server/src/__tests__/unit/ninjaoneProactiveRefresh.schedule.test.ts` verifies delayed scheduling on connect path semantics and previous-workflow termination during reschedule.
- (2026-03-26) Added proactive execution/backfill tests:
  - `ee/server/src/__tests__/unit/ninjaoneProactiveRefresh.execution.test.ts`
    - verifies runtime credential reload from secret storage;
    - verifies rotated credential persistence;
    - verifies successful proactive refresh reschedules next workflow and increments lifecycle nonce;
    - verifies terminal `invalid_token` marks reconnect-required and avoids further scheduling;
    - verifies missing credentials become unschedulable without reschedule loop;
    - verifies integration settings lifecycle metadata excludes raw token material.
  - `ee/temporal-workflows/src/schedules/__tests__/setupSchedules.ninjaone-backfill.test.ts`
    - verifies rollout backfill seeding runs for active integrations lacking lifecycle ownership and skips reconnect-required/already-owned lifecycle rows.
- (2026-03-26) Added lazy fallback schedule handoff test:
  - `ee/server/src/__tests__/unit/ninjaOneClient.proactiveSchedule.test.ts`
    - verifies successful lazy NinjaOne token refresh triggers proactive reschedule (`source: lazy_refresh_success`) for the same integration.
- (2026-03-26) Expanded proactive suite coverage:
  - `ee/server/src/__tests__/unit/ninjaoneProactiveRefresh.execution.test.ts`
    - includes inactive integration no-op assertions for disconnect protection semantics.
  - `ee/server/src/__tests__/unit/ninjaoneProactiveRefresh.schedule.test.ts`
    - includes reconnect lifecycle reset + fresh schedule seeding assertions.
  - `ee/temporal-workflows/src/workflows/__tests__/ninjaone-token-refresh-workflow.test.ts`
    - verifies structured workflow start/success logs contain tenant/integration/schedule context.
- (2026-03-26) Added rollout backfill implementation in Temporal startup schedule bootstrap (`setupSchedules`) that seeds proactive NinjaOne refresh for active integrations without active lifecycle ownership.
- (2026-03-26) Added proactive refresh failure event publication (`INTEGRATION_TOKEN_REFRESH_FAILED`) in proactive path so failures are visible outside worker logs.

## Links / References

- NinjaOne client refresh implementation: `ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`
- NinjaOne sync strategy: `ee/server/src/lib/integrations/ninjaone/sync/syncStrategy.ts`
- NinjaOne OAuth callback: `ee/server/src/app/api/integrations/ninjaone/callback/route.ts`
- Temporal schedules bootstrap: `ee/temporal-workflows/src/schedules/setupSchedules.ts`
- Temporal delayed scheduling patterns: `ee/server/src/lib/jobs/runners/TemporalJobRunner.ts`
- NinjaOne proactive refresh plan: `ee/docs/plans/2026-03-26-ninjaone-proactive-token-refresh/PRD.md`
- Official NinjaOne public API docs: `https://www.ninjaone.com/docs/application-programming-interface-api/public-api-operations/`
- Official NinjaOne OAuth configuration docs: `https://www.ninjaone.com/docs/application-programming-interface-api/oauth-token-configuration/`

## Open Questions

- Should lifecycle metadata live in `rmm_integrations.settings` or a dedicated table if we need stronger scheduling introspection later?
- Should a reconnect-required token failure also write `sync_error`, or should it be tracked separately to avoid conflating token lifecycle state with sync state?
