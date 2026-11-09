# Fix plan — DoS: concurrent sends can overdraw the email token bucket (`checkEmailRateLimit`)

- **Card:** d95a0ef5 — "Security: dos in checkEmailRateLimit"
- **Finding:** dos · medium — `packages/email/src/TenantEmailService.ts:356` (`checkEmailRateLimit`)
- **Fingerprint:** `packages/email/src/TenantEmailService.ts#checkEmailRateLimit`
- **Source PR:** https://github.com/Nine-Minds/alga-psa/pull/3984 · merge `ad16c90abfee` (ancestor of this branch's HEAD `e75baf12b5`)
- **Status of this document:** forward-looking plan. No fix is implemented on this branch; the only working-tree change is a pre-existing unstaged `package-lock.json`, left untouched.

---

## 1. The defect, precisely

**Verdict: the finding is REAL.** The code matches the evidence.

### What is wrong
The shared outbound-email rate gate consumes tokens through the **non-atomic** `TokenBucketRateLimiter.tryConsume`, which performs a read-modify-write across two separate Redis round-trips with no mutual exclusion:

- `packages/email/src/TenantEmailService.ts:356` — `checkEmailRateLimit` calls `rateLimiter.tryConsume('email', tenantId, userId)`.
- `packages/core/src/lib/rateLimit/TokenBucketRateLimiter.ts:300-351` — `tryConsume` does `await this.redis.get(bucketKey)` (line 302), then computes the new token count in JS, then `await this.redis.set(...)` (line 330 on the allow branch, line 351 on the deny branch). The GET and SET are distinct commands; nothing serializes the pair.

Under concurrency, N calls all `await` the GET before any has issued its SET. They each read the same balance, each independently decide `state.tokens >= tokens` (line 325), each decrement locally, and each write back `maxTokens - 1`. All N are allowed and the stored balance only drops by one token total — the classic lost-update race. The bucket is overdrawn by up to N−1 sends.

The class already ships the correct primitive: `tryConsumeAtomic` (`TokenBucketRateLimiter.ts:394-491`) performs check + refill + consume + TTL as a single Redis-side `EVAL` (`ATOMIC_TRY_CONSUME_SCRIPT`, invoked at line 437), and its doc comment (lines 381-386) explicitly states it exists so "concurrent requests cannot over-draw a bucket." The extension gateway already uses it (`packages/product-ext-proxy/ee/gateway/access.ts:242`).

### Which caller reaches it / the attacker path
`checkEmailRateLimit` is the single shared gate for **every** tenant-scoped outbound send. Two callers funnel through it:

1. **Regular sends** — `checkRateLimits` (instance method, `TenantEmailService.ts:333-335`) → used before `sendEmail`.
2. **Diagnostics live-send** — `defaultSendLive` (`packages/email/src/diagnostics/outboundDiagnostics.ts:199`), whose *only* rate gate before the provider call (`manager.sendEmail`, line 227) is this check.

PR 3984 introduced the diagnostics live-send and made it the single guarded test-send path. The reachable attacker route:

- `testOutboundEmail` server action (`packages/integrations/src/actions/email-actions/emailSettingsActions.ts:407-448`). An MSP admin passes a validated recipient (`isValidEmail`, line 423); the call routes to `runOutboundEmailDiagnosticsImpl({ liveSendTest: true, recipient, ... })` (lines 428-432).
- That reaches `defaultSendLive` → `checkEmailRateLimit` (non-atomic) → provider send.
- An authenticated MSP admin fires a **parallel batch** of `testOutboundEmail` calls. Because the gate is non-atomic, the batch overdraws the configured `email` bucket, pushing more real messages to the provider than the limit permits — burning provider quota and risking sender-reputation / deliverability damage.

The attacker is an authenticated MSP admin (the action is behind `withAuth` + `requireOutboundEmailAdmin`, lines 408-415), so this is a privileged-user quota/abuse DoS, not an anonymous one — consistent with the finding's **medium** severity. The non-atomic primitive predates PR 3984; PR 3984 created a new outbound path that leans on it.

---

## 2. The fix

### Single enforcement point
Change the one consume call in the shared helper:

- **File/function:** `packages/email/src/TenantEmailService.ts` — `TenantEmailService.checkEmailRateLimit` (lines 342-372).
- **Edit:** line 356, replace
  `const result = await rateLimiter.tryConsume('email', tenantId, userId);`
  with
  `const result = await rateLimiter.tryConsumeAtomic('email', tenantId, userId);`

This is the correct and complete enforcement point: `checkEmailRateLimit` is **already the shared chokepoint** both outbound paths (regular `checkRateLimits` and diagnostics `defaultSendLive`) pass through. Fixing it here closes the race for every current and future outbound-email caller in one place — no second route can bypass it, and the same class of bug cannot recur in a sibling email path because there is only one gate. No new helper is warranted; the right shared helper already exists on both ends (`checkEmailRateLimit` as the app-level gate, `tryConsumeAtomic` as the primitive).

`tryConsume` itself is left in place — it is still used by other namespaces/consumers (`api`, webhooks, inbound) and by the existing `email-regression` test. This plan does not migrate those; see Scope.

### Failure-semantics change this introduces (must be accounted for)
`tryConsume` and `tryConsumeAtomic` do **not** fail identically, so swapping them changes behavior on infra errors:

| Condition | `tryConsume` (today) | `tryConsumeAtomic` (after fix) |
|---|---|---|
| Redis client absent | allow (`remaining:-1`) | allow (`remaining:-1`) — same |
| Client lacks `EVAL` | n/a | allow (`remaining:-1`) — fail open |
| Broken bucket config | allow | **deny** (`remaining:-1`) — fail closed |
| Redis op throws / EVAL error | allow (caught, allow) | **deny** (`allowed:false, remaining:-1`) |
| Malformed reply | n/a | **deny** |

Net effect for email: a transient Redis **EVAL error now denies** the test-send instead of allowing it. Note `tryConsumeAtomic` returns (never throws) on these paths, so the outer `try/catch` at `TenantEmailService.ts:367-371` is **not** what produces the deny — the atomic method's own fail-closed branches do. This is a deliberate, defensible tightening for a rate gate (matches the gateway's existing choice), but reviewers must weigh that a Redis blip now blocks diagnostic/outbound sends that previously squeaked through.

### What the fix deliberately does NOT change about failure handling
When the limiter is genuinely **unavailable** (`!this.redis`, or `isReady()` false at `TenantEmailService.ts:350`), both methods still **fail open** (`allowed:true, remaining:-1`), and `checkEmailRateLimit` keeps returning `allowed:true`. This preserves the documented "fail open if rate limiter unavailable" contract (comment at lines 337-340) so email deliverability is not taken down when Redis is down. The fix closes only the concurrency race — exactly the finding — and does **not** add a `remaining < 0` fail-closed check (as `access.ts:259` does). Flipping email to fail-closed-on-unavailable would be a separate behavioral decision and is out of scope.

The user-facing shape is unaffected: `parseAtomicReply` returns no `reason`, but `checkEmailRateLimit` already falls back (`result.reason ?? 'Rate limit exceeded'`, line 361) and `retryAfterMs` is still populated.

---

## 3. The proof (tests to add)

Two layers. The first is deterministic and is the one that fails without the fix in any environment; the second is the behavioral concurrency proof the finding asks for.

### Test A — enforcement-point unit test (deterministic, no live Redis)
**New:** `packages/email/src/__tests__/TenantEmailService.rateLimit.test.ts`

- Reset the limiter singleton, `initialize` it with an in-memory mock Redis and an `email` bucket config.
- Spy on `TokenBucketRateLimiter.prototype.tryConsume` and `...tryConsumeAtomic`.
- Call `TenantEmailService.checkEmailRateLimit(tenantId, userId)`.
- **Assert:** `tryConsumeAtomic` was called once with `('email', tenantId, userId)`; `tryConsume` was **not** called.

**Why it fails before the fix:** today `checkEmailRateLimit` calls `tryConsume`, so the "atomic called / non-atomic not called" assertion fails. After the one-line swap it passes. This pins the enforcement-point decision permanently and runs in CI without Redis.

### Test B — concurrent live-Redis behavioral test (the finding's requested proof)
**New:** `packages/email/src/__tests__/TenantEmailService.rateLimit.concurrency.test.ts`, modeled on the existing live-Redis harness in `packages/core/src/lib/rateLimit/__tests__/TokenBucketRateLimiter.atomic.test.ts:158-227` (connect-with-short-timeout, skip when no Redis reachable).

- Initialize the limiter singleton with the live Redis client and an `email` bucket of `maxTokens = N` (e.g. 20), `refillRate` negligible (e.g. 0.01) so refill cannot mask the race.
- `del` the bucket key, then fire `3N` concurrent `TenantEmailService.checkEmailRateLimit(tenant, user)` via `Promise.all`.
- **Assert:** exactly `N` results have `allowed === true`, and `allowed` is never `> N`.

**Why it fails before the fix:** with non-atomic `tryConsume`, `Promise.all` makes all `3N` GETs resolve against the same full-bucket state before any SET lands, so far more than `N` calls are allowed — assertion `allowed === N` fails. After the swap, the single `EVAL` serializes consume on the Redis side and exactly `N` are allowed. When no Redis is reachable (CI without the service), the test self-skips, exactly like the existing atomic suite; Test A still guards the contract there.

Run: `npm test` in `packages/email` (`vitest run`). For Test B against local Redis, point it at the same convention the atomic suite uses (`redis://127.0.0.1:6381` / env override).

---

## 4. Scope not covered, and risks for the reviewer

**Deliberately NOT doing:**
- **Not** migrating the other `tryConsume` callers (`api` enforce, Microsoft/inbound webhooks, `WebhookService`) to atomic. They are different namespaces with their own risk profiles and out of this finding's scope; a blanket migration is a separate change. The non-atomic `tryConsume` method stays for them and for the existing `TokenBucketRateLimiter.email-regression.test.ts` (which asserts legacy single-threaded email behavior and remains valid).
- **Not** changing the fail-open-on-unavailable behavior for email (no `remaining < 0` denial added). Email deliverability vs. quota protection is a product decision, not part of closing the race.
- **Not** adding any per-admin or per-recipient throttle on `testOutboundEmail` beyond the shared bucket; the bucket is the finding's control surface.
- **Not** touching the `package-lock.json` working-tree change.

**Risks / regressions to weigh:**
- **Fail-closed on Redis EVAL errors** (section 2 table): a transient Redis/EVAL failure now denies outbound/diagnostic sends that previously passed. Defensible for a rate gate and consistent with the gateway, but it is a real behavior change on the normal `sendEmail` path too, not just diagnostics. Confirm this is acceptable for notification email.
- **EVAL support requirement:** `tryConsumeAtomic` needs a Redis client exposing `eval`. If a deployment's injected client lacks it, the method fails **open** (`remaining:-1`, lines 407-410) — no worse than today, but worth confirming the production client supports `EVAL`.
- **Test B flakiness/CI:** the concurrency test requires a live Redis and self-skips otherwise; ensure CI either provides Redis or the skip is acceptable, leaning on Test A for always-on coverage.
- **Blast radius:** a single-line change at a shared chokepoint touches both regular sends and diagnostics simultaneously — intended, but means the regular-send path should be exercised (existing `packages/email` suite) to confirm no normal-path regression.
