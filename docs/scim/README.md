# SCIM User Lifecycle Provisioning — Plan

Tenant-scoped SCIM 2.0 service provider (EE, Pro tier or higher) that lets Microsoft Entra de/reactivate **existing** internal Alga users — closing the offboarding gap SSO leaves. Never creates users, never mutates profiles/roles/licenses, revokes all sessions immediately on deactivation.

- **Status:** Design approved 2026-07-23, not yet implemented
- **Branch:** `feature/scim-support`

## Artifacts

| File | Contents |
|---|---|
| [PRD.md](PRD.md) | Product requirements: problem, goals/non-goals, flows, UX notes, requirements, acceptance criteria |
| [design.md](design.md) | Technical design: architecture, persistence, linking, lifecycle semantics, session enforcement, emulator, rollout, risks |
| [SCRATCHPAD.md](SCRATCHPAD.md) | Working notes: confirmed existing behavior, CIPP/Entra sync assessment and reuse boundary, all design decisions with rationale |
| [features.json](features.json) | 79 atomic features (F001–F079) with PRD references and `implemented` flags — the implementation checklist |
| [tests.json](tests.json) | 31 Pareto-focused tests (T001–T031) mapped to feature IDs — every feature is covered by at least one test |

## Key decisions (see SCRATCHPAD.md for full rationale)

- **Existing users only.** POST /Users creates a *link*, never an Alga user.
- **Exact normalized primary-email auto-linking.** No aliases, UPN fallback, or fuzzy matching; mismatches go to an unresolved-identity review queue.
- **Lifecycle-only authority.** SCIM manages active/inactive state and nothing else; drift is observed, not applied.
- **Source-aware reactivation.** `active=true` reverses only SCIM-applied inactivity, never manual deactivation.
- **DELETE = reversible deprovisioning.** Tombstones the link, preserves the user and all PSA history.
- **Immediate session revocation.** Revoked sessions are denied on the next authenticated request across all pods — fail closed, no throttle window.
- **First-party emulator** as the primary deterministic integration harness, plus a smaller live-Entra acceptance suite.

## Open questions (resolve during implementation)

1. Authoritative repo location/convention for external-provider emulators.
2. Bounded retention duration for sanitized SCIM operation history.
3. Whether the 24-hour token-overlap default is tenant-configurable or fixed in v1.
