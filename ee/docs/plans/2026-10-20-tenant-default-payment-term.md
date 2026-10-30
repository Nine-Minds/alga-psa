# Tenant-level default payment term

Card: d6816608 "Tenant-level default payment term (follow-up to alga-2026-0002607)".
Ticket: alga-2026-0002607 (CloudVBS). This is a Nine Minds improvement, not a customer commitment.
Branch: `feature/tenant-level-default-payment-term-follow-up-to-a`, stacked on the Net 7 / Net 14 commit `87bbbe4f8b`.

## Problem

When neither the billing profile nor the client has a recognised payment term, every due-date path
falls back to the constant `DEFAULT_PAYMENT_TERMS = 'net_30'`
(`shared/billingClients/paymentPreferences.ts`, `paymentTermDays`). An MSP whose standard is Net 14
has to set terms on every client, and any client they miss gets 30 days without warning. CloudVBS hit
this on a quick invoice from a ticket.

The client Billing tab makes this worse. `BillingConfiguration.tsx` seeds the form with
`client.payment_terms || 'net_30'`, so the tab shows Net 30 for a client that has no terms. Saving
that tab for any other reason then writes `'net_30'` to the client, which pins the client to Net 30
for good. Once a tenant default exists, that pinned value would quietly override it.

## Current state (read in this worktree)

| Concern | Location | Today |
|---|---|---|
| Vocabulary, days, fallback | `shared/billingClients/paymentPreferences.ts` | `PAYMENT_TERMS`, `PAYMENT_TERM_LABELS`, `DEFAULT_PAYMENT_TERMS`, `normalizePaymentTerms`, `paymentTermDays(value)` (unknown → Net 30) |
| Effective terms | `shared/billingClients/billingProfileSettings.ts` `resolveEffectiveBillingIdentity` | `paymentTerms: PaymentTerms \| null`, resolved profile → client, null when neither is set |
| Due date | `packages/billing/src/lib/billing/invoiceDueDate.ts` | `dueDateForPaymentTerms(date, terms)` → `paymentTermDays`; `resolveInvoiceDueDate` = identity + that |
| Callers of the identity → due date | `invoiceGeneration.ts:2396` (preview), `invoiceGeneration.ts:3955` (generation), `manualInvoiceActions.ts:210` (manual / quick invoice from ticket), `billingAndTax.ts:getDueDate` (via `resolveInvoiceDueDate`) | all pass `identity.paymentTerms` to `dueDateForPaymentTerms` |
| Other identity readers | `packages/billing/src/services/invoiceService.ts:540` (email gate), `packages/clients/src/actions/clientBillingProfileActions.ts:644` (profile settings) | do not read terms for due dates |
| REST invoice create | `server/src/lib/api/services/InvoiceService.ts` `computeDueDate` (line ~326, called ~1986) | reads `clients.payment_terms` only, ignores profiles, then `paymentTermDays` |
| Tenant settings storage | `default_billing_settings` (one row per tenant, may be absent); `getDefaultBillingSettings` / `updateDefaultBillingSettings` in `packages/billing/src/actions/billingSettingsActions.ts` | partial-update contract: only keys present in `data` are written |
| Tenant settings UI | `packages/billing/src/components/settings/billing/BillingSettings.tsx` (General tab cards), section pattern in `QuoteSettings.tsx` / `DefaultCurrencySettings.tsx` | each card loads and saves its own key |
| Option labels | `packages/clients/src/components/clients/paymentPreferenceOptions.ts` | `paymentTermsOptions(t)` / `paymentTermsLabels(t)`, keys under `msp/clients` `billingConfigForm.paymentTerms.*` |
| Client Billing tab | `packages/clients/src/components/clients/BillingConfiguration.tsx:57`, select in `BillingConfigForm.tsx:215` | `payment_terms: client.payment_terms \|\| 'net_30'` |
| Profile settings | `ClientBillingProfileSettings.tsx`, inherit option `inheritFromClient` with `clientValues.paymentTerms` | shows "Inherit from client (Not set)" when the client has no terms |
| Accounting CSV export | `packages/billing/src/adapters/accounting/quickBooksCSVAdapter.ts:282` | `client.payment_terms ?? 'net_30'` |
| Unit stub | `server/test-utils/billingProfileUnitStub.ts` | stub identity returns `paymentTerms: null` |

Package boundary: `@alga-psa/clients` depends on `@alga-psa/billing`, not the other way round. The
billing settings UI cannot import `paymentPreferenceOptions.ts` from `packages/clients`.

i18n boundary (`packages/core/src/lib/i18n/config.ts`): `/msp/settings` and `/msp/billing` do not
load `msp/clients`. `features/billing` is loaded on `/msp/clients`, `/msp/settings` and
`/msp/billing`.

## Design

### 1. Storage

- Migration `server/migrations/<timestamp>_add_default_payment_terms_to_billing_settings.cjs` adds
  `default_billing_settings.default_payment_terms text NULL`, with no default and no CHECK. Guard it
  with `hasTable` / `hasColumn` and the `ensureSequentialMode` Citus preamble used by
  `20260923120000_add_default_quote_validity_days.cjs`. `down` drops the column.
- NULL (or a missing row) means "not set", which resolves to Net 30, so existing tenants see no change.
- There is no CHECK constraint, on purpose. Every other `payment_terms` column is unconstrained text
  and the vocabulary lives in code (`PAYMENT_TERMS`). The Net 7 / Net 14 card added terms without a
  migration, and this column must allow the same. Writes are validated in the action. Reads go
  through `normalizePaymentTerms`, so an unknown stored value is treated as not set.

### 2. One resolver for the tenant default (shared layer)

Add a new module, `shared/billingClients/tenantPaymentTerms.ts`:

```ts
/** The tenant's configured default terms, or null when unset/unrecognised. */
export async function readTenantDefaultPaymentTerms(knex, tenant): Promise<PaymentTerms | null>
/** Terms used when profile and client hold none: tenant default, else DEFAULT_PAYMENT_TERMS. */
export async function resolveTenantDefaultPaymentTerms(knex, tenant): Promise<PaymentTerms>
```

Both read `tenantDb(knex, tenant).table('default_billing_settings').first('default_payment_terms')`.
This module is the only place that reads the column. The action, the identity resolver, the REST
service, the CSV adapter and the client-side lookups all call it.

`paymentPreferences.ts` stays pure and has no DB access. `DEFAULT_PAYMENT_TERMS` is kept, and its
doc comment changes to "system fallback when the tenant has no default". Its signature does not change.

### 3. Identity resolution: tenant as the last tier

In `resolveEffectiveBillingIdentity`, add the tenant default read to the existing `Promise.all`:

- `paymentTerms` becomes **non-null** `PaymentTerms`, resolved as profile → client → tenant default →
  `DEFAULT_PAYMENT_TERMS`. `overriddenFields` still records only profile overrides.
- Add `paymentTermsSource: 'profile' | 'client' | 'tenant' | 'system'` to `EffectiveBillingIdentity`
  so the UI can say where the value came from without resolving it again.
- `preferredPaymentMethod` and every other field are unchanged.

All due-date callers pass `identity.paymentTerms` to `dueDateForPaymentTerms`. Once the identity
resolves the tenant tier, preview, generation, manual or quick invoice, and `getDueDate` agree with
no per-call-site change. The stored `invoices.due_date` is the invoice snapshot, so a later change to
the tenant default never moves an issued invoice.

`dueDateForPaymentTerms` / `paymentTermDays` keep their signatures and their Net 30 fallback for
unknown input. They are pure arithmetic over an already-resolved term. Update the doc comments in
`invoiceDueDate.ts` so they say "profile, then client, then tenant default".

Update `server/test-utils/billingProfileUnitStub.ts` to return `paymentTerms: 'net_30'` and
`paymentTermsSource: 'system'`.

### 4. REST path

`InvoiceService.computeDueDate` stops reading `clients.payment_terms` and delegates to
`resolveInvoiceDueDate(trx, tenant, clientId, invoiceDate)` (the client's default profile, then the
client, then the tenant). After this change, REST and UI invoices for the same client get the same
due date. As a side effect, a REST invoice for a client whose default profile overrides terms now
honours that profile. That is the intended agreement, and the old behaviour was a latent
inconsistency.

Tests that change with it:
- `server/src/test/unit/api/invoiceService.computeDueDate.test.ts`: mock `resolveInvoiceDueDate`, or
  mock the identity, instead of the `clients` row. Keep the Net 7 / Net 14 / unknown → Net 30 cases
  and add a tenant-default case.
- `server/src/test/unit/api/invoiceServiceTopHelpersTenantScoped.contract.test.ts` asserts that the
  `computeDueDate` section contains `tenantDb(` and `.table('clients')`. Narrow it to the remaining
  sections, or assert that `computeDueDate` delegates to `resolveInvoiceDueDate`. Tenant scoping now
  lives in the shared resolver, which already uses `tenantDb`.

### 5. Actions

`billingSettingsActions.ts`:
- `BillingSettings.defaultPaymentTerms?: PaymentTerms | null`.
- `getDefaultBillingSettings` returns `normalizePaymentTerms(settings.default_payment_terms)`. When
  no row exists it returns `null`. A null value means "not set (Net 30)".
- `updateDefaultBillingSettings`: when `has('defaultPaymentTerms')`, reject a non-null value that
  fails `isPaymentTerms` with `actionError(..., 'msp/billing-settings:general.paymentTerms.errors.invalid')`.
  Do this before the transaction, like `defaultQuoteValidityDays`. Write
  `columnValues.default_payment_terms`, and include it in the insert branch as
  `data.defaultPaymentTerms ?? null`. The partial-update contract is unchanged.
- No propagation to clients. This is deliberate (see Decisions).

Client-facing read (Billing tab and profile settings), in `packages/clients`:
- Extend the `getClientBillingProfileSettings` result
  (`clientBillingProfileActions.ts`, around line 630) with `tenantDefaultPaymentTerms: PaymentTerms`
  from `resolveTenantDefaultPaymentTerms`.
- Add `getTenantDefaultPaymentTerms()` in `packages/clients/src/actions`, gated on the same
  permission the Billing tab already needs (client read). It returns the resolved `PaymentTerms`.
  The Billing tab must not depend on `billing_settings:read`, because a user who can edit a client's
  billing may not be able to open tenant billing settings.

### 6. Shared option labels (layering fix)

Move `paymentPreferenceOptions.ts` from `packages/clients/src/components/clients/` into
`packages/billing` and export it through an existing or new `@alga-psa/billing` subpath export.
`BillingConfigForm.tsx` and `ClientBillingProfileSettings.tsx` import it from there. Move the
`billingConfigForm.paymentTerms.*` and `billingConfigForm.paymentMethods.*` label keys from
`msp/clients` to `features/billing` (for example `paymentPreferences.paymentTerms.net30`), in all 11
locale folders (`de en es fr it nl pl pt sv xx yy`). The helpers keep the `Translate` signature, and
callers pass a `t` from `useTranslation('features/billing')`. After the move, the client Billing tab,
the profile settings and the tenant billing settings render identical labels from one source.

### 7. Billing settings UI

Add a `DefaultPaymentTermsSettings.tsx` card to the General tab of
`packages/billing/src/components/settings/billing/BillingSettings.tsx`, beside "Default currency",
using the same `Card` / `CardHeader` / `CardContent` pattern:
- Use `CustomSelect` (standard component) with `paymentTermsOptions(t)`. The loaded value is
  `defaultPaymentTerms ?? 'net_30'`.
- Help text: new invoices use this term when neither the client nor its billing profile sets one.
- Saving calls `updateDefaultBillingSettings({ defaultPaymentTerms })` with only that key, plus a
  toast. Follow `QuoteSettings.tsx` for load, save and error handling.
- Card copy goes under `msp/billing-settings` `general.paymentTerms.*` in every locale.
- Add `data-automation-id`s: `default-payment-terms-select` and `save-default-payment-terms`.

### 8. Client Billing tab and profile inherit label

- `BillingConfiguration.tsx` seeds `payment_terms: normalizePaymentTerms(client.payment_terms) ?? ''`
  and no longer defaults to `'net_30'`.
- `BillingConfigForm.tsx` puts a first option before the terms, with value `''` and the label
  "Tenant default (Net 14)" (`features/billing` key `paymentPreferences.tenantDefault`, interpolating
  the resolved label). The resolved term comes from `getTenantDefaultPaymentTerms()`. When the
  tenant has no default, the label reads "Tenant default (Net 30)".
- Saving with that option selected writes `''`. `updateClient` and the importer already store `''`
  for unset, and every reader normalizes it to "not set". The client keeps inheriting the tenant
  default, and a later change to the tenant default reaches that client.
- A client holding a known term shows that term. A client holding legacy free text shows the
  tenant-default option, which matches what due-date calculation does with it. Saving replaces the
  free text with `''`. This is the same rule the profile settings already apply.
- `ClientBillingProfileSettings.tsx`: when `clientValues.paymentTerms` is null, the inherit option
  reads "Inherit from client (Tenant default: Net 14)" instead of "Not set", using
  `tenantDefaultPaymentTerms` from the settings result.

### 9. Accounting CSV export

`quickBooksCSVAdapter.ts:282`: replace `client.payment_terms ?? 'net_30'` with
`normalizePaymentTerms(client.payment_terms) ?? tenantDefault`. Resolve `tenantDefault` once per
batch with `resolveTenantDefaultPaymentTerms`. Today `''` passes through `??` as `''`, which is a
second bug, and normalizing fixes it.

## Order of work

1. Migration and `shared/billingClients/tenantPaymentTerms.ts`, with unit tests.
2. `resolveEffectiveBillingIdentity` tenant tier, `paymentTermsSource`, the non-null type, and the
   unit stub update. Fix type fallout at the call sites.
3. `invoiceDueDate.ts` comments; `InvoiceService.computeDueDate` delegates; REST unit and contract
   tests.
4. `billingSettingsActions.ts` get/update and validation.
5. Move `paymentPreferenceOptions.ts` into `@alga-psa/billing` and move the label keys to
   `features/billing` in all locales.
6. `DefaultPaymentTermsSettings.tsx` card.
7. Client actions (`getTenantDefaultPaymentTerms`, `tenantDefaultPaymentTerms` on the profile
   settings result); the `BillingConfiguration` / `BillingConfigForm` tenant-default option; the
   profile inherit label.
8. CSV adapter fallback.
9. Integration and UI tests (below), then a browser check on the dev server.

## Tests

Integration tests, in `server/src/test/integration/billing/` next to
`billingProfilePaymentMethod.integration.test.ts`:
- With the tenant default at Net 14, an unset profile and unset client give `paymentTerms === 'net_14'`
  and `paymentTermsSource === 'tenant'`, and `resolveInvoiceDueDate('2026-09-22')` returns
  `'2026-10-06'`.
- Client `net_7` wins over a Net 14 tenant default. A profile `due_on_receipt` wins over both.
- A legacy free-text client value falls through to the tenant default.
- With no tenant default (no row, NULL column, or an unknown stored value), the term is `net_30` with
  source `'system'`. The existing Net 30 assertions in this file keep passing unchanged.
- `updateDefaultBillingSettings({ defaultPaymentTerms: 'net_45' })` is rejected. `null` clears the
  value. A save that omits the key leaves the column untouched (partial-update contract).
- Manual invoice and generated invoice `due_date` honour the tenant default end to end. This covers
  the quick-invoice-from-ticket path that CloudVBS hit.

Unit tests:
- REST `computeDueDate` agrees with `resolveInvoiceDueDate`, including the tenant-default case.
- `tenantPaymentTerms.ts`: normalization and fallback.
- `BillingConfigForm` shows "Tenant default (Net 14)" for an unset client and does not submit `'net_30'`.
- `DefaultPaymentTermsSettings` saves only `defaultPaymentTerms`.

## Non-goals

- A per-invoice terms selector or due-date presets. These wait on customer feedback.
- Propagating a tenant default change to existing client or profile `payment_terms` values, and any
  backfill of clients the old Billing tab pinned to `'net_30'`.
- QuickBooks Online `SalesTermRef`. The online adapter still sends the client's own term and
  `DueDate` is exported explicitly, so QBO receives the correct due date.
- Exporting profile-level terms to accounting. The CSV adapter reads client terms today, and that
  pre-existing gap is unchanged.
- A DB CHECK constraint on `default_payment_terms`, or on any other payment-terms column.
- Changing `paymentTermDays` / `dueDateForPaymentTerms` signatures, or removing `DEFAULT_PAYMENT_TERMS`.
- Removing the unused `getPaymentTermDays` export in `billingAndTax.ts`. Leave it alone.

## Risks

- **Clients already pinned to Net 30.** Many tenants have clients with `'net_30'` stored only because
  the old Billing tab saved its default. Those clients do not follow a new tenant default. This is
  deliberate: stored values carry no provenance, and silently changing a term the MSP may have chosen
  is worse. The Billing tab now shows the stored term explicitly, so the MSP can see it. Mention this
  in the PR and in the ticket reply.
- **Extra read per identity resolution.** This is one single-row, tenant-scoped read added to an
  existing `Promise.all`. Batch generation resolves per invoice, so the cost is negligible.
- **REST behaviour change** for clients whose default profile overrides terms (see §4). This is
  intended, and the PR must call it out.
- **i18n key move** touches 11 locale files across two namespaces. A missed key falls back to
  `defaultValue` (English), not to a raw key. Run the locale checks after the move.
- **Type change** (`paymentTerms` becomes non-null) ripples to any test fixture that builds an
  `EffectiveBillingIdentity` by hand. The compiler finds them.
- **Stacking.** This card is stacked on the Net 7 / Net 14 card (`87bbbe4f8b`), and both change
  `paymentPreferences.ts` and `InvoiceService.computeDueDate`. A rework of that card means rebasing here.

## Decisions later steps must honour

1. Store the default as `default_billing_settings.default_payment_terms text NULL`, with no CHECK.
   NULL, a missing row, or an unknown value means Net 30.
2. Only `shared/billingClients/tenantPaymentTerms.ts` reads the column. Every consumer goes through it.
3. `resolveEffectiveBillingIdentity` resolves profile → client → tenant → `DEFAULT_PAYMENT_TERMS`.
   `paymentTerms` is non-null, and `paymentTermsSource` reports the tier.
4. REST `computeDueDate` delegates to `resolveInvoiceDueDate`, so profiles now apply on REST too.
5. A tenant default change does not propagate to clients or profiles, and nothing is backfilled.
6. On the client Billing tab, unset is a real state: a "Tenant default (Net X)" option with value `''`.
   It never saves `'net_30'` implicitly.
7. Label options move to `@alga-psa/billing` and the `features/billing` namespace, so the client tab,
   profile settings and tenant settings share one list and one set of labels.
8. The client-side tenant-default lookup is gated on client access, not `billing_settings:read`.
9. Use standard components only: `CustomSelect`, `Card`, `Button`, with `data-automation-id`s on new
   controls.
10. Out of scope: per-invoice terms or presets, QBO `SalesTermRef`, profile terms in exports.
