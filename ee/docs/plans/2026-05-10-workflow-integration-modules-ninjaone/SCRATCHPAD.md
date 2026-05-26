# Scratchpad — Workflow Integration Modules: NinjaOne First Pass

- Plan slug: `2026-05-10-workflow-integration-modules-ninjaone`
- Created: `2026-05-10`

## What This Is

Rolling notes for adding first-party workflow integration modules and the first NinjaOne workflow module/actions.

## Decisions

- (2026-05-10) Use a first-party workflow integration module registry instead of only action-prefix grouping. Rationale: integrations need tenant availability, icon/logo metadata, default action, and future extensibility without hardcoding each integration into the generic designer.
- (2026-05-10) Define NinjaOne “in use” as an active `rmm_integrations` row with `provider = 'ninjaone'`, `is_active = true`, and non-null `connected_at`.
- (2026-05-10) First pass will implement a mixed NinjaOne action set: find/list device, sync single device, reboot device, list active alerts, get alert, acknowledge alert.
- (2026-05-10) Do not add `ninjaone.alerts.create_ticket`. Users should chain NinjaOne alert outputs into the generic Ticket module (`tickets.create`, etc.). This keeps PSA ticket behavior generic and avoids duplicated ticket rules.
- (2026-05-10) Label `ninjaone.alerts.reset` as **Acknowledge alert** in the UI. The technical action ID can reflect the NinjaOne API reset operation, but users should see MSP/operator terminology.
- (2026-05-10) Any workflow editor can add/use NinjaOne workflow actions. No extra integration/action permission gate in this pass.

## Discoveries / Constraints

- (2026-05-10) Review follow-up fixed package typecheck failures caused by Vitest `vi.mock` third-argument usage for `@alga-psa/db/workDate`; the package export exists, so the virtual flag was unnecessary.
- (2026-05-10) Review follow-up fixed NinjaOne handler guards: local device query no longer references nonexistent `assets.hostname`, alert DB reads/updates are scoped by `integration_id`, timestamp outputs are normalized to ISO strings, and device IDs are coerced/validated as positive integers before side-effect calls.
- (2026-05-10) Existing action catalog builder lives at `shared/workflow/runtime/designer/actionCatalog.ts` and already groups unknown action prefixes into `tileKind: 'app'` records.
- (2026-05-10) Existing designer catalog endpoint is backed by `listWorkflowDesignerActionCatalogAction` in `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`.
- (2026-05-10) Existing app filtering only checks enabled extension installs via `tenant_extension_install` and `extension_registry`; it does not handle first-party integration availability.
- (2026-05-10) Current Workflow Designer icon mapping lives in `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` in `getPaletteIcon`.
- (2026-05-10) NinjaOne integration code already exists under `ee/server/src/lib/integrations/ninjaone/`, including `ninjaOneClient.ts`, `sync/syncEngine.ts`, and alert/webhook handling.
- (2026-05-10) `rmm_integrations` schema includes `provider`, `is_active`, `connected_at`, `instance_url`, sync status fields, and tenant-scoped uniqueness on `(tenant, provider)`.
- (2026-05-10) Temporal activities import workflow runtime from `@alga-psa/workflows/runtime/core`, so worker/runtime bootstrap must be considered carefully when adding EE/server-only NinjaOne registrations.

## Commands / Runbooks

- (2026-05-10) Initial context commands used:
  - `rg "WorkflowDesignerCatalog|actionCatalog|buildWorkflowDesignerActionCatalog|workflow module" -n server ee shared packages`
  - `rg "loadAvailableWorkflowDesignerAppKeys|availableAppKeys|integration" ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts server/src ee/server shared -n`
  - `rg "rmm_integrations|ninjaone|quickbooks|xero|email_providers|calendar_providers|microsoft_profiles" ee/server/migrations server/migrations packages -n`
  - `rg "NinjaOne|ninjaone|remote|device|alert|webhook|rmm" ee/server/src/lib/integrations/ninjaone packages/integrations/src/actions/integrations packages/integrations/src/lib/rmm -n`

## Links / References

- `shared/workflow/runtime/registries/actionRegistry.ts`
- `shared/workflow/runtime/designer/actionCatalog.ts`
- `shared/workflow/runtime/init.ts`
- `ee/packages/workflows/src/runtime/bootstrap.ts`
- `ee/packages/workflows/src/runtime/worker.ts`
- `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- `server/src/app/api/workflow/registry/designer-catalog/route.ts`
- `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- `ee/server/src/components/workflow-designer/GroupedActionConfigSection.tsx`
- `server/migrations/20251124000001_create_rmm_integration_tables.cjs`
- `ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`
- `ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts`
- `ee/server/src/lib/integrations/ninjaone/alerts/alertProcessor.ts`

## Open Questions

- Should the first pass render a true NinjaOne SVG/logo asset, or is a `ninjaone` icon token mapped in the existing palette sufficient?
- Should `ninjaone.devices.find` be local-only, live API-backed, or support both? Recommendation in PRD: local-first with optional live mode only if low risk.

## Progress Updates

- (2026-05-10) Implemented first-party workflow integration module registry in `shared/workflow/runtime/registries/integrationModuleRegistry.ts` with duplicate-key protection and singleton accessor.
- (2026-05-10) Extended `buildWorkflowDesignerActionCatalog` to accept explicit first-party app module definitions and produce stable app records from declarative `allowedActionIds`.
- (2026-05-10) Added server-side first-party availability filtering keyed by `availabilityKey` in `listWorkflowDesignerActionCatalogAction`; preserved extension install filtering path.
- (2026-05-10) Registered `app:ninjaone` first-party workflow module in EE runtime core with icon token `ninjaone`, default action `ninjaone.devices.find`, and explicit six-action allow-list.
- (2026-05-10) Added six NinjaOne workflow actions in `ee/packages/workflows/src/runtime/actions/registerNinjaOneWorkflowActions.ts`:
  - `ninjaone.devices.find`
  - `ninjaone.devices.sync`
  - `ninjaone.devices.reboot`
  - `ninjaone.alerts.list_active`
  - `ninjaone.alerts.get`
  - `ninjaone.alerts.reset` (labelled `Acknowledge alert`)
- (2026-05-10) Handlers now fail fast for missing tenant and inactive integration, use engine-provided idempotency for side-effectful operations, and return normalized non-secret outputs.
- (2026-05-10) Mapped `ninjaone` icon token in Workflow Designer palette (`WorkflowDesigner.tsx`) for a distinct NinjaOne tile icon.
- (2026-05-10) Added registry pattern documentation for future integrations at `ee/docs/plans/2026-05-10-workflow-integration-modules-ninjaone/INTEGRATION_MODULE_REGISTRY.md`.
- (2026-05-10) Added/updated tests:
  - `shared/workflow/runtime/__tests__/workflowIntegrationModuleRegistry.test.ts` (duplicate-key + metadata roundtrip)
  - `shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts` (explicit module record behavior)
  - `ee/packages/workflows/src/actions/workflow-runtime-v2-designer-catalog.integration-filtering.test.ts`:
    - `T003` active NinjaOne tenant includes `app:ninjaone` in designer catalog
    - `T004` inactive/missing NinjaOne excludes `app:ninjaone`
    - `T005` extension app filtering still works with first-party filtering (`app:acme.sync` allowed when installed)
  - `ee/packages/workflows/src/runtime/__tests__/ninjaOneWorkflowActions.registration.test.ts`:
    - `T006` verifies bootstrap and worker runtime entrypoints both register exactly the six NinjaOne action IDs
    - `T007` verifies side-effect/idempotency metadata and `ninjaone.alerts.reset` UI label/description (`Acknowledge alert`)
    - `T014` verifies NinjaOne registry action input/output schemas are present and parse representative `action.call` configuration payloads
  - `ee/server/src/components/workflow-designer/__tests__/ninjaOneDesignerCatalog.contract.test.ts`:
    - `T015` verifies NinjaOne grouped action options and explicit `ninjaone` icon token mapping contract in `WorkflowDesigner.tsx`
    - `T016` verifies NinjaOne module does not include ticket-creation actions and generic Ticket module remains the `tickets.create` path
  - `ee/packages/workflows/src/runtime/actions/__tests__/ninjaOneWorkflowActions.handlers.test.ts`:
    - `T008` verifies `ninjaone.devices.find` happy path (local lookup) returns normalized device output and does not leak secret-like source fields
    - `T009` verifies `ninjaone.devices.sync` delegates to sync strategy and returns synced identifiers
    - `T010` verifies `ninjaone.devices.reboot` inactive-integration guard and successful reboot delegation
    - `T011` verifies `ninjaone.alerts.list_active` output includes alert/device/asset/severity/message fields for ticket mappings
    - `T012` verifies `ninjaone.alerts.get` happy path and not-found behavior
    - `T013` verifies `ninjaone.alerts.reset` calls NinjaOne reset operation and returns acknowledged output

- (2026-05-10) Added targeted unit/integration-style coverage around `listWorkflowDesignerActionCatalogAction` filter behavior by mocking auth/runtime and exercising `rmm_integrations` plus extension-install query paths. Rationale: prove regression-safe catalog filtering without requiring full end-to-end server harness for this plan slice.
- (2026-05-10) Added runtime registration coverage using real runtime bootstrap/worker initialization and shared action registry reads. Included virtual test shim for `@alga-psa/db/workDate` to satisfy shared runtime import graph in package-level Vitest execution.
- (2026-05-10) Added handler-level test harness for NinjaOne actions with mocked integration client/sync strategy imports and action-registry invocation to validate output contracts directly at handler boundary.

## Validation Runbook

- `npx vitest run --config shared/vitest.config.ts shared/workflow/runtime/__tests__/workflowIntegrationModuleRegistry.test.ts shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts`
- `npx tsc -p ee/packages/workflows/tsconfig.json --noEmit`
- `cd ee/packages/workflows && npx vitest run src/actions/workflow-runtime-v2-designer-catalog.integration-filtering.test.ts`
- `cd ee/packages/workflows && npx vitest run src/runtime/__tests__/ninjaOneWorkflowActions.registration.test.ts`
- `cd ee/packages/workflows && npx vitest run src/runtime/actions/__tests__/ninjaOneWorkflowActions.handlers.test.ts`
- `cd ee/server && npx vitest run src/components/workflow-designer/__tests__/ninjaOneDesignerCatalog.contract.test.ts`

## Gotchas

- Root vitest config does not discover `ee/packages/workflows/src/runtime/__tests__` by default; shared runtime tests were executed via `shared/vitest.config.ts`.
- `createNinjaOneClient` second argument is region, not instance URL; workflow action handlers must call it with workflow context rather than raw URL.
