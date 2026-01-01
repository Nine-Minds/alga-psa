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

## Links / References

- Extension settings UI: `ee/server/src/components/settings/extensions/ExtensionSettings.tsx`
- Gateway Runner invoke contract: `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`
- EE install config lookup: `ee/server/src/lib/extensions/installConfig.ts`
- Job runner abstraction: `server/src/lib/jobs/interfaces/IJobRunner.ts`
- Schedule actions: `ee/server/src/lib/actions/extensionScheduleActions.ts`
- Extension update API: `ee/server/src/app/api/v1/extensions/update/route.ts`

## Open Questions

- Tenant timezone source of truth (DB field? settings?).
- Policy on extension update when schedules can’t be remapped: block vs allow with forced disable.
  - Current v1 behavior: disallow selecting endpoints with path params; only allow static paths.
