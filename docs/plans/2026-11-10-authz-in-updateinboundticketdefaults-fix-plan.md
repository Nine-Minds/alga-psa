# Fix plan: authorization on inbound ticket defaults

**Card:** Security: authz in updateInboundTicketDefaults
**Finding (f4, high, authz):** `packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions.ts` — `updateInboundTicketDefaults` (and its sibling create/delete/read actions) perform no authorization.
**Source review:** security review of PR #3984 (merge `ad16c90abfee`). The finding explicitly notes PR 3984 did not introduce this; it is an adjacent authentication-only email-settings action.

I agree with the finding. It is real, reachable, and matches the code as it stands on this branch. No fix exists here yet.

---

## 1. The defect

`inboundTicketDefaultsActions.ts` wraps every exported action in `withAuth` (`packages/auth/src/lib/withAuth.ts:151-179`). `withAuth` only **authenticates** — it resolves the session user, enforces tenant context, and (for co-managed workspaces) an acceptance gate. It performs **no permission check** and no client-vs-MSP distinction. The wrapped actions here deliberately name their user parameter `_user` and never consult it:

- `getInboundTicketDefaults` — `:77-113` (`_user`, no check)
- `createInboundTicketDefaults` — `:115-197` (`_user`, no check)
- `updateInboundTicketDefaults` — `:199-311` (`_user`, no check)
- `deleteInboundTicketDefaults` — `:313-373` (`_user`, no check)
- `getInboundTicketDefaultsById` — `:375-406` (`_user`, no check)

So **any authenticated user in the tenant** — including a client-portal user (`user_type === 'client'`) — can call these. The validation that does exist (`assertTicketStatusBelongsToBoard` `:58-75`, `assertLocationBelongsToClient` `:33-56`) only enforces referential consistency, not authority.

**Caller reaching it.** The browser form `InboundTicketDefaultsForm.tsx` imports and invokes `updateInboundTicketDefaults`/`createInboundTicketDefaults` directly (`:12-13`, `:282-284`). Server actions are addressable POST endpoints: a caller does not need the UI — any authenticated session can invoke the action with an arbitrary `id` and a caller-controlled `data` payload (client_id, board_id, status_id, priority_id, category_id, subcategory_id, location_id, entered_by).

**Concrete attack path (reroute + misattribute future inbound mail):**
1. A low-privilege authenticated user (no ticket-settings authority, or a client-portal user) POSTs the `updateInboundTicketDefaults` server action with the tenant's existing defaults `id` and `{ client_id: <attacker-chosen>, board_id, status_id, priority_id, entered_by: <chosen user id> }`.
2. The action writes those fields to `inbound_ticket_defaults` (`:257-294`). `id` is tenant-scoped via `tenantDb(...).where({ id })` but otherwise unrestricted.
3. Inbound email processing later loads that row and uses it as the ticket destination: `targetClientId = ruleAssignedClientId ?? matchedSenderClientId ?? defaults.client_id` (`shared/services/email/processInboundEmailInApp.ts:1975`) and persists `board_id`, `status_id`, `priority_id`, `category_id`, `subcategory_id`, `location_id`, and `entered_by` onto **every new ticket** created from unmatched inbound mail (`:2087-2102`).
4. Result: future inbound-email tickets are routed to a client the attacker chose, placed on a board/status/priority they chose, and attributed to an `entered_by` identity they chose. `createInboundTicketDefaults` and `deleteInboundTicketDefaults` give the same leverage (plant a new default / orphan a provider's defaults). The reads (`getInboundTicketDefaults`, `getInboundTicketDefaultsById`) leak the tenant's routing configuration to any authenticated user.

This is a genuine authorization gap, not a false positive: the code confirms no guard on any path, the server-action boundary is directly reachable, and the consumer trusts the row.

---

## 2. The fix

**Approach: a shared MSP-only guard, mirroring the established sibling pattern**, so the same class of bug is closed for the whole inbound-defaults surface at the one boundary that cannot be bypassed — the server action itself. There is no deeper choke point: `processInboundEmailInApp` is the *consumer* and runs in the worker with no acting user, so enforcement must live at the write/read boundary.

### 2a. The enforcement point

The server actions in `inboundTicketDefaultsActions.ts` are the single enforcement point. Every browser/API path and the direct-action-invocation path pass through these five functions; there is no other writer of `inbound_ticket_defaults` reachable by an end user. Guarding each action closes the UI-bypass route the finding calls out.

### 2b. Reuse the existing permission model (do not invent one)

The repo already standardizes on `ticket_settings` as the MSP-only permission governing email/inbound configuration, applied via `hasPermission(user, 'ticket_settings', <action>, knex)` from `@alga-psa/auth/rbac` (`packages/auth/src/lib/rbac.ts:71`). Precedent on sibling actions:

- `emailProviderActions.ts:1681,1727` → `ticket_settings:update` for provider diagnostics.
- `inboundPauseActions.ts:15-17` → `canConfigureEmailProviders` = `ticket_settings:update`.
- `ticketFieldOptionsActions.ts:117,225,253,…` → `ticket_settings:read` for reads.
- `mspOutboundEmailAccess.ts` → shared guard `requireOutboundEmailAdmin` / `isClientUser`: **rejects client users before any permission lookup**, then requires `ticket_settings:update`.

This matches the finding's suggested fix (`ticket_settings:read` for reads, `ticket_settings:update` for create/update/delete, reject client users before DB access) exactly.

### 2c. Shared helper (the right home)

Add a small guard module beside `mspOutboundEmailAccess.ts`, e.g. `packages/integrations/src/actions/email-actions/mspInboundTicketDefaultsAccess.ts`, exposing:

```ts
export function requireInboundTicketDefaultsAdmin(
  user, knex, mode: 'read' | 'write'
): Promise<InboundDefaultsAdminCheck>
```

- Reject `isClientUser(user)` first (reuse `isClientUser` from `mspOutboundEmailAccess.ts` rather than re-implementing), returning a denial **before** any DB work.
- Then require `hasPermission(user, 'ticket_settings', mode === 'read' ? 'read' : 'update', knex)`.
- Return the same discriminated-union shape as `OutboundEmailAdminCheck` (`{ allowed: true } | { allowed: false; reason; message }`) so callers can branch uniformly and compile without `strictNullChecks` (ee/server).

A dedicated helper (vs. inlining `hasPermission`) is justified because five actions need the identical two-step (client-reject → permission) check and two existing test harnesses plus future inbound-defaults actions will share it; it is the minimal shared mechanism the problem's structure already calls for, consistent with the outbound sibling. It does **not** add flags/modes beyond the `read`/`write` distinction the permission catalog itself draws.

> LEVERAGE note (do not build in this card): `mspOutboundEmailAccess.ts` and the proposed `mspInboundTicketDefaultsAccess.ts` are the same shape (`isClientUser` → `hasPermission('ticket_settings', …)`). If a third email-config guard appears, collapse them into one `requireTicketSettingsAccess(user, knex, 'read'|'update')` helper. Flagged, not actioned.

### 2d. Per-action changes in `inboundTicketDefaultsActions.ts`

For each action, rename `_user` → `user`, take the guard result immediately after `createTenantKnex()` (before any `tenantDb(...).table(...)` call), and return the action's native error shape on denial:

- `getInboundTicketDefaults` (`:77`), `getInboundTicketDefaultsById` (`:375`): guard `'read'`; on denial return `{ defaults: [], error: 'Permission denied' }` / `{ defaults: null, error: 'Permission denied' }` (these already return a `{ defaults, error }` shape, and the provider forms that call `getInboundTicketDefaults` — `EmailProviderList.tsx:71`, `ImapProviderForm.tsx:150`, `GmailProviderForm.tsx:108`, `MicrosoftProviderForm.tsx:263`, `InboundEmailRuleForm.tsx:141` — already handle an `error` field, so a denial degrades gracefully).
- `createInboundTicketDefaults` (`:115`), `updateInboundTicketDefaults` (`:199`), `deleteInboundTicketDefaults` (`:313`): guard `'write'`; on denial return `actionError('Permission denied', 'errors.permissionDenied')` (the existing `InboundTicketDefaultsActionError` shape, consistent with `emailSettingsActions.ts:129`).

Keep the client-user rejection ahead of `createTenantKnex()`/any table access so the "reject client users before database access" requirement holds literally (mirror `emailSettingsActions.ts:462-463`: check `isClientUser` first, then acquire knex, then the permission check).

### 2e. Permission catalog

No migration needed: `ticket_settings` with `read`/`update` already exists in `server/migrations/utils/permissions/catalog.cjs` and is MSP-only (`msp: true, client: false`), already used by the sibling actions above. Confirm during implementation that both `read` and `update` rows are seeded for the default MSP roles (they are referenced by `ticketFieldOptionsActions` reads and `emailProviderActions` writes respectively).

---

## 3. The proof (tests)

Add a focused unit test file `packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions.authz.test.ts`, modeled on `emailSettingsActions.outboundAccess.test.ts` — in particular its DB-access tripwire: mock `tenantDb().table()` to **throw** (`unexpected DB access`), so any permission check that runs *after* a DB read is caught, and record `hasPermission` calls. Mock `withAuth` to pass a controllable `sessionUser` (`user_type`, `tenant`), and mock `@alga-psa/auth/rbac`'s `hasPermission` via a `grant(...)` helper.

Assertions, per action:

1. **Client user is rejected before any DB access or permission lookup.** Set `user_type: 'client'`; call `updateInboundTicketDefaults('id', { client_id: 'attacker' })`. Assert it returns a permission-denied error, `hasPermission` was **not** called, and the DB tripwire never fired. *Fails before the fix:* today the action ignores `_user`, immediately calls `tenantDb(knex, tenant).table('inbound_ticket_defaults')` (`:221`), so the tripwire throws / the update proceeds — no denial is returned.
2. **MSP user lacking `ticket_settings:update` is rejected for writes.** `grant()` (none); call create/update/delete. Assert permission-denied and no DB write. *Fails before the fix:* no permission check exists, so the write path is entered.
3. **MSP user lacking `ticket_settings:read` is rejected for reads.** `grant()`; call `getInboundTicketDefaults` / `getInboundTicketDefaultsById`. Assert `{ error: 'Permission denied' }` and `defaults` empty/null. *Fails before the fix:* read returns live data.
4. **Authorized MSP user passes the gate.** `grant('ticket_settings:update')` / `('ticket_settings:read')`; assert `hasPermission` was called with the expected `(resource, action)` and the action proceeds to DB work. Guards against an over-tight gate.

Each of 1–3 fails against the current code because there is no guard at all; each would pass only once the guard is inserted ahead of DB access. Test 1 is the core behavioral regression for the reported attack (low-privilege/client user rerouting future inbound mail).

**Existing tests to update (they will otherwise break):** `inboundTicketDefaultsActions.location.test.ts:5-8` and `inboundTicketDefaultsActions.deleteReferences.test.ts:6-7` mock `withAuth` with a bare user (`{ user_id: 'user-1' }`, no `user_type`) and do **not** mock `hasPermission`. After the fix they must (a) give the user `user_type: 'internal'` and (b) mock `@alga-psa/auth/rbac` `hasPermission` to return `true`, so those behavioral tests continue to exercise the location/delete logic rather than tripping the new guard. This is a required, deliberate part of the change, not incidental.

---

## 4. Scope not covered / risks for the reviewer

**Deliberately out of scope:**
- No new `email_provider:*` / `inbound_defaults:*` permission resource. Reusing `ticket_settings` matches every sibling action and the finding's suggestion; carving a finer-grained permission is a separate catalog decision (the outbound guard explicitly defers the same thing — `mspOutboundEmailAccess.ts:7`).
- Not collapsing the inbound and outbound guards into one `requireTicketSettingsAccess` helper now (flagged as a LEVERAGE marker in 2c); two call sites don't yet earn the extraction, and doing it here widens the blast radius of a security fix.
- The pre-existing bug in `getInboundTicketDefaultsById` selecting a non-existent `defaults` column (`:391`) — unrelated correctness issue, left alone.
- No change to `processInboundEmailInApp.ts`; it is the trusting consumer and the fix is upstream at the write boundary. Worth noting the consumer stays unauthenticated-by-design (worker context), which is why the action boundary is the only correct place.
- The unstaged `package-lock.json` change is left untouched.

**Risks/regressions to weigh:**
- **Read gate on `getInboundTicketDefaults` touches dropdown population.** Five provider/rule forms call it to fill selects. All are MSP settings surfaces whose users should already hold `ticket_settings:read`; they also already handle the `{ error }` branch. Still, a reviewer should confirm no MSP role that legitimately configures providers lacks `ticket_settings:read`, or those dropdowns will silently empty. (If a gap exists, the right fix is the role grant, not weakening the gate.)
- **Permission seed coverage.** The fix assumes default MSP admin/config roles already hold `ticket_settings:read` and `:update`. Verify in `catalog.cjs` during implementation; if a role is missing one, add the grant in the same change.
- **Client-user rejection ordering.** Must precede `createTenantKnex()` so no tenant connection is opened for a client caller (the stated requirement and the outbound precedent). A reviewer should check the guard isn't accidentally placed after the first DB call.
- **Error-shape consistency.** Reads return `{ defaults, error }`; writes return `actionError(...)`. Keeping each action's native shape avoids breaking callers that pattern-match on it; a reviewer should confirm no caller treats a denial as a thrown exception.
