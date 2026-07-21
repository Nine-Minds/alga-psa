# AI Usage Billing (AI Add-on) — Implementation Plan

- Date: 2026-07-20
- Branch: `feature/ai-usage-billing`
- Status: approved design, ready for implementation
- Scope: v1 of the AI add-on — credit-based usage billing for all AI features, hosted and on-prem

## 1. Summary

Alga PSA's AI features become a paid add-on billed with prepaid credits. A tenant
subscribes to a monthly Stripe subscription that includes a monthly allotment of
**abstract credits**; LLM calls burn credits at per-model rates. Tenants can buy
one-time top-up packs and enable auto-top-up. When credits run out, a small grace
buffer lets work finish, then AI hard-stops with clear in-product messaging.

A new standalone service — the **AI gateway** (`services/ai-gateway`) — is the
single metering and enforcement point for **both** hosted tenants and on-prem
appliances. It is an OpenAI-compatible transparent proxy: it authenticates the
caller, checks the credit balance, forwards the request to the real provider
(Vertex / OpenRouter — provider keys exist *only* in the gateway), reads token
usage off the response, and debits an append-only credit ledger in its own
Postgres database. Hosted AlgaPSA reaches it through the existing
`resolveChatProvider` facade; appliances call it directly with their
alga-license credential, gated on a recorded data-sharing consent.

Stripe is used **for money movement only**: flat monthly subscription, one-time
top-up payments, and off-session PaymentIntents for auto-top-up. There are **no
Stripe billing meters and no Stripe credit grants** — the gateway ledger is the
sole record of credit burn. The gateway owns the Stripe webhook endpoint for the
add-on, so purchase surfaces (hosted in-app billing, nm-store portal for
on-prem) only create checkout sessions and never touch the ledger.

## 2. Decisions (settled in design session)

| Topic | Decision |
|---|---|
| Who bills whom | Nine Minds bills tenants for the AI add-on (not tenant→client billing) |
| Credit unit | Abstract credits; internal per-model token→credit rates |
| Commercial shape | Single tier v1: monthly subscription with included credits + one-time top-up packs; auto-top-up in v1 |
| Numbers | Mechanism only — every price, credit amount, rate, and threshold is configuration, not code |
| Zero credits | Grace buffer (default 10% of monthly included credits, configurable per account), then hard stop; in-flight requests always complete |
| Grace deficit | Deducted from the next monthly included grant; never billed (bounded by the grace limit) |
| Included credits | Reset monthly (no rollover); top-up credits persist until used; burn order: included first, then top-ups |
| Architecture | New standalone gateway service = single metering/enforcement point for hosted + on-prem |
| Gateway shape | Transparent OpenAI-compatible proxy (`/v1/chat/completions`); provider keys live only in the gateway; fail closed |
| Stripe depth | Money movement only — no meters, no credit grants, no usage mirroring, no reconciliation job |
| Purchases | Hosted: in-app via existing EE Stripe integration. On-prem: nm-store portal |
| Webhooks | Gateway owns the Stripe webhook endpoint for all AI add-on events |
| Gating | No subscription → no AI (upsell state). Applies to **all** AI surfaces, including background classifiers |
| On-prem | Appliance calls the gateway; requires recorded data-sharing consent, enforced at the gateway |

## 3. Architecture

```
hosted AlgaPSA (EE)                      appliance (on-prem)
  resolveChatProvider('gateway')            provider resolver → gateway
  OpenAI client + tenant service token      alga-license credential
        │                                        │  (requires consent record)
        ▼                                        ▼
   ┌──────────────────────────────────────────────────┐
   │  services/ai-gateway  (own Postgres)             │
   │  auth → admission (balance+grace) → proxy call → │──► Vertex / OpenRouter
   │  usage capture → ledger debit → auto-top-up check│    (keys only here)
   │  Stripe webhook consumer (grants, status)        │◄── Stripe webhooks
   └──────────────────────────────────────────────────┘
        ▲                          ▲
  hosted billing settings     nm-store portal
  (create checkout/sub)       (create checkout/sub)
```

Verified grounding:

- All AI callers already route through `ee/server/src/services/chatProviderResolver.ts`,
  which returns `ResolvedChatProvider { providerId, model, client: OpenAI, requestOverrides }`.
  Callers: `chatCompletionsService`, `chatStreamService`, `lib/opportunities/drafting`,
  `email/inboundReplyAcknowledgementDecider`, `email/inboundEmailRuleAiClassifier`,
  `inventory/ghostUsageClassifier`, `workflowInferenceService`.
- Standalone services live in `services/` (email-service, workflow-worker) with
  their own Dockerfile + package.json; the gateway follows that pattern.
- EE Stripe integration exists (`ee/server/src/lib/stripe/StripeService.ts`,
  `stripe_customers`/`stripe_subscriptions` tables, webhook route
  `server/src/app/api/webhooks/stripe/route.ts`) for license purchasing — the
  add-on purchase UI builds on it.
- Appliances get identity from **alga-license** (separate repo): registry
  `tenant_id` + stored appliance credential, minted at registration
  (see `docs/plans/2026-06-05-appliance-registration-install-flow/`).
  **nm-store** (DB-less Next.js, separate repo) is the on-prem purchase surface.

## 4. Gateway service (`services/ai-gateway`)

Node/TS service following the `services/email-service` conventions: own
`package.json`, `Dockerfile`, entrypoint, wired into the compose files and the
Argo build/deploy path. Own Postgres database `ai_gateway` (not the tenant
app DB) with knex migrations local to the service.

### 4.1 Data model

All credit columns are `bigint`. No floats anywhere in money/credit math.

- **`ai_accounts`** — one row per paying entity.
  `account_id (pk)`, `tenant_id`, `deployment_type ('hosted'|'appliance')`,
  `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`,
  `included_balance`, `topup_balance` (running sub-balances),
  `grace_limit_credits`, `cycle_started_at`, `low_balance_threshold`,
  `auto_topup_enabled`, `auto_topup_threshold_credits`,
  `auto_topup_pack_price_id`, `auto_topup_failure_count`,
  `created_at`, `updated_at`. Unique on (`tenant_id`, `deployment_type`).
- **`credit_ledger`** — append-only.
  `entry_id (pk)`, `account_id (fk)`,
  `entry_type ('grant_included'|'grant_topup'|'usage_debit'|'expiry'|'adjustment')`,
  `bucket ('included'|'topup')`, `credits` (signed), `balance_after`
  (total across buckets), `stripe_ref` (nullable — payment/invoice id),
  `usage_id` (nullable fk), `note`, `created_at`.
  Balance is read from `ai_accounts` sub-balances (maintained transactionally
  with each ledger insert), never by summing on the hot path. A usage debit that
  spans buckets writes one ledger row per bucket touched.
- **`ai_usage_events`** — one row per LLM call.
  `usage_id (pk)`, `account_id (fk)`, `feature`
  (`chat`, `chat-title`, `email-reply-ack`, `email-rule-classifier`,
  `opportunity-drafting`, `workflow-inference`, `inventory-classifier`, …
  passed by the caller via header), `model`, `provider`,
  `prompt_tokens`, `completion_tokens`, `total_tokens`, `credits_charged`,
  `request_id`, `duration_ms`, `created_at`.
- **`pricing_config`** — versioned rates.
  `pricing_id (pk)`, `model_pattern`, `credits_per_1k_input_tokens`,
  `credits_per_1k_output_tokens`, `effective_from`, `created_at`.
  Resolution: most specific matching pattern with latest `effective_from` ≤ now;
  no match → configurable default rate (env/config), **never free**.
- **`consent_records`** — appliance data-sharing opt-in.
  `consent_id (pk)`, `account_id (fk)`, `granted_by` (user identity string from
  the appliance), `terms_version`, `granted_at`, `revoked_at` (nullable),
  `revoked_by` (nullable). Active consent = latest row with `revoked_at IS NULL`.
- **`stripe_webhook_events`** — idempotency: `event_id (pk)`, `type`,
  `processed_at`, `payload_hash`.
- **`tier_config`** (single-row v1, or env-driven config — implementer's choice,
  but it must be changeable without deploy): monthly included credits, grace
  percent default, top-up pack definitions (Stripe price id → credits), low
  balance default threshold.

### 4.2 Balance semantics

- `available = included_balance + topup_balance + grace_limit_credits`.
- Admission: request allowed iff `subscription_status` is active-ish
  (`active`, `trialing`, `past_due` within Stripe's retry window) **and**
  `available > 0` **and** (appliance only) active consent exists.
- Debit happens **after** the provider call at actual token counts, so total
  balance may go as negative as one call's overshoot past the grace floor.
  Accepted by design (in-flight requests complete).
- Burn order: `included_balance` first, then `topup_balance`; both may be driven
  negative only by the final overshooting debit.
- Monthly cycle renewal (`invoice.paid`): `included_balance` is **set** to
  (tier included credits + current `included_balance` if negative — i.e. the
  deficit carries in, rollover does not). `topup_balance` untouched.
  Ledger records an `expiry` entry zeroing any positive included remainder and a
  `grant_included` entry for the new allotment.
- Concurrency: debit path locks the account row (`SELECT … FOR UPDATE`),
  inserts ledger row(s) + usage event and updates sub-balances in one
  transaction. Admission checks read the row without locking; grace absorbs
  the raciness.

### 4.3 HTTP API

- `POST /v1/chat/completions` — OpenAI-compatible, streaming and non-streaming.
  Metered. Callers pass `X-Alga-AI-Feature: <feature>` for attribution.
  For streaming, the gateway injects `stream_options: {include_usage: true}`
  upstream and captures the final usage chunk while passing all chunks through
  unmodified.
- `GET /v1/account` — subscription status, included/topup balances, grace
  limit, low-balance flag, cycle info, auto-top-up settings, consent status.
- `GET /v1/account/usage?from&to&feature&cursor` — paginated usage history.
- `POST /v1/account/auto-topup` — enable/disable + threshold/pack settings
  (called from both purchase surfaces' settings UIs).
- `POST /v1/consent` / `DELETE /v1/consent` — appliance opt-in lifecycle
  (records `granted_by`/`terms_version`; delete = revoke, takes effect
  immediately on admission checks).
- `POST /v1/admin/grants` — internal/ops-only manual `adjustment` entries
  (support credits, refunds). Protected by an ops service token.
- `POST /webhooks/stripe` — see §6.
- `GET /healthz`.

Rejections from the metered endpoint use HTTP 402 with
`{ error: { code: 'no_subscription' | 'out_of_credits' | 'consent_required', … } }`
so client surfaces can render exact states. Auth failures are 401; a revoked
consent is 402/`consent_required` (not 401 — the box is who it says it is).

### 4.4 Authentication

Two caller classes:

- **Hosted AlgaPSA**: the app server holds a shared service secret
  (`AI_GATEWAY_SERVICE_SECRET`) and mints short-lived signed tokens (JWT/HMAC,
  ~5 min TTL) carrying `tenant_id`, following the existing internal
  service-auth pattern in the codebase. Gateway verifies and maps
  `tenant_id` + `deployment_type='hosted'` → account.
- **Appliance**: authenticates with its alga-license appliance credential.
  Gateway verifies against a new alga-license verification endpoint
  (see §8) and caches the result (short TTL, e.g. 5 min). Resolves registry
  `tenant_id` + `deployment_type='appliance'` → account. Requires active
  consent record.

Accounts are created lazily on first authenticated contact (with
`subscription_status='none'`) so `GET /v1/account` works before purchase and
the upsell state has something to render.

### 4.5 Provider proxying

The Vertex/OpenRouter resolution logic currently in
`ee/server/src/services/chatProviderResolver.ts` (ADC token handling, base URL
construction, fallback) **moves into the gateway** as its upstream-provider
module. The gateway decides the upstream from its own config (per-model routing
map), not from the caller. Provider errors pass through with no debit. If the
provider returns usage but the client connection died mid-stream, the debit
still happens (tokens were consumed).

### 4.6 Auto-top-up

After any debit that leaves `included_balance + topup_balance` below the
account's `auto_topup_threshold_credits` (and auto-top-up enabled): enqueue a
top-up job (in-DB job row + poller, or the service's existing job conventions —
implementer's choice, but it must be idempotent per account+cycle-of-need).
The job creates an off-session PaymentIntent on the saved default payment
method for the configured pack. Success → `grant_topup` ledger entry (webhook
confirms; the job only initiates). Failure → retry with backoff up to N
(config, default 3), then set `auto_topup_enabled=false`,
increment `auto_topup_failure_count`, and emit a notification event (§7).

## 5. Hosted AlgaPSA integration

### 5.1 Provider facade

- `chatProviderResolver.ts` gains provider id `'gateway'` as the default when
  `AI_GATEWAY_URL` is set: returns `ResolvedChatProvider` whose `client` is an
  `OpenAI` instance pointed at the gateway with a freshly minted tenant token,
  and whose `requestOverrides` inject the `X-Alga-AI-Feature` header (each
  caller passes its feature name — small signature addition or a per-caller
  wrapper, implementer's choice).
- Direct `vertex`/`openrouter` resolution stays as an env-flag fallback
  (`AI_GATEWAY_BYPASS=true`) for local dev and emergencies.
- A small shared client lib (`ee/server/src/lib/aiGateway/`) wraps:
  token minting, account fetch (`GET /v1/account`), usage fetch, error
  mapping of gateway 402 codes → typed `AiCreditsError { reason }`.

### 5.2 Surface behavior on 402

- **Interactive chat (stream + completions routes)**: catch `AiCreditsError`
  and return a structured error the chat UI renders as a blocking panel:
  `no_subscription` → AI add-on upsell with link to billing settings;
  `out_of_credits` → balance + top-up link.
- **Background surfaces** (email classifiers, reply-ack decider, opportunity
  drafting, workflow inference, inventory classifier): degrade to their
  existing no-AI behavior (skip classification → default routing; workflow AI
  step fails with a workflow-visible error message). Each surface emits a
  rate-limited (e.g. 1/day/tenant/surface) admin notification so the
  degradation is visible.

### 5.3 Purchase & management UI (EE billing settings)

New "AI Usage" section in the EE billing settings area, built on the existing
`StripeService` patterns:

- Subscribe flow: Stripe Checkout for the add-on subscription price
  (metadata: `tenant_id`, `deployment_type='hosted'`, `purpose='ai-addon'`),
  collecting/saving a default payment method for future off-session use.
- Balance card: included vs top-up split, cycle progress, grace indicator.
- Usage history table: from `GET /v1/account/usage`, filterable by feature.
- Top-up: Stripe Checkout one-time payment for a pack price
  (same metadata + `purpose='ai-topup'`).
- Auto-top-up config: toggle, threshold, pack — calls
  `POST /v1/account/auto-topup`.
- Manage/cancel subscription: Stripe billing portal or existing patterns.
- Chat UI header: compact credits indicator (from `GET /v1/account`, cached
  ~60 s client-side), switching to a warning style below the low-balance
  threshold, and to the blocking states on 402.

### 5.4 Gating

`no subscription → no AI` is enforced by the gateway (402), but hosted UI also
pre-checks `GET /v1/account` to render upsell states without a failed call.
Rollout flag (§9) controls whether a tenant's traffic goes through the gateway
at all; unflagged tenants keep today's free direct-provider behavior.

## 6. Stripe (money movement only)

Stripe objects (all ids in config/env, test + live):

- Product "AlgaPSA AI Add-on", one flat monthly subscription price (single
  tier v1). Included-credit amount is **our** config keyed off the price id —
  Stripe knows nothing about credits.
- One-time prices for top-up packs (price id → credits mapping in
  `tier_config`).

Gateway webhook consumer (`POST /webhooks/stripe`, signature-verified,
idempotent via `stripe_webhook_events`):

- `checkout.session.completed` (`purpose='ai-addon'`): bind
  `stripe_customer_id`/`subscription_id` to the account (creating it if
  needed from metadata), set status.
- `invoice.paid` (subscription cycle): perform the monthly cycle renewal
  (§4.2) — deficit-carrying included grant reset.
- `checkout.session.completed` / `payment_intent.succeeded`
  (`purpose='ai-topup'` or auto-top-up initiated): `grant_topup` ledger entry
  (idempotent on payment intent id via `stripe_ref`).
- `customer.subscription.updated/deleted`: update `subscription_status`;
  `invoice.payment_failed`: status per Stripe state (admission logic already
  tolerates `past_due` within the retry window).

The existing hosted webhook route (`server/src/app/api/webhooks/stripe/route.ts`)
is **not** extended for add-on events; the Stripe webhook endpoint config adds
the gateway URL for the relevant event types (separate webhook secret).

## 7. Notifications

Emit through the existing notification/email system (hosted) and appliance
notification surface, driven by gateway state transitions. The gateway exposes
these as events; for v1 the simplest compliant mechanism is: hosted app and
appliance poll `GET /v1/account` where they already do, and the gateway
additionally fires outbound webhooks/emails for the money-critical ones.
Implementer picks the mechanism per event; required events:

- Low balance threshold crossed (default: at low_balance_threshold).
- Entered grace (total balance ≤ 0).
- Hard stop (grace exhausted).
- Auto-top-up succeeded / failed / disabled after retries.

## 8. Cross-repo work (separate coordinated PRs)

- **alga-license** (separate repo): add an appliance-credential verification
  endpoint for the gateway (`POST /verify-appliance` → `{ tenant_id, edition }`),
  service-to-service authenticated. Small, additive.
- **nm-store** (separate repo, DB-less): portal pages for on-prem customers —
  subscribe to the AI add-on, buy top-ups, manage auto-top-up — creating Stripe
  Checkout sessions with the same metadata contract (registry `tenant_id`,
  `deployment_type='appliance'`), and a balance/usage view calling the gateway's
  account endpoints (authenticated via the existing portal re-issue mechanism →
  short-lived gateway token; exact mechanism decided in that PR).
- **Appliance/EE server (this repo)**: appliance provider resolver targets the
  gateway with the alga-license credential; settings screen for data-sharing
  consent (terms display + versioned accept/revoke → gateway consent API),
  balance card, and links out to nm-store for purchase.

This branch lands the gateway + hosted integration + appliance-side code that
lives in this monorepo; the alga-license and nm-store PRs are listed as
explicit follow-ups with their API contracts frozen by this plan.

## 9. Rollout

- All AlgaPSA-side behavior behind a PostHog feature flag
  (`ai-usage-billing`), per existing conventions — per-tenant enablement.
- Unflagged tenants: today's free, direct-provider behavior (bypass path).
- Flagged tenants: traffic via gateway, gating enforced.
- `AI_GATEWAY_BYPASS` env flag for local dev/emergency.
- Gateway deploys via the standard Argo path (nm-kube-config), like
  email-service/workflow-worker. New secrets: gateway DB, service secret,
  Stripe secret + webhook secret, provider keys (moved), alga-license
  service token.
- Grandfathering/comms for existing AI users is a business decision outside
  this branch; the per-tenant flag is the lever.

## 10. Testing

- **Gateway unit**: pricing resolution (patterns, effective dating,
  unknown-model default), ledger math (burn order, grace admission, deficit
  carry on renewal, `balance_after` chain), concurrent debit correctness
  (transaction + row lock under parallel calls), auto-top-up trigger/backoff/
  disable, webhook idempotency.
- **Gateway integration** (existing integration-test harness conventions):
  fake OpenAI-compatible upstream (streaming + non-streaming; usage chunk
  capture; provider error → no debit; mid-stream client disconnect → debit
  still recorded); Stripe webhook flows from recorded test-mode fixtures;
  alga-license verification stub with consent present/absent/revoked.
- **Hosted integration**: facade resolves to gateway, feature header
  attribution, 402 → `AiCreditsError` mapping, background-surface degradation
  paths, bypass flag.
- **E2E smoke (Stripe test mode, Playwright per existing patterns)**:
  subscribe → chat burns credits → balance UI updates → drain to grace →
  hard stop states → manual top-up restores → auto-top-up fires at threshold.
- **Appliance-path integration**: credential auth + consent gate (allow,
  refuse-without-consent, immediate refusal after revoke).

## 11. Implementation order

1. **Gateway skeleton**: service scaffold in `services/ai-gateway`, DB +
   migrations (§4.1), health endpoint, compose wiring, CI/test harness.
2. **Ledger core**: balance semantics, pricing engine, admission + debit
   transaction, unit tests. (Pure logic first — most of the correctness risk
   lives here.)
3. **Proxy path**: OpenAI-compatible endpoint, provider modules (moved
   resolver logic), streaming usage capture, usage events, fake-provider
   integration tests.
4. **Auth**: hosted token mint/verify; alga-license verification client
   (stubbed until the alga-license PR lands); lazy account creation.
5. **Stripe**: webhook consumer + idempotency, cycle renewal, top-up grants,
   subscription status handling; auto-top-up job.
6. **Hosted facade + surfaces**: `'gateway'` provider in
   `chatProviderResolver`, shared client lib, 402 error mapping, feature
   headers on all seven callers, background degradation + admin notifications.
7. **Hosted UI**: AI Usage billing settings section (subscribe, balance,
   usage, top-up, auto-top-up), chat header indicator, upsell/blocked states.
8. **Appliance side (this repo)**: gateway-targeting resolver, consent
   settings screen, balance card.
9. **Notifications** (§7) and rollout flag wiring (§9).
10. **E2E smoke + polish**; freeze API contracts for the alga-license and
    nm-store follow-up PRs (write them into `docs/plans/` as short contract
    docs if not already unambiguous here).

Each step lands with its tests; steps 1–5 are pure-additive (no user-visible
change); nothing is user-visible until the flag flips per tenant.

## 12. Out of scope (explicit)

- Multiple tiers; annual billing; per-seat AI pricing.
- Tenant→client AI rebilling through the PSA invoice pipeline.
- Postpaid/overage billing (grace deficit is never billed in v1).
- Stripe billing meters / credit grants / usage mirroring.
- Actual price points, credit amounts, per-model rates (config, set later).
- Grandfathering policy for existing AI users (business decision; flag is the lever).
