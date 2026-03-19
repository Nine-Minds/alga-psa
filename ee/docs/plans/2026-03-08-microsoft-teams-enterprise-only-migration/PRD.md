# PRD — Microsoft Teams Enterprise-Only Migration

- Slug: `microsoft-teams-enterprise-only-migration`
- Date: `2026-03-08`
- Status: Draft

## Summary

Create a follow-on migration plan that moves the Microsoft Teams integration out of shared/CE runtime ownership and into Enterprise-only ownership. The target state is:

- Teams is invisible and unavailable in CE
- Teams admin setup appears only in `Settings -> Integrations -> Communication`
- Teams runtime entry points only execute in EE when the tenant feature flag `teams-integration-ui` is enabled
- Shared Microsoft profiles remain shared because they are used by non-Teams Microsoft integrations
- Teams-specific schema is owned by `ee/server/migrations`, not shared `server/migrations`

This plan follows `2026-03-07-microsoft-teams-integration-v1` rather than replacing it. The original plan remains the historical product-delivery plan; this one tracks the ownership and packaging correction.

## Problem

The current Teams implementation landed largely in shared code:

- shared integrations settings render Teams directly
- shared server routes own Teams tab, bot, message-extension, and package behaviors
- shared notifications and auth surfaces import Teams-specific runtime logic
- shared migrations currently create Teams-specific schema

That shape makes Teams look like a CE feature even though product intent is that Teams should be enterprise-only. If this is left in place:

- CE builds continue to expose or imply Teams availability
- schema ownership remains ambiguous
- future Teams work will keep mixing EE-only behavior into shared packages
- the repo loses the clear boundary already established by the Entra integration pattern

The migration is therefore not a product-scope expansion. It is a correction to feature ownership, packaging, routing, settings placement, and schema location.

## Goals

1. Move all Teams-specific product behavior behind enterprise ownership boundaries.
2. Hide all Teams UI and runtime behavior from CE.
3. Gate Teams UI and runtime in EE with one tenant feature flag: `teams-integration-ui`.
4. Move Teams admin setup from `Providers` to `Communication`.
5. Keep shared Microsoft profiles and Microsoft consumer bindings in shared code.
6. Move Teams-specific schema ownership from shared migrations to EE migrations.
7. Reuse the Entra CE-stub plus EE-delegation pattern where shared route or import boundaries must remain.
8. Preserve the existing Teams v1 product shape for EE tenants once the ownership migration is complete.

## Non-goals

- Redesigning Teams v1 product scope
- Adding client-user Teams support
- Adding channel-targeted notification routing
- Adding channel-first bot workflows
- Creating a separate Teams-only Microsoft credential store
- Moving shared Microsoft profile management into EE
- Preserving current local/dev Teams integration rows or package metadata
- Adding new operational telemetry or rollout systems beyond the one required feature flag
- Rewriting the original Teams v1 ALGA plan instead of creating a follow-on plan

## Users and Primary Flows

### Personas

- **Enterprise tenant admin**: configures shared Microsoft profiles, opens Teams setup from `Communication`, and enables Teams only when the tenant is licensed and flagged on.
- **Enterprise MSP technician**: uses the Teams tab, bot, message extension, and notifications after the migration, but only in EE.
- **Core/shared-platform engineer**: maintains the CE-safe wrappers and shared Microsoft profile infrastructure.
- **Enterprise engineer**: owns the concrete Teams runtime and schema.

### Primary Flows

#### Flow 1: CE tenant visits integrations settings
1. User opens integrations settings in CE.
2. `Providers` shows Google, Microsoft profiles, and MSP SSO configuration.
3. `Communication` shows Inbound Email.
4. No Teams admin UI appears anywhere in settings.

#### Flow 2: EE tenant with flag disabled visits integrations settings
1. User opens integrations settings in EE.
2. Shared Microsoft profiles are available in `Providers`.
3. Teams admin UI does not render as an active integration while `teams-integration-ui` is off.
4. No Teams runtime route or action becomes available by virtue of being EE alone.

#### Flow 3: EE tenant with flag enabled configures Teams
1. Admin opens `Settings -> Integrations -> Communication`.
2. Teams admin UI appears there, not in `Providers`.
3. Admin configures Teams by referencing one selected shared Microsoft profile.
4. Teams setup, package state, and runtime all execute through EE-owned code paths.

#### Flow 4: CE or disabled EE route access
1. A Teams route, action, or callback is invoked.
2. Shared wrapper checks edition and flag state before touching Teams runtime logic.
3. CE returns an EE-unavailable response.
4. EE with flag off returns a disabled response.
5. No active Teams business logic executes in either case.

#### Flow 5: Enabled EE runtime access
1. A Teams route, action, callback, or notification delivery path is invoked.
2. Shared wrapper checks edition and flag state.
3. When enabled, the wrapper delegates to the EE implementation.
4. The EE implementation uses the existing shared Microsoft profile, auth, and notification primitives.

## UX / UI Notes

- Teams should no longer appear in `Providers`; that area is for shared provider credentials, not collaboration surfaces.
- `Communication` is the correct home because the Teams integration is an operator-facing communication surface alongside inbound-email-adjacent workflows.
- Microsoft profile management remains in shared `Providers` because it supports email, calendar, and MSP SSO in addition to Teams.
- The migration should preserve the Teams setup concepts already built for EE users, but it should change where and how that UI is surfaced.
- UI gating should be obvious and deterministic: no CE shell, no “coming soon” placeholder in CE, and no accidental discovery via category placement.

## Requirements

### Functional Requirements

#### A. Planning and migration framing

- FR-A1: Create a new follow-on ALGA plan folder for the migration rather than rewriting the original Teams v1 plan.
- FR-A2: The follow-on plan must reference `2026-03-07-microsoft-teams-integration-v1` as historical context.
- FR-A3: The follow-on plan must treat current Teams state as pre-release and disposable.

#### B. Availability and gating

- FR-B1: Define one shared Teams availability helper for settings, routes, actions, and notifications.
- FR-B2: Teams availability must require enterprise edition.
- FR-B3: Teams availability must require the tenant feature flag `teams-integration-ui`.
- FR-B4: CE must always evaluate Teams availability as disabled.
- FR-B5: EE with the tenant flag off must evaluate Teams availability as disabled.
- FR-B6: Settings, routes, actions, and notifications must all use the same availability rule.
- FR-B7: Disabled and unavailable states must be explicit rather than silently falling through into partial runtime behavior.

#### C. Settings IA and admin UX

- FR-C1: Remove Teams from the shared `Providers` category.
- FR-C2: Add Teams to the `Communication` category.
- FR-C3: Keep Microsoft profile management in shared `Providers`.
- FR-C4: The shared settings page must render Teams through an EE-safe wrapper or entrypoint, not a concrete shared Teams component.
- FR-C5: Teams admin UI must only render in EE with `teams-integration-ui` enabled.
- FR-C6: The migration must not create a second Teams settings location.

#### D. Routes and runtime ownership

- FR-D1: Teams tab behavior must be EE-owned or EE-delegated.
- FR-D2: Teams bot behavior must be EE-owned or EE-delegated.
- FR-D3: Teams message-extension behavior must be EE-owned or EE-delegated.
- FR-D4: Teams auth callback behavior must be EE-owned or EE-delegated.
- FR-D5: Teams package/install/status behavior must be EE-owned or EE-delegated.
- FR-D6: Shared CE route boundaries may remain only as stubs or delegators when required by public routing.
- FR-D7: CE route wrappers must not execute Teams business logic.
- FR-D8: EE flag-off route wrappers must not execute Teams business logic.

#### E. Actions, helpers, and module boundaries

- FR-E1: Shared Teams server-action entrypoints must become EE-safe stubs or delegators.
- FR-E2: Concrete Teams action implementations must be enterprise-owned.
- FR-E3: Shared Teams helpers that are required by both UI and action code must move out of `use server` modules when needed.
- FR-E4: Shared package exports must not make Teams appear to be a CE integration after the migration.
- FR-E5: Shared modules must not depend directly on enterprise Teams runtime logic.

#### F. Auth and notification integration points

- FR-F1: Shared Microsoft profile infrastructure remains shared and continues to serve non-Teams Microsoft consumers.
- FR-F2: Teams-specific auth/provider-resolution used only by Teams runtime must be EE-owned or exposed through EE-safe wrappers.
- FR-F3: Shared non-Teams auth flows must not require enterprise Teams modules.
- FR-F4: Teams notification delivery must be EE-owned or EE-delegated.
- FR-F5: Shared notification generation and deep-link resolution remain the source of truth.
- FR-F6: CE notification broadcasting must never attempt Teams delivery after the migration.

#### G. Schema ownership

- FR-G1: Shared migrations must no longer own Teams-specific schema.
- FR-G2: EE migrations must own Teams-specific schema.
- FR-G3: Shared migrations must continue to own Microsoft profile and consumer-binding schema.
- FR-G4: Fresh CE installs must not create Teams tables.
- FR-G5: Fresh EE installs must create Teams tables.
- FR-G6: The migration must not include a production data backfill for existing pre-release Teams rows.

#### H. Compatibility and cleanup

- FR-H1: Shared Microsoft profile CRUD must continue to work in CE.
- FR-H2: Shared Microsoft profile CRUD must continue to work in EE.
- FR-H3: Existing Microsoft consumers such as email, calendar, and MSP SSO must remain unaffected.
- FR-H4: EE tenants with the feature flag on must retain the same Teams v1 surface set after the ownership migration.
- FR-H5: No CE documentation, tests, or exports may continue to present Teams as a CE feature.

### Non-functional Requirements

- NFR-1: Teams remains one integration with multiple surfaces, not separate EE sub-products.
- NFR-2: Shared Microsoft profiles remain the single credential model for Teams.
- NFR-3: The migration should use the Entra boundary pattern instead of inventing a second EE-isolation approach.
- NFR-4: Shared route wrappers and action wrappers must be safe for CE builds and must not eagerly import EE modules.
- NFR-5: Schema ownership must be unambiguous after the migration.
- NFR-6: The migration should remove complexity rather than introducing duplicate Teams implementations.

## Data / API / Integrations

### Simplification Cascades

The migration should explicitly use these simplification cascades:

1. **Teams is one EE integration.**
   The migration should not split tab, bot, message extension, and notifications into separate ownership models.

2. **Shared Microsoft profiles stay shared.**
   If Microsoft profiles are shared infrastructure, Teams does not need a duplicate EE-only credential system.

3. **CE keeps only wrappers where boundaries require them.**
   If a path must exist for imports or routing, it becomes a stub or delegator. Otherwise, it should stop existing as active CE logic.

4. **One availability helper governs everything.**
   If edition and flag checks are unified, the migration does not need separate UI gating logic, action gating logic, and route gating logic that can drift.

### Data / API Direction

- Shared data retained in CE/shared code:
  - Microsoft profiles
  - Microsoft consumer bindings
  - shared notification payload generation
  - shared record deep-link resolution
  - shared MSP auth/session primitives

- Teams data moved to EE ownership:
  - Teams integration state/config
  - Teams package metadata and install state
  - Teams runtime handlers
  - Teams-specific auth resolution/helpers used only for Teams runtime
  - Teams notification delivery implementation

- Shared route/action boundaries that may remain:
  - thin CE stubs
  - thin EE delegators
  - explicit EE-unavailable responses

## Security / Permissions

- Teams remains MSP-user-only.
- Tenant-admin permissions for Teams setup do not change; only the code ownership and UI placement change.
- Tenant scoping and permission enforcement remain the responsibility of the underlying Teams EE runtime.
- CE-unavailable and EE-disabled paths must fail closed and must not leak tenant Teams configuration or runtime details.
- Shared Microsoft profile permissions remain unchanged and continue to protect profile CRUD independently of Teams availability.

## Observability

No new observability platform work is in scope for this migration. The plan only requires:

- bounded logging for failed EE dynamic imports and wrapper failures
- enough test coverage and scratchpad runbooks to validate CE/EE/flag behavior

## Rollout / Migration

- This is a follow-on migration plan, not a new product rollout.
- The new feature flag is `teams-integration-ui`.
- Teams should be treated as unreleased and internal while this migration is in progress.
- Current local/dev Teams data does not need preservation.
- Developers may reset/rebuild local databases if needed to align with the new migration ownership split.
- The original Teams v1 plan remains as the product-history artifact; this plan becomes the migration-history artifact.

## Open Questions

- None at draft time. The migration decisions needed for implementation are captured in this PRD and the linked feature/test inventories.

## Acceptance Criteria (Definition of Done)

1. CE settings show no Teams integration surface.
2. EE settings show Teams only in `Communication`, and only when `teams-integration-ui` is enabled.
3. Shared `Providers` retains Microsoft profile management but no longer owns Teams setup.
4. Shared routes/actions no longer execute concrete Teams business logic.
5. Shared notifications and auth flows no longer own concrete Teams runtime logic.
6. Fresh CE installs do not create Teams schema.
7. Fresh EE installs do create Teams schema.
8. Shared Microsoft profiles and non-Teams Microsoft consumers still work in CE and EE.
9. EE tenants with the flag enabled retain the Teams v1 surface set after the migration.
10. The new ALGA plan contains stable feature/test inventories and a scratchpad that captures the migration decisions and validation runbooks.
