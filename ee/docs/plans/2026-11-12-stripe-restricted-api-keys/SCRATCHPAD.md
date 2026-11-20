# Scratchpad: Stripe restricted API keys

## Context
- Source: ticket alga-2026-0002833. Earlier roadmap items for the same request exist (May 2026 and Sept 2026); at least three customers asked.
- Researched 2026-11-12 against origin/main. No PR, branch or board card existed for rk_ support.

## Key facts
- Prefix check is client-side only: PaymentSettings.tsx (`!secretKey.startsWith('sk_')`) and StripeConnectionSettings.tsx. `connectStripeAction` checks only `pk_` on the publishable key.
- Tenant key secret name: `stripe_payment_secret_key`. Read only in payment-actions.ts, StripePaymentProvider.ts, stripeWebhookEvents.ts. Webhook signing secret is separate (`stripe_payment_webhook_secret`).
- connectStripeAction swallows webhook errors (logs a warning, still stores the key). With a restricted key missing webhook_write this connects but never reconciles payments.
- Connect path reuses an existing webhook endpoint when a signing secret is stored (updates events), and preserves settings (alga-2026-0002724). The connected UI state has only Disconnect, which deletes the webhook.
- Errors mapped only for `StripeAuthenticationError` at three sites in payment-actions.ts (connect, test connection, one more).
- Existing tests to extend: `ee/server/src/__tests__/unit/payments/connectStripeAction.reconnect.test.ts` (mocks stripe, secrets, db), `paymentSettingsValidation.test.ts`. A Stripe emulator exists in packages/emulators/stripe but cannot tell us what real Stripe enforces for restricted keys.
- Locales with the strings: de en es fr it nl pl pt sv (xx, yy pseudo-locales have none). Keys: billing-settings `invalidSecretKey`, `secretKeyPlaceholder`; integrations `secretKeyPlaceholder`, `secretKeyFormat`.

## Stripe documentation (read 2026-11-12)
- Restricted keys start `rk_live_` / `rk_test_`; per-resource None / Read / Write; write implies read; GET = read, POST/DELETE = write. Drop-in replacement for sk_ in server code.
- Stripe doc says a missing permission returns an invalid-request error whose message says which permission to add (SDK type/code not documented; spike).
- Permission ids (API permissions reference): checkout_session_read/write, customer_read/write, payment_intent_read/write, payment_method_read/write, setup_intent_read/write, charge_read/write, webhook_read/write. `customers/{id}/payment_methods` needs payment_method_read. customers/search needs customer_read.
- The reference table fetched did not list `GET /v1/account` or `POST /v1/payment_intents`; it was a partial fetch. Confirm against the Dashboard resource list or a real key.

## Decisions
- Single permission manifest drives checks, errors, UI help, docs and a drift test (general mechanism rather than hard-coding the list in docs).
- Connect fails on missing webhooks/core-payments permissions, warns on auto-pay/import ones.
- Replace key in place (Update API keys) reusing the connect path, instead of disconnect then connect.
- No feature flag: additive, sk_ behaviour unchanged.

## Commands
- Run unit tests from `ee/server`: `npx vitest run src/__tests__/unit/payments`.
- Create the test key: Stripe Dashboard (test mode / sandbox) → Developers → API keys → Create restricted key.

## Draft Implementation evidence (2026-11-20)

### Stripe authorization observations
- The implementation environment had no Stripe credential available (no `STRIPE`-named environment variables), and no authorized `rk_test_` was supplied through another channel. No request was sent to Stripe. The Stripe emulator was not used to infer authorization behavior.
- `accounts.retrieve()` access under a restricted key is **not verified**. The connect flow now requires a successful `webhookEndpoints.list({ limit: 1 })` manifest read for key validation and treats account lookup as best-effort.
- No write probe was run, and no Stripe object was created or modified by a probe. Every write permission stays `checked on first use`; its reason is included in the manifest and UI help.
- The Stripe SDK error type/code/message for permission denial is **not verified live**. Mocked regression coverage uses the expected invalid-request shape (`StripeInvalidRequestError`, `parameter_invalid_empty`, message naming the permission). Authentication and other errors do not parse as permission denials.

### Implementation
- Added `stripePermissionManifest.ts` as the tenant-key permission source for `webhooks`, `core-payments`, `saved-cards-auto-pay`, and `customer-import`, including shared permissions and write-implies-read annotations.
- Shared strict secret-key validation accepts `sk_live_`, `sk_test_`, `rk_live_`, and `rk_test_` formats and runs in both forms and the server action before constructing a Stripe client.
- Connect checks manifest list reads with `limit: 1`; required read denials fail before writes. Webhook endpoint permission errors fail connect and are translated by capability and permission id before storing the replacement API secret. Optional read denials return unavailable capability/permission details. Account retrieval is best-effort.
- Added in-place **Update API keys** UI. The existing connect path retains the endpoint and signing-secret path for same-account replacement and merges saved payment settings. Failed webhook replacement is covered by a test that asserts no vault writes and no provider-row changes.
- Both key forms show collapsed capability-grouped permission help, with first-use checks marked. Test connection reports capability statuses. Updated all requested locale files.
- Corrected both documentation sources. The nm-store source is isolated in worktree `/tmp/nm-store-stripe-restricted-keys` on branch `docs/stripe-restricted-tenant-keys`; its local commit is recorded separately.
- The repo test compares every docs-table capability, permission id, access level and covered operation to the manifest. Set `STRIPE_PUBLISHED_DOC_PATH` to verify the separate published source; the test does not hardcode Robert's checkout path. SDK drift scanning covers all calls in the three designated files, and a synthetic `stripe.refunds.create()` call is detected as uncovered.

### Verification completed
- `npx vitest run src/__tests__/unit/payments` plus `src/components/settings/integrations/__tests__/StripeConnectionSettings.restrictedKey.test.tsx`: **15 files, 116 tests passed**. The published docs parity path was supplied with `STRIPE_PUBLISHED_DOC_PATH`.
- `NODE_OPTIONS='--max-old-space-size=24576' npm run typecheck`: **passed**. The default 4 GB heap and an 8 GB retry both ran out of memory; 24 GB completed.
- `npm run build`: outcome to be recorded after completion.
- The app server was not started. The pre-existing root `package-lock.json` modification remains excluded from implementation changes.

### T012 manual coverage and remaining live checks
- Mocked only: key format rejection before first Stripe call; equivalent success results for fake `sk_test_` and `rk_test_`; denied `customer_read` core preflight; denied `setup_intent_read` optional warning; `webhook_write` denial during actual existing-endpoint update; failed replacement preserves provider config, endpoint id, signing-secret path, and settings without writing vault secrets.
- Not exercised against Stripe: Checkout payment and webhook invoice reconciliation; saved-card setup; auto-pay charge; customer import; removing each of `webhook_write`, `checkout_session_write`, `payment_intent_write`, and `customer_read`; any write permission probe; `accounts.retrieve()` restricted-key behavior. These remain reviewer live checks when a restricted test key is available.
- No same-account enforcement was added, per scope. A restricted key for another Stripe account remains an open risk from the original plan.
- Initial production build failed because workspace package `@alga-psa/jobs` did not have generated `dist` outputs for its declared `./fanout` and `./runner` exports. `npm run build --workspace=@alga-psa/jobs` generated the workspace outputs successfully (ignored build artifacts); the application build was rerun afterward.
- Separate nm-store documentation commit: `382767c9d7526967298f404b923a3da377e7d531` on local branch `docs/stripe-restricted-tenant-keys` (worktree clean; original nm-store worktree and branch were left untouched).

## Reviewer repair evidence (2026-11-20)
- Permission parsing recognizes SDK `StripePermissionError` errors and falls back to the manifest operation when a 403 message omits the permission ID. Non-permission authentication and connection errors stay on their existing error paths. Webhook setup and retry carry the failing operation into translation; the Stripe payment provider wraps deferred SDK operations so first-use denials are translated at the operation boundary. Test Connection includes per-capability status data even when a required permission is denied, and both forms render those results.
- Added `checkout.sessions.list`, `charges.list`, and `paymentMethods.list` as read probes. The nested Checkout operation is resolved segment by segment, and each probe uses `{ limit: 1 }`. `setup_intent_read` is shared by `saved-cards-auto-pay` and `customer-import`; optional denial permits connect and reports both unavailable capabilities.
- A connected tenant's saved webhook endpoint ID now takes precedence over URL matching. Replacement does not choose a duplicate legacy URL, and a failed provider-row update restores the previous API secret in the vault. Standard `sk_` initial connect retains partial success for non-permission webhook failures; permission failures remain blocking, and replacement failures retain the active connection.
- Added behavioral coverage for duplicate endpoint URLs, post-vault-write database failure, standard-key partial success, SDK `StripePermissionError` preflight and actual webhook update, shared optional capability warnings, and Test Connection required-denial status payload.
- Corrected both docs tables to match manifest operations and shared capabilities. The published source repair was committed separately as `a2f24d27eae322979f91491be69848a15e2b2371` on `docs/stripe-restricted-tenant-keys` in the isolated nm-store worktree.
- Final verification after deferred-error translation: from `ee/server`, `npx vitest run src/__tests__/unit/payments` passed (14 files, 120 tests). `STRIPE_PUBLISHED_DOC_PATH=/tmp/nm-store-stripe-restricted-keys/packages/nm-store/src/site/content/docs/online-payments.md npx vitest run src/__tests__/unit/payments/stripePermissionManifest.test.ts src/components/settings/integrations/__tests__/StripeConnectionSettings.restrictedKey.test.tsx` passed (2 files, 16 tests), including manifest/docs parity for both sources and SDK drift detection. `NODE_OPTIONS='--max-old-space-size=24576' npm run typecheck` passed. Default-heap `npm run build` exited 134 on Node heap OOM; `NODE_OPTIONS='--max-old-space-size=24576' npm run build` passed on final code (existing Next/Webpack warnings and dynamic-route diagnostics). A detached dev server was already running for this checkout at inspection and was stopped; no app server was started for verification.
- No authorized Stripe test key was supplied; this remains a mocked spike, not live Stripe evidence. No write permission behavior, `accounts.retrieve()` authorization, Checkout payment/webhook reconciliation, saved-card setup, auto-pay charge, customer import, or removal of `webhook_write`, `checkout_session_write`, `payment_intent_write`, and `customer_read` was exercised live. T012 and the live write-probe observations remain outstanding for a reviewer with an authorized Stripe test account.

### Exact verification commands
Run from `ee/server` unless noted:

```bash
export NM_STORE_ROOT=/path/to/nm-store-worktree
STRIPE_PUBLISHED_DOC_PATH="$NM_STORE_ROOT/packages/nm-store/src/site/content/docs/online-payments.md" npx vitest run src/__tests__/unit/payments src/components/settings/integrations/__tests__/StripeConnectionSettings.restrictedKey.test.tsx
NODE_OPTIONS='--max-old-space-size=24576' npm run typecheck
NODE_OPTIONS='--max-old-space-size=24576' npm run build
```

The docs parity test uses the provided path and the repo-local guide; no Robert-specific checkout path is embedded in the test. The recorded suite result was 15 files / 117 tests passed. Typecheck passed with exit 0. The final build rerun outcome is recorded below when it exits.
- Final `NODE_OPTIONS='--max-old-space-size=24576' npm run build` completed successfully after the jobs workspace build. Next compiled, completed TypeScript, generated all 30 static pages, and emitted the route summary. It logged existing Next config deprecation/route export warnings, webpack dynamic-dependency warnings, and expected dynamic-cookie prerender diagnostics; there was no build error.
- After the final UI summary-id adjustment, its focused component test passed (1 file / 1 test), and `NODE_OPTIONS='--max-old-space-size=24576' npm run typecheck` passed with exit 0.
