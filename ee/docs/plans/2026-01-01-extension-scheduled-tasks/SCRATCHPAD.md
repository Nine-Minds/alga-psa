# Scratchpad — Extension scheduled tasks (endpoint-based)

- Plan slug: `extension-scheduled-tasks`
- Created: `2026-01-01`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-01-01) Schedules invoke *manifest-declared API endpoints* (method+path) using the existing Runner `/v1/execute` HTTP-shaped payload, rather than introducing a new “scheduled handler” ABI.
- (2026-01-01) Schedules reference endpoints by `endpoint_id` (normalized endpoint table) for stronger guarantees; extension version updates remap schedules by matching `(method,path)` and are blocked if remapping fails (unless explicitly overridden).
- (2026-01-01) No DB cascades (Citus constraints). All cleanup (uninstall/delete/update) is performed in application/business logic.
- (2026-01-01) Extension version updates use a remap-by-(method,path) step; if any schedule cannot be remapped, the update returns a 409 conflict (`SCHEDULE_REMAP_FAILED`) unless `disableMissingSchedules=true` is provided.
- (2026-01-01) Schedule CRUD and execution controls require `extension:read` / `extension:write` permissions (consistent with extension settings access).

## Discoveries / Constraints

- (2026-01-01) Gateway → Runner request today always uses `{ context, http, limits, providers?, secret_envelope?, user? }` (`server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`).
- (2026-01-01) EE install config is available via `getInstallConfig` / `getInstallConfigByInstallId` (`ee/server/src/lib/extensions/installConfig.ts`).
- (2026-01-01) Job runner abstraction supports cron recurrence in both backends:
  - Temporal schedules in EE (`ee/server/src/lib/jobs/runners/TemporalJobRunner.ts`)
  - PG Boss schedules in CE (`server/src/lib/jobs/runners/PgBossJobRunner.ts`)
- (2026-01-01) Registry v2 currently stores endpoints in `extension_version.api_endpoints` (JSON) and has an older facade reading `extension_version.api`; we should standardize endpoint storage to avoid drift.
- (2026-01-01) Temporal schedule creation now passes `timezoneName` (when available) from schedule metadata; PG Boss ignores timezone.
- (2026-01-01) v1 cron validation is restricted to 5-field crons and blocks overly-frequent (every-minute) schedules; schedulable endpoints exclude path params and restrict to GET/POST.
- (2026-01-01) Citus: `tenant_extension_schedule` is distributed by `tenant_id`; `extension_api_endpoint` must be a Citus reference table to support distributed joins in schedule list queries.

## Commands / Runbooks

- Validate plan artifacts: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-01-01-extension-scheduled-tasks`
- Run Vitest schedules integration tests: `cd ee/server && npx vitest run src/__tests__/integration/extension-schedules.actions.integration.test.ts`
- Run Playwright schedules UI test: `cd ee/server && PW_REUSE=false npx playwright test src/__tests__/integration/extension-schedules.playwright.test.ts --project=chromium --reporter=list`

## Links / References

- Extension settings UI: `ee/server/src/components/settings/extensions/ExtensionSettings.tsx`
- Gateway Runner invoke contract: `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`
- EE install config lookup: `ee/server/src/lib/extensions/installConfig.ts`
- Job runner abstraction: `server/src/lib/jobs/interfaces/IJobRunner.ts`
- Schedule actions: `ee/server/src/lib/actions/extensionScheduleActions.ts`
- Extension update API: `ee/server/src/app/api/v1/extensions/update/route.ts`

## Tests / Implementation Notes

- (2026-01-01) Added Vitest integration coverage for endpoint materialization + schedule CRUD + run-now + rate limiting:
  - `ee/server/src/__tests__/integration/extension-schedules.actions.integration.test.ts`
- (2026-01-01) Fixed schedule action validation errors to return `{ success:false, fieldErrors }` instead of throwing (cron/timezone/uuid validation).
- (2026-01-01) Fixed endpoint materialization to de-dupe within a batch by `(method,path)` to avoid Postgres `ON CONFLICT DO UPDATE command cannot affect row a second time`.
- (2026-01-01) Updated `ee/server/vitest.config.ts` aliases so Vitest can resolve mixed EE + CE path patterns used by the extension subsystem.
- (2026-01-01) Fixed `extRegistryV2Actions.ts` to only export async functions (Next.js server action restriction) by making helper types non-exported.
- (2026-01-01) Added Vitest integration coverage for scheduled invocation handler behavior (payload shaping, errors, timeout, no-overlap, endpoint-missing disable policy):
  - `ee/server/src/__tests__/integration/extension-scheduled-invocation.handler.integration.test.ts`
- (2026-01-01) Adjusted scheduled invocation handler to:
  - Use transaction-scoped advisory locks to enforce no-overlap without pooled-connection reentrancy issues.
  - Persist `last_run_*` fields even when execution fails (avoid transaction rollback losing the update).
  - Disable schedules when `endpoint_id` is broken/missing (policy).
- (2026-01-01) Added Vitest integration coverage for extension v2 update/remap behavior (block vs override + disable only missing + recreate runner schedules when handles missing):
  - `ee/server/src/__tests__/integration/extension-schedule-remap.integration.test.ts`
- (2026-01-01) Tightened schedule input validation to match policy and improve UX:
  - Reject cron when both DOM + DOW are set.
  - Require payload to be JSON object/array and enforce size limit.
  - Validate schedule name length and surface unique-name violations as field errors.
  - Reject schedule creation when extension install is disabled.
- (2026-01-01) Added unit coverage for Temporal runner schedule creation semantics (singletonKey => scheduleId, timezoneName):
  - `ee/server/src/__tests__/unit/temporalJobRunner.scheduleRecurringJob.test.ts`
- (2026-01-01) Added integration coverage for uninstall/toggle cleanup behavior (cancel jobs + delete schedules, pause/resume on extension enable/disable):
  - `ee/server/src/__tests__/integration/extension-schedule-cleanup.integration.test.ts`
- (2026-01-01) Added runner response size guardrail via `EXT_RUNNER_MAX_RESPONSE_BYTES` (default `262144`) and integration test coverage:
  - `server/src/lib/jobs/handlers/extensionScheduledInvocationHandler.ts`
  - `ee/server/src/__tests__/integration/extension-scheduled-invocation.handler.integration.test.ts`
- (2026-01-01) Expanded schedule actions integration coverage to include stable endpoint IDs/handler field and run-now disabled policy:
  - `ee/server/src/__tests__/integration/extension-schedules.actions.integration.test.ts`
- (2026-01-01) Stabilized Playwright schedule toggle assertions by polling DB state instead of fixed sleeps:
  - `ee/server/src/__tests__/integration/extension-schedules.playwright.test.ts`
- (2026-01-01) Added strict assertion that scheduled invocation does not inject extra headers into runner `http.headers` payload:
  - `ee/server/src/__tests__/integration/extension-scheduled-invocation.handler.integration.test.ts`
- (2026-01-01) Made schedule create/update/delete transactional with runner scheduling/cancellation (atomic failure semantics):
  - `ee/server/src/lib/actions/extensionScheduleActions.ts`
  - `ee/server/src/__tests__/integration/extension-schedules.actions.integration.test.ts`
- (2026-01-01) Defaulted schedule timezone input to current user's timezone (fallback UTC) and added Playwright coverage:
  - `ee/server/src/lib/actions/extensionScheduleActions.ts`
  - `ee/server/src/components/settings/extensions/ExtensionSettings.tsx`
  - `ee/server/src/__tests__/integration/extension-schedules.playwright.test.ts`

## Open Questions

- Tenant timezone source of truth (DB field? settings?).
- Policy on extension update when schedules can’t be remapped: block vs allow with forced disable.
  - Current v1 behavior: disallow selecting endpoints with path params; only allow static paths.
