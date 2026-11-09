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
