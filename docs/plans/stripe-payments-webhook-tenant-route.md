# Plan: Stripe payments webhook — tenant identity from the route, not the payload

Card: 7cce6ae5. Design decisions recorded as card facts (2026-11-09).

## Root cause
`/api/webhooks/stripe/payments` is shared by every tenant, but secrets are per tenant
(`stripe_payment_webhook_secret`). `paymentsSignature.ts` picks the candidate secret from
`metadata.tenant_id` **in the unverified body**; events Alga did not create carry no hint, so only the
platform secret is tried and verification returns 401. Stripe is deactivating endpoints.

## Change set (in order)
1. `packages/integrations/src/webhooks/stripe/paymentsSignature.ts`
   - `resolveSignatureCandidates({ tenantIdFromRoute?, payloadTenantHint? })` → ordered candidate secrets.
   - `verifyStripeSignature(rawBody, header, candidates)` → `{kind:'verified', tenantId, secretSource} | {kind:'ignored', reason} | {kind:'invalid'}`.
   - Constant-time compare per candidate; never short-circuit.
2. Legacy shared route: widen candidates — payload hint (if any), then **every enabled tenant's endpoint secret**
   (bounded, memoised per secret version), then platform secret for license-order events. Shippable alone; stops the bleed.
3. New route `api/webhooks/stripe/payments/[tenantId]`: load that tenant's enabled payment-provider config, verify against
   that tenant's secret only, dispatch with `tenantId` fixed by the route. Unknown/disabled tenant → 404.
4. Outcomes: verified → dispatch. Not Alga-originated or metadata tenant ≠ route tenant → **200 ignored** (never re-routed).
   Signature failure → 401. Malformed after verification → 400.
5. `ee/server/src/lib/actions/payment-actions.ts` connect flow: register endpoint URL `/api/webhooks/stripe/payments/<tenantId>`.
   Endpoint secret is preserved across a URL update.
6. `reconcileStripeWebhookEvents`: idempotent migration of existing endpoints (`stripe.webhookEndpoints.update(id,{url})`),
   tolerate deleted/paused endpoints, never recreate secrets. One operational run for all 31 enabled tenants after deploy.
7. Observability: structured log `{route, tenantId, secretSource, outcome, eventType, eventId}`; alert on 401 rate.

## Not doing
No secret rotation/recreation. Legacy endpoint stays live through migration. No change to `STRIPE_WEBHOOK_EVENTS`.
No generic multi-provider webhook router. Identifying the reporter's tenant is a support task, not a dependency.

## Tests
- Untagged event signed by tenant A's secret → 200 and dispatched to A on both the per-tenant and legacy routes.
- Payload `metadata.tenant_id = B` signed by A → 200 ignored, no B-side effect.
- Tampered signature → 401, no candidate leak. Unknown tenant route → 404. Platform license-order event → still handled.
- Migration idempotent (run twice = no-op); endpoint missing in Stripe → logged, skipped.

## Item 6 repair: on-demand endpoint migration from the legacy route
When a delivery on the legacy route (`POST /api/webhooks/stripe/payments`) verifies against tenant T's own endpoint
secret (`secretSource` `hint-tenant` | `tenant`, non-null tenantId), T's Stripe endpoint is moved to
`<base>/api/webhooks/stripe/payments/<T>` in the background. Response is unchanged.
- **Trigger site**: one place in `handlePaymentsWebhookDelivery`, right after signature verification, before any outcome
  branch. Fires for dispatched, dispatch_failed, ignored_tenant_mismatch and malformed-but-verified (decision: the move is
  URL-only and the signature proves the endpoint belongs to T, so payload shape is irrelevant). Never for platform,
  per-tenant route, invalid, missing header or 404. Not awaited; the dynamic import is part of the background work.
- **URL-only mode**: `reconcileStripeWebhookEvents(tenant, { scope: 'url' })` (default `'full'`, unchanged). Retrieve; if URL
  already matches, no update; else `update(id, { url })` with no `enabled_events`; config `webhook_events` untouched.
- **Entry point**: `migrateStripeWebhookEndpointOnDemand(tenantId)` in `ee/server/src/lib/payments/stripeWebhookEvents.ts`,
  exported from the EE payments index; no-op in the CE stub `packages/ee/src/lib/payments/index.ts`. Never throws; logs tenantId/endpointId only.
- **Single-flight**: in-process `Set` of in-flight tenants; cleared when the attempt ends. A completed attempt (including
  "endpoint missing") sets an in-process marker for 10 minutes; failures set none so the next delivery retries. No Redis
  (no readily available helper; each replica may attempt once per TTL, harmless since the update is idempotent).
- **Base-URL guard** (no Stripe calls, `logger.warn`): host `localhost`/`127.0.0.1`/`::1`, or non-https when
  `NODE_ENV === 'production'`.
- **Testing**: unit tests plus a live run against the Stripe emulator, which now models `/v1/webhook_endpoints`
  (create/retrieve/list/update/delete, per-endpoint signing secrets, deliveries follow the endpoint's current URL,
  `webhook_endpoints.*` operation faults). The reconcile Stripe client honours the guarded `stripeApiOverride`
  (`STRIPE_API_BASE_URL`, loopback + `sk_test_` only, ignored in production without `ALGA_STRIPE_LOCAL_REVIEW`).
  Recommended prod canary: run the ops script with `--tenant` on one tenant, then watch Loki for `On-demand migration`
  log lines.
