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

## Open Questions

- Shared caps module home: new `shared/core/deployment-profile.ts` vs extending an existing config
  module. Resolve at F001.
- Middleware runtime (edge vs node) determines whether slice-2 last-seen recording can hit Redis in
  middleware or must move to the first node-runtime touchpoint (signin redirect / handoff). Validate
  before F024.
- "Active but never seen" ⚠ threshold (active > N minutes). Pick a default at F025.
