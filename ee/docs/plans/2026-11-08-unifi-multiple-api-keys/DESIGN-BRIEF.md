# UniFi: multiple API keys per integration (fabric-scoped keys)

Design brief, 2026-11-08. This is input for the Design Session, not the plan.
The Design Session turns it into `PRD.md`, `features.json` and `tests.json` in
this folder (alga-plan format).

## Credit

Found and diagnosed by **Ryan of Tom's Help Desk** (Discord and GitHub
`LightningManGTS`), reported in Discord on 2026-11-08. He worked out exactly how
UniFi Site Manager scopes API keys to fabrics, which is the whole reason this
fix is precise rather than guesswork. Every artifact this work produces (PR
description, release notes entry, customer-facing docs change, PSA ticket
note) must thank him by name. Example line:

> Thanks to Ryan at Tom's Help Desk for finding and diagnosing the fabric API key limitation.

## The report

Ryan's words, lightly trimmed:

> In the current Site Manager environment you can't make a "master" API key
> that encompasses both independent sites and sites that are part of a fabric.
> Under a key made in independent you can only access sites that are not
> already part of a fabric. You can get the list of all sites with that key,
> but you can't access any of the fabric specific sites as it doesn't have
> permission to those fabric sites. And if you make the key under a fabric it
> only lists those sites under the fabric.

He thinks this is newer UniFi behaviour. We could not find official Ubiquiti
documentation of fabric key scoping; treat his description as the spec and
confirm it against a real account if one becomes available.

## What Alga does today (main @ 2026-11-08, after PR 3711)

Site Manager mode reads consoles from `GET /v1/hosts`, then reads each
console's sites and devices through the Cloud Connector proxy
(`/v1/connector/consoles/{hostId}/proxy/network/integration/v1/...`).

With a key made under **Independent**:

- `/v1/hosts` returns every console, including the fabric ones.
- Connector calls to fabric consoles return 403. `UniFiApiClient.request`
  already classifies a connector 403 as `console_forbidden`, not a dead key
  (`ee/server/src/lib/integrations/unifi/unifiApiClient.ts:229`), so the
  integration is not marked reconnect-required.
- `listSites()` puts each fabric console in `failures`
  (`unifiApiClient.ts:387`). Scope sync finishes with a warning per console
  (`ee/server/src/lib/integrations/unifi/sync/syncEngine.ts:145`). Fabric sites
  never appear for mapping, so they get no assets and no offline alerts.
- If UniFi lets the site list through but denies device calls, each mapped
  site logs "device listing failed" every sync and is never tombstoned
  (fail-closed, `syncEngine.ts:365`). The alert fetcher treats it as an
  uncertain scope (`ee/server/src/lib/integrations/unifi/alerts/reconciliationFetcher.ts:348`).

With a key made under **a fabric**: only that fabric's consoles exist as far
as Alga knows; every independent console is invisible.

So nothing breaks, but an MSP with independent consoles plus any fabric (or
with two or more fabrics) can only ever cover one group.

## Root constraint

One key per tenant, by construction:

- `rmm_integrations` is unique on `(tenant, provider)`
  (`server/migrations/20251124000001_create_rmm_integration_tables.cjs:35`).
- The key is one tenant secret, `unifi_api_key`, plus `unifi_local_base_url`
  for local mode (`ee/server/src/lib/actions/integrations/uniFiActions.ts:255`).
- `createUniFiClient(tenant, mode)` builds exactly one client from those
  secrets (`unifiApiClient.ts:487`). Every consumer goes through it: device
  sync strategy, alert fetcher, settings actions.
- A 401 anywhere calls `markUniFiReconnectRequired(tenant)`, which flags the
  whole integration (`ee/server/src/lib/integrations/unifi/reconnect.ts`).
- Local mode uses the constant host id `local`
  (`UNIFI_LOCAL_HOST_ID`, `unifiApiClient.ts:26`), so two local controllers
  would collide on scope keys (`buildUniFiScopeKey` = `${hostId}:${siteId}`,
  `syncEngine.ts:36`).

## Goal

One UniFi integration per tenant that holds **any number of keys**, each a
Site Manager key (independent or fabric-scoped) or a local controller key.
Alga discovers consoles across all keys, routes each console to a key that
can actually reach it, and syncs and alerts on all of them. A tenant with one
key today sees no change at all.

Non-goals: multiple UniFi integrations per tenant (one integration, many
credentials); write operations against UniFi; generalising to other RMM
providers before a second provider actually needs it.

## Proposed design (recommendation; the Design Session decides)

### 1. Credentials become rows

A tenant-scoped table, e.g. `unifi_credentials`:
`tenant, credential_id, integration_id, label, mode ('site_manager'|'local'),
status ('active'|'reconnect_required'|'disabled'), last_error,
last_checked_at, created_at, updated_at`. The API key, and the local base
URL, stay in the secret provider under a per-credential name
(e.g. `unifi_api_key:<credential_id>`). Rows rather than a JSON array in
`rmm_integrations.settings` because each key has its own lifecycle state that
the UI, sync and alerts all read and write.

Migration: Citus rules apply (tenant distribution column, no `now()` inside
CASE/COALESCE, see the `citus-migration-gotchas` skill). Backfill one
credential per existing UniFi integration from the current secrets, labelled
"Default", keeping its mode. Leave the old secret names readable until the
backfill is verified, then delete them.

### 2. A multi-credential client behind the existing interface

Compose, don't flag. Keep `UniFiApiClient` as the single-key client and add a
client that owns N of them and exposes the same surface the consumers use
(`testConnection`, `listConsoles`, `listSites`, `listSitesForHost`,
`listDevices`, `getDevice`). `createUniFiClient` returns it. The sync engine,
alert fetcher and scope keys then need little or no change.

Console discovery and routing:

- Union `/v1/hosts` across all Site Manager credentials and de-duplicate by
  `hostId`. The independent key will list fabric consoles it cannot reach,
  so listing a console proves nothing.
- A console's **owner** is a credential whose connector call succeeds. Probe
  candidates in a stable order; a `console_forbidden` falls through to the
  next credential. Persist the owner (routing table or console metadata) so
  routine syncs don't re-probe; re-probe only when the owner returns
  `console_forbidden` or its credential is removed.
- A console no credential can reach becomes one clear, actionable warning:
  "Console X is visible but none of your keys can access it. If it belongs to
  a fabric, add a key created under that fabric." That is the message Ryan
  needed.
- Local credentials each contribute their single controller. The legacy
  local credential keeps host id `local` so existing scope keys
  (`local:<siteId>`) and asset mappings stay valid; new local credentials get
  a distinct host id with no `:` in it (`parseUniFiScopeKey` splits on the
  first `:`).

### 3. Failure isolation per key

- A 401 on one key marks **that credential** `reconnect_required`, not the
  integration. Its consoles become failed scopes: no tombstoning, alerts
  uncertain, exactly like today's per-console failure path.
- The integration is reconnect-required only when every credential is.
- Rate limiting is per key in UniFi; keep retry state per child client.

### 4. Settings UI

The UniFi settings screen becomes a list of keys: label, mode, status, number
of consoles it reaches, last error, with add, replace key, relabel and
remove. Use the standard settings and data-table components; never show
credential or host ids, show labels and console names. The site mapping table
can show which key reaches each site.

Removing a key: its consoles lose their owner; re-route if another key can
reach them, otherwise they become unreachable (fail-closed). Ask whether to
unmap the affected sites rather than deleting mappings silently.

Setup docs must explain fabric-scoped keys: one key under Independent, plus
one key per fabric.

### 5. Security: fold in the key-exfiltration finding

Backlog card `42434e43-45b3-58a1-a2ce-2658c56b5686` ("Security: secrets in
saveUniFiConfiguration") reports that saving a new local controller URL
without re-entering the key sends the stored key to the new URL. This work
rewrites that save path, so the fix belongs here: **a stored key is only ever
sent to the destination it was saved with**. Changing a credential's mode or
base URL requires entering its key again. Tell the XO when the plan covers
it so that card can be closed as fixed-by, or stack it, rather than both
cards editing `uniFiActions.ts` at once.

Also related but independent: `6dc0028c-df46-5358-9b49-6e5c44bb27e0`
(Advanced Assets entitlement check in `uniFiDeviceSyncStrategy`), and
`c0758497-cbe5-426e-ba86-2cf4e85e3757` (verify Site Manager cloud mode with an
emulator). The emulator work below directly serves that card.

## Testing (80/20)

Extend the UniFi simulator (`tools/smoke-sim/unifi-sim/unifi-controller-sim.mjs`)
and, if it lands first, the algasim emulator suite, with fabric-scoped keys:
key A lists every host but gets 403 from the connector on fabric consoles;
key B lists only the fabric's hosts. That reproduces Ryan's setup exactly.

High-value tests:

- Routing: with keys A and B, every console resolves to a reaching key,
  fabric consoles go to B, and nothing is reported unreachable.
- Only key A: fabric consoles produce the "add a fabric key" warning, and
  independent consoles sync normally.
- Per-key auth isolation: a 401 on key B marks only B; key A's sites keep
  syncing and B's sites are neither tombstoned nor auto-resolved.
- Migration: an existing single-key tenant (both modes) backfills to one
  credential and keeps every scope key and asset mapping.
- Two local controllers do not collide on scope keys.
- Security: changing a credential's destination without a new key is
  rejected and no request carries the old key.

Smoke: in the dev stack against the simulator, connect two keys, map one
independent site and one fabric site, run device sync and an alert cycle,
and confirm assets and an offline-alert ticket for both.

## Open questions for the Design Session

1. Credentials table vs. JSON in `rmm_integrations.settings` (recommendation:
   table).
2. Where the console-to-key routing lives (dedicated table vs. mapping
   metadata) and when it is re-probed.
3. Can one integration mix local controllers and Site Manager keys? The
   design above allows it; confirm the UI stays understandable.
4. Behaviour when two keys can both reach a console (first by stable order is
   the proposal).
5. Whether to ask Ryan to try the branch against his real fabric setup before
   merge. He's offered detailed reports before and has the exact
   configuration.
