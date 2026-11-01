# Tenant Stripe account binding — design

Card: `d5b8b99b-6cba-5f17-b1fa-e811bc07dc0d` "Security: tenant-scoping in getStripePaymentConfig"
Finding: critical · `ee/server/src/lib/payments/StripePaymentProvider.ts#getStripePaymentConfig`
Step: Design Session (conn — XO desk)

## 1. The defect, confirmed in code

`getStripePaymentConfig(tenantId)` (`StripePaymentProvider.ts:52-99`) reads the tenant's
`payment_provider_configs` row, and **when tenant vault credentials are absent it silently falls back to
the application-wide account**:

```ts
let secretKey = await secretProvider.getAppSecret('stripe_secret_key');   // :79
if (!secretKey && process.env.STRIPE_SECRET_KEY) secretKey = process.env.STRIPE_SECRET_KEY;
```

`getStripe()` then hands that client to every method of the provider, and the provider is what the
tenant-facing import feature uses:

- `StripeCustomerImportService.create` (`:91-93`) → `createStripePaymentProvider(tenantId)`
  (`StripePaymentProvider.ts:836`).
- `previewStripeImportAction` / `proposeStripeImportMatchesAction` / `executeStripeImportAction`
  (`ee/server/src/lib/actions/stripe-import-actions.ts:45-82`) gate on nothing but
  `hasPermission(user,'billing','update')` — i.e. **any authenticated tenant user with billing:update**.
- `listCustomersForImport` (`:260-264`) pages up to 5 000 customers of whichever account the key belongs
  to; `getCustomerImportSnapshot` (`:247-258`) returns any supplied customer's payment methods, setup
  intents and payment intents.

The platform key has three legitimate operator users — `applianceLicenseActions.ts:54`,
`StripeService.ts:111`, `applianceConsole/stripeBilling.ts:46` — which is exactly why the fallback must be
removed from the *tenant* resolver rather than from the process environment.

The adoption half is in the classifier: `metadataClaimedByOther`
(`ee/server/src/lib/payments/stripeImportClassifier.ts:162-168`) treats a customer with **no** ownership
metadata (or partial metadata that does not contradict) as adoptable, and `execute` then stamps it with
the attacker's tenant (`StripeCustomerImportService.ts:195-265`). `selectOwnedCustomer`
(`ee/server/src/lib/stripe/stripeCustomerOwnership.ts:94-124`) accepts `tenant_id` alone as ownership
proof, so one client-payment import can become proof for binding the victim's Stripe customer to the
attacker tenant.

So the chain is: shared account → list → pick a victim customer by email/name/known `cus_` id → adopt →
stamp + enrol in autopay. Every link in that chain is either the fallback or a consequence of it.

## 2. What we change

The load-bearing control is **the tenant's Stripe account becomes a durable, verified binding**, and every
tenant-facing read is confined to that account. Removing the fallback alone is not sufficient and is not
enough on its own (a tenant config could name any account), so the two changes ship together.

### 2.1 Tenant credential resolution becomes tenant-only

`StripePaymentProvider.ts`:

- `getStripePaymentConfig(tenantId)` keeps its name and signature but loses **both** fallbacks (`:79`
  `getAppSecret('stripe_secret_key')` and the `process.env.STRIPE_SECRET_KEY` branch, `:88-93`). No
  `stripe_webhook_secret` / `stripe_publishable_key` app-level fallback either: a tenant without its own
  credentials is unconfigured, full stop. Returns `null`.
- New `ee/server/src/lib/payments/operatorStripeConfig.ts` exports `getOperatorStripeConfig()` and
  `createOperatorStripeClient()` containing exactly the code removed above. The three operator call sites
  listed in §1 switch to it. Nothing under a tenant request path may import it; that is enforced by a lint
  rule in §2.5.

### 2.2 The config carries a bound account id, verified at first use

`payment_provider_configs.configuration` (jsonb) gains `stripe_account_id` — additive, no migration:

- Written when credentials are saved (the Stripe settings action). The save path calls
  `stripe.accounts.retrieve()` with the newly supplied key and stores `account.id` only if the call
  succeeds; a key that cannot be verified is rejected at save time with a typed error.
- Read on first `getStripe()`: after constructing the client, the provider does
  `await stripe.accounts.retrieve()` **once per provider instance** and compares `account.id` to the bound
  id. Mismatch → the client is discarded and `StripeTenantAccountMismatchError` is thrown. Unbound config
  (`stripe_account_id` absent) → `StripeTenantAccountUnboundError`; the provider refuses to serve. This is
  what makes "the account is the tenant's" a fact rather than a copy-paste.

`configuration.stripe_account_id` is the single source of truth for the binding — deliberately not a new
column on `client_payment_customers` / `payment_methods`: those tables are Citus-distributed and the
provenance that matters for adoption lives on the Stripe object.

### 2.3 Import fails closed without a bound account

`StripeCustomerImportService.create` resolves the provider config up front and **throws before any Stripe
call** when it is missing or unbound:

- `stripe-import/no-tenant-stripe-account` (no credentials) — the three actions return this as the user
  message: "This tenant has no Stripe account configured; imports are disabled."
- `stripe-import/account-unbound` / `stripe-import/account-mismatch` — as above.

The service exposes the bound account id as `this.accountId` and passes it into classification so every row
records which account it was evaluated against.

### 2.4 Ownership proof becomes purpose-specific

- `importMetadata` (`stripeImportClassifier.ts:152-154`) stamps `stripe_account_id` alongside
  `tenant_id` / `client_id` / `billing_profile_id`.
- The classifier gains an explicit `ownershipOf(metadata, tenantId, accountId)` returning
  `owned | unclaimed | claimed-by-other`:
  - **owned** — metadata names this tenant **and** this account → adoptable.
  - **claimed-by-other** — metadata names another tenant/client/profile/account → `conflict`
    `customer-metadata-owned-by-other` (unchanged reason).
  - **unclaimed** — **adoptable only because the account is the tenant's own bound account** (§2.2). This
    preserves PR 4026's legacy unstamped nm-store customers, which are legitimately the tenant's by virtue
    of living in the tenant's own account. When the service could not establish a bound account, no row is
    adoptable at all (the service never reaches classification — §2.3).
- `selectOwnedCustomer` (`stripeCustomerOwnership.ts:94-124`) takes `{ tenantId, accountId, purpose }` and
  requires `metadata.stripe_account_id === accountId` when present. For `purpose: 'saas_billing'` it
  additionally requires `metadata.purpose === 'saas_billing'`; a `tenant_id` stamp produced by a
  client-payment import is **not** proof for binding SaaS billing. The operator recovery path
  (`StripeService.linkStripeCustomerToTenant`) sets that purpose explicitly, which is the only sanctioned
  way to create the binding.

### 2.5 Enforcement

- A `no-restricted-imports` ESLint rule (or the repo's existing boundary mechanism if one fits better) bars
  `operatorStripeConfig` from being imported under `server/src/app`, `server/src/lib/actions`, or
  `ee/server/src/lib/actions` — so the platform key cannot drift back into a tenant request path.
- `getStripePaymentConfig` gets a unit test that asserts it never consults `getAppSecret` or
  `process.env.STRIPE_SECRET_KEY` (the secret provider is stubbed; any call is a failure).

## 3. Tests (each must fail without the corresponding change)

1. **No fallback.** Stub the secret provider so the tenant has no vault credentials and the app has
   `stripe_secret_key`; `createStripePaymentProvider(t).getStripe()` rejects and no Stripe SDK call is made.
   Same through `previewStripeImportAction`: typed error, no customer listing.
2. **Binding verified.** Config bound to `acct_A`, credentials resolve to `acct_B` → `account-mismatch`,
   client never used. Unbound config → `account-unbound`.
3. **Legacy adoption still works inside the tenant's own account.** Bound account, customer with no
   metadata → adoptable; customer with `tenant_id` of another tenant → `conflict`.
4. **Cross-account adoption impossible.** A customer carrying another account's stamp is never adoptable
   even if `tenant_id` matches.
5. **Purpose-specific SaaS binding.** `selectOwnedCustomer` with a client-payment-import stamp
   (`tenant_id` + `stripe_account_id`, no `purpose`) → refuses for `saas_billing`.
6. **Existing suites.** Classifier/import/ownership tests updated only where they encoded the fallback;
   `payment_provider_configs` save path test covers writing/verifying `stripe_account_id`.

## 4. Deliberately NOT doing

- **Not deleting the platform account's operator access.** License management and the appliance console
  legitimately run on it; the fix is that it is no longer reachable *from a tenant*, not that it goes away.
- **Not adding a migration to `client_payment_customers` / `payment_methods`.** They are Citus-distributed;
  the account provenance that matters is the binding on the config and the stamp on the Stripe object.
  A local `stripe_account_id` column would be defensible but is not needed to close the chain and would
  widen the blast radius of this card.
- **Not rate-limiting the import actions.** The permission is already `billing:update`; bounds belong above
  this layer.
- **Not changing the assisted-matching UX.** It still proposes candidates by email/name; the difference is
  that candidates now come only from the tenant's own account.
- **Not silently migrating tenants off the platform account.** Tenants that were relying on the fallback
  become visibly unconfigured (typed error, UI copy). That is the correct failure mode; an operator note on
  the card will list what the captain should expect after deploy.

## 5. Order of work

1. `operatorStripeConfig.ts` + repoint the three operator call sites (behaviour-neutral, ship first).
2. Strip the fallbacks from `getStripePaymentConfig`; add save-time account verification.
3. Verify the binding at first use in `StripePaymentProvider.getStripe()` and cache the resolved account id.
4. Import service: fail-closed create, `accountId` plumbed into classification and `importMetadata`.
5. `ownershipOf` in the classifier; `selectOwnedCustomer` purpose/account signature; update the operator
   recovery path.
6. Tests §3; then the touched-package typecheck and the EE test suites.

## 6. Risks

- **Tenants on the fallback go dark** until they configure credentials — intended, but it must be said out
  loud in the release note, and the settings UI must explain the fix rather than showing a generic error.
- **`stripe.accounts.retrieve()` per provider instance** is one extra call; cached with the config for the
  process lifetime, so it is not per request.
- **Legacy unclaimed customers in a tenant's own account** remain adoptable by design; the guard is that the
  account is provably the tenant's. If an operator later re-points a tenant's credentials at another
  account, adoption must stop — which the mismatch check in §2.2 enforces.
