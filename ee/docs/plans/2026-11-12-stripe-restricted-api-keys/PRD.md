# Stripe restricted API keys (rk_) for tenant payments

Source: Alga ticket alga-2026-0002833. Roadmap items for the same request have existed since May 2026, and at least three customers have asked.

## Problem

A tenant connects its own Stripe account to AlgaPSA (Settings → Billing → Payments, and Settings → Integrations → Stripe) so invoices can be paid by Checkout link, saved card and auto-pay. The connection form accepts only a standard secret key (`sk_live_` / `sk_test_`), which grants unrestricted access to the Stripe account.

Stripe recommends giving third parties restricted keys (`rk_live_` / `rk_test_`) scoped to the least privilege they need. MSPs who follow that guidance cannot connect Stripe at all: the form rejects an `rk_` key before it reaches Stripe.

The block is a client-side prefix check only. The server action does not check the secret-key prefix. But simply relaxing the check would create a worse problem: a restricted key missing a permission connects "successfully" and then fails later, silently or with an unhelpful message (see Findings).

## Goals

1. Accept `rk_live_` and `rk_test_` keys wherever `sk_` keys are accepted for tenant payments, in both forms and on the server.
2. State, in one place, exactly which Stripe permissions each payment capability needs, and have that single source drive: connect-time checks, error messages, UI help text, and the published docs list.
3. Tell the user which permission is missing, at connect time and on "Test connection", instead of failing on the first payment.
4. Let a connected tenant replace its key (for example `sk_` → `rk_`) without disconnecting, so the webhook endpoint and signing secret are kept and no payment goes unreconciled.
5. Publish the minimum permission list and correct the docs that currently contradict the form.

## Non-goals

- Stripe Connect / platform keys, or Nine Minds' own billing key (`stripe_secret_key` app secret): unchanged.
- Changing which Stripe calls the integration makes.
- Per-IP key restrictions or key rotation reminders.
- Validating that a new key belongs to the same Stripe account as the old one (see open questions).

## Findings

- Prefix checks: `ee/server/src/components/settings/billing/PaymentSettings.tsx` and `ee/server/src/components/settings/integrations/StripeConnectionSettings.tsx` both reject anything not starting with `sk_`. `connectStripeAction` (`ee/server/src/lib/actions/payment-actions.ts`) checks only the publishable key prefix.
- `connectStripeAction` validates the key with `stripe.accounts.retrieve()` (no id, i.e. `GET /v1/account`). Stripe's restricted-key permission table lists `GET /v1/accounts/{id}` under `connected_account_read` (Direct) but does not list `GET /v1/account`. Whether a restricted key without extra permissions can call it is unverified: it must be tested before relying on it as the validity check.
- Webhook setup failure is swallowed: if `webhookEndpoints.list/create/update/del` throws (for example a missing `webhook_write`), the action logs a warning, still stores the key and marks the provider enabled, and returns `webhookConfigured: false`. The UI toast only says auto-configuration "failed". For a restricted key this is the most likely failure and would leave payments that never reconcile.
- Errors are mapped only for `StripeAuthenticationError` (connect, test connection, and one more action). Stripe's restricted-key documentation says a missing permission returns an invalid-request style error whose message names the missing permission. The SDK error `type`/`code` for it must be confirmed with a real restricted key; either way the message is worth surfacing.
- The connected state of `StripeConnectionSettings` offers only Disconnect. Disconnect deletes the webhook endpoint from Stripe and stops payment links, so swapping keys today means a window in which payments cannot reconcile. The connect path itself already keeps an existing endpoint and its stored signing secret (`connectStripeAction` updates the endpoint when a secret is stored) and preserves saved settings (alga-2026-0002724), so an in-place key replacement can reuse it.
- Webhook signature verification uses the separate signing secret, not the API key.
- Strings mentioning `sk_`: `invalidSecretKey` and `secretKeyPlaceholder` in `msp/billing-settings.json`; `secretKeyPlaceholder` and `secretKeyFormat` in `msp/integrations.json`; across de, en, es, fr, it, nl, pl, pt, sv.
- Docs: nm-store `online-payments.md` says the key must start with `sk_` and, one line later, to use restricted keys in production. Repo `docs/stripe-integration-setup.md` only mentions `sk_` keys.

## Stripe calls made with the tenant key

Read only by `payment-actions.ts`, `StripePaymentProvider.ts`, `stripeWebhookEvents.ts` (all other payment services go through `StripePaymentProvider`). Permission ids are from Stripe's API permissions reference (write implies read).

| Capability | Calls | Permissions |
| --- | --- | --- |
| Validate key | `accounts.retrieve` | to be verified (see Findings) |
| Webhook lifecycle | `webhookEndpoints` list / retrieve / create / update / del | `webhook_read`, `webhook_write` |
| Pay by link | `checkout.sessions` create / retrieve / expire; `customers` create / retrieve / update / list; `paymentIntents` retrieve / search; `charges.retrieve` | `checkout_session_write`, `customer_write`, `payment_intent_read`, `charge_read` |
| Saved card / auto-pay | `checkout.sessions.create` (setup mode); `paymentIntents.create` (off-session); `paymentMethods` retrieve / detach; `setupIntents.list`; `customers.listPaymentMethods`; `paymentIntents.list` | `checkout_session_write`, `payment_intent_write`, `payment_method_write`, `setup_intent_read`, `customer_read` |
| Import existing customers | `customers` retrieve / list; `customers.listPaymentMethods`; `setupIntents.list`; `paymentIntents.list` | `customer_read`, `payment_method_read`, `setup_intent_read`, `payment_intent_read` |

The ids for `paymentIntents.create`, `customers.update` and `setupIntents.list` are inferred from Stripe's "POST is write, GET is read" rule and the permission table was only partly retrievable; the spike confirms each against a real key.

## Design

### One permission manifest (the general mechanism)

A single module in `ee/server/src/lib/payments/` declares the permissions the integration needs, as data: Stripe permission id, access level, the Stripe operations it covers, and the capability group that needs it (`core-payments`, `saved-cards-auto-pay`, `customer-import`, `webhooks`). Everything else derives from it:

- the connect-time and test-connection checks;
- the error translation (a permission failure names the capability and permission);
- the permission checklist shown next to the key input;
- the docs list (the docs table is written from, and a test compares it to, the manifest);
- a drift test that scans the three Stripe-using files for `stripe.<resource>.<method>` calls and fails when a call is not covered by a manifest entry, so a future Stripe call cannot silently need a permission the docs do not mention.

### Permission checks without side effects

For read permissions, call the `list` endpoint with `limit: 1`. For write permissions, call the write endpoint against a deliberately nonexistent object id (for example `checkout.sessions.expire('cs_alga_probe')`): if Stripe checks permission before existence, a permitted key gets "resource missing" and a restricted key lacking the permission gets a permission error, with nothing created. This ordering is an assumption and is the first task: verify against a real `rk_test_` key. If it does not hold for an endpoint, that permission is marked "checked on first use" in the manifest and the UI says so; no probe may create data in the customer's Stripe account.

### Connect outcome

- Missing permission for `webhooks` or `core-payments`: connect fails (nothing stored) with the missing permission names, because the integration cannot work.
- Missing permission for `saved-cards-auto-pay` or `customer-import`: connect succeeds, those capabilities are reported as unavailable with the missing permission, and the UI says what to add.
- `sk_` keys pass every check as today (no behaviour change, probes just succeed).
- A webhook failure no longer reports success: `webhookConfigured: false` for a permission reason is reported as a missing permission, not a generic failure toast.

### Replace key in place

The connected state of the Stripe settings gets "Update API keys". It opens the same form and calls the same connect path, which already reuses the existing webhook endpoint and signing secret and preserves saved settings. No disconnect, so no reconciliation gap. This is also the migration path from an `sk_` to an `rk_` key.

### Docs

Correct `online-payments.md` (nm-store) and `docs/stripe-integration-setup.md`; add the permission table from the manifest, how to create the restricted key in Stripe (Dashboard → Developers → API keys → Create restricted key), and the in-place swap steps.

## UX notes

- Secret key placeholder: `sk_live_... / rk_live_... (or test keys)`. Error: "Secret key should start with sk_ or rk_".
- Next to the key input: "Using a restricted key? It needs these permissions" with the manifest checklist grouped by capability, collapsed by default.
- Connect success with unavailable capabilities: a warning listing capability → missing permission.
- "Test connection" (existing action) reports per-capability status using the same checks.
- No new settings, no feature flag: accepting `rk_` is additive and `sk_` behaviour is unchanged.

## Risks and open questions

- Permission-before-existence ordering for write probes is unproven (first task). Fallback described above.
- `GET /v1/account` under a restricted key is unproven. If it fails, replace the validity check with the cheapest permitted read from the manifest (for example `webhookEndpoints.list`) and keep the account id lookup best-effort.
- A key from a different Stripe account than the stored one: today connect lists endpoints under the new key, finds none, and creates a new webhook, overwriting the signing secret. Out of scope here, but the in-place "Update API keys" makes it easier to hit; open question whether to compare account ids and warn.
- Stripe may change permission ids or names; the drift test guards our side, the docs list carries a "checked against Stripe's permissions reference on <date>" note.

## Acceptance criteria

1. An `rk_test_` key with exactly the manifest's permissions connects, creates the webhook, creates a Checkout link, pays it, and the invoice is marked paid via the webhook. Saved-card setup, an auto-pay charge and customer import work.
2. The same key with one permission removed (each of webhook_write, checkout_session_write, payment_intent_write, customer_read) yields a message naming that permission and its capability; core ones block connect, others warn.
3. An `sk_` key behaves exactly as before.
4. "Update API keys" from `sk_` to `rk_` on a connected tenant keeps the webhook endpoint id and signing secret and keeps every saved payment setting.
5. The docs list matches the manifest, and a test fails if a new Stripe call is added without a manifest entry.
6. All nine locale files carry the updated strings and no longer say the key must start with `sk_`.
