# PRD — Entra Settings Guided Flow Layout

- Slug: `entra-settings-guided-flow-layout`
- Date: `2026-02-20`
- Status: Draft
- Edition: Enterprise only (`NEXT_PUBLIC_EDITION=enterprise`)

## Summary

Restructure the Entra integration settings screen into two explicit modes:

1. Onboarding mode: guided, hard-gated sequence (Connect → Discover → Map → Initial Sync).
2. Maintenance mode: post-initial-sync operations view for recurring sync and health checks.

Keep existing Entra backend behavior, but improve UX clarity by exposing one current-step primary action at a time during onboarding and a stable operations surface afterward.

## Problem

The settings page currently presents `Run Discovery`, `Run Initial Sync`, and `Sync All Tenants Now` in the same visual tier. This implies equivalent usage order, but the real workflow is sequential: connect, discover, map, then sync.

Users can click actions out of sequence, leading to confusion about what should happen next and why certain actions appear disabled.

After initial setup, there is also no clear transition to an operational maintenance experience, so users still see setup-era controls without a maintenance-first framing.

## Goals

1. Present Entra onboarding as a clear, deterministic process.
2. Enforce hard-gated step progression in the UI.
3. Keep operational/manual sync actions available, but visually separate from onboarding.
4. Add an explicit maintenance mode after first initial sync run.
5. Reuse existing backend routes/actions and existing test coverage where possible.

## Non-goals

1. No Entra schema changes.
2. No Temporal workflow contract changes.
3. No new feature flags.
4. No redesign of mapping-table internals beyond placement/context.

## Users and Primary Flows

1. MSP admin connects Entra provider.
2. User runs discovery once connected.
3. User confirms tenant mappings.
4. User runs initial sync.
5. UI transitions to maintenance mode once initial sync exists.
6. User performs ongoing operations (`Sync All Tenants Now`, refresh discovery, review queue/history) from maintenance mode.

## UX / UI Notes

1. Add a step-progress header showing:
   1. Connect
   2. Discover
   3. Map
   4. Sync
2. Add a `Current Step` card with one primary CTA only (hard-gated).
3. Move `Sync All Tenants Now` to a separate `Ongoing Operations` section.
4. Keep mapping table visible and contextualize it as Step 3 (Map).
5. Keep status/connection diagnostics visible (including CIPP server/direct tenant details).
6. Add mode-level heading/treatment so users can distinguish Setup vs Ongoing Operations.
7. In maintenance mode, prioritize operational cards:
   1. Health summary/status
   2. Ongoing operations CTA group
   3. Sync history / queue review

## Requirements

### Functional Requirements

1. Derive guided step state from existing status signals (`status`, `lastDiscoveryAt`, `mappedTenantCount`) without new backend APIs.
2. Derive page mode (`onboarding` vs `maintenance`) from existing sync signals (existing sync history/run data), without schema changes.
3. Render only one onboarding primary action at a time:
   1. Not connected: show connect options.
   2. Connected without discovery: show `Run Discovery`.
   3. Discovered without confirmed mappings: direct user to mapping confirmation.
   4. Mapped tenants present: show `Run Initial Sync`.
4. Hard-gate future onboarding actions (no same-tier multi-action row).
5. Wire `Run Discovery` CTA to existing `discoverEntraManagedTenants` action.
6. Wire `Run Initial Sync` CTA to existing `startEntraSync({ scope: 'initial' })` path.
7. In maintenance mode, suppress onboarding-focused CTA emphasis and prioritize ongoing operations controls.
8. Keep `Sync All Tenants Now` behavior unchanged but place it in `Ongoing Operations`.
9. Preserve existing status panel fields and refresh/disconnect behaviors.
10. Preserve existing mapping table behaviors (`confirm`, `skip`, `import`, `remap`).
11. Preserve existing flag-gated visibility logic for optional advanced sections.

### Non-functional Requirements

1. No regression in existing Entra settings RBAC/flag checks.
2. UI state transitions should be deterministic from loaded status + mapping summary.
3. Keep implementation localized to Entra settings UI and its unit tests.
4. Mode switching must be predictable and not oscillate across refreshes for stable status data.

## Data / API / Integrations

1. Reuse existing server actions:
   1. `discoverEntraManagedTenants`
   2. `startEntraSync`
   3. `getEntraIntegrationStatus`
   4. `getEntraSyncRunHistory` (for maintenance-mode transition signal)
2. No new routes required.
3. No data model changes required.

## Security / Permissions

1. Continue to rely on existing route/action permission enforcement.
2. No client-portal access changes.

## Observability

1. No new observability scope.
2. Reuse existing sync feedback and sync history panel for run visibility.
3. Maintenance mode should surface last-run context from existing sync history data already available.

## Rollout / Migration

1. Ship behind existing Entra UI flag behavior.
2. No data migration required.

## Open Questions

1. Should Step 3 use a dedicated `Review Mappings` CTA (scroll/focus) or instruction-only guidance?
2. Should `Run Initial Sync` remain available both in guided Step 4 and mapping-confirm flow, or should one path become canonical?
3. Should maintenance mode expose `Run Discovery` as a secondary operation by default, or keep it behind an overflow/details affordance?

## Acceptance Criteria (Definition of Done)

1. The settings page no longer shows discovery/initial/all-tenants actions as same-tier onboarding controls.
2. Onboarding surface shows one current-step primary action based on progress state.
3. Discovery and initial-sync actions are clickable only when their prerequisites are met.
4. `Sync All Tenants Now` is visibly separated under operations/maintenance context.
5. Once initial sync has run, UI shifts to maintenance-mode emphasis and no longer presents setup CTAs as primary.
6. Existing status details, mapping flows, and advanced-flag panels continue to work.
7. Existing relevant tests continue to pass; only a small set of focused new UI tests is added.
