# PRD — UniFi: multiple API keys per integration (fabric-scoped keys)

Card: `fd64fb8d-bf2f-4348-a7ab-d77a2d7b0d4a` — PSA ticket alga-2026-0003148
(Tom's Help Desk).
Reported in Discord on 2026-11-08 by **Ryan, Tom's Help Desk** (GitHub
`LightningManGTS`). Input: `DESIGN-BRIEF.md` in this folder (code walk-through,
root constraint, test list). This PRD is the decision record; the brief is the
evidence.

## 1. Product question, answered first

**Question.** What does Alga promise when a UniFi Site Manager key cannot cover
every console the tenant owns?

**Answer: Alga must make "which key can see what" an explicit, editable fact,
and must never silently drop consoles.** Today a tenant stores exactly one
UniFi key. UniFi now scopes keys: a key created under *Independent* lists every
console through `/v1/hosts` but gets 403 from the Cloud Connector on every
fabric console; a key created under a *fabric* sees only that fabric. Therefore
an MSP with independent consoles plus a fabric — or with two fabrics — can
cover at most one group, and today the rest are skipped with a per-sync
warning nobody reads.

The fix is not "better error handling". It is that **credentials become a
first-class collection** on one integration, each console is routed to a
credential that can actually reach it, and a console nobody can reach is a
single actionable message naming the fabric-key remedy.

**Acceptance shape (the customer's own case).** A tenant adds a key created
under Independent and a key created under one fabric. Discovery unions both
keys' consoles; each console resolves to a reaching key; device sync and alert
evaluation run for independent sites and fabric sites alike with no warning.

## 2. Scope

In scope:

- N credentials under one UniFi integration per tenant (Site Manager and local
  controller credentials may mix).
- Console discovery across credentials, ownership/routing, persistence.
- Per-credential failure isolation (401 marks that key, not the integration).
- Settings UI: list/add/replace/relabel/remove keys; site table shows the key.
- Migration of existing single-key tenants with **zero scope-key or asset
  churn**.
- The key-exfiltration fix from backlog card `42434e43` (see §6) — this work
  rewrites the same save path.

Out of scope: more than one UniFi integration per tenant; UniFi write
operations; generalising multi-credential RMM handling to other providers;
new alert types.

## 3. Data model

### 3.1 `unifi_credentials` (new table)

| column | type | notes |
|---|---|---|
| `tenant` | uuid | Citus distribution column |
| `credential_id` | uuid | default `gen_random_uuid()` |
| `integration_id` | uuid | FK `(tenant, integration_id)` → `rmm_integrations`, cascade |
| `label` | text | operator-facing, unique per integration (case-insensitive) |
| `mode` | text | `'site_manager'` \| `'local'` |
| `local_host_id` | text | nullable; local mode only (see §4.3) |
| `status` | text | `'active'` \| `'reconnect_required'` \| `'disabled'` |
| `last_error` | text | nullable |
| `last_checked_at` | timestamptz | nullable |
| `created_at` / `updated_at` | timestamptz | `notNullable().defaultTo(knex.fn.now())` |

Primary key `(tenant, credential_id)`; unique `(tenant, credential_id)` plus a
partial unique on `(tenant, integration_id, lower(label))`; index
`(tenant, integration_id, status)`.

Rows, not a JSON array in `rmm_integrations.settings`, because each key has its
own lifecycle state written by sync, alerts and the settings actions, and a
per-key reconnect flag is read on every sync. JSON would serialise concurrent
writers and lose the atomic "mark only this key" update.

Secrets stay in the secret provider, **one secret name per credential**:
`unifi_api_key:<credential_id>` and, for local mode,
`unifi_local_base_url:<credential_id>`. The legacy unnamed secrets
(`unifi_api_key`, `unifi_local_base_url`) are read only by the migration and
then deleted once the backfill verifies (§8).

### 3.2 `unifi_console_routes` (new table)

| column | type | notes |
|---|---|---|
| `tenant` | uuid | distribution column |
| `integration_id` | uuid | FK cascade |
| `host_id` | text | UniFi console host id, or a local credential's host id |
| `credential_id` | uuid | FK `(tenant, credential_id)` cascade — the *owner* |
| `console_name` | text | cached for the UI warning |
| `state` | text | `'routed'` \| `'unreachable'` |
| `last_error` | text | nullable |
| `first_seen_at` / `last_verified_at` | timestamptz | |

Primary key `(tenant, integration_id, host_id)`. One row per console: the
console→key association is a fact about the world, not per-key metadata, and
making it a table lets removal of a credential re-route deterministically with
one indexed query.

**Re-probe policy.** A row is trusted while its credential is `active` and the
observation is younger than 24 h. It is re-probed when (a) any call to that
console returns `console_forbidden`/401, (b) its credential is disabled,
removed or replaced, (c) a full sync runs, or (d) the operator presses
"Re-check consoles". Routine incremental syncs use the persisted route; that is
the whole point of persisting it.

## 4. Client composition and routing

**Compose, don't flag.** Keep `UniFiApiClient` exactly as the single-key client
(it already classifies `console_forbidden` at `unifiApiClient.ts:229`). Add
`UniFiFleetClient` that owns N `UniFiApiClient`s plus the routing table and
exposes the consumers' surface: `testConnection`, `listConsoles`, `listSites`,
`listSitesForHost`, `listDevices`, `getDevice`. `createUniFiClient(tenant,
mode?)` returns a fleet client with one child when the tenant has one
credential — so a today-tenant sees identical behaviour and call sites do not
change. Consumers (`deviceSyncStrategy.ts`, `reconciliationFetcher.ts`,
`uniFiActions.ts`) keep calling `createUniFiClient`; the `mode` argument becomes
optional and, when supplied by legacy callers, only filters which credentials
are used.

### 4.1 Discovery

Union `/v1/hosts` across all `site_manager` credentials **that are active**,
de-duplicate by `hostId`. Listing proves nothing about reachability: the
Independent key lists fabric consoles it will 403 on.

### 4.2 Ownership resolution

For each console with no trusted route, probe candidate credentials in a stable
order — credentials with `mode='local'` matching the local host id first, then
`site_manager` credentials by `created_at` ascending (oldest first) — until a
connector call succeeds. A `console_forbidden` falls through to the next
credential; a 401 marks that credential `reconnect_required` and also falls
through (another key may work). The first success is written as `routed`.

Deterministic tie-break (§open q4): first credential in that stable order wins,
and it stays the owner until re-probe. Ownership does not flap between syncs.

### 4.3 Local controllers

Each local credential owns exactly one controller. The credential created by
the migration keeps `local_host_id='local'`, preserving every existing
`local:<siteId>` scope key and asset mapping. New local credentials get a
generated host id containing no `:` (e.g. `local-2`), because
`parseUniFiScopeKey` splits on the first colon. Local credentials never see
other consoles and are never probed for Site Manager hosts.

### 4.4 Unreachable consoles

A console for which every credential failed becomes `state='unreachable'` and
produces exactly one warning per console, surfaced in the settings screen and
as one line in the sync result:

> Console **X** is visible but none of your keys can access it. If it belongs
> to a fabric, add a key created under that fabric.

That sentence is the deliverable Ryan needed.

## 5. Failure isolation

- A 401 on one credential sets **that row** to `reconnect_required` and its
  consoles to failed scopes: no tombstoning, alerts uncertain — the existing
  per-console failure path (`syncEngine.ts:365`,
  `reconciliationFetcher.ts:348`) already does this once the route resolves to
  a credential.
- The **integration** is marked reconnect-required only when every credential
  is (`reconnect.ts` unchanged, fed by the fleet client's aggregate).
- Rate-limit and retry state live per child client; one throttled key must not
  slow the others. Child clients are independent, so this falls out of
  composition.

## 6. Security: a stored key is bound to its destination

Backlog card `42434e43` (secrets in `saveUniFiConfiguration`) reports that saving
a new local controller URL without re-entering the key sends the stored key to
the new URL. This PRD rewrites that path, so the fix lands here.

**Rule: a stored key is only ever sent to the destination it was saved with.**
Changing a credential's `mode` or local base URL requires entering its key
again in the same submission. The save action validates the pair (new key to
new URL) before persisting anything, and only then writes both secret and URL.
A stored key is never reused with a different `local_host_id`/URL, and no
request is issued to the old destination with the new key (or vice versa).
Backlog card `42434e43` is then closed as fixed-by this card; it must not edit
`uniFiActions.ts` in parallel.

## 7. Settings UI

The UniFi settings screen becomes a credentials list: label, mode, status,
#consoles reached, last error, last checked; actions add, replace key, relabel,
remove. Standard settings + data-table components. Never render credential ids
or host ids — labels and console names only.

- Site mapping table gains a "Reached by" column showing the credential label
  reaching each site.
- Removing a credential: its consoles lose their owner; re-route immediately
  among remaining credentials, mark the rest unreachable (fail-closed). Ask
  whether to unmap affected sites; never delete mappings silently.
- Setup docs updated: one Independent key plus one key per fabric.

## 8. Migration

New migration (Citus rules: tenant distribution column, no `now()` inside
CASE/COALESCE; see `citus-migration-gotchas`). Backfill: for each UniFi
`rmm_integrations` row, insert one `unifi_credentials` row with label
`Default`, `mode` from existing settings, `status='active'`, copying the
existing secret value to `unifi_api_key:<new id>` (and the local URL secret for
local mode). Insert `unifi_console_routes` lazily — no route backfill: the first
sync after migration resolves consoles through the one credential and writes
routes, which is exactly today's behaviour and preserves scope keys because the
local host id stays `local`.

Legacy unnamed secrets: keep readable for one release, delete in a follow-up
migration after a verified backfill. `readUniFiCredentials` keeps a
legacy fallback used only when zero credential rows exist (defensive, and what
makes rollout safe if the backfill and code deploy are staggered).

## 9. Observability

- Sync result carries `credentials: [{label, status, consolesReached}]` and
  `unreachableConsoles: [{hostId, name, suggestedAction}]`.
- `last_error` on the credential row is the UI's source of truth; do not rely on
  log grepping.
- The existing per-console warnings remain but are deduplicated to the one
  unreachable-console line above.

## 10. Decisions on the brief's open questions

1. **Table vs JSON** — table (§3.1); per-key lifecycle state is written
   concurrently.
2. **Routing home** — dedicated `unifi_console_routes` (§3.2), re-probe policy
   in §3.2.
3. **Mix local and Site Manager** — yes; grouped by mode in the UI so the screen
   stays understandable.
4. **Two keys reach one console** — first by stable order (§4.2), persisted.
5. **Ask Ryan to test the branch** — yes, as a courtesy pre-merge check, not a
   gate. Record his confirmation on the card if it arrives; do not block merge
   on it.

## 11. Testing strategy (80/20)

Extend the UniFi simulator
(`tools/smoke-sim/unifi-sim/unifi-controller-sim.mjs`) with fabric-scoped keys:
key A lists all hosts but 403s the connector on fabric consoles; key B lists
only its fabric. High-value tests: routing across two keys, single-key warning
path, per-key 401 isolation, migration fidelity, two local controllers without
scope-key collision, and destination binding on save. Smoke: two keys, map one
independent and one fabric site, run device sync and an alert cycle, confirm
assets and an offline-alert ticket for both.

## 12. Credit and communications

Every artifact — PR description, release notes, customer docs, PSA ticket note
— thanks Ryan by name:

> Thanks to Ryan at Tom's Help Desk for finding and diagnosing the fabric API
> key limitation.

Also record on the PSA ticket alga-2026-0003148 (Tom's Help Desk) that the
design covers fabric-scoped keys and points at this plan.
