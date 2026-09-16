# Scratchpad — Entra connection diagnostics

## Scope and decisions

- 2026-09-16: Planning assignment based on the commissioned Entra connection diagnostics card. Deliver PRD, implementation checklist, and representative test checklist; application implementation belongs to subsequent work.
- The commissioning brief supplies the settled product scope: on-demand only; read-only except partner-token refresh persistence; compare expected app-registration values without Graph application reads; separate connection and selected-client runs; share the existing email diagnostics engine.
- Existing unrelated working-tree change: `package-lock.json`; preserve it.

## Investigation

- Plan format: `/home/robert/.codex/skills/alga-plan/SKILL.md`.
- Existing plans live under `ee/docs/plans/` with dated slugs.
- Findings, implementation constraints, and validation commands will be added as the plan is grounded in the repository.

## Repository findings (2026-09-16)

- `ee/server/src/app/api/integrations/entra/_guards.ts`: currently returns generic 403 responses for tier misses. Diagnostics needs shared guard evaluation and safe structured readiness evidence, not a bypass of the guard. The action bridge currently maps 401/403 to generic permission text too.
- `ee/server/src/lib/integrations/entra/auth/microsoftCredentialResolver.ts`: binding/profile/archive/capability/secret failures all collapse to null. Add a diagnostic result without changing existing nullable callers or creating a package cycle.
- `ee/server/src/lib/integrations/entra/auth/refreshDirectToken.ts`: partner refresh persists the token set; managed-tenant refresh deliberately does not persist its access token, but does save a rotated refresh token. Preserve that explicit allowed exception. Current EntraOperatorError loses structured response metadata even though its message includes OAuth/suberror/AADSTS.
- `packages/integrations/src/actions/integrations/entraActions.ts`: connect assembles its callback from environment/app-secret base URL values. `microsoftActions.ts` setup metadata uses getDeploymentBaseUrl; use one read-only server resolver for expected/connect/setup URL parity. Do not call an initialization/backfill helper just to display expected values.
- `packages/integrations/src/actions/integrations/microsoftActions.ts` MicrosoftProfileRow has client_secret_ref but no secret-expiry field. Plan unknown-expiry display, no new schema requirement.
- `ee/server/src/lib/integrations/entra/providers/direct/directProbe.ts`: pure probe already uses beta managedTenants and the self-tenant /organization switch; existing markers sanction shared extraction. Preserve HTTP/correlation evidence instead of flattening it.
- `ee/server/src/lib/integrations/entra/providers/direct/directProviderAdapter.ts`: full managed-tenant and user paging plus token refresh/cache live here. Diagnostic token context must avoid unintended extra mints and retain sanitized error metadata.
- `ee/server/src/lib/integrations/entra/providers/cipp/cippProbe.ts`: tries three URLs, falls through on 404, stops on 401/403, accepts array/data/tenants/value list shapes, and currently discards most HTTP/network detail.
- `ee/server/src/lib/integrations/entra/sync/preflightService.ts`: dry-run preflight inserts entra_sync_runs. Do not call runEntraPreflight from diagnostics. Reuse `settingsService.ts` and `sync/userFilterPipeline.ts` for counts; exclusion reasons are account_disabled, missing_identity, service_account, tenant_custom_pattern.
- `ee/server/src/lib/integrations/entra/entraWorkflowClient.ts`: applyEntraSyncSchedule deletes schedules when sync is disabled. Read-only diagnostics must treat absence as consistent with disabled settings and still warn sync is off. Temporal client helpers that start/reconcile workflows are unsuitable probes.
- `ee/server/src/lib/integrations/entra/scheduleService.ts` is at the integration root, not in sync/. Its read settings path is separate from the write/reconcile path.
- `notifications/entraSyncNotificationRules.ts`: failed and partial both count as unsuccessful; dry-run entries must not reset real-sync failure history.
- EE/CE wiring spans base `server/src/app/api/integrations/entra`, `ee/server`, `packages/ee/src/app/api/integrations/entra`, and `packages/integrations/src/entra/routes/{ee,oss}/entry.ts`.
- `packages/emulators/msgraph` and suite scenario infrastructure are present. The brief's alga-emulator-testing skill is absent from the available catalog and searched roots; source/README-based harness work remains possible. No emulator or stack mutation was necessary for this planning assignment.
- `server/src/test/unit/docs/entraIntegrationGuide.contract.test.ts` checks setup paths, secrets, additive sync, rollout guidance, and retired flags. Preserve these while adding the diagnostics section and consolidating remedies.

## Planning choices

- The detailed commissioning brief is the scope authority; the assignment asks to add the plan. No additional product confirmation is necessary and settled decisions are not reopened.
- Estimated checklist size: approximately 90–100 independently observable implementation items. Final count: 87 features and 40 representative test cases/suites, with every feature referenced by at least one test.
- Shared diagnostics extraction is the first delivery slice and unchanged email tests are its gate. The actual extraction should apply the leverage skill; planning does not modify that engine.
- Proposed client progress uses bounded, authenticated request-driven continuations so the read-only contract does not quietly expand to persistent job records or background workflows. Verify request-budget handling and optional full-directory preview during implementation.
- Dependency skips apply per prerequisite, not blindly to all higher-numbered layers: Temporal failures do not suppress Graph, and credential failures do not suppress local history/queue checks.
- Both report scopes retain timestamps for meaningful history/client cross-reference. Operator-visible consent links can carry necessary identifiers; exported identifiers are controlled separately and secrets are always redacted server-side.
- Product implementation, runtime tests, smoke screenshots, and both documentation updates are future checklist work, not claimed complete by creating these artifacts.

## Implementation progress (2026-09-16 first draft)

Landed in the `feature/entra-connection-diagnostics-*` worktree:

- Shared diagnostics foundation in `shared/services/diagnostics/` (timed runner, status fold, Graph failure classifier, token fingerprint/JWT decode) with canonical generic types in `packages/types` and mirrors through `shared/interfaces`. The Microsoft 365 email adapter now consumes it; `MicrosoftGraphAdapter.diagnostics.test.ts` passes unchanged.
- Entra diagnostics engine in `ee/server/src/lib/integrations/entra/diagnostics/`: OAuth/AADSTS classifier, recommendation dedupe/severity ordering, server-side redaction + support bundle, HMAC signed bounded continuations, dependency-aware step runner, read-only Temporal readiness, CIPP detailed probe, direct connection diagnostics (layers 1/2/3/5 + C.1–C.5) and selected-client diagnostics (4.1–4.5, C.6) with at most three clients in flight.
- EE routes (`diagnostics`, `diagnostics/clients`) behind `requireEntraAccess('read')`, base-server CE delegators, `packages/ee` 501 stubs, integrations EE/OSS route entries, and `entraDiagnosticsActions.ts` actions re-exported from the actions barrel.
- `EntraDiagnosticsDialog` mounted from the Connection action row and the Overview attention section, with `msp/admin` localization keys under `integrations.entra.diagnostics.*`.
- Consolidated AADSTS/remedy table and a Diagnostics section in `ee/docs/guides/entra-integration-phase-1.md`; guide contract test passes.

Verified: shared diagnostics tests + unchanged email regression; EE unit tests for the classifier, dedupe, redaction, continuation, connection step order/read-only behavior, and the dialog component; Entra guard/delegator regressions; EE and integrations typechecks; the new route is live on :3793 and returns a safe 401 unauthenticated.

`features.json` (76/87) and `tests.json` (9/40) mark only what actually landed. Still open, recorded as false: shared guard evaluation payload (F010/F011), unified setup-metadata callback (F016), stored-error decode (F037), adapter token-context seam reuse (F048), client/sync cross-reference (F061), stop-after-close (F077), explicit includeIdentifiers export control (F080), emulator fault fixtures (F084), nm-store page (F086), and console screenshots (F087).

Could not complete in this draft: live console smoke with green + two failure screenshots against the msgraph emulator; nm-store user guide (repository not located in this assignment); DB-backed integration tests and the full server `tsc` (the server typecheck exceeded available heap).

## Validation and handoff

Plan-only checks:

```sh
python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-16-entra-connection-diagnostics
git diff --check -- ee/docs/plans/2026-09-16-entra-connection-diagnostics
```

Implementation regression commands (not run during planning):

```sh
cd shared
npx vitest run --config vitest.config.ts services/email/providers/__tests__/MicrosoftGraphAdapter.diagnostics.test.ts
```

```sh
cd server
npx vitest run --config vitest.config.ts src/test/unit/docs/entraIntegrationGuide.contract.test.ts
```

Use repository integration-test bootstrap for the migrated-DB tests, and the msgraph emulator's README/config for scenarios. Locate nm-store and screenshot conventions through alga-business-documentation when writing website documentation.

The OOD planning assignment does not advance, approve, merge, or mark the board step complete; those mechanics belong to XO/captain.

Validation result (2026-09-16): plan validator passed (87 features, 40 tests). Additional checks passed for unique IDs, all implementation flags false, resolved PRD headings, complete feature-to-test mapping, and whitespace/conflict markers in all four new files. Application tests were not run because this assignment changes plan artifacts only.
