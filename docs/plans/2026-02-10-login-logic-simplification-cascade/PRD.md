# PRD — Login Logic Simplification Cascade

- Slug: `2026-02-10-login-logic-simplification-cascade`
- Date: `2026-02-10`
- Status: Draft

## Summary

Unify duplicated MSP/client-portal login, session, and extension-auth logic into a single policy-driven pipeline so `clientId` and related identity claims are consistent across canonical and vanity domains, and across `/api/ext` and `/api/ext-proxy`.

This plan is intentionally structured as five Simplification Cascade rounds, each with one unifying insight that enables deletion of multiple special-case paths.

## Problem

The current login/auth stack has multiple parallel implementations for equivalent decisions:

- Node vs Edge auth option construction and claim mapping are partially duplicated.
- `/api/ext` and `/api/ext-proxy` resolve user/session context differently.
- User context is represented with mismatched field names and optionality across JWT/session, gateway payloads, WIT, and SDK/runtime layers.
- MSP and client-portal route gating/redirect logic is duplicated in middleware, layouts, and signin routes.
- Vanity-domain handoff creates a separate session issuance path that can drift from Auth.js session semantics.

Observed production symptom: client-portal login can resolve `clientId` during authentication but downstream context recompute can still produce `clientId: undefined` in some flows, especially around first-request windows and split gateway paths.

## Goals

1. Ensure `clientId` parity across canonical and vanity-domain client portal sessions.
2. Ensure `clientId` parity across `/api/ext` and `/api/ext-proxy` extension execution paths.
3. Reduce duplicated auth/gating implementations by introducing shared policy modules.
4. Make user context propagation explicit and testable end-to-end.
5. Add instrumentation that can prove parity and identify recompute misses before full rollout.

## Non-goals

- Redesigning OAuth provider UX or changing enabled providers.
- Removing vanity/custom portal domain support.
- Hard-deprecating `/api/ext` or `/api/ext-proxy` in this phase.
- Rewriting extension runner architecture.
- Introducing unrelated permission model changes.

## Users and Primary Flows

**Primary users**
- Client portal end users (user_type `client`) on canonical and vanity domains.
- MSP/internal users (user_type `internal`) accessing MSP routes.
- Extension developers relying on stable user context in `user-v2`.

**Primary flows**
1. Client credentials login on canonical host with redirect to `/client-portal/*`.
2. Client credentials login that handoffs to vanity domain via OTT.
3. First request after login/handoff hitting edge middleware and app layout guards.
4. Extension UI proxy calls from client portal and MSP routes.
5. Direct extension API calls (`/api/ext`) from server/client contexts.

## UX / UI Notes

- No major UI redesign.
- Keep existing signin pages and handoff page behavior stable.
- Preserve callback URLs and portal-domain branding behavior.
- Any user-visible change should be limited to fewer redirect loops/failures after login.

## Requirements

### Functional Requirements

### FR-1: Round 1 — Single Auth Config/Claims Pipeline

Unifying insight: auth config and claim mapping are one policy, not separate Node/Edge implementations.

- Build a shared auth config/claims mapping surface consumed by both Node and Edge auth.
- Eliminate claim-mapping drift (`id`, `tenant`, `tenantSlug`, `user_type`, `clientId`, `contactId`, `session_id`, `login_method`).
- Ensure cookie name/secret helpers are single-sourced.
- Keep provider behavior and secrets resolution compatible with current runtime expectations.

### FR-2: Round 2 — Single Extension Gateway Core

Unifying insight: `/api/ext` and `/api/ext-proxy` are mode variants of one extension gateway.

- Create one shared gateway execution core with explicit `mode` (`api` vs `ui-proxy`).
- Normalize tenant/session/user resolution and install-context loading.
- Preserve route contracts while removing logic drift.
- Ensure client users include `client_id` consistently in both modes.

### FR-3: Round 3 — Canonical User Context Contract

Unifying insight: user context should have one canonical contract with deterministic mapping at boundaries.

- Define canonical `UserContextV2` for gateway/runtime boundaries.
- Enforce `client_id` availability for client users where data exists.
- Standardize `client_name` naming and keep compatibility aliases only where required.
- Align WIT/user schema definitions across runner and SDK templates/samples.
- Remove duplicate type declarations that can drift.

### FR-4: Round 4 — Unified Portal Guard Pipeline

Unifying insight: route namespace + user_type decides access; host/domain only decides branding and cookie scope.

- Introduce shared portal guard pipeline used by edge middleware, express middleware, and app route/layout entry points.
- Centralize signin redirect decisions (MSP vs client portal) and callback preservation.
- Centralize vanity-domain decisioning and portal-domain resolution.
- Reduce duplicated route branching and mismatch outcomes.

### FR-5: Round 5 — Unified Session Issuance and Stabilization

Unifying insight: all sessions must be issued with the same auth utility path.

- Replace bespoke OTT session-cookie issuance helpers with shared auth session helpers.
- Include `session_id` and `login_method` parity for handoff-issued sessions.
- Reduce first-request race windows after handoff with deterministic stabilization logic.
- Maintain secure cookie attributes and domain-specific behavior.

### FR-6: Instrumentation and Diagnostics

- Add structured logs at key transitions (authorize, jwt/session callbacks, handoff issue/consume, gateway execute, guard decisions).
- Add parity-focused metrics (missing `clientId`, missing `session_id`, mode/path mismatch, handoff failures).
- Include correlation identifiers across login/handoff/gateway requests.

### FR-7: Safe Rollout Controls

- Use explicit flags/toggles for major path switches.
- Support staged rollout with shadow comparison where practical.
- Provide rollback path without schema-breaking migrations.

### Non-functional Requirements

- Backward-compatible API contracts for `/api/ext` and `/api/ext-proxy` during rollout.
- No new required DB migrations for baseline rollout.
- TypeScript strict mode compliance for modified files.
- No regressions for MSP login/access behaviors.
- Added tests must run in CI within existing budget.

## Data / API / Integrations

- Auth/session modules: `packages/auth/src/lib/nextAuthOptions.ts`, `packages/auth/src/nextauth/edge-auth.ts`, `packages/auth/src/lib/session.ts`.
- Server auth/session wrappers: `server/src/lib/auth/session.ts`, `server/src/lib/auth/sessionCookies.ts`, middleware modules.
- Extension gateways: `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`, `server/src/app/api/ext-proxy/[extensionId]/[[...path]]/route.ts`, `packages/product-ext-proxy/ee/*`.
- Route guards and domain routing: `server/src/middleware.ts`, `server/src/middleware/express/authMiddleware.ts`, auth signin pages/layouts.
- Runner/WIT/SDK context contracts: `ee/runner/wit/extension-runner.wit`, runner models, SDK templates/samples/runtime.

## Security / Permissions

- Preserve existing user_type access boundaries (`internal` for MSP, `client` for client portal).
- Preserve tenant scoping requirements for extension execution.
- Preserve cookie security semantics (`Secure`, `HttpOnly`, `SameSite`) and domain scoping.
- Ensure internal header-based auth paths cannot accidentally bypass required session checks for client flows.

## Observability

Required structured events:

- `auth.jwt_claims_mapped`
- `auth.session_mapped`
- `portal.guard_decision`
- `portal.handoff_ott_issued`
- `portal.handoff_ott_consumed`
- `portal.handoff_cookie_issued`
- `gateway.execute_start`
- `gateway.execute_finish`
- `gateway.user_context_missing_client_id`

Required metrics:

- `auth_missing_client_id_total`
- `auth_missing_session_id_total`
- `portal_handoff_failure_total` (reason-tagged)
- `extension_gateway_requests_total` (mode-tagged)
- `extension_gateway_missing_client_id_total` (mode + user_type)
- `portal_guard_redirect_total` (reason-tagged)

## Rollout / Migration

1. Implement shared helpers and dual-wire without deleting old paths.
2. Add shadow/comparison logging where both old/new decision engines can be compared.
3. Migrate edge middleware and core gateway paths behind flags.
4. Migrate express/layout/signin decision points to shared guard.
5. Migrate OTT session issuance to shared auth utility.
6. Run parity test suite in staging with canonical + vanity flows.
7. Remove dead/duplicated paths only after parity metrics are stable.

## Open Questions

1. Should `/api/ext-proxy` remain a permanent compatibility route, or be formally deprecated after parity period?
2. Do we require `client_id` for all `user_type=client` contexts, or allow null for partial account states with explicit fallback behavior?
3. Should first-request tolerance after handoff be permanent policy or temporary rollout guard?

## Acceptance Criteria (Definition of Done)

1. Client portal login yields consistent `clientId` in session and gateway user context on both canonical and vanity domains.
2. `/api/ext` and `/api/ext-proxy` deliver equivalent user identity fields (including `client_id`) for equivalent authenticated client requests.
3. Shared portal guard produces consistent redirect/access decisions across edge middleware, express middleware, and app entry points.
4. OTT/handoff-issued sessions decode via the same auth utility path as standard sessions.
5. No regression in MSP/internal access control and sign-in flows.
6. Metrics show no sustained increase in auth/gateway failures after rollout.
7. Duplicated legacy modules/paths identified in this PRD are either removed or isolated behind explicit compatibility wrappers.
