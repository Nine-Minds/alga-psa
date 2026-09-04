# Plan — Automatic invoices: show actionable generation failure reasons

Card: `7e82acbf-3b9e-4739-bdca-41d08446024b`

## Problem (grounded in code)

A missing billing recipient is already a first-class, coded condition in the engine:
`validateClientBillingEmail` (`packages/billing/src/services/invoiceService.ts:294`) returns
`{ valid:false, code:'NO_BILLING_EMAIL', params:{clientName}, error:'...' }`.

But the structure is destroyed before the recurring-run UI sees it:

1. Callers re-wrap it as a plain `new Error(emailValidation.error)`
   (`invoiceGeneration.ts:1855` preview, `:2656` shared generation) — `code`/`params` dropped.
2. The boundary mapper `invoiceGenerationActionErrorFrom` (`invoiceGeneration.ts:660`) is a
   string-matcher; the `"Cannot generate invoice: No billing email address..."` message matches
   nothing, so it returns `null` and the error is **re-thrown**.
3. `generateGroupedInvoicesAsRecurringBillingRun` (`recurringBillingRunActions.ts:349`) catches the
   throw in its generic block (`:434`) and pushes
   `errorMessage: 'Failed to generate invoice for this billing cycle.'`
   (`RecurringBillingRunInvoiceFailure`, `recurringBillingRunActions.shared.ts:8` — has no `code`,
   no `clientId`).
4. `AutomaticInvoices.tsx` renders `<ClientName>: <that flat string>` (`:2148-2177`).

The manual-invoice path already does this correctly via a discriminated union + code enum + error
class (`packages/billing/src/errors/manualInvoiceErrors.ts`) and translates through
`t('manualInvoices.errors.NO_BILLING_EMAIL', {clientName})` — the locale key already exists at
`server/public/locales/en/msp/invoicing.json:346` (and de/fr/es/it/nl/pl/pt). The recurring path
just never carries a code far enough to look it up.

## Design approach

Preserve the existing engine code across the batch boundary, translate it in the UI, and keep
unknown errors generic. Reuse the manual-invoice patterns rather than inventing new ones.

### 1. Carry the code across the action boundary
- Throw a coded error (reuse `ManualInvoiceError` from `manualInvoiceErrors.ts`, or a small shared
  coded-error carrier) at the two validation sites — `invoiceGeneration.ts:1855` and `:2656` —
  instead of `new Error(emailValidation.error)`, propagating `code` + `params`.
- Preferred routing: teach the boundary to recognize the coded error and return a **keyed
  `actionError`** (`errorHandling.ts` `messageKey`/`messageParams`, same mechanism the duplicate-invoice
  path already uses at `invoiceGeneration.ts:699`). This routes it into the recurring run's
  *returned-error* branch (`recurringBillingRunActions.ts:419`) rather than the generic throw catch.
- Whichever branch it lands in, the run must record the structured failure (below). Unknown/internal
  exceptions stay on the generic catch path unchanged.

### 2. Extend the run failure shape (attribution preserved)
- Add optional `code?: HandledFailureCode` + `params?` to `RecurringBillingRunInvoiceFailure`
  (`recurringBillingRunActions.shared.ts:8`). Keep existing `billingCycleId` /
  `executionIdentityKey` / `executionWindowKind` so client/window attribution in mixed batches is
  unchanged (`AutomaticInvoices.tsx:1451` `resolveRecurringFailureLabel` keeps working).
- Apply identically in both twins: grouped (`generateGroupedInvoicesAsRecurringBillingRun`) and
  non-grouped (`generateInvoicesAsRecurringBillingRun`, catch at `:264`).
- Server-side diagnostics unchanged: `logRecurringBillingRunInvoiceFailure` still logs full detail.

### 3. Consistent mapping across all five paths
Single mapping helper used by: preview (`buildPreviewInvoiceForSelectionInputs` /
`previewInvoiceErrorMessage:596`), single-target, grouped-target
(`generateInvoiceForNormalizedSelectionInputs`), and the PO-overage decision path
(`AutomaticInvoices.tsx:1639`). Known code → keyed/structured failure; everything else → generic.

### 4. Render actionable, localized guidance in the UI
- In `AutomaticInvoices.tsx`, when a failure carries a `code`, translate it
  (`t('manualInvoices.errors.NO_BILLING_EMAIL', {clientName})` — reuse existing key, or move it to a
  shared `errors.*` namespace) instead of rendering the flat `errorMessage`. Failures with no code
  fall back to the generic string.
- Stretch (only if the existing candidate/readiness model supports it without duplicating
  recipient-resolution rules): surface a missing recipient pre-generation via the existing
  `'attention'` view / `blockedReason` on `IRecurringDueWorkInvoiceCandidate`
  (`recurringTiming.interfaces.ts:568`). Do **not** re-implement recipient precedence in the UI. The
  post-generation actionable alert is required regardless.

### 5. Localized strings
- Confirm `NO_BILLING_EMAIL` copy is reachable from the recurring UI's namespace
  (`useTranslation('msp/invoicing')`). If the key must move/duplicate out of `manualInvoices.errors`
  into a shared `errors.*` block, add it to all locales (en/de/fr/es/it/nl/pl/pt + pseudo xx/yy).

## Non-goals (per acceptance criteria)
No change to invoice persistence, numbering, delivery, or recipient precedence
(`invoiceBillingRecipientService.ts` untouched). No stacks/SQL/internals in UI. Unknown failures keep
the generic fallback.

## Tests (behavioral, not source-string assertions)
- **Action** (`recurringBillingRunActions.test.ts`): NO_BILLING_EMAIL through a grouped run yields a
  failure carrying `code` + client/window attribution; a mixed batch keeps each failure attributed to
  the right client/window; an unknown thrown error still yields the generic failure with no code;
  full underlying detail still logged. Update T010 (`:394`) which currently locks the generic string.
- **UI** (`packages/billing/tests/automaticInvoices.*.test.tsx`): a coded failure renders the
  actionable remedy text under the correct client; an uncoded failure renders the generic fallback;
  assert on rendered user-visible outcome, not on source strings.
- If pre-generation attention surfacing is added: candidate with no recipient appears in the
  `'attention'` view.

## Open questions for the design session
1. Route via keyed `actionError` (returned-error branch) vs. coded-throw detection in the catch —
   pick one for consistency across both run twins.
2. Keep reusing `manualInvoices.errors.NO_BILLING_EMAIL` key, or promote to a shared `errors.*`
   namespace so manual + recurring share one string.
3. Ship the pre-generation "Needs attention" surface now, or land the actionable post-run alert first
   and treat attention surfacing as a fast-follow (depends on whether candidate readiness can flag it
   without duplicating recipient resolution).
