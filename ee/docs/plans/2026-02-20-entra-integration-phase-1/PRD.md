# PRD — Microsoft Entra Integration Phase 1 (EE)

- Slug: `entra-integration-phase-1`
- Date: `2026-02-20`
- Status: Draft
- Edition: Enterprise only (`NEXT_PUBLIC_EDITION=enterprise`)

## Summary

Build the Phase 1 Microsoft Entra integration for the EE product with a partner-level auth model, tenant discovery/mapping, and ongoing contact sync using Temporal workflows.

All user-visible Entra surfaces ship behind feature flags from day one for selective tenant rollout.

## Problem

MSP tenants need a single delegated connection to Microsoft that can discover all managed customer tenants, map those tenants to Alga clients, and keep contacts aligned without destructive writes.

Today there is no EE Entra workflow that does this end-to-end with deterministic mapping, explicit review paths, and Temporal-backed execution.

## Goals

1. Ship EE-only Entra integration settings and APIs.
2. Support partner-level connection paths:
1. Direct Microsoft partner auth (reusing existing Azure app credentials model).
2. CIPP-based connection.
3. Discover managed Microsoft tenants and reconcile them to Alga clients.
4. Sync enabled Entra users into Alga contacts with additive/linking behavior.
5. Run initial and recurring sync via Temporal workflows.
6. Keep all user-visible UI/actions behind feature flags.

## Non-goals

1. Entra write operations (create/disable users, license assignment).
2. Device assignment automation, welcome email automations, offboarding automations.
3. Deep operational hardening work (metrics, alerting, advanced rate-limit orchestration).

## Users and Primary Flows

1. MSP admin/internal user opens Integrations and enables Entra connection.
2. MSP user chooses connection type (Direct or CIPP) and completes setup.
3. MSP user runs discovery and reviews mapping suggestions.
4. MSP user confirms mappings and starts initial sync.
5. MSP user reviews sync outcomes, ambiguous matches, and per-tenant status.
6. MSP user triggers manual sync (all mapped tenants or single client).

Client portal users do not see or access Entra setup/sync surfaces.

## UX / UI Notes

1. Add an EE card to integrations settings for Entra.
2. Use a 4-step wizard:
1. Connect.
2. Discover Tenants.
3. Map Tenants to Clients.
4. Initial Sync.
3. Show explicit mapping states: auto-matched, needs review, skipped.
4. Show per-tenant sync result summaries and ambiguous contact queue.
5. Add client-level “Sync Entra Now” action on client details (flag-gated).
6. No hidden writes during preview screens; writes only after explicit confirm.

## Requirements

### Functional Requirements

1. EE-only APIs/routes/components for Entra integration.
2. Feature flags gate all user-visible Entra settings and client actions.
3. Partner-level auth configuration supports Direct and CIPP connection types.
4. Tenant discovery persists discovered managed tenants.
5. Mapping flow supports exact-domain auto-match, fuzzy candidates, manual assignment, skip.
6. Initial sync creates contact links and new contacts where needed.
7. Ongoing sync updates links and status with additive, non-destructive behavior.
8. Disabled/deleted Entra users mark linked contacts inactive (never delete).
9. Optional per-field sync toggles control whether selected Entra fields may overwrite local contact fields.
10. Ambiguous user matches are queued for manual review.
11. Manual sync actions support all tenants and single-client scope.
12. All sync execution paths use Temporal workflows/activities.

### Non-functional Requirements

1. Deterministic idempotency at workflow/run/tenant scopes.
2. Tenant isolation by tenant context in all reads/writes.
3. Secrets resolved through existing secret provider chain (env/filesystem/vault).

## Data / API / Integrations

### Data model (EE)

1. Add Entra integration configuration tables in `ee/server/migrations`.
2. Add discovered-tenant and tenant-mapping tables in `ee/server/migrations`.
3. Add sync run tables for parent run + per-tenant run details in `ee/server/migrations`.
4. Add Entra contact-link and ambiguous reconciliation tables in `ee/server/migrations`.
5. Add EE columns for Entra identifiers/sync metadata on `clients` and `contacts` where needed.

### Connection adapters

1. Direct adapter for Microsoft partner discovery/user enumeration in `ee/server/src/lib/integrations/entra/providers/direct`.
2. CIPP adapter for tenant/user enumeration in `ee/server/src/lib/integrations/entra/providers/cipp`.
3. Provider interface and normalization layer in `ee/server/src/lib/integrations/entra/providers`.

### API/action surfaces

1. EE route handlers under `ee/server/src/app/api/integrations/entra/...`.
2. CE stubs/delegators under `server/src/app/api/integrations/entra/...` (edition-gated import pattern).
3. Server actions exported via `packages/integrations/src/actions/integrations/entraActions.ts`.
4. OAuth callback handler under `server/src/app/api/auth/microsoft/entra/callback/route.ts` (EE behavior branch).

### Temporal placement

1. Workflows: `ee/temporal-workflows/src/workflows/entra-*.ts`.
2. Activities: `ee/temporal-workflows/src/activities/entra-*.ts`.
3. Registration: `ee/temporal-workflows/src/workflows/index.ts`, `ee/temporal-workflows/src/activities/index.ts`.
4. Schedule bootstrap: `ee/temporal-workflows/src/schedules/setupSchedules.ts`.
5. Workflow client wrapper: `ee/server/src/lib/integrations/entra/entraWorkflowClient.ts`.

## Security / Permissions

1. Entra settings/sync actions are internal-user only.
2. Use existing RBAC checks (`system_settings.read/update`) for setup, mapping, manual sync.
3. Deny client-portal users at action and route layers.
4. Use secret provider for sensitive tokens/credentials (tenant secrets + app secrets).
5. Reuse existing Microsoft app secret names where appropriate to avoid credential drift.

## Feature Flags / Rollout

User-visible Entra functionality must be hidden unless flag-enabled.

Primary flags:

1. `entra-integration-ui` (settings card + wizard).
2. `entra-integration-client-sync-action` (client page manual sync button).
3. `entra-integration-cipp` (CIPP option visibility).
4. `entra-integration-field-sync` (field overwrite toggles visibility).
5. `entra-integration-ambiguous-queue` (reconciliation queue visibility).

All flags are managed via EE platform feature flag APIs (`/api/v1/platform-feature-flags` + tenant targeting).

## Observability

Only minimal sync status and audit-oriented result storage required for feature usability in Phase 1. Broad monitoring/metrics work is explicitly deferred.

## Rollout / Migration

1. Deploy schema and EE code with all user surfaces disabled by default flags.
2. Enable flags for internal test tenants first.
3. Enable for selected customer tenants once mapping/sync quality is validated.

## Open Questions

1. Direct partner path exact required delegated scopes for tenant and user enumeration in target customer environments.
2. CIPP endpoint contract stability/version for tenant and user listing.
3. Final fuzzy matching heuristic threshold defaults.

## Acceptance Criteria (Definition of Done)

1. EE tenant can connect Direct or CIPP, discover tenants, map tenants, and run initial sync entirely through flag-gated UI.
2. Manual sync (all tenants and per client) starts Temporal workflows and records outcomes.
3. Contact sync is additive/linking by default; no silent overwrite of non-enabled fields.
4. Disabled/deleted Entra users mark linked contacts inactive, not deleted.
5. Client portal users cannot view or execute Entra features.
6. Turning feature flags off hides user-visible Entra surfaces immediately.
