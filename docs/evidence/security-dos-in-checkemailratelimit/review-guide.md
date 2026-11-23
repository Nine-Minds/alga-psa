# Security review: concurrent email token bucket overdraw

## Finding

The shared outbound email gate in [`TenantEmailService.ts`](../../../packages/email/src/TenantEmailService.ts#L337-L372) previously called the Redis limiter's non-atomic `tryConsume`. That method performs separate GET and SET operations in [`TokenBucketRateLimiter.ts`](../../../packages/core/src/lib/rateLimit/TokenBucketRateLimiter.ts#L300-L379), allowing concurrent requests to read the same token balance and each pass the check.

The affected live-send route is `testOutboundEmail` in [`emailSettingsActions.ts`](../../../packages/integrations/src/actions/email-actions/emailSettingsActions.ts#L407-L448), through `runOutboundEmailDiagnosticsImpl` and `defaultSendLive` in [`outboundDiagnostics.ts`](../../../packages/email/src/diagnostics/outboundDiagnostics.ts#L190-L230). The regular tenant send path also funnels through `checkEmailRateLimit` (`TenantEmailService.ts:333-335`). The existing atomic primitive is implemented as one Redis EVAL at [`TokenBucketRateLimiter.ts`](../../../packages/core/src/lib/rateLimit/TokenBucketRateLimiter.ts#L381-L457).

## Change

`checkEmailRateLimit` now calls `tryConsumeAtomic('email', tenantId, userId)`. The existing Lua EVAL primitive performs refill, capacity check, decrement, and TTL update in one Redis operation; no separate limiter or policy was added. Redis EVAL failures continue to deny in `tryConsumeAtomic`, while an unavailable/unready limiter still follows the email gate's existing fail-open path (`TenantEmailService.ts:349-352`). A Redis client without EVAL retains the atomic method's fail-open sentinel behavior.

## Behavioral evidence

- `TenantEmailService.rateLimit.test.ts` initializes the limiter with a mock Redis client and verifies the shared email gate invokes the atomic method once with the email namespace, tenant, and user, and never invokes non-atomic `tryConsume`.
- `TenantEmailService.rateLimit.concurrency.db.test.ts` sends 60 concurrent diagnostics live-send requests through `Promise.all` against live Redis, with a bucket capacity of 20 and negligible refill. With the atomic implementation, exactly 20 sends succeed and the mocked provider is called exactly 20 times. A second test verifies quota enforcement across application clock skew and future bucket timestamps.
- Negative control: temporarily restoring the original non-atomic call made the live test fail; all 60 requests were allowed for capacity 20. The atomic implementation was restored before final verification.

The live suite uses a random tenant-scoped Redis key and deletes it in `afterAll`. Its `.db.test.ts` suffix assigns it to the workspace database lane, which provides real Redis; the server unit lane uses a Redis stub and excludes database suites. Connection or authentication failures fail setup instead of skipping the behavioral assertions. The URL defaults to `redis://${REDIS_HOST || '127.0.0.1'}:${REDIS_PORT || '6379'}`. Set `EMAIL_RATE_LIMIT_TEST_REDIS` to override it; optionally set `EMAIL_RATE_LIMIT_TEST_REDIS_PASSWORD_FILE` to a file containing its password.

For focused validation from `server/`, run `REDIS_HOST=127.0.0.1 REDIS_PORT=6379 ../node_modules/.bin/vitest run --config vitest.redis.config.ts ../packages/email/src/__tests__/TenantEmailService.rateLimit.concurrency.db.test.ts`. The CI workspace database runner enables the real client automatically.

## Verification

- CI lane repair: the server configuration with `SKIP_DB_TESTS=1` passed all 46 email unit files (456 tests). Both live Redis tests passed with `vitest.redis.config.ts`; file collection confirmed the concurrency suite belongs to the workspace database lane and is excluded from the server unit lane. Email typechecking passed. Repeating the non-atomic negative control invoked the provider 60 times instead of 20 and failed as expected; the production source was restored before the final live run.
- `npm -w @alga-psa/email test` with the existing Redis service at `127.0.0.1:6380`: 47 test files passed, 1 skipped; 455 tests passed, 4 skipped.
- `npm -w @alga-psa/email run build`: passed.
- `npm -w @alga-psa/email run typecheck`: passed.
- Negative control with `tryConsume` restored temporarily: the live Redis concurrency test failed as expected, allowing 60 requests for a capacity of 20. Atomic code was restored and the live test and complete suite passed afterward.

The app server was not started. The pre-existing unstaged `package-lock.json` change was preserved and excluded from the commit.

## Reviewer should inspect first

1. The one-line shared-gate change in `TenantEmailService.ts`.
2. The concurrent live-Redis test and its negative-control result.
3. The fail-closed EVAL and preserved unavailable-limiter semantics described above.
