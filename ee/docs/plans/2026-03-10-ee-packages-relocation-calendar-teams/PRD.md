# PRD — EE Packages Relocation for Calendar and Teams

- Slug: `ee-packages-relocation-calendar-teams`
- Date: `2026-03-10`
- Status: Draft

## Summary
Move live enterprise calendaring code and live Microsoft Teams code out of `packages/ee` and into first-class enterprise workspace packages under `ee/packages/`. The target layout is `ee/packages/calendar` for enterprise calendaring and `ee/packages/microsoft-teams` for enterprise Teams functionality, with `packages/ee` reduced to CE stubs and temporary compatibility forwarders only where the CE/EE boundary requires them.

This is a follow-on packaging and topology plan, not a product-scope plan. It supports the previously planned and partially implemented enterprise-only calendar and Teams work by correcting where the live enterprise code lives and how it is resolved by builds, tests, and shared entrypoints.

## Problem
The repo currently mixes three concerns across `packages/ee`, `ee/server/src`, and shared packages:

- CE stub behavior used to compile Community Edition
- thin EE entrypoints used by Next routes/pages
- live enterprise runtime, actions, services, and UI for calendaring and Teams

That arrangement has already caused drift where the runtime alias path terminates in placeholder files under `packages/ee/src` while the real implementation lives elsewhere. The result is an unreliable enterprise boundary: some code paths execute real EE logic, some paths hit stubs, and tests/typecheck can validate the wrong source tree.

`ee/packages/` already exists in the workspace and is the correct home for enterprise-owned packages. Calendaring and Teams should use that structure rather than continuing to grow inside `packages/ee`.

## Goals
- Create a real enterprise calendaring package at `ee/packages/calendar`.
- Create a real enterprise Microsoft Teams package at `ee/packages/microsoft-teams`.
- Move live enterprise calendar and Teams actions, components, libs, services, and route-handler logic into those packages.
- Leave `packages/ee` as CE stub and compatibility infrastructure only for calendar and Teams.
- Rewire shared callers, EE route/page entrypoints, and build/test config so they resolve the new package surfaces instead of `packages/ee` live code.
- Keep the package migration scoped to calendaring and Teams; do not turn this into a repo-wide `packages/ee` elimination effort.
- Preserve current CE behavior, current EE feature gating, and current product behavior while changing package ownership.

## Non-goals
- Moving every enterprise feature out of `packages/ee`.
- Redesigning calendar sync product behavior, Teams product behavior, or Microsoft profile behavior.
- Re-scoping Entra, inbound email, licensing, chat, extensions, or other unrelated enterprise domains.
- Changing tenant-facing rollout rules, feature flags, or permissions beyond what is required to preserve current behavior after the move.
- Removing `packages/ee` entirely in this plan.

## Users and Primary Flows
Primary users are internal engineers and CI/build systems. End users are affected indirectly because enterprise calendaring and Teams runtime must keep working after the package move.

Primary flows:

- An EE build compiles calendaring from `ee/packages/calendar` and Teams from `ee/packages/microsoft-teams`.
- Shared CE and shared package callers still compile because stub/delegator boundaries remain intact.
- CE runtime still returns calendar/Teams unavailable behavior where appropriate and never loads live EE code.
- EE Next route/page entrypoints remain thin and delegate into the enterprise packages rather than owning duplicated business logic.
- Vitest, TypeScript, and workspace tooling resolve the correct enterprise source roots for calendar and Teams instead of drifting between `packages/ee` and `ee/server/src`.

## UX / UI Notes
This is not a user-facing redesign. UI parity is the requirement.

- Existing EE calendar settings UI and profile calendar UI should render from the new calendar package without changing their user-facing behavior.
- Existing EE Teams settings UI and Teams tab/bot/message-extension behavior should render from the new Teams package without changing product scope.
- CE should continue to see the same unavailable or hidden surfaces it sees today after the recent EE boundary work.

## Requirements

### Functional Requirements
- `ee/packages/calendar` must become the source of truth for enterprise calendar code.
- `ee/packages/microsoft-teams` must become the source of truth for enterprise Teams code.
- New enterprise packages must expose stable entrypoints for actions, components, libs, and server handlers needed by shared packages and `ee/server`.
- `packages/ee` must not remain the live implementation location for calendar or Teams after the migration.
- Shared package imports that currently depend on `@enterprise/*` calendar or Teams paths must be migrated to explicit package entrypoints or thin compatibility forwarders that terminate in the new packages.
- EE route/page files under `ee/server/src/app/...` may remain as framework entrypoints, but their implementation logic must delegate into the new packages.
- CE stub files may remain under `packages/ee/src`, but only as stubs or temporary forwarders; they must not own live calendar or Teams business logic.
- Build and test aliasing must distinguish between live EE packages and CE stubs without relying on the old omnibus `packages/ee` layout.
- Existing feature gating for enterprise calendar and Teams must remain unchanged by the package move.
- Workspace package metadata, exports, lint/typecheck targets, and dependency wiring must be valid for the new packages.

### Non-functional Requirements
- The migration should minimize churn outside calendaring and Teams.
- The resulting package topology should reduce alias ambiguity rather than adding more ad hoc mappings.
- The plan should prefer explicit package imports over deep filesystem imports.
- The migration should preserve current runtime behavior for CE and EE.
- The plan should keep CI/typecheck/test verification practical and domain-scoped.

## Data / API / Integrations
No new product data model is introduced. Existing schema and API behavior for calendar and Teams remain as-is.

Relevant technical surfaces that must be re-homed or rewired:

- Enterprise calendar actions and services
- Enterprise Teams actions and package-generation logic
- Enterprise Teams notification delivery
- Enterprise Teams auth/provider resolution helpers
- Enterprise calendar OAuth callbacks and webhook handlers
- Enterprise Teams tab, bot, message extension, and quick-action handlers
- Enterprise settings/profile components for calendar and Teams

Shared Microsoft profile infrastructure remains shared and is not itself moved by this plan.

## Security / Permissions
No permission model changes are intended.

- CE must continue to fail closed and must not accidentally load live EE calendar or Teams code because of alias drift.
- EE must continue to enforce the same tenant/user/feature-flag gating already implemented for calendar and Teams.
- Compatibility forwarders must not create alternate bypass paths around edition checks.

## Observability
This plan does not add new observability scope. Existing logging and error behavior should remain intact after relocation.

The main engineering requirement is verification coverage that proves build, routing, and stub/delegation behavior still work after the move.

## Rollout / Migration
This is an internal topology migration with no tenant rollout.

Migration shape:

1. Create `ee/packages/calendar` and `ee/packages/microsoft-teams` as real workspace packages.
2. Move live enterprise implementation code into those packages.
3. Rewire `ee/server` entrypoints and shared package imports to the new package entrypoints.
4. Reduce `packages/ee` calendar and Teams files to CE stubs or temporary compatibility forwarders only.
5. Update aliasing, test config, and workspace metadata so calendar and Teams no longer depend on `packages/ee` as their live implementation location.
6. Remove obsolete duplicated files and deep import paths once the new package graph is stable.

This plan intentionally does not attempt a one-shot migration of all other `packages/ee` content.

## Open Questions
- Should `@enterprise/*` remain as a long-lived compatibility alias for migrated calendar and Teams surfaces, or should those imports be fully replaced with direct package entrypoints during this migration?
- Should the new package names be exposed only through workspace path aliases initially, or through stable package names consumed directly by shared code from day one?

## Acceptance Criteria (Definition of Done)
- Live enterprise calendaring implementation no longer lives in `packages/ee`.
- Live enterprise Microsoft Teams implementation no longer lives in `packages/ee`.
- `ee/packages/calendar` and `ee/packages/microsoft-teams` exist as workspace packages with valid exports and project metadata.
- `ee/server` calendar and Teams route/page entrypoints delegate into the new packages rather than owning duplicated implementation logic.
- Shared callers no longer rely on `packages/ee` as the live calendar or Teams runtime source.
- `packages/ee` calendar and Teams files are limited to CE stubs or temporary compatibility forwarders.
- CE behavior remains unchanged and fails closed.
- EE behavior remains functionally equivalent for calendar and Teams after the relocation.
- Targeted typecheck and test coverage validate the new package graph, aliasing, and CE/EE boundary behavior.
