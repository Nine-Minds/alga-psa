# Scratchpad — Custom Portal Domains on the On-Premise Appliance

- Plan slug: `appliance-custom-portal-domains`
- Created: `2026-06-25`
- Design doc: `docs/plans/2026-06-25-appliance-custom-portal-domains-design.md` (commit `6413895eca`, worktree branch `worktree-appliance-portal-domains-design`)

## What This Is

Working memory for bringing vanity client-portal domains to the on-prem appliance. The cloud
feature is multi-tenant + Temporal/Istio/cert-manager; the appliance is single-MSP + BYO-proxy.

## Decisions

- (2026-06-25) BYO-proxy: operator owns DNS + TLS + routing. Appliance provisions nothing.
- (2026-06-25) Trust-on-submit: domain -> `active` immediately; no on-box DNS/cert verification.
- (2026-06-25) Managed in the existing in-app EE Settings card (MSP-admin persona); no host-service
  `:8080` surface.
- (2026-06-25) Cloud-vs-appliance branch via a `PortalDomainProvisioner` seam: `temporal` (cloud,
  extracted verbatim) + `direct` (appliance) drivers.
- (2026-06-25) Disable = DELETE the row (no tombstone). OTT rows cascade.
- (2026-06-25) Config model = deployment profile -> capabilities. ONE `DEPLOYMENT_PROFILE` input
  resolved once into typed caps; code reads `caps.portalDomain.provisioner` /
  `caps.trustForwardedHost`, never the profile. Rationale: avoid both per-feature env-var
  accretion AND a raw `if(appliance)` conditional magnet. (User explicitly chose this over a
  single appliance boolean.)
- (2026-06-25) Header robustness = contract + trusted X-Forwarded-Host fallback + best-effort
  warning. XFH fallback is opt-in via caps (appliance on, cloud off) — host-injection concern.
- (2026-06-25) Phasing: Slice 1 = end-to-end working core (caps, provisioner, UI, XFH fallback,
  config, docs). Slice 2 = misconfig diagnostics (Redis last-seen + Settings ⚠ + XFH≠Host log).
- (2026-06-25) Operator proxy setup + troubleshooting doc is an in-scope deliverable (F022).

## Discoveries / Constraints

- The app-level vanity behavior is infra-agnostic and PORTS UNCHANGED:
  - `server/src/middleware.ts:171` derives host from `request.headers.get('host')`; vanity
    detection is `requestHostname !== new URL(NEXTAUTH_URL).hostname` (`:252`, `:362`). It does
    NOT consult X-Forwarded-Host today — that's the F018 change.
  - OTT issue: `computeVanityRedirect` in `packages/auth/src/lib/nextAuthOptions.ts`.
  - OTT consume + cookie set: `server/src/app/api/client-portal/domain-session/route.ts` (already
    reads `x-forwarded-proto` at `:232`).
  - Branding by domain: `getTenantBrandingByDomain`; email links: `ticketEmailSubscriber`,
    `packages/portal-shared/src/actions/portalInvitationActions.ts`.
- Server actions (all 5) funnel through `enqueuePortalDomainWorkflow`:
  `ee/server/src/lib/actions/tenant-actions/portalDomainActions.ts`. They bake in `pending_dns`/
  `pending_certificate` status strings — those move into temporalProvisioner.
- `computeCanonicalHost(tenant)` (`server/src/models/PortalDomainModel.ts:80`) returns
  `<prefix>.portal.<NEXTAUTH host>`. On the appliance this is meaningless DNS — store it as an
  opaque unique value, but do NOT surface it as a CNAME target in direct mode.
- `portal_domain_session_otts.portal_domain_id -> portal_domains` is `onDelete CASCADE`
  (`server/migrations/20250925103000_create_portal_domain_session_otts.cjs:21-24`) — so
  delete-on-disable is clean.
- No existing deployment-mode signal to reuse. `EDITION`/`NEXT_PUBLIC_EDITION` is orthogonal
  (appliance AND cloud are EE). Helm `hostedEnv` / `sebastian.hostedEnvEnabled` is chart-scoped
  dev-environment tooling, not a runtime profile. `DEPLOYMENT_ID` exists but is an identifier.
- alga-core env is injected as hardcoded templated entries in `helm/templates/deployment.yaml`
  (e.g. `EDITION` at `:178-181`, `TEMPORAL_PORTAL_DOMAIN_TASK_QUEUE` at `:262`). Add
  `DEPLOYMENT_PROFILE` the same way.
- Appliance currently advertises `portal-domain-workflows` in the worker taskQueue
  (`ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml:15`) with an
  empty `portalDomain` block (`:55`). Drop both — nothing enqueues to it once direct driver is used.
- Appliance alga-core sets `edition: enterprise`, `appUrl: https://alga.local` (-> NEXTAUTH_URL)
  (`ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml`). So the EE gate
  already passes on the appliance; the Settings card is reachable today.

## Commands / Runbooks

- Apply-able worktree: design doc lives on `worktree-appliance-portal-domains-design`. To land on
  the feature branch: `git checkout feature/appliance-custom-portal-domains && git cherry-pick <sha>`.
- Appliance smoke: use the `alga-appliance-local` skill with a real nginx/caddy in front; verify
  (1) Host forwarded -> portal works, (2) Host not forwarded -> ⚠, (3) disable -> row gone.
- Validate plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py <plan-folder>`.

## Links / References

- Design doc: `docs/plans/2026-06-25-appliance-custom-portal-domains-design.md`.
- Cloud feature file map: repo-root `context.md` (on the feature branch) has the full cloud file
  inventory for portal domains.

## Resolved (during implementation)

- (2026-06-25) Caps module home = `server/src/lib/deployment/deploymentProfile.ts`, NOT
  `@alga-psa/core`. Reason: `@alga-psa/core` subpaths are dist-built and the root export drags in
  heavy node-only deps; the edge-runtime middleware must stay light. A pure, dependency-free module
  under `server/src/lib` is importable by middleware (relative) AND ee/server actions (`@/lib/...`,
  same pattern they already use for `@/lib/db`).
- (2026-06-25) `server/src/middleware.ts` is **Edge runtime** ("Minimal, Edge-safe middleware").
  Consequences: F018 resolveRequestHost stays pure header/env logic (fine). Slice-2 last-seen (F024)
  CANNOT write Redis from middleware -> record it at the client-portal **signin page** (node RSC),
  which already reads the `portalDomain` query param the middleware set (proves a vanity request
  reached us, fires on every vanity redirect). F027 tell-tale also can't query Redis in edge ->
  use an edge-safe heuristic: trustForwardedHost && XFH present && XFH !== Host && Host === canonical
  -> log-warn (the proxy collapsed a vanity request onto the canonical Host).
- (2026-06-25) Redis active-SET (orig F023) is UNNECESSARY and dropped (simplification): the status
  action already knows the tenant's domain from its row, so the warning only needs a per-hostname
  last-seen key. F023 repurposed to the last-seen Redis helper module.
- (2026-06-25) NEXTAUTH-host rejection (F009) gated to direct mode in the action, to preserve cloud
  validation behavior exactly.

## Implementation Progress

- (2026-06-25) SLICE 1 COMPLETE (F001-F022). Files:
  - `server/src/lib/deployment/deploymentProfile.ts` (caps resolver, pure/edge-safe).
  - `server/src/lib/deployment/requestHost.ts` (resolveRequestHost — extracted from middleware so
    it's unit-testable without importing the whole edge middleware).
  - `ee/server/src/lib/portal-domains/provisioner/{types,temporalProvisioner,directProvisioner,index}.ts`.
  - `ee/server/src/lib/actions/tenant-actions/portalDomainActions.ts` (delegates to provisioner; sets `mode`).
  - `packages/tenancy/src/actions/tenant-actions/portalDomain.types.ts` (`mode?`, `neverSeenOnHost?`).
  - `ee/server/src/components/settings/general/ClientPortalDomainSettings.tsx` (mode-aware help/checklist + doc link + never-seen ⚠).
  - `server/public/locales/en/msp/settings.json` (`clientPortal.domain.appliance.*`). Other locales NOT translated (en only).
  - `server/src/middleware.ts` (uses resolveRequestHost + caps).
  - `helm/templates/deployment.yaml` (`DEPLOYMENT_PROFILE` env), appliance `alga-core.single-node.yaml`
    (`deploymentProfile: appliance`), `temporal-worker.single-node.yaml` (dropped queue + portalDomain block).
  - `ee/docs/guides/appliance-custom-portal-domain-proxy.md` (operator nginx/caddy guide).
- (2026-06-25) Import style: new ee/server files import server/src via `@/...` (vitest aliases `@`->./src
  and `@ee`->ee/server/src; `server/src/...` is NOT aliased in vitest). Verified by running unit tests.
- (2026-06-25) Tests passing (18): deploymentProfile (T001), portalDomainProvisioner (T002 + unit-level
  T003/T004/T005/T006), resolveRequestHost (T007). Run: `cd server && npx vitest run --coverage=false <file>`.
- (2026-06-25) PROXY_SETUP_DOC_URL in the UI is a placeholder (docs.algapsa.com/...); has a TODO to point
  at the published docs URL once it lands.
- (2026-06-25) NOT YET RUN / cannot run here: DB-backed action tests (T003/T004 full), E2E login (T008),
  appliance smoke. tsc full typecheck not run (heavy project refs) — relied on vitest transpile + targeted tests.

## Open Questions

- "Active but never seen" ⚠ threshold (active > N minutes). Default chosen at F025: 10 minutes.
