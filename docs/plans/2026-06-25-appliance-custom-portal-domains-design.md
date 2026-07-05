# Custom Portal Domains on the On-Premise Appliance — Design

**Date:** 2026-06-25
**Status:** Approved design, pre-implementation
**Branch:** `feature/appliance-custom-portal-domains`

## Summary

Bring custom client-portal domains ("vanity domains" such as `portal.acme.com`) to the
on-premise appliance. In the hosted cloud this feature is built on Temporal workflows,
Istio Gateways/VirtualServices, cert-manager, and a GitOps repo — none of which exist on
the appliance, and all of which the appliance deliberately omits (k3s with traefik and
servicelb disabled, no ingress controller, no cert-manager, TLS terminated by an
operator-managed proxy).

The appliance is effectively single-MSP, so the cloud's multi-tenant routing machinery is
unnecessary. The feature therefore collapses to three concerns:

1. **Routing** — a second hostname must reach `alga-core`.
2. **TLS** — a valid certificate must exist for that hostname.
3. **Activation** — the domain must be recorded and the portal's app-level vanity behavior
   must run off it.

On the appliance, (1) and (2) are owned by the operator's existing reverse proxy
(bring-your-own-proxy), and (3) reuses the application code that already exists in
`alga-core`. The implementation introduces one new seam — a provisioner abstraction — so
the appliance never loads any cloud-infrastructure code path.

## Decisions

These were settled during design and frame everything below:

| Decision | Choice | Consequence |
|---|---|---|
| Routing + TLS ownership | **Bring-your-own-proxy** | Operator runs their own proxy/LB; appliance provisions nothing |
| Activation model | **Trust-on-submit** | Domain becomes `active` immediately; no DNS/cert verification on-box |
| Config surface | **In-app EE Settings** | MSP admin manages it in the existing Settings card; no new operator UI |
| Cloud-vs-appliance branch | **Provisioner seam** | One abstraction, two drivers, selected via the deployment profile |
| Config model | **Deployment profile → capabilities** | One `DEPLOYMENT_PROFILE` input resolves to a typed capabilities object; code reads named capabilities, not the profile |
| Disable behavior | **Delete the row** | No tombstone; OTT rows cascade away |
| Proxy-header robustness | **Contract + XFH fallback + warning** | Documented contract, trusted `X-Forwarded-Host` fallback, and a best-effort misconfig warning |

## What ports for free

The vanity-domain *application* behavior is infrastructure-agnostic and already lives in
`alga-core`. None of it changes for the appliance:

- **Edge middleware redirect** keys off `requestHostname !== new URL(NEXTAUTH_URL).hostname`
  (`server/src/middleware.ts`). On the appliance `NEXTAUTH_URL` is the app URL
  (e.g. `https://alga.acme.com`), so a request arriving with `Host: portal.acme.com`
  triggers the same redirect-to-canonical-sign-in flow.
- **OTT cross-domain session handoff** — issuance in `computeVanityRedirect`
  (`packages/auth/src/lib/nextAuthOptions.ts`), consumption in
  `server/src/app/api/client-portal/domain-session/route.ts`.
- **Branding by domain** (`getTenantBrandingByDomain`), **email link rewriting**
  (`ticketEmailSubscriber`, `portalInvitationActions`), and the **`portal_domains` /
  `portal_domain_session_otts` migrations** are unchanged.

The single external requirement for all of this to work is that the operator's proxy
**forwards the original `Host` header** (and `X-Forwarded-Proto: https`).

## What does not fit the appliance

- All five EE server actions in
  `ee/server/src/lib/actions/tenant-actions/portalDomainActions.ts` funnel through
  `enqueuePortalDomainWorkflow` and bake in `pending_dns` / `pending_certificate` statuses
  that have no meaning without the cloud workflow.
- `computeCanonicalHost()` returns `<prefix>.portal.<appHost>` and the Settings UI tells the
  operator to "point a CNAME to" it. On the appliance that target does not exist; the proxy
  target is the appliance itself.

## Deployment profile and capabilities

Rather than minting a new environment variable per appliance behavior, the hosted-vs-appliance
divergence is expressed once. A single input — `DEPLOYMENT_PROFILE` (`hosted` by default, or
`appliance`) — is resolved in one place into a typed capabilities object:

```
DEPLOYMENT_PROFILE=appliance
  → resolveDeploymentCapabilities()
      {
        portalDomain: { provisioner: 'direct' },   // 'temporal' on hosted
        trustForwardedHost: true,                   // false on hosted
      }
```

The rest of the code reads **named capabilities** (`caps.portalDomain.provisioner`,
`caps.trustForwardedHost`) — never `DEPLOYMENT_PROFILE` directly. This keeps call sites
semantic and independently testable, avoids the "conditional magnet" failure mode of a raw
`if (appliance)` boolean (which mis-names what it controls and accretes unrelated branches),
and still gives the DRY-ness of a single mode: one place to set, one place to map, no
impossible flag combinations. Individual capabilities remain overridable for the rare
deployment that needs a non-default mix.

The resolver lives in a shared module (e.g. `shared/core/deployment-profile.ts`) so both
`alga-core` server actions and the edge middleware read the same capabilities. There is no
existing deployment-mode signal to reuse: `EDITION` is orthogonal (the appliance and the cloud
are both EE), and the Helm `hostedEnv` flag is chart-scoped tooling, not a runtime profile.

Portal domains is the first consumer; subsequent appliance-specific behaviors extend the
capabilities object in this one place instead of adding env vars.

## Architecture: the provisioner seam

Introduce a `PortalDomainProvisioner` interface that owns **status transitions and side
effects**. The server actions keep authentication, validation, and response-shaping, and
delegate the "what happens next" to a driver.

```
interface PortalDomainProvisioner {
  register(ctx): Promise<void>   // domain submitted or changed
  refresh(ctx):  Promise<void>   // poll / refresh
  retry(ctx):    Promise<void>   // retry after a failure
  disable(ctx):  Promise<void>   // remove the domain
}
// ctx = { knex, tenant, domain?, existing, canonicalHost }
```

Two implementations under `ee/server/src/lib/portal-domains/provisioner/`:

- **`temporalProvisioner`** (cloud, default) — today's behavior lifted verbatim out of the
  actions: `upsert(pending_dns)` + `enqueuePortalDomainWorkflow`, the DNS/cert status
  strings, and disable that enqueues the K8s-cleanup workflow.
- **`directProvisioner`** (appliance) — `register` upserts the row directly to `active` with
  a proxy-contract status message and `verificationDetails` describing the proxy target;
  `disable` **deletes the row**; `refresh` and `retry` are idempotent "ensure active"
  no-ops (there are no transient or failed states to recover from). No workflow, no
  Temporal, no Kubernetes.

### Driver selection

The provisioner factory (in `alga-core`, where the server actions run — not the worker)
selects the driver from `caps.portalDomain.provisioner`:

- **Cloud (`hosted` profile):** `temporal`. Zero behavior change.
- **Appliance (`appliance` profile):** `direct`.

The capabilities resolver **defaults to the `hosted` profile** (→ `temporal`) on an unset or
unknown `DEPLOYMENT_PROFILE` — the safe default for the common case. A misconfigured appliance
(profile omitted) produces a visible "stuck at `pending_dns`" symptom rather than silent
corruption, because the enqueue lands on a queue no worker services.

### Reject the app host as a vanity domain

The cloud already rejects `domain === canonicalHost`. The direct driver additionally rejects
`domain === NEXTAUTH_URL host`: choosing the app host itself would mark a row `active` that
the middleware never redirects (host equals canonical), a confusing no-op.

## Component and file changes

### New

- `shared/core/deployment-profile.ts` (or equivalent shared module) — `DEPLOYMENT_PROFILE`
  parsing + `resolveDeploymentCapabilities()` returning the typed capabilities object. Read by
  both the server actions and the middleware.
- `ee/server/src/lib/portal-domains/provisioner/types.ts` — interface + `ProvisionContext`.
- `ee/server/src/lib/portal-domains/provisioner/temporalProvisioner.ts` — extracted cloud
  behavior.
- `ee/server/src/lib/portal-domains/provisioner/directProvisioner.ts` — appliance
  trust-on-submit.
- `ee/server/src/lib/portal-domains/provisioner/index.ts` — factory selecting the driver from
  `caps.portalDomain.provisioner`.

### Modified

- `ee/server/src/lib/actions/tenant-actions/portalDomainActions.ts` — the five actions
  delegate side effects to the provisioner (selected from `caps.portalDomain.provisioner`);
  status-message literals move into the temporal driver; the status response gains a
  `mode: 'temporal' | 'direct'` field.
- `packages/tenancy/src/actions/tenant-actions/portalDomain.types.ts` — add `mode` to
  `PortalDomainStatusResponse` and surface the proxy fields in `verificationDetails`.
- `ee/server/src/components/settings/general/ClientPortalDomainSettings.tsx` — make the help
  text and checklist mode-aware: for `direct`, render the BYO-proxy contract instead of CNAME
  instructions. The refresh button stays (harmless re-fetch); retry never renders (no failure
  states); the `active` / `disabled` badges work unchanged. Add the "never seen on vanity
  Host" warning.
- i18n `msp/settings` — add the proxy-contract and warning strings.
- `helm/templates/deployment.yaml` — add a templated `DEPLOYMENT_PROFILE` env from
  `.Values.deploymentProfile | default "hosted"`. (The chart already injects env this way,
  e.g. `TEMPORAL_PORTAL_DOMAIN_TASK_QUEUE`.)
- `ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml` — set
  `deploymentProfile: appliance` (which yields `provisioner: direct` + `trustForwardedHost: true`).
- `ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml` — drop
  `portal-domain-workflows` from `taskQueue` and remove the empty `portalDomain` block. The
  appliance never loads K8s provisioning.

### Unchanged

Middleware vanity detection logic, OTT issuance/handoff, the domain-session route,
branding-by-domain, email link rewriting, the database migrations, and the CE stubs.

## Data flow

### Register (appliance)

1. MSP admin enters `portal.acme.com` → `requestPortalDomainRegistrationAction`.
2. The action authenticates, validates the domain (including the app-host rejection).
3. `directProvisioner.register` upserts the row as `active` with a proxy-contract message —
   no workflow.
4. The action returns the status; the Settings card shows **Active** immediately.

### End-user login on the vanity domain (unchanged)

1. A client visits `https://portal.acme.com/client-portal/...`.
2. The operator's proxy terminates TLS and forwards to `alga-core:3000`, **preserving
   `Host: portal.acme.com`** and sending `X-Forwarded-Proto: https`.
3. Middleware sees host ≠ `NEXTAUTH_URL` host → redirects to the canonical sign-in with
   `?portalDomain=portal.acme.com&callbackUrl=...`.
4. The user authenticates; branding is looked up by domain.
5. NextAuth's `jwt()` callback issues a one-time token via `computeVanityRedirect`.
6. The browser lands on the handoff page on `portal.acme.com`, which POSTs to
   `/api/client-portal/domain-session`.
7. That route validates the domain is `active`, consumes the OTT, sets the session cookie on
   `portal.acme.com`, and redirects to the originally requested path.

### Disable

1. The admin clicks Remove → `disablePortalDomainAction` → `directProvisioner.disable`
   deletes the row. Outstanding OTT rows cascade away (`portal_domain_session_otts` →
   `portal_domains` is `onDelete CASCADE`).
2. Middleware stops redirecting that host; the operator removes their proxy/DNS at leisure.

## The proxy contract

Shown in the Settings checklist in `direct` mode and in the troubleshooting docs:

1. Point `portal.acme.com` at this appliance (an A record to the appliance IP, or a CNAME to
   the app host).
2. On the reverse proxy: terminate TLS for `portal.acme.com` and proxy to
   `http://<appliance>:3000`, **preserving the original Host header**
   (`proxy_set_header Host $host;`) and sending `proxy_set_header X-Forwarded-Proto https;`.
3. Obtain and maintain the TLS certificate for `portal.acme.com` (the proxy's
   responsibility).
4. Enter the domain in Settings → it is active immediately.

## Header handling and misconfiguration warning

Domain distinction is by the **`Host`** header (`server/src/middleware.ts`), not
`X-Forwarded-For` — XFF carries the client IP, which is irrelevant here.
`X-Forwarded-Proto: https` is already consumed (the domain-session route) so that the app,
which receives plain HTTP behind the TLS-terminating proxy, sets the cookie `Secure` flag and
builds `https://` redirects correctly.

To make more proxy configurations work and to surface the dominant misconfiguration:

- **Trusted `X-Forwarded-Host` fallback.** A `resolveRequestHost()` helper in the middleware
  uses `Host` by default and falls back to `X-Forwarded-Host` only when
  `caps.trustForwardedHost` is set (appliance on, cloud off — trusting forwarded host headers
  is a host-injection consideration, so it is opt-in via the deployment profile).
- **Active-domain set + last-seen.** The provisioner maintains a Redis set of active vanity
  hostnames (register adds, disable removes). A request arriving on an active vanity Host
  records a last-seen timestamp.
- **Settings warning.** If a domain has been `active` for a while but no traffic has ever
  arrived on its Host (while canonical traffic flows), the Settings card shows: *"No requests
  have reached portal.acme.com yet — check that your reverse proxy forwards the Host
  header."*
- **Rewrite tell-tale.** When `X-Forwarded-Host` names an active domain but `Host` does not,
  the middleware emits a (rate-limited) log warning — the signature of a Host-rewriting proxy.

**Honest limitation:** if a proxy rewrites `Host` and sends *no* `X-Forwarded-Host`, the
original hostname is lost and the appliance has nothing to warn from. The warning is
best-effort.

**Implementation risk to validate:** whether Next.js middleware runs in the edge or node
runtime here, and whether it can reach Redis cheaply. If not, last-seen recording moves to the
first node-runtime touchpoint that sees the vanity Host (the signin redirect or the handoff
path).

## Edge cases

- **Links go live immediately.** Because trust-on-submit marks the row `active` at once,
  `ticketEmailSubscriber` and `portalInvitationActions` start rewriting links to the vanity
  domain right away. If the proxy/DNS is not yet live, those links break. The Settings copy
  states plainly: wire DNS + proxy **first**, then enter the domain.
- **Disable then re-add.** Delete-on-disable cascades to OTT rows; re-adding is a fresh
  insert with no stale state.
- **Multi-tenant appliance.** `portal_domains` is `UNIQUE(tenant)` and `UNIQUE(domain)`; the
  per-tenant upsert yields one row per tenant. A duplicate domain across tenants surfaces a DB
  error through the existing action error path. Single-MSP appliances never hit this.
- **`canonical_host` value.** The direct driver still stores the computed
  `<prefix>.portal.<appHost>` as an opaque unique value (no model change), but the UI does not
  present it as a CNAME target in `direct` mode.

## Testing

**Unit**

- `directProvisioner`: register → `active` with no workflow enqueued; disable → row deleted +
  OTT cascade; refresh/retry idempotent; reject `domain === NEXTAUTH_URL host` and
  `=== canonicalHost`.
- `temporalProvisioner`: regression — still upserts `pending_dns` and enqueues with the
  correct trigger (behavior-preserving extraction).
- `resolveDeploymentCapabilities`: `appliance` → `{ provisioner: 'direct', trustForwardedHost: true }`;
  `hosted` / unset / unknown → `{ provisioner: 'temporal', trustForwardedHost: false }`.
- Factory: reads `caps.portalDomain.provisioner` and returns the matching driver.
- Middleware `resolveRequestHost`: `Host` by default; `X-Forwarded-Host` honored only when
  `caps.trustForwardedHost` is set; tell-tale log-warn fires on XFH≠Host and not in the healthy
  case; last-seen recorded on an active vanity Host.

**Integration**

- In `direct` mode, registering creates the `active` row; an end-to-end login with a spoofed
  `Host: portal.acme.com` + `X-Forwarded-Proto: https` exercises redirect → OTT →
  domain-session → cookie-set, proving the app-level flow works with no cloud infrastructure.

**Cloud regression**

- Existing portal-domain tests run unchanged with the default `temporal` driver.

**Manual smoke (appliance)**

- Via `alga-appliance-local` with a real nginx/caddy in front:
  1. Host forwarded → portal works end-to-end.
  2. Host not forwarded → the warning appears in Settings.
  3. Disable → row gone, vanity host stops resolving to the portal.

## Out of scope

- On-appliance DNS verification, ACME/Let's Encrypt, cert-manager, or any ingress controller.
- A migration path for rows created by one driver when the driver later changes.
- An operator-facing (host-service `:8080`) surface — the domain is managed in-app.
