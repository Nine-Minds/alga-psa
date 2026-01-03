# PRD — Extension scheduled tasks (endpoint-based)

- Slug: `extension-scheduled-tasks`
- Date: `2026-01-01`
- Status: Draft

## Summary
Add “scheduled tasks” for EE extensions by allowing tenant admins to configure cron-based schedules that invoke a *manifest-declared API endpoint* on an installed extension, without requiring an external caller.

Implementation approach:
- Schedules are configured in the extension settings UI and via APIs.
- Each schedule points to an `endpoint_id` in a normalized endpoint table (strong guarantees).
- At runtime, a scheduler invokes the Runner using the existing `/v1/execute` contract with a synthetic `http` payload.
- When an extension install is updated to a new version, schedules are remapped to the new version’s endpoints by matching `(method,path)`; updates are blocked if any schedule cannot be remapped (unless explicitly overridden by admin action).
- All cleanup is handled via business logic (no DB cascades; Citus constraints).

## Problem
Extensions often need to “do something periodically” (sync, reconciliation, refresh caches, send reminders, pull from external systems). Today, extensions can only run when the host receives an HTTP request to `/api/ext/[extensionId]/[[...path]]`, which requires an external trigger.

We need a first-party, tenant-scoped scheduling mechanism that:
- Works with the Runner/Gateway execution model (out-of-process WASM execution)
- Uses existing install-scoped config/providers/secrets
- Is observable, auditable, and controllable by tenant admins
- Behaves predictably across extension version upgrades

## Goals
- Allow tenant admins to create/edit/enable/disable scheduled invocations for an installed extension.
- Schedules invoke a selected endpoint from the extension’s manifest-declared endpoint list (method + path), using the same Runner execute pipeline as HTTP gateway invocations.
- Provide safe, tenant-scoped controls: “run now”, view next run, view last run, view history/status.
- Remap schedules on extension update when possible; block version updates when scheduled endpoints are removed/changed (per policy).
- Enforce platform constraints: job runner abstraction (Temporal in EE), no cascades, clean deletion, and full tenant isolation.

## Non-goals
- General event bus / arbitrary “events” delivery to extensions (this plan uses synthetic HTTP invocations).
- Extension-defined dynamic schedule creation via host APIs (e.g., `alga.scheduler.register`).
- Sub-minute, high-frequency scheduling and/or large-scale fanout scheduling without explicit quota/limits work.
- A full UI for complex parameter schemas per endpoint (optional “body template” can be added later).

## Users and Primary Flows
Primary persona: MSP / tenant admin configuring an extension install.

### Flow: Create a schedule
1. Admin opens `Settings → Extensions → <Extension> → Settings`.
2. Admin navigates to “Schedules” section.
3. Admin clicks “Add schedule”.
4. Admin selects an endpoint (method + path) from a dropdown sourced from the installed version’s manifest endpoints.
5. Admin sets schedule (cron + timezone), optional payload, and enables it.
6. System creates a durable schedule in the job runner and persists schedule configuration.

### Flow: Run now
1. Admin clicks “Run now” on a schedule.
2. System immediately triggers an execution using the same endpoint settings; execution is logged and visible in schedule history.

### Flow: Update extension version (with schedules)
1. Admin updates the extension install to a new version.
2. System attempts to remap schedules to new version endpoints by matching `(method,path)`.
3. If all schedules remap, update succeeds.
4. If any scheduled endpoint is missing, update is blocked with a clear list of affected schedules; admin can either edit schedules to valid endpoints or explicitly disable affected schedules and proceed (policy-dependent).

## UX / UI Notes
- Extension settings UI (`ee/server/src/components/settings/extensions/ExtensionSettings.tsx`) gains a “Schedules” card/section:
  - List schedules: name (optional), enabled, endpoint (method + path), cron + timezone, last run status, next run time (best-effort), actions (Run now / Edit / Disable / Delete).
  - Create/edit modal or inline form:
    - Endpoint dropdown: sourced from `extension_api_endpoint` for the current installed `version_id`.
    - Cron string input with validation feedback.
    - Timezone selector (defaults to tenant timezone if available; fallback UTC).
    - Optional JSON payload body (validated) and optional “headers” (likely restricted / optional).
  - Upgrade-block UX: if extension update is blocked due to missing endpoints, present explicit list and remediation actions.

## Requirements

### Functional Requirements
#### Endpoint materialization
- Persist each version’s manifest-declared endpoints into a normalized DB table (one row per `{version_id, method, path}`), producing stable `endpoint_id` values.
- Provide an API to list endpoints for an installed extension (current version).

#### Schedule CRUD and execution
- Create schedule for a tenant extension install:
  - Inputs: `install_id`, `endpoint_id`, `cron`, `timezone`, `enabled`, optional `payload_json`.
  - Output: schedule record including durable runner schedule id and/or associated job id.
- Update schedule (including changing endpoint and schedule expression).
- Enable/disable schedule without deleting configuration.
- Delete schedule:
  - Must delete the underlying durable schedule (Temporal schedule / PG Boss schedule) and remove DB records.
- Run schedule immediately (“run now”):
  - Must execute using the same endpoint selection and record execution.

#### Remap on extension update
- When changing the installed `version_id` for a tenant install, attempt to remap schedules:
  - For each schedule, determine old endpoint’s `(method,path)`.
  - Find matching endpoint in the new version by `(method,path)`.
  - Update schedule rows to the new `endpoint_id` if found.
- If any schedule cannot remap, block the version update (default policy), returning a structured error with affected schedule ids.
- Provide a controlled override action to proceed by disabling affected schedules (optional but recommended for usability).

#### Cleanup (no cascades)
- On uninstall/disable/tenant cleanup, delete schedules and any derived job runner resources via business logic.
- On version deletion or registry cleanup, delete `extension_api_endpoint` rows via business logic (no DB cascade assumptions).

### Non-functional Requirements
- Tenant isolation: all schedule operations scoped to a tenant and install.
- Reliability: schedules are durable (Temporal schedules in EE), at-least-once execution semantics.
- Safety: cron frequency limits and per-tenant caps to prevent abuse.
- Idempotency: each run has a stable invocation id; “run now” uses idempotency keys to avoid accidental duplicates.
- Backpressure: no overlapping execution per schedule by default (configurable later).

## Data / API / Integrations
### Proposed schema (EE registry/admin DB)
New table: `extension_api_endpoint`
- `id` (uuid)
- `version_id` (FK-like reference to `extension_version.id`; enforced in application logic as needed)
- `method` (string; normalized)
- `path` (string; normalized)
- `handler` (string)
- `created_at`, `updated_at`
- Unique constraint: `(version_id, method, path)`

New table: `tenant_extension_schedule`
- `id` (uuid)
- `install_id` (uuid; references `tenant_extension_install.id` via business logic)
- `tenant_id` (string; duplicated for query locality + enforcement)
- `endpoint_id` (uuid; references `extension_api_endpoint.id` via business logic)
- `name` (string nullable)
- `cron` (string)
- `timezone` (string)
- `enabled` (bool)
- `payload_json` (jsonb nullable) — request body template for synthetic HTTP invocation
- `job_id` (uuid/string nullable) — if we store our own job record association
- `runner_schedule_id` (string nullable) — external schedule id for Temporal/pgboss (if not using `jobs` table)
- `last_run_at`, `last_run_status`, `last_error` (nullable)
- `created_at`, `updated_at`, `deleted_at` (optional soft delete)

Execution logs can reuse/extend `extension_execution_log` and/or add `schedule_id` to correlate runs.

### APIs (EE)
- List endpoints for install (current version): `GET /api/extensions/{extensionId}/endpoints` (tenant-scoped; uses install resolution to find version)
- Schedule CRUD:
  - `GET /api/extensions/{extensionId}/schedules`
  - `POST /api/extensions/{extensionId}/schedules`
  - `PATCH /api/extensions/{extensionId}/schedules/{scheduleId}`
  - `POST /api/extensions/{extensionId}/schedules/{scheduleId}/run-now`
  - `DELETE /api/extensions/{extensionId}/schedules/{scheduleId}`
- Install update/remap hooks live in install/update service layer (not only UI).

### Execution payload to Runner
Use existing `/v1/execute` request body format with synthetic `http`:
- `http.method` and `http.path` come from selected endpoint
- `http.body_b64` comes from `payload_json` serialized as JSON (if provided)
- `context` includes `schedule_id`, `scheduled_for`, `trigger = "schedule"` (field naming TBD, but must be present for logs/metrics)

## Security / Permissions
- Only users with extension admin privileges can manage schedules (align with extension settings permissions).
- Validate that `endpoint_id` belongs to the installed version’s `version_id` (or the remapped version when updating).
- Restrict which headers can be injected for scheduled calls (default: none; use payload + config/secrets instead).
- Apply quotas/limits for schedules (per tenant/per install):
  - max schedules per install
  - min interval / cron frequency guardrails
  - max “run now” rate

## Observability
- Log schedule CRUD actions (who changed what; audit trail).
- Log each scheduled invocation with:
  - `schedule_id`, `install_id`, `registry_id`, `version_id`, `content_hash`
  - execution start/finish, status, error summary
- Expose metrics: runs, failures, duration, retries, skipped/disabled counts.

## Rollout / Migration
- Add new DB tables via EE migration.
- Backfill endpoints for existing versions:
  - Either on first access (lazy materialization) or via a one-time backfill job.
- Feature flag the UI section initially (optional).
- Ship read-only endpoint listing first, then schedule creation, then update/remap enforcement.

## Open Questions
- How do we surface tenant timezone today (and where is it stored)?
- Should update be blocked by default, or should we default to “disable affected schedules and proceed” with explicit confirmation?
- How should we handle endpoints with path params for schedules (e.g., `/things/:id`)? (Likely prohibit selection or require static substitutions/payload template.)
- Do we allow a per-schedule request body template only, or also query string?
- Do we need “next run time” calculation in-app (cron parser) or via job runner introspection only?

## Acceptance Criteria (Definition of Done)
- A tenant admin can create a scheduled task for an installed extension by selecting a manifest endpoint, providing cron/timezone, and enabling it.
- Scheduled tasks execute through the existing Runner `POST /v1/execute` pathway using synthetic HTTP payloads, with install-scoped config/providers/secrets applied.
- Admin can run-now/disable/delete schedules; deletion cleans up job runner schedules and DB records (no cascades).
- Extension version update attempts remap schedules by `(method,path)`; update is blocked when any schedule cannot be remapped (with clear error details and remediation path).
- Endpoint dropdown is sourced from stored endpoints for the currently installed version, not hard-coded.
- Logging/metrics provide visibility into schedule runs and failures.
