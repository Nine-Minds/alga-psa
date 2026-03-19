# PRD — Calendar Sync Enterprise Migration and Microsoft Profile Explicit Bindings

- Slug: `calendar-sync-enterprise-migration-and-microsoft-profile-explicit-bindings`
- Date: `2026-03-09`
- Status: Draft

## Summary

Create a follow-on migration plan that makes calendar sync fully enterprise-only and finishes the Microsoft profile model cleanup that started with named profiles and consumer bindings.

The target end state is:

- Calendar sync is EE-only across settings, profile surfaces, OAuth callbacks, runtime services, webhook/subscriber execution, and supporting entrypoints.
- CE retains only stub or delegator boundaries for calendar where a public route or import surface must remain.
- Microsoft profiles remain shared infrastructure, but CE exposes only MSP SSO guidance and binding UX.
- EE exposes Microsoft profile consumers for MSP SSO, email, calendar, and Teams.
- Consumer selection is explicit and binding-driven; the legacy compatibility/default-consumers pane is removed.

## Prior Work / Scope Continuation

This plan is a continuation of the earlier Microsoft integration work, not a rewrite of it.

- It follows `ee/docs/plans/2026-03-07-microsoft-teams-integration-v1/` as the original product-history artifact for Microsoft profiles, Teams, and shared consumer bindings.
- It follows `ee/docs/plans/2026-03-08-microsoft-teams-enterprise-only-migration/` as the precedent for CE stubs plus EE delegators at stable public boundaries.
- The named-profile and consumer-binding groundwork from those plans remains in place; this plan finishes the migration by making calendar enterprise-only and by deleting the remaining compatibility/default-consumer semantics.
- The plan intentionally keeps one coordinated acceptance checklist for both workstreams because the calendar EE move and the Microsoft binding cleanup share the same ownership rule: shared credential infrastructure, edition-aware consumer UX, and EE-owned calendar execution.

## Problem

The current implementation mixes three different models:

1. Calendar sync still behaves like a shared CE feature in multiple places, including settings composition, profile settings, OAuth routes, and shared runtime services.
2. Microsoft profile configuration still carries legacy compatibility semantics such as a default compatibility profile and a legacy consumers pane.
3. The UI and action model do not yet cleanly separate CE-visible MSP SSO configuration from EE-only Microsoft consumers like calendar and Teams.

That creates three classes of problems:

- Packaging problems: calendar sync remains CE-shaped even though it should be enterprise-only.
- UX problems: the Microsoft profile page still explains compatibility behavior instead of explicit bindings.
- Architecture problems: consumer resolution can still fall back to legacy defaults instead of using one binding-driven source of truth.

## Goals

1. Move all calendar sync behavior into EE ownership, including settings, profile settings, OAuth routes, runtime services, and background execution.
2. Leave CE with only explicit stubs or wrappers for calendar surfaces that must remain addressable.
3. Keep named Microsoft profiles and the shared binding table as shared infrastructure.
4. Make CE Microsoft profile configuration talk only about MSP SSO.
5. Make EE Microsoft profile configuration expose MSP SSO plus email, calendar, and Teams consumer options.
6. Make explicit Microsoft consumer bindings the source of truth for consumer selection.
7. Remove the legacy Microsoft consumers pane and all copy that frames the default profile as a compatibility source for multiple consumers.
8. Preserve the Entra and Teams EE boundary patterns rather than inventing a new packaging model.

## Non-goals

1. Redesign the calendar sync product itself.
2. Add new calendar providers, new sync behaviors, or new notification patterns.
3. Redesign Teams integration scope.
4. Redesign MSP SSO domain discovery or claim lifecycle behavior.
5. Rework Google provider ownership beyond what is required to remove calendar execution from CE.
6. Add new rollout flags unless implementation later proves one is required.
7. Preserve pre-release compatibility UI wording or fallback semantics if they conflict with explicit bindings.

## Users and Primary Flows

### CE Tenant Admin

- Opens `Settings -> Integrations -> Providers`.
- Manages named Microsoft profiles that are described only in MSP SSO terms.
- Selects or verifies the explicit Microsoft profile binding for MSP SSO.
- Does not see calendar sync settings or calendar profile tabs.
- Cannot execute Google or Microsoft calendar OAuth flows.

### EE Tenant Admin

- Opens `Settings -> Integrations -> Providers`.
- Manages named Microsoft profiles and sees binding options for MSP SSO, email, calendar, and Teams.
- Opens `Settings -> Integrations -> Calendar` and configures calendar sync.
- Uses Google or Microsoft calendar OAuth through EE-owned route implementations.
- Can review or change explicit bindings without relying on compatibility defaults.

### EE MSP User

- Opens `Profile -> Calendar` and connects or manages calendar sync from an EE-owned surface.
- Uses calendar sync behavior without hitting CE-owned runtime code.

### Internal Engineer

- Can identify one clean ownership rule:
  shared Microsoft profile storage and binding infrastructure remain shared;
  calendar execution and extended Microsoft consumer UX are enterprise-owned.

## UX / UI Notes

### Simplification Cascades

1. Shared Microsoft profiles are infrastructure, not product UX.
   That means the same credential records can stay shared even while consumer-specific experiences split by edition.
2. Consumers are bindings, not defaults.
   If that is true, we do not need the legacy Microsoft consumers pane, compatibility copy, or silent cross-consumer fallback semantics.
3. Calendar sync is one EE feature.
   If that is true, we do not need a partially shared settings card, shared profile tab, and shared runtime services.
4. CE owns only stubs at boundaries.
   If that is true, we do not need CE-visible calendar product behavior anywhere else.

### Settings Information Architecture

- `Settings -> Integrations -> Calendar` becomes EE-only.
- `Settings -> Integrations -> Providers` remains shared, but the Microsoft page is edition-aware:
  - CE: MSP SSO-only guidance and binding controls.
  - EE: MSP SSO plus email, calendar, and Teams guidance and binding controls.

### User Profile

- The user-profile `Calendar` tab becomes EE-only.
- CE should not present a dead-end Calendar tab.

### Microsoft Profile Page

- Remove the legacy Microsoft consumers pane.
- Remove wording such as “default compatibility profile” and “existing consumers until explicit bindings ship.”
- Replace it with explicit, current binding state and controls that reflect the edition.

## Edition Contracts

### Calendar Surface Contract

| Surface | CE contract | EE contract | Stable boundary |
| --- | --- | --- | --- |
| `Settings -> Integrations -> Calendar` | Hidden from navigation; if a wrapper remains addressable it must render explicit EE-unavailable messaging and fall back to a valid shared category | Real calendar configuration UI remains available through an EE-owned entry component | Shared settings composition keeps the category key stable while delegating implementation ownership |
| `Profile -> Calendar` | Hidden from the user profile tab list; any stale tab query falls back to a valid tab without client errors | Real profile calendar management remains available through an EE-owned entry component | Shared profile tab routing keeps the tab key stable while delegating implementation ownership |
| `GET /api/auth/google/calendar/callback` | Stable public URL remains addressable, but CE returns an enterprise-only unavailable payload before any token exchange or provider writes | Stable public URL delegates to an EE-owned callback implementation and preserves existing success/error semantics | Shared route file remains a thin wrapper only |
| `GET /api/auth/microsoft/calendar/callback` | Stable public URL remains addressable, but CE returns an enterprise-only unavailable payload before any token exchange or provider writes | Stable public URL delegates to an EE-owned callback implementation and preserves existing success/error semantics | Shared route file remains a thin wrapper only |
| `POST /api/calendar/webhooks/google` and `POST /api/calendar/webhooks/microsoft` | Stable public URLs remain addressable, but CE rejects or no-ops cleanly without running calendar logic | Stable public URLs delegate to EE-owned webhook handling and maintenance behavior | Shared route files remain thin wrappers only |
| Shared calendar services, adapters, jobs, and subscribers | Import-safe CE wrappers or abstract boundaries only; no live provider CRUD, sync, adapter, webhook, or subscriber behavior remains in shared runtime | EE owns the live provider CRUD, sync execution, webhook renewal, adapter selection, secret handling, and subscriber registration paths | Shared packages expose only edition-safe entrypoints |

### Microsoft Profile Surface Contract

| Surface | CE contract | EE contract |
| --- | --- | --- |
| `Settings -> Integrations -> Providers -> Microsoft` page framing | Describes Microsoft profiles only as MSP SSO infrastructure | Describes Microsoft profiles as shared credentials reused by MSP SSO, email, calendar, and Teams |
| Visible binding controls | Only `MSP SSO` | `MSP SSO`, `Email`, `Calendar`, and `Teams` |
| Redirect-URI guidance | Only MSP SSO guidance and login-domain support copy | MSP SSO guidance plus supported non-SSO redirect URIs |
| Teams metadata guidance | Omitted | Teams Application ID URI guidance appears when metadata is available |
| Profile readiness and empty-state copy | References only MSP SSO prerequisites and reuse | References the full supported EE consumer set |
| Actions and payloads | Binding list/write/status actions expose only MSP SSO-visible metadata | Binding list/write/status actions expose the supported EE consumers and metadata required by EE profile management |

### Source Of Truth Rules

- Calendar availability is decided by one edition-aware contract shared across settings composition, profile tab routing, HTTP route wrappers, runtime registration, and subscriber/job ownership.
- Microsoft consumer visibility is decided by one edition-aware consumer matrix:
  - CE visible consumers: `msp_sso`
  - EE visible consumers: `msp_sso`, `email`, `calendar`, `teams`
- Shared modules must consume edition-safe calendar entrypoints and edition-safe Microsoft consumer helpers rather than importing concrete EE runtime files or relying on compatibility-default resolution.
- Action-layer consumer selection must read explicit binding rows first and treat any remaining fallback behavior as migration glue to remove, not as target runtime behavior.

### CE Stub And EE Delegation Pattern

The calendar migration follows the same boundary model already used for Entra and Teams:

- Shared CE route wrappers keep stable public URLs.
- CE HTTP stubs return `501` JSON with `success: false` plus an enterprise-only error message before any provider, token, mapping, or sync side effect can occur.
- CE UI surfaces prefer invisibility; when a wrapper must stay addressable, it uses explicit EE-unavailable messaging rather than a disabled-but-discoverable shell.
- EE wrappers dynamically delegate to enterprise implementations and preserve existing method, query parsing, OAuth state extraction, success, and error contracts.
- Shared imports remain package-safe: no raw filesystem-relative reach-in from shared code to EE implementations.

### Stable Routes And Addressable Boundaries

The migration keeps these route URLs stable even though active ownership moves to EE:

- `/api/auth/google/calendar/callback`
- `/api/auth/microsoft/calendar/callback`
- `/api/calendar/webhooks/google`
- `/api/calendar/webhooks/microsoft`

The migration also preserves stable shared import boundaries for:

- `CalendarIntegrationsSettings` and related calendar settings/profile entrypoints
- shared calendar action entrypoints that must remain import-safe in CE
- shared Microsoft profile CRUD and binding infrastructure

### Compatibility Behaviors Intentionally Deleted

The target design explicitly deletes, rather than preserves:

- the legacy Microsoft consumers pane,
- copy that presents the default profile as a compatibility source for multiple consumers,
- silent cross-consumer fallback from default profiles for migrated consumers,
- CE-visible calendar settings cards, profile tabs, and callback/runtime behavior,
- shared runtime ownership of calendar provider CRUD, sync execution, webhook maintenance, and subscriber registration.

## Requirements

### Functional Requirements

1. Calendar sync settings are visible only in EE.
2. The user-profile Calendar tab is visible only in EE.
3. Calendar OAuth callback routes are CE stubs or EE delegators.
4. CE calendar routes must not create providers, tokens, or sync side effects.
5. EE calendar routes must preserve existing callback success/error behavior.
6. Shared runtime code must stop owning active calendar services, adapters, webhook maintenance, and subscriber registration.
7. EE runtime must continue to own calendar provider CRUD, sync execution, webhook maintenance, and adapter behavior.
8. Shared Microsoft profile CRUD remains available in both CE and EE.
9. CE Microsoft profile UI exposes only MSP SSO-specific guidance and bindings.
10. EE Microsoft profile UI exposes additional consumer options for email, calendar, and Teams.
11. Explicit consumer bindings are the source of truth for MSP SSO, email, calendar, and Teams.
12. The legacy Microsoft consumers pane is removed.
13. Action-layer consumer resolution must prefer explicit bindings and stop relying on compatibility defaults for migrated consumers.
14. Archive/delete guards for Microsoft profiles must respect active bindings.
15. Edition-aware tests must cover CE unavailable behavior and EE active behavior.

### Non-functional Requirements

1. CE imports must remain safe after the EE extraction.
2. Shared wrappers must not reach into EE by raw filesystem-relative imports.
3. Public route URLs should stay stable for EE tenants even if ownership moves.
4. The migration should favor explicit boundaries over backward-compatible hidden behavior.
5. The plan should avoid adding product complexity beyond edition separation and binding cleanup.

## Data / API / Integrations

### Shared Data

- `microsoft_profiles` remains shared.
- `microsoft_profile_consumer_bindings` remains shared.
- MSP SSO login-domain tables remain shared.

### Enterprise-Owned Calendar Behavior

- Calendar provider configuration and sync execution remain functionally intact, but their active runtime ownership moves behind EE boundaries.
- Google and Microsoft calendar callback handlers become EE-owned implementations behind shared stubs or delegators.

### Consumer Resolution

- `MSP SSO` resolves via explicit binding.
- `Email` resolves via explicit binding where that consumer remains supported.
- `Calendar` resolves via explicit binding.
- `Teams` continues to resolve via explicit binding.

The important boundary is:
credential records stay shared, but consumer usage is explicit and edition-aware.

## Security / Permissions

1. Only authorized MSP users with system settings update permission can manage Microsoft profiles and bindings.
2. Client-portal users cannot manage Microsoft profiles or bindings.
3. CE direct access to calendar callback endpoints must not execute provider writes or token exchange.
4. Binding writes must stay tenant-scoped and edition-scoped.

## Observability

This plan does not add new observability scope by default.

It does require preserving existing debuggability:

- route ownership should stay obvious in logs and tests,
- unavailable CE stubs should fail clearly,
- scratchpad/runbooks should document the changed ownership model.

## Rollout / Migration

1. This is a follow-on plan to the named Microsoft profile and Teams EE-boundary work, not a rewrite of those plans.
2. Calendar sync should be treated as unreleased or migration-safe enough that ownership can move without preserving a CE execution path.
3. Consumer bindings become the steady-state model.
4. Any remaining legacy compatibility behavior should be treated as migration glue to eliminate, not as target design.
5. CE should end in a clean state:
   - no calendar settings,
   - no profile Calendar tab,
   - no live calendar callback/runtime behavior,
   - Microsoft profile UI limited to MSP SSO.
6. EE should end in a clean state:
   - working calendar settings and profile tab,
   - working calendar callbacks/runtime,
   - Microsoft profile UI with explicit bindings for the supported consumers.

### Manual Cleanup / Unsupported Edge States

- If a tenant has a calendar provider row that points at a Microsoft profile without an explicit `calendar` binding after migration, the tenant should be backfilled or manually rebound rather than silently falling through to a default-profile compatibility rule.
- If a tenant has an archived Microsoft profile that is still bound to an active consumer, archive/delete should stay blocked until the binding is reassigned or cleared according to product rules.
- If retained Outlook email behavior still depends on a temporary fallback path, that path must be isolated and documented as migration-only scope rather than surfaced as normal Microsoft profile behavior.

### Final Acceptance Matrix

| Area | CE outcome | EE outcome | Regression focus |
| --- | --- | --- | --- |
| Integrations settings | No Calendar category or stale Calendar shell remains visible | Calendar category remains visible and deep-linkable | Selected-category fallback, no duplicate nav entries |
| User profile | No Calendar tab or dead-end tab route remains | Calendar tab remains available and stateful | Tab-query fallback/preservation |
| Calendar callbacks and webhooks | Stable URLs return explicit unavailable behavior without side effects | Stable URLs delegate to EE-owned implementations | Method/query/OAuth-state contracts remain stable |
| Calendar runtime ownership | No live shared provider CRUD, sync, adapter, job, or subscriber behavior remains | EE runtime continues to own those behaviors | Ownership tests and package-boundary tests |
| Microsoft profile UI | Shows only MSP SSO guidance and binding control | Shows MSP SSO plus email, calendar, and Teams binding controls | Edition-aware payloads and copy |
| Microsoft consumer resolution | No migrated consumer depends on default-profile compatibility routing | Explicit bindings drive selection | Missing-binding, archive-guard, tenant-scope coverage |

## Open Questions

1. If Outlook inbound email remains CE-supported long term, determine whether its Microsoft profile binding should live in EE-only provider UI or move to a consumer-owned CE UI later. This plan assumes the Microsoft profile page itself shows only MSP SSO in CE.

## Acceptance Criteria (Definition of Done)

1. CE tenants no longer see Calendar Sync in integration settings or the user profile.
2. CE calendar OAuth/callback/runtime entrypoints act only as stubs or unavailable wrappers.
3. EE tenants retain working calendar settings, profile tab, OAuth flows, and runtime behavior through EE-owned implementations.
4. The shared Microsoft profile page in CE shows only MSP SSO guidance and binding behavior.
5. The Microsoft profile page in EE shows MSP SSO plus email, calendar, and Teams consumer options.
6. The legacy Microsoft consumers pane and default-compatibility wording are removed.
7. Consumer selection is binding-driven and edition-aware.
8. Tests cover CE unavailable behavior, EE active behavior, explicit binding behavior, and migration/ownership regressions.
