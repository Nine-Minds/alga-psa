# Merge evidence: telephony availability + notifications realtime

Merge of `origin/main` (`aa124f86da`) into `feature/co-managed-it` (`cb65a3444d`).
Merge base `9a59114991`. Five conflicted files, resolved in two groups.

Every hunk below states which side won and why. Where both sides changed
behaviour, the resolution makes both effects run rather than keeping one side's
guard with the other side's effect dropped.

---

## Group A — telephony availability

### `packages/integrations/src/lib/telephonyAvailabilityCore.ts`

**Branch wanted:** a `'product_unavailable'` reason code plus its message
("Telephony integrations are not available for this product."), for the
co-managed product-admission guard.

**Main wanted:** a `'tier_required'` reason code plus its message
("This telephony provider requires the Pro plan."), for per-provider tier gating.

**Resolution:** union — both codes and both messages kept.

| Hunk | Winner | Why |
|---|---|---|
| `TelephonyAvailabilityDisabledReason` union | both | The two codes describe unrelated rejections (product admission vs. commercial tier). Neither subsumes the other, and `TELEPHONY_AVAILABILITY_MESSAGES` is typed `Record<Reason, string>`, so dropping either code would have been a silent behaviour loss that still compiled on the other side. |
| `TELEPHONY_AVAILABILITY_MESSAGES` | both | Same; messages kept verbatim from each side. |

Nothing else in this file differed between the sides.

### `packages/integrations/src/lib/telephonyAvailability.ts`

**Branch wanted:** `getTelephonyAvailability` to call
`assertPsaOnlyTenantAccess(tenantId, 'telephony_integration')` and map
`ProductAccessError` to `product_unavailable`, while re-throwing any other error
(so a database failure can never be laundered into "enabled").

**Main wanted:** a new exported function `getTelephonyProviderAvailability(provider, input)`
that layers a per-provider tier check (`TIER_FEATURES.PBX_TELEPHONY` for `3cx`,
nothing for `teams-phone`) on top of the class-wide checks, with an injectable
`resolveTier` for tests.

**Resolution:** both. Imports unioned; both functions present; **and the two
guards are wired so both actually run.**

| Hunk | Winner | Why |
|---|---|---|
| Import block | both | Branch's `productAccessGuard` import + main's `@alga-psa/types` / `@alga-psa/telephony/types` imports. Main's multi-line `disabledTelephonyAvailability, resolveTelephonyAvailability` import form kept (it is the superset). |
| `getTelephonyAvailability` body | **branch** | Main did not touch this function (base version was a bare `return resolveTelephonyAvailability(input)`); the branch's product guard is a pure addition. |
| `getTelephonyProviderAvailability` | **main, with one behavioural change** | Kept wholesale from main, **except** its first line. Main had `const base = resolveTelephonyAvailability(input)` — the synchronous resolver, which bypasses the product guard entirely. Taking that verbatim would have kept the branch's guard in `getTelephonyAvailability` while silently dropping its effect on every per-provider caller (`telephonyActions.ts` lines 139/458/506/700, `server/src/lib/telephony/threecxRouteDeps.ts`). Changed to `const base = await getTelephonyAvailability(input)` so the product guard runs on the provider path too. |

**Precedence decision (documented at the call site as a comment):**
`product_unavailable` **outranks** `tier_required`.

Rationale: product admission is the coarser, non-purchasable gate. A co-managed
tenant is not entitled to telephony at any price, so answering "upgrade to the
Pro plan" would be both wrong and a mild disclosure (it implies the feature is
obtainable). Ordering also mirrors main's own layering — main already ran all
class-wide checks (`ce_unavailable`, `tenant_not_configured`) before the
provider tier check, and `product_unavailable` is a class-wide check. A
consequence worth stating: the tier lookup (`resolveTenantTier`, a database
read) no longer runs at all for a tenant that fails product admission.

A regression test pins this: *"reports product_unavailable (not tier_required)
when both guards would reject"*, which also asserts `resolveTier` was never
called.

### `packages/integrations/src/lib/telephonyAvailability.test.ts`

**Resolution:** union of both sides' cases, restructured so they can coexist.

| Hunk | Winner | Why |
|---|---|---|
| `vi.mock('@shared/services/productAccessGuard', …)` | **branch** | Now required by *all* tests, not just the branch's: with `getTelephonyProviderAvailability` routed through `getTelephonyAvailability`, main's provider tests would otherwise hit the real guard and open a database connection. |
| Import list | both | Branch's guard imports + main's `getTelephonyProviderAvailability`, `TELEPHONY_AVAILABILITY_MESSAGES`, `registerFeatureFlagChecker`. |
| `keeps the client-safe resolver free of server-only feature checks` | **main** | Main's version is a strict superset (adds `expect(serverSource).not.toContain('isFeatureFlagEnabled')`). Still passes: the branch's addition to that file is a product-access import, not a feature-flag read. |
| Branch's two product-admission tests | **branch** | Moved from file top level into the `telephonyAvailability` describe. The `afterEach` mock reset was deliberately left at **file** level so it also resets state between main's provider tests. |
| Main's `getTelephonyProviderAvailability` describe (6 tests) | **main** | Kept verbatim. |
| New | added | `declares a non-empty product_unavailable message` (mirrors main's `tier_required` assertion); the precedence test described above; `applies the product guard to per-provider availability`, which fails if anyone re-points `getTelephonyProviderAvailability` back at the bare resolver. |

Result: **16 tests, all passing.**

---

## Group B — notifications realtime

### Context

The branch performed a security rewrite (-423/+175 across the realtime path).
Rooms were renamed `notifications:<tenant>:<user>` → `notification-signals:<tenant>:<user>`,
connections are forced `readOnly`, access is validated by
`validateNotificationSignalRoom` with a ≤60s scoped JWT re-checked in
`beforeHandleMessage`, and the server only `broadcastStateless`-es a constant
`{type:'notifications.changed'}` wake-up, filtered per connection by
tenant + user + expiry. The client refetches from the database on that signal.
Invariant, from the class doc comment: *"Yjs documents never cache message
bodies, links, counts or metadata for a later connection to reuse."*

Main, meanwhile, added a telephony incoming-call feature on the **old**
architecture: `NotificationExtension` wrote the Redis `telephony.incoming_call`
payload into a Yjs `incomingCall` map, and `useInternalNotifications` observed
that map, folded it through `reduceIncomingCall`, and returned
`{ incomingCall, dismissIncomingCall }`.

A naive resolve in favour of the branch would have silently deleted main's
feature, because the rooms and maps it depends on no longer exist.

**Overall decision: keep the branch's architecture and its invariant, and carry
main's feature forward onto the branch's stateless transport.** Main's own
comment already described the incoming call as *"a transient signal… never
touches the notifications maps"*, so `broadcastStateless` — transient,
per-connection filtered, never persisted in a document — is a better home for it
than a Yjs map, which *did* persist the caller's number and contact for any
later connection to the same room to read back.

### `hocuspocus/NotificationExtension.js`

**Branch wanted:** the whole hardened file — `pSubscribe` on a channel pattern
with reconnect-safe re-subscription, `onConnect` token validation + `readOnly`,
`beforeHandleMessage` expiry re-check, and `handleMessage` broadcasting a
constant hint through a per-connection filter.

**Main wanted:** inside its per-room `subscribe` callback, a
`telephony.incoming_call` branch writing
`{event, call, receivedAt: timestamp ?? now}` into `doc.getMap('incomingCall')`.

| Hunk | Winner | Why |
|---|---|---|
| Whole-file architecture (`onConfigure`/`subscribe`/`onConnect`/`beforeHandleMessage`/`onDestroy`) | **branch** | Main's version is the pre-rewrite file. Keeping any of it would reintroduce unauthenticated `notifications:` rooms, writable connections, and Yjs-cached notification bodies. |
| `telephony.incoming_call` handling | **main's feature, branch's transport** | Extracted into a new exported pure function `toNotificationSignal(event)`. Inbox events still collapse to the constant `{type:'notifications.changed'}`; `telephony.incoming_call` maps to `{type:'telephony.incoming_call', entry:{event, call, receivedAt}}`. The entry shape (including main's `timestamp ?? new Date().toISOString()` fallback) is preserved exactly, so `IncomingCallEntry` and `reduceIncomingCall` need no change. |
| Yjs map write (`doc.getMap('incomingCall').set('data', …)`) | **dropped** | This is the one place main's effect was intentionally *not* reproduced. It is replaced, not deleted: the same payload now travels over `broadcastStateless` with the identical tenant/user/expiry filter the branch applies to `notifications.changed`. Dropping the map write is what preserves the invariant — a Yjs map retains the caller's number and contact for the next connection to the room; a stateless broadcast does not. |
| Event allowlist | both | `telephony.incoming_call` added alongside the four inbox event types; unknown types still relay nothing. A malformed ring (missing `event` or `call`) also relays nothing. |

`toNotificationSignal` is exported so the relay decision is testable without a
Redis or Hocuspocus harness.

**Invariant check:** the branch's own test harness in
`server/src/test/unit/hocuspocus/NotificationExtension.test.ts` stubs the
document with `getMap: vi.fn(() => { throw new Error('Notification bodies must
never enter Yjs') })`. The incoming-call path passes it untouched.

### `packages/notifications/src/hooks/useInternalNotifications.ts`

**Branch wanted:** token fetch from `/api/notifications/live-token`, identity
validation of the token against the hook's own props, `useActionPolling` with a
`scope`/`requestId` staleness guard, an `onStateless` refresh hint, a
`highUnreadCount` priority badge, and `inbox.scope === scope` gating so a
previous identity's content can never render.

**Main wanted:** an `incomingCall` state, an `incomingCallMap.observe` wired
through `reduceIncomingCall`, a `dismissIncomingCall` callback, and two extra
return members.

| Hunk | Winner | Why |
|---|---|---|
| Import block (lines 7–47 of the conflict) | **branch**, plus one line from main | Branch's relative imports kept; main's version dragged in the whole pre-rewrite `getHocuspocusUrl`, `POLLING_INTERVAL`/`MAX_RECONNECT_DELAY` constants and `getUnreadCountAction`, all dead under the branch's design. Only `import { reduceIncomingCall, type IncomingCallEntry } from './incomingCall';` was taken from main. |
| `UseInternalNotificationsReturn` | **branch's shape + main's two fields** | Branch's compact shape (which is the one that carries `highUnreadCount`), with main's `incomingCall: IncomingCallEntry \| null` and `dismissIncomingCall: () => void` appended verbatim, including main's doc comment. `IncomingCallProvider.tsx` destructures exactly these two. |
| Load effect tail / Yjs observers | **branch** | Main's block here is the `notificationsMap.observe` / `unreadCountMap.observe` / `incomingCallMap.observe` wiring. The first two are precisely what the rewrite removed (they trusted document content). The third is re-homed — see next row. |
| `onStateless` handler | **branch's handler, extended with main's feature** | Now parses once, routes `notifications.changed` → `refresh()` (unchanged) and `telephony.incoming_call` → `setIncomingCall(current => reduceIncomingCall(current, signal.entry))`. `reduceIncomingCall` is reused, not reimplemented, so its folding semantics (fresh ring shows and replaces; `connected`/`ended` clears the *same* call; a ring older than `INCOMING_CALL_MAX_AGE_MS` is ignored) are untouched. Malformed payloads are still swallowed. |
| Return block | **branch's shape + main's two fields** | Branch's `visible = inbox.scope === scope ? inbox : EMPTY` gating kept in full; `incomingCall` and `dismissIncomingCall` appended. Main's version of this block is the pre-rewrite one (raw `notifications`/`unreadCount` state, plus a `refresh` redefinition that no longer exists) and was discarded apart from those two fields. |
| `dismissIncomingCall` | **main** | Kept verbatim: `useCallback(() => setIncomingCall(null), [])`. |
| New line, neither side | added | `setIncomingCall(null)` at the top of the connect effect, next to the existing `setIsConnected(false)`. Under main's design the map belonged to the document and was destroyed with it; under the branch's design `incomingCall` is plain React state that would otherwise survive a tenant/user change. This extends the branch's "never show a previous identity's data" discipline to the ring. |

`incomingCall` state is **not** routed through the `inbox`/`scope` gate: it is
transient socket state, not fetched inbox content, and the effect-level clear
already covers identity change.

### Files deliberately NOT edited

`packages/notifications/src/realtime/internalNotificationBroadcaster.ts`
auto-merged and is owned elsewhere. It was read, not changed. The consumer
matches its published shape exactly:
`{ type: 'telephony.incoming_call', event, call, timestamp }`. No change to it
is required.

---

## Out-of-scope edits (flagged)

Two test files outside the five conflicted files were changed, because they test
the merged files directly and no other resolution touches them:

1. **`packages/notifications/src/realtime/notificationExtensionIncomingCall.test.ts`**
   — arrived from main (clean add, no conflict) and tested the deleted
   architecture: `onConnect({documentName: 'notifications:tenant-1:user-1'})`,
   `subscriber.subscribe`, and `doc.getMap('incomingCall')`. Verified **red**
   against the resolved extension (2 failures) before rewriting. Rewritten for
   the stateless transport, preserving main's T053/T054 intent and adding
   connection-filter, wrong-channel/malformed-ring, and "inbox events stay
   content-free" coverage. 5 tests.

2. **`server/src/test/unit/internal-notifications/useInternalNotifications.test.tsx`**
   — one test appended (`delivers a telephony ring to the card over the same
   authenticated signal channel`), proving the ring reaches the hook under the
   new transport, that the Yjs document still caches nothing, that
   `dismissIncomingCall` clears, and that `reduceIncomingCall`'s ended-clears and
   stale-ring rules still apply end to end. Existing tests untouched.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` — `packages/notifications` | **exit 0** |
| `npx tsc --noEmit` — `packages/telephony` | **exit 0** |
| `npx tsc --noEmit` — `packages/integrations` | **exit 0** with `--max-old-space-size=12288`; OOMs (exit 134) on the default 4 GB heap. Pre-existing project-size issue, not a type error — the failure is `FATAL ERROR: Ineffective mark-compacts near heap limit`, and no diagnostic is emitted at any heap size. |
| `node --check hocuspocus/NotificationExtension.js` | **exit 0** |
| `packages/integrations` → `src/lib/telephonyAvailability.test.ts` | **16 passed / 0 failed** |
| `packages/notifications` → full suite | **157 passed / 0 failed** (20 files), incl. `incomingCall.test.ts` and the rewritten `notificationExtensionIncomingCall.test.ts` |
| `server` → `src/test/unit/hocuspocus/` + `src/test/unit/internal-notifications/` | **163 passed / 0 failed** (19 files), incl. `NotificationExtension.test.ts` (8) and `useInternalNotifications.test.tsx` (4) |
| `packages/telephony` → `IncomingCallCard.test.tsx` | **8 passed / 0 failed** |
| `packages/integrations` → full suite | 957 passed / **2 failed** — both in `src/actions/integrations/teamsPackageActions.test.ts`. **Pre-existing and unrelated:** that file is unmodified by this merge, exists identically on `origin/main`, contains zero references to telephony, and fails inside `acquireAdminConnection` (`../db/src/lib/admin.ts:81`) for want of a database/secrets fixture. |

No conflict markers remain in any of the five files.
