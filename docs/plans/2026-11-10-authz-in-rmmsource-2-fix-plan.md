# Fix plan — authz in `rmmSource` (card: Security: authz in rmmSource)

- **Finding:** authz · high — `packages/integrations/src/actions/integrationHealthActions.ts` (`rmmSource`)
- **Fingerprint:** `packages/integrations/src/actions/integrationHealthActions.ts#rmmSource`
- **Source PR:** https://github.com/Nine-Minds/alga-psa/pull/3981 · merge `dc46a3315dff`
- **Verdict:** Finding is **real and reproducible on this branch.** The fix does not yet exist.

## 1. The defect, precisely

`getIntegrationHealthAlerts` is a `'use server'` action wrapped only by `withAuth`
(`packages/integrations/src/actions/integrationHealthActions.ts:433-454`). `withAuth`
establishes an authenticated session and tenant but does **not** distinguish an MSP
principal from a client-portal principal — any authenticated user of the tenant can
invoke the action directly (the browser banner at
`packages/integrations/src/components/IntegrationHealthBanner.tsx:78` only renders inside
the MSP shell `server/src/components/layout/DefaultLayout.tsx:458`, but the server action
is reachable regardless of which UI a principal uses).

The action fans out to every registered source
(`integrationHealthActions.ts:421-427, 439-451`). Each source carries its own
authorization gate, and every one of them except `rmmSource` uses an **MSP-only**
permission:

- `inboundEmailSource` → `ticket_settings:read` (catalog: `client:false`, line 329)
- `accountingSource` → `accounting_integrations:catalog_read` (MSP-only)
- `teamsBotSource` → `system_settings:update` (catalog: `client:false`, line 299)

`rmmSource` is the outlier. Its only gate is
`hasPermission(user, 'settings', 'read')` (`integrationHealthActions.ts:207`). In the
permission catalog, `settings:read` is **client-capable**:

```
server/migrations/utils/permissions/catalog.cjs:272
{ resource: 'settings', action: 'read', msp: true, client: true, ...
  defaultGrants: { psa: ['client:Admin', 'client:Finance', 'msp:Admin'], ... } }
```

`hasPermission` evaluates client-portal principals against `permission.client`
(`packages/auth/src/lib/rbac.ts:94-104`), so a client-portal **Admin or Finance** user —
granted `settings:read` by default — passes the gate.

`rmmSource` then reads the **tenant-wide** `rmm_integrations` table with no per-client
scoping (`integrationHealthActions.ts:213-216`) and, for every unhealthy integration,
emits an alert exposing MSP-owned data (`integrationHealthActions.ts:220-248`):

- `providerName` — the RMM provider (e.g. NinjaOne),
- `id` — contains the integration UUID (`rmm-${row.integration_id}-${reason}`),
- the `reconnect_required` lifecycle state,
- `detail` — the **raw `sync_error` string** (`:241`, `push('rmm_sync_error', row.sync_error ?? providerName)`).

**Attack path:** a client-portal Admin/Finance user authenticates to the client portal,
directly invokes the `getIntegrationHealthAlerts` server action, and — whenever any RMM
integration is unhealthy — receives the provider, integration UUID, reconnect state, and
raw provider sync-error text for an MSP-wide integration that is entirely outside that
client's authority.

Note that the real RMM settings reads this gate was copied from
(`getNinjaOneConnectionStatus`, `ee/server/src/lib/actions/integrations/ninjaoneActions.ts:339`)
also use `settings:read`, but wrap it in `withAdvancedAssetsAccess` — which only asserts a
license *tier* (`ninjaoneActions.ts:86-93`), **not** an MSP-vs-client distinction. So the
comment at `integrationHealthActions.ts:205-206` ("same gate as getNinjaOneConnectionStatus")
is misleading: the EE action is not meaningfully MSP-gated either, but it is not exposed to
the client-portal shell the way this banner action is. The client-capability of `settings:read`
is the actual bug, and it should be fixed here regardless.

**Secondary leak:** even for an authorized MSP user, the banner UI never renders the RMM
`detail` field. The `rmm_sync_error` message
(`IntegrationHealthBanner.tsx:38`) interpolates only `{{providerName}}`; `detail` is bound
to the `mailbox` placeholder (`:129`) which the RMM messages do not reference. So the raw
`sync_error` is serialized across the wire and never used — it should not be in the payload
at all.

## 2. The fix

Two enforcement points, chosen so the same class of bug cannot recur in a sibling source,
plus removal of the unused-but-leaked field.

### 2a. Primary (class-level) gate — reject non-MSP principals at the aggregation seam

File: `packages/integrations/src/actions/integrationHealthActions.ts`, function
`getIntegrationHealthAlerts` (`:433`).

This banner is unambiguously an MSP-shell concern: every `href` points at `/msp/...`
settings pages (`:80-88`) and every source already intends MSP-only permissions. The
single enforcement point that cannot be bypassed by any source's individual gate is the
exported action itself. Before running any source, reject client-portal principals:

```ts
import { isMspPrincipalUserType } from '@alga-psa/types'; // userTypes.ts:35

export const getIntegrationHealthAlerts = withAuth(async (user, { tenant }) => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return [];
  }
  ...
});
```

Returning `[]` (not throwing) matches the action's existing fail-soft contract
(`:441-449`) and the banner's empty-state handling. This one guard protects *all five*
sources — including any future source a developer adds with a client-capable permission by
mistake — so it is the general fix the source registry's structure calls for.

### 2b. Defense-in-depth — correct `rmmSource`'s own gate

File: same, function `rmmSource` (`:204-210`). Even with 2a in place, `rmmSource`'s local
gate should not rely on a client-capable permission (so the source is correct in isolation
and a future caller that reuses it is safe). Replace
`hasPermission(user, 'settings', 'read')` with an MSP-only permission consistent with the
other sources. Preferred: `hasPermission(user, 'system_settings', 'read')`
(catalog `:298`, `client:false`, MSP-Admin) — the same family `teamsBotSource` uses and
the suggested fix. Update the now-inaccurate comment at `:205-206`.

(Leaving the gate as `settings:read` but adding an `isMspPrincipalUserType` check inside
`rmmSource` is an acceptable alternative, but changing the permission is cleaner and makes
the source's MSP intent explicit without duplicating the principal check 2a already owns.)

### 2c. Stop leaking raw `sync_error` in the payload

File: same, `rmmSource` `push('rmm_sync_error', ...)` (`:241`). The UI does not consume
`detail` for RMM reasons, so pass `providerName` (or `''`) rather than `row.sync_error`:

```ts
if (row.sync_status === 'error') {
  push('rmm_sync_error', providerName);
}
```

Drop `sync_error` from the `.select(...)` at `:216` once it is no longer read. This removes
the raw provider error text from the serialized response entirely, even for authorized MSP
users where the banner never displays it.

### Why a shared helper is *not* the right home here

The missing concept is "this action is MSP-shell-only." That is a property of the exported
action, not of a reusable permission helper — `hasPermission` and `isMspPrincipalUserType`
already exist and are the right primitives. The correct "shared" move is placing the guard
at the single aggregation point (2a) so every source inherits it, rather than threading an
identical principal check through each source. No new abstraction is warranted.

## 3. The proof

Add tests to `packages/integrations/src/actions/integrationHealthActions.test.ts` (the
harness already supports a `client` `user_type` via `sessionUser.user_type` and a
per-resource/action `hasPermissionMock`, and records table calls in `tableCalls`).

1. **`getIntegrationHealthAlerts` returns `[]` for a client-portal principal even when RMM
   data is unhealthy and `settings:read` is granted.**
   Arrange: `sessionUser.user_type = 'client'`; `hasPermissionMock` returns `true` for
   `settings:read`; `tableRows.current.rmm_integrations` has a row with
   `sync_status: 'error'`, `sync_error: 'SECRET-PROVIDER-ERROR'`.
   Assert: result is `[]`, and `tableCalls` contains **no** read of `rmm_integrations`
   (proves the guard short-circuits before the query, i.e. no tenant-wide read happens).
   *Fails before the fix:* today the client principal passes `settings:read`, the
   `rmm_integrations` query runs, and an `rmm-...-rmm_sync_error` alert carrying
   `SECRET-PROVIDER-ERROR` is returned.

2. **`rmm_sync_error` alert never carries the raw `sync_error`.**
   Arrange: MSP principal; `rmm_integrations` row with `sync_status: 'error'`,
   `sync_error: 'SECRET-PROVIDER-ERROR'`.
   Assert: the emitted alert's `detail` equals the provider title (not
   `'SECRET-PROVIDER-ERROR'`), and the serialized alert contains no occurrence of
   `SECRET-PROVIDER-ERROR`.
   *Fails before the fix:* `detail` is currently `row.sync_error`.

3. **(Regression-lock for 2b) `rmmSource` is gated on an MSP-only permission.**
   Arrange: MSP principal for whom `hasPermissionMock` returns `false` for the new RMM
   permission; unhealthy `rmm_integrations` row present.
   Assert: no `rmm-*` alerts returned.
   *Fails before the fix:* gate keys off `settings:read`, so a principal without the
   intended permission could still read.

Existing MSP-happy-path RMM tests (e.g. `integrationHealthActions.test.ts:278, 515`) must
continue to pass with the MSP principal, confirming the fix does not regress legitimate
alerts.

## 4. Scope deliberately excluded, and risks to weigh

**Not doing:**

- **Re-gating the EE NinjaOne/Level/Huntress actions** (`ninjaoneActions.ts`, etc.). They
  also use `settings:read` behind `withAdvancedAssetsAccess`, but they are not surfaced to
  the client-portal shell and are a separate, larger audit. Flag for a follow-up card;
  out of scope for this finding's fingerprint.
- **Changing the `settings:read` catalog entry's `client:true`** (`catalog.cjs:272`). That
  permission is legitimately client-capable for actual client-portal settings; narrowing it
  would be a broad, risky change touching unrelated flows. The fix belongs at the consumer.
- **Per-client scoping of `rmm_integrations`.** RMM integrations are MSP-owned with no
  client dimension; the correct answer is "clients see none," which 2a delivers. No
  client-scoped RMM view is in scope.

**Risks / regressions a reviewer should weigh:**

- **Behavioral change for client principals:** if any client-portal surface ever intended
  to show integration-health alerts, 2a silently removes them. Evidence says none does (the
  banner mounts only in MSP layouts; all hrefs are `/msp/...`), but a reviewer should
  confirm there is no client-portal mount of `IntegrationHealthBanner`.
- **Permission choice in 2b:** switching to `system_settings:read` narrows who among MSP
  users sees RMM alerts (MSP Admin only, vs. anyone with `settings:read`). This is a
  tightening; confirm it matches the intended MSP audience for RMM health, or choose a
  wider MSP-only permission if product wants Finance/Manager to see them too. Either way the
  permission must be `client:false`.
- **Dropping `sync_error` from `.select`:** verify no other code path in `rmmSource` reads
  it (it does not today) before removing the column from the query.
