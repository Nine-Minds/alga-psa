# Fix plan — Security: authz in `withAdvancedAssetsAccess`

- **Card:** f9fadea2-f96e-5941-a661-67483ec54db9 — Security: authz in withAdvancedAssetsAccess
- **Source:** security review of PR #3981 (merge `dc46a3315dff`), finding `f2`, fingerprint `ee/server/src/lib/actions/integrations/ninjaoneActions.ts#withAdvancedAssetsAccess`
- **Verdict:** **Finding confirmed.** Real, reachable, unfixed on this branch. Plan only — no code changed here.

All file:line references below are against the code as it stands on this branch
(`feature/security-authz-in-withadvancedassetsaccess`).

---

## 1. The defect

### The missing check

`withAdvancedAssetsAccess` is the gate in front of **every** NinjaOne RMM server
action (`ee/server/src/lib/actions/integrations/ninjaoneActions.ts:86-93`):

```ts
function withAdvancedAssetsAccess<TArgs, TResult>(handler) {
  return withAuth(async (user, context, ...args) => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS);
    return handler(user, context as { tenant: string }, ...args);
  });
}
```

It enforces exactly two things: **authentication** (`withAuth` → `getCurrentUserWithRevocationCheck`,
`packages/auth/src/lib/withAuth.ts:155-165`) and **tenant tier** (`assertTierAccess`).
It never inspects `user.user_type`, so a **client-portal principal** (`user_type === 'client'`)
passes through exactly like an MSP staff user. `withAuth` itself does not distinguish
the two either (`packages/auth/src/lib/withAuth.ts:151-178`).

### Why the per-action permission checks don't save it

Each action then calls `hasPermission(user, 'settings', 'read' | 'update')` for the
integration-administration actions. Those are **client-capable** permissions. In the
permission catalog (`server/migrations/utils/permissions/catalog.cjs:272-275`):

```
settings:read   msp:true client:true  → psa grants: client:Admin, client:Finance, msp:Admin
settings:update msp:true client:true  → psa grants: client:Admin, msp:Admin
```

`hasPermission` resolves a client principal against the **client** column only
(`packages/authorization/src/rbac.ts:84-94`: `isClientPortal` → requires `role.client`
and `permission.client`). Because `settings:read`/`settings:update` carry `client: true`
and are granted to `client:Admin`/`client:Finance`, those checks **return true** for a
client Admin/Finance. The permission gate therefore does not reject client principals —
it was designed to let client admins manage *their own portal settings*, not the MSP's
RMM integration.

### The attacker path (client Admin, same tenant)

These are Next.js server actions; a client-portal user authenticated in the tenant can
invoke any of them directly via a `next-action` POST regardless of the `/msp/...` UI
route they are nominally attached to. Concretely:

1. **Integration takeover.** Client Admin calls `saveNinjaOneCredentials`
   (`:233-257`, gated only by `settings:update`) with attacker-controlled OAuth
   client id/secret → stored as tenant secrets. Calls `getNinjaOneConnectUrl`
   (`:794-837`, gated only by `settings:read`), which **mints and persists OAuth state**
   (`:815-824`) and returns an authorize URL. The attacker completes OAuth against an
   attacker-controlled NinjaOne account; the **unauthenticated** callback
   (`ee/server/src/app/api/integrations/ninjaone/callback/route.ts:270-354`) validates
   only the round-tripped state and then **creates or replaces** the tenant's
   `rmm_integrations` row and stored tokens. The MSP's RMM integration is now bound to
   the attacker (or disconnected via `disconnectNinjaOneIntegration`, `:413-416`).
2. **Cross-client data disclosure.** Client Admin/Finance calls
   `getNinjaOneOrganizationMappings` (`:656-693`, gated only by `settings:read`) and
   reads every RMM org mapping in the tenant — **other clients'** names
   (`c.client_name`), external org identifiers, default contacts, billing-profile ids,
   and metadata. `getNinjaOneConnectionStatus` (`:339`) similarly leaks integration state.

The suggested-fix prose matches the code at every fingerprint. **Confirmed.**

---

## 2. The fix

### Single enforcement point

Add an **MSP-principal gate inside `withAdvancedAssetsAccess`**
(`ee/server/src/lib/actions/integrations/ninjaoneActions.ts:86-93`), placed *before*
`assertTierAccess` and the handler. This is the one choke point every RMM action already
routes through, so no action can be reached around it:

```ts
import { isMspPrincipalUserType } from '@alga-psa/types';

function withAdvancedAssetsAccess(handler) {
  return withAuth(async (user, context, ...args) => {
    if (!isMspPrincipalUserType(user.user_type)) {
      throw new Error('NinjaOne integration actions are restricted to MSP users.');
    }
    await assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS);
    return handler(user, context as { tenant: string }, ...args);
  });
}
```

- **Why `isMspPrincipalUserType` and not `!== 'client'`:** the project predicate
  (`packages/types/src/constants/userTypes.ts:34-37`) fails closed — it admits only
  `internal | service` and rejects `client` *and* any unknown/null type. This is the
  mandated idiom (same file, lines 10-12) and the one `rbac.ts` uses.
- **Why in the wrapper, not per action:** the finding's root cause is that the shared
  gate is the *wrong* gate. Fixing it once there removes the bug from all ~20 actions in
  the file simultaneously and makes it structurally impossible for a future RMM action
  (which will reuse this wrapper) to reinstate the hole. It also throws *outside* each
  action's `try/catch`, so the action promise rejects rather than silently returning
  `{ success: false }` / `[]`.
- **Why throwing is sufficient for the OAuth-state concern:** the "state can only be
  minted after the manage check" requirement from the suggested fix is satisfied because
  `getNinjaOneConnectUrl` (the only state minter) now rejects client principals at the
  wrapper, before line 815 is reached.

### Is a shared helper the right home?

Yes — `withAdvancedAssetsAccess` *is* the shared helper, and it is the correct home: it
is RMM-scoped and already the universal entry. I am **not** moving the gate up into the
generic `withAuth` (`packages/auth`), because `withAuth` legitimately serves client-portal
actions too; an MSP-only requirement belongs to the RMM wrapper, not the global one.

### Permission-catalog tightening — deliberately NOT in scope (see §4)

The suggested fix also proposes replacing `settings:read/update` with an MSP-only
`system_settings`/dedicated RMM permission. Once the wrapper rejects every client
principal, the residual risk those checks guard against is gone, and re-pointing ~20
`hasPermission` call sites plus adding a catalog permission + migration + default grants
is a larger, higher-regression change (it would also change which *MSP* roles can use RMM).
The wrapper gate is the minimal unbypassable fix for the reported defect; the catalog
change is defense-in-depth recorded as a follow-up, not required for acceptance.

---

## 3. The proof (regression test)

Add a behavioral unit test next to the existing NinjaOne action tests:
`ee/server/src/__tests__/unit/integrations/ninjaoneAdvancedAssetsAccess.authz.test.ts`,
following the mocking idiom of
`ee/server/src/__tests__/unit/huduGlobalDocsActions.test.ts:34-50` (mock `@alga-psa/auth`
so `withAuth` passes a supplied `user` straight through; mock `assertTierAccess`,
`createTenantKnex`, logger, secret provider). The **real** `withAdvancedAssetsAccess` in
the module under test still runs, so the new `user_type` gate is exercised.

Assertions:

1. **Client principal is rejected before any work.** With
   `user = { user_type: 'client', tenant, ... }` and `hasPermission` mocked to return
   `true` (proving the permission layer *would* have allowed it):
   - `getNinjaOneConnectUrl()` **rejects** (throws) and the secret provider's
     `setTenantSecret` is **never called** — i.e. no OAuth state is minted
     (guards the `:815-824` path).
   - `getNinjaOneOrganizationMappings()` **rejects** and `createTenantKnex` is never
     called — no mapping rows are read.
   - `saveNinjaOneCredentials(id, secret)` **rejects** and `setTenantSecret` is never
     called.
   - `user_type: 'service'` with no MSP role is likewise rejected only if it lacks the
     permission — but to keep the test about the *principal* gate, assert the three above
     for `'client'`.
2. **MSP principal still works.** With `user = { user_type: 'internal', ... }` and
   `hasPermission` → `true`, the same actions proceed (reach the mocked knex / secret
   provider). This proves the gate does not break the legitimate path.

**Why each fails before the fix:** on the current code, `withAdvancedAssetsAccess`
performs no `user_type` check, so with `hasPermission` mocked `true` the client-principal
calls run to completion — `getNinjaOneConnectUrl` calls `setTenantSecret` (state minted)
and returns a URL, `getNinjaOneOrganizationMappings` calls `createTenantKnex` and returns
rows, `saveNinjaOneCredentials` calls `setTenantSecret`. The "never called" / "rejects"
assertions fail until the wrapper gate is added.

Optionally mirror the source-contract style of
`ee/server/src/__tests__/unit/integrations/ninjaoneActionsTenantScoped.contract.test.ts`
with one assertion that the wrapper source contains the `isMspPrincipalUserType` guard,
to pin the enforcement point against accidental removal. The behavioral test is the
primary proof.

---

## 4. Scope NOT being done, and risks to weigh

**Deliberately out of scope:**

- **Permission-catalog change** (new MSP-only RMM/`system_settings` permission + migration
  + default-grant edits + re-pointing the `hasPermission` call sites at `:241, 281, 316,
  342, 416, 565, 592, 659, 720, 804, ...`). Defense-in-depth; the wrapper gate fully
  closes the reported defect. Recommend as a follow-up card.
- **Other integrations.** Hudu/Tanium and other EE integration actions have their own
  wrappers; this card is scoped to the NinjaOne `withAdvancedAssetsAccess` fingerprint.
  Worth a follow-up audit (the same `settings:*` client-capable pattern may recur), but
  not changed here.
- **The unauthenticated callback route** (`callback/route.ts`) is left as-is: it is
  reachable only via a state value that is now only mintable by MSP principals.

**Risks / regressions a reviewer should weigh:**

- **`service` user type.** `isMspPrincipalUserType` admits `'service'`. If any
  non-interactive/service identity invokes these actions (e.g. a workflow-run context),
  it keeps access — intended, matches `rbac`/role-assignment semantics. Confirm no path
  *needs* a client principal to call an RMM action (none found; these are MSP-only
  features surfaced under `/msp`).
- **Error surface.** The wrapper throw is outside each action's `try/catch`, so callers
  that currently expect a `{ success: false }` shape will instead see a rejected promise
  for client principals. That is the correct fail-closed behavior and matches how
  `assertTierAccess`/`withAuth` already reject, but UI callers should degrade gracefully
  (they already handle action rejections).
- **No data migration, no behavior change for MSP Admins** — the legitimate users of
  these actions are unaffected.
