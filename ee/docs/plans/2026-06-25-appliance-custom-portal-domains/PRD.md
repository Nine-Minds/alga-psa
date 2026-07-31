# PRD — Custom Portal Domains on the On-Premise Appliance

- Slug: `appliance-custom-portal-domains`
- Date: `2026-06-25`
- Status: Draft (design approved)
- Design doc: `docs/plans/2026-06-25-appliance-custom-portal-domains-design.md` (commit `6413895eca`)

## Summary

Bring custom client-portal domains ("vanity domains" such as `portal.acme.com`) to the
on-premise appliance. In the hosted cloud this feature is driven by Temporal workflows, Istio,
cert-manager, and a GitOps repo — none of which exist on the appliance, which deliberately runs
k3s with no ingress controller, no cert-manager, and TLS terminated by an operator-managed
reverse proxy.

On the appliance the feature collapses to: record the domain and run the existing app-level
vanity behavior, while the **operator owns DNS, TLS, and routing** through their own reverse
proxy (bring-your-own-proxy). Activation is **trust-on-submit** — entering a domain marks it
`active` immediately with no on-box DNS or certificate verification.

The hosted-vs-appliance split is expressed once via a `DEPLOYMENT_PROFILE` input that resolves
into a typed capabilities object; a `PortalDomainProvisioner` seam selects between the existing
`temporal` driver (cloud) and a new `direct` driver (appliance).

## Problem

Appliance customers (single-MSP, on-prem) cannot serve their client portal on a branded domain.
The cloud feature exists but hard-depends on infrastructure the appliance omits by design, so
today the in-app Settings card would accept a domain and then silently never provision it
(workflow enqueued to a queue no worker services), leaving the row stuck.

## Goals

- Let an appliance MSP admin register a custom client-portal domain and have it work end-to-end
  with an operator-supplied reverse proxy.
- Reuse the existing app-level vanity behavior (middleware redirect, OTT session handoff,
  branding-by-domain, email link rewriting) without modification.
- Introduce the hosted-vs-appliance divergence as a single deployment-profile → capabilities
  layer, not as scattered env flags or an inline `appliance` boolean.
- Leave the hosted/cloud path's behavior unchanged.
- Make the dominant misconfiguration (proxy not forwarding `Host`) observable.

## Non-goals

- On-appliance DNS verification, ACME/Let's Encrypt, cert-manager, or any ingress controller.
- An operator-facing (host-service `:8080`) management surface — the domain is managed in-app.
- A migration path for rows created by one provisioner driver when the driver later changes.
- Multi-tenant-per-appliance domain management beyond what the existing `UNIQUE(tenant)` /
  `UNIQUE(domain)` schema already provides.

## Users and Primary Flows

**Persona: MSP admin (in-app).** Manages the domain in `Settings → Client Portal → Domain`.

**Persona: infra operator (out-of-band).** Owns DNS, the reverse proxy, and the TLS cert. Guided
by the in-card checklist and a setup/troubleshooting doc.

**Persona: client portal end-user.** Visits the vanity domain and signs in.

Primary flows:

1. **Register** — admin enters `portal.acme.com` → validated → `direct` driver upserts the row
   `active` (no workflow) → card shows Active immediately.
2. **End-user login (unchanged)** — client hits `https://portal.acme.com/...`; operator's proxy
   terminates TLS and forwards to `alga-core:3000` preserving `Host` + `X-Forwarded-Proto: https`
   → middleware redirects to canonical sign-in → auth → OTT issued → handoff on the vanity host
   → `/api/client-portal/domain-session` validates the active row, consumes the OTT, sets the
   cookie → lands on the requested path.
3. **Disable** — admin clicks Remove → `direct` driver **deletes** the row (OTT rows cascade) →
   middleware stops redirecting that host.

## UX / UI Notes

- Reuse `ClientPortalDomainSettings.tsx`. The status response carries a `mode: 'temporal' |
  'direct'` field; in `direct` mode the help text and checklist render the **BYO-proxy contract**
  (point DNS here, proxy `:443 → :3000` preserving `Host`, supply the TLS cert) instead of the
  cloud "CNAME to canonical" instructions, and link to the proxy doc.
- Status badge/panel work unchanged — appliance only ever uses `active` / `disabled`. The refresh
  button stays (harmless re-fetch); retry never renders (no failure states).
- Slice 2 adds a ⚠ in the card when a domain has been `active` but no traffic has ever arrived on
  its `Host`.

## Requirements

### Functional Requirements

- A `DEPLOYMENT_PROFILE` env (`hosted` default, `appliance`) resolved by
  `resolveDeploymentCapabilities()` into `{ portalDomain: { provisioner }, trustForwardedHost }`.
- A `PortalDomainProvisioner` interface with `temporal` (extracted, behavior-preserving) and
  `direct` (appliance) drivers, selected from `caps.portalDomain.provisioner`.
- The five EE portal-domain server actions delegate side effects to the provisioner.
- `direct` driver: register → row `active`; disable → row deleted; refresh/retry → idempotent
  ensure-active; reject `domain === NEXTAUTH_URL host` and `=== canonicalHost`.
- Status response gains `mode`; Settings UI renders the proxy contract in `direct` mode.
- Middleware `resolveRequestHost()` uses `Host`, falling back to `X-Forwarded-Host` only when
  `caps.trustForwardedHost` is set.
- Appliance Flux sets `deploymentProfile: appliance`; the temporal-worker drops the
  `portal-domain-workflows` queue and the empty `portalDomain` block.
- Operator setup + troubleshooting doc (nginx/caddy snippets, DNS/TLS expectations).

#### Slice 2 (diagnostics)

- Provisioner maintains a Redis set of active vanity hostnames (register adds, disable removes).
- A request on an active vanity `Host` records a last-seen timestamp.
- Settings card shows ⚠ "no requests have reached `<domain>` yet" when active-but-never-seen.
- Middleware emits a rate-limited log-warn when `X-Forwarded-Host` names an active domain but
  `Host` does not (the Host-rewrite tell-tale).

### Non-functional Requirements

- Hosted/cloud behavior unchanged when `DEPLOYMENT_PROFILE` is unset (defaults to `hosted` →
  `temporal`).
- The appliance path loads no Temporal/Istio/cert-manager/K8s provisioning code.

## Data / API / Integrations

- No schema changes. `portal_domains` and `portal_domain_session_otts` already exist;
  `portal_domain_session_otts.portal_domain_id → portal_domains` is `onDelete CASCADE`, so
  delete-on-disable cleans up outstanding OTTs.
- Redis (already deployed on the appliance) backs the active-domain set and last-seen timestamps
  in slice 2.

## Security / Permissions

- Existing checks unchanged: actions require `settings:update`; client portal users cannot manage
  domains.
- `trustForwardedHost` is opt-in via the profile (appliance on, cloud off) because trusting
  forwarded host headers is a host-injection consideration. Cloud never honors `X-Forwarded-Host`.

## Observability

- Slice 2 only: the active-but-never-seen ⚠ and the XFH≠Host log-warn. No other metrics/audit
  added (out of scope unless requested).

## Rollout / Migration

- No data migration. Ship slice 1 (end-to-end working) first; slice 2 (diagnostics) second.
- Cloud requires no change; the default profile preserves current behavior.

## Open Questions

- Exact home of the shared capabilities module (`shared/core/deployment-profile.ts` vs an existing
  config module) — resolve during implementation.
- Whether Next.js middleware runs on the edge or node runtime here, which determines whether
  last-seen recording happens in middleware or at the first node-runtime touchpoint (signin
  redirect / handoff). Validate before building slice 2.
- Threshold for the "active but never seen" ⚠ (e.g. active > N minutes) — pick a sensible default
  during slice 2.

## Acceptance Criteria (Definition of Done)

- On an appliance (`DEPLOYMENT_PROFILE=appliance`) with a correctly configured reverse proxy, an
  MSP admin can register a vanity domain, a client can sign in on it end-to-end (OTT handoff), and
  removing it deletes the row and stops the redirect.
- Registering does not enqueue any Temporal workflow on the appliance.
- With the default profile, the hosted path and its existing tests are unchanged.
- Slice 2: a deliberately misconfigured proxy (Host not forwarded but XFH present) surfaces the ⚠
  in Settings and the log-warn.
- Operator proxy doc exists and is linked from the Settings card.
