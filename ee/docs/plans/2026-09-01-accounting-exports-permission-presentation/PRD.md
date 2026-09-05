# PRD — Permission-Aware Accounting Exports Presentation

- Slug: `accounting-exports-permission-presentation`
- Date: `2026-09-01`
- Status: Approved

## Summary

Gate every Accounting Exports presentation entry point on `accounting_integrations:exports_execute` while retaining the existing server authorization boundary.

## Problem

Users without accounting export permission can currently see navigation and integration-settings links, reach the exports tab directly, and see enabled export controls. A denied list action is presented as an empty list rather than an in-page access-denied state.

## Goals

- Hide Accounting Exports navigation and settings links from users without export execution permission.
- Block direct tab URLs from mounting the functional export surface.
- Present denied action results as a generic access-denied state with no export controls.
- Preserve the complete export workflow for Finance and other capable users.

## Non-goals

- Changing server-side authorization, permission names, role defaults, legacy routes, sync-health behavior, or accounting APIs.

## Users and Primary Flows

- A user without `exports_execute` does not discover or activate accounting export UI.
- A direct URL opened by that user displays a generic denied state.
- A Finance user continues to navigate to, create, inspect, execute, and cancel export batches.

## UX / UI Notes

- The denied presentation must not disclose whether providers, connections, realms, batches, or remote entities exist.
- Controls are hidden while capability resolution is pending to avoid an authorization flash.

## Requirements

### Functional Requirements

- Gate the billing sidebar entry and dashboard tab resolution on `accounting_integrations:exports_execute`.
- Gate all four integration-settings links on the same capability.
- Convert permission-denied export action results into a persistent generic denied state.

### Non-functional Requirements

- Reuse the existing accounting capability hook and specific-subpath imports.
- Add behavioral component tests; do not alter existing server-enforcement tests.

## Data / API / Integrations

No schema or API changes.

## Security / Permissions

Client gating is supplemental. Existing server checks remain authoritative and unchanged.

## Observability

No new telemetry is required.

## Rollout / Migration

Ship on the existing accounting-hardening branch; no migration required.

## Open Questions

None.

## Acceptance Criteria (Definition of Done)

- Unauthorized users see no Accounting Exports navigation or settings links, cannot mount the functional tab through its URL, see a generic denied state instead of an empty list, and have no activatable export controls.
- Finance-capable users retain the complete exports UI.
- Focused component/navigation tests, accounting regression tests, full typecheck, and build pass.
