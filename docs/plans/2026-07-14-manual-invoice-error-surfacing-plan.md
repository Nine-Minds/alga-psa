# Manual Invoice Error Surfacing — Implementation Plan

**Date:** 2026-07-14
**Branch:** `fix/manual-inventory-error-handling`
**Ticket:** alga0002092 (Talaria Works — "Saving quotes causes an error", phase 2: manual invoice generation errors)

## Problem

Andrew (Talaria Works, prod tenant `d8ec1212-4487-4eba-83bb-4b6046816408`) cannot generate a
manual invoice and only ever sees **"Error generating invoice"**. His tenant has zero invoices
all-time. Investigation (2026-07-14, prod Loki + DB) found the direct cause plus a masking bug
that hides *every* failure mode behind the same string:

1. **i18n masking (the bug this card fixes).** `translateManualInvoiceError` in
   `packages/billing/src/components/billing-dashboard/ManualInvoices.tsx:235` falls back to
   `t('manualInvoices.errors.generateFailed', { defaultValue: message })`. That key **exists**
   in `server/public/locales/*/msp/invoicing.json` ("Error generating invoice"), so i18next
   resolves it and the real server message never renders. Andrew's client "Omni Energy
   Partners" has no billing-location email; the server correctly returns *"Cannot generate
   invoice: No billing email address for …"* (`invoiceService.ts:331`) and the UI throws that
   text away.
2. **Handled failures are invisible in prod logs.** `generateManualInvoice` returns
   `{success:false, error}` without logging anything, which is why Loki had no trace of any of
   Andrew's attempts.
3. Two systemic error sources feed the same generic message and are **ticketed separately,
   out of scope here**: deploy-skew "Failed to find Server Action" (alga0002126), session
   expiry `AuthenticationError` (alga0002127). Invoice-number seeding (`TIC001000` for tenants
   with no `next_number` INVOICE row) is alga0002128.

## Settled design (approved 2026-07-14)

**Approach B — structured error codes.** Handled errors travel as *data* (immune to Next's
production error masking), the UI translates per code, and every failure is logged
server-side with context.

- New typed error carrying `code` + `params`; known failure points in the manual-invoice
  flow produce it.
- `generateManualInvoice` and `updateInvoiceManualItems` return
  `{ success: false, code, params, message }` for handled failures; unexpected throws are
  caught at the action boundary, logged with a short **reference ID** + stack, and returned
  as `{ success: false, code: 'UNEXPECTED', ref }`.
- UI maps `code → manualInvoices.errors.<code>` (params interpolated) in **all locales**;
  unknown code → show server `message` verbatim; `UNEXPECTED` → generic message that includes
  the ref ID.
- Pre-submit guard: selecting a client with no billing-location email shows an inline warning
  immediately.
- Edit-path atomicity: `recalculateInvoice` moves inside the item-mutation transaction.

## Work items

### W1 — Typed manual-invoice errors

New module `packages/billing/src/errors/manualInvoiceErrors.ts`:

```ts
export type ManualInvoiceErrorCode =
  | 'NO_BILLING_EMAIL'          // params: { clientName }
  | 'CLIENT_NOT_FOUND'
  | 'SERVICE_NOT_FOUND'         // params: { serviceId }
  | 'INVALID_QUANTITY'
  | 'NO_TAX_RATE'               // params: { region, date }
  | 'DISCOUNT_TARGET_NOT_FOUND' // params: { serviceId }
  | 'INVOICE_NUMBER_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'UNEXPECTED';               // params: { ref }

export class ManualInvoiceError extends Error {
  constructor(
    public readonly code: Exclude<ManualInvoiceErrorCode, 'UNEXPECTED'>,
    message: string,                       // human-readable fallback, English
    public readonly params: Record<string, string> = {}
  ) { super(message); this.name = 'ManualInvoiceError'; }
}
```

Result envelope (extend the existing `ManualInvoiceResult` union in
`packages/billing/src/actions/manualInvoiceActions.ts`):

```ts
{ success: false; code: ManualInvoiceErrorCode; params?: Record<string,string>; message: string; ref?: string }
```

Keep `error: string` populated alongside `message` for one release so any other consumer of
the old shape keeps working (grep for callers; the only UI consumer is `ManualInvoices.tsx`).

### W2 — Produce typed errors at the known failure points

All in `packages/billing/src`:

- `services/invoiceService.ts`
  - `validateClientBillingEmail` (line ~331): return the code + params
    (`NO_BILLING_EMAIL`, `{clientName}`) alongside the existing message.
  - `persistManualInvoiceCharges` (line ~454): `Service not found: <id>` (~477) →
    `ManualInvoiceError('SERVICE_NOT_FOUND', …, {serviceId})`; `Quantity must be greater
    than 0` (~518) → `INVALID_QUANTITY`; discount-target throw (~571) →
    `DISCOUNT_TARGET_NOT_FOUND`.
  - `getClientDetails`: not-found → `CLIENT_NOT_FOUND`.
- `services/taxService.ts` (~116): `No active tax rate(s) found for region <X> on date <Y>`
  → `ManualInvoiceError('NO_TAX_RATE', <same message>, {region, date})`. **Keep the message
  text byte-identical** — other consumers (recurring invoice generation, existing UI
  string-matching) sniff it. `ManualInvoiceError extends Error`, so existing
  `catch (e) { e.message }` call sites are unaffected.
- `actions/manualInvoiceActions.ts` — `generateManualInvoice` (line ~53):
  - permission failure → `{success:false, code:'PERMISSION_DENIED', …}`.
  - Wrap the body in try/catch: `ManualInvoiceError` → envelope with its code/params/message.
  - Postgres unique violation on `unique_invoice_number_per_tenant` (error code `23505`) →
    `INVOICE_NUMBER_CONFLICT`.
  - Anything else → generate `ref` (e.g. `crypto.randomUUID().slice(0, 8)`), `log.error`
    with stack + tenant/client/user + ref, return `{success:false, code:'UNEXPECTED', ref, …}`.
- `actions/invoiceModification.ts` — `updateInvoiceManualItems` (line ~739): same envelope
  treatment (it currently throws to the UI). Update the UI edit branch
  (`ManualInvoices.tsx:586`) to consume the envelope.

### W3 — Server-side logging for handled failures

In both actions, every handled `{success:false}` return logs before returning:

```
log.warn('[generateManualInvoice] <CODE>', { tenant, clientId, userId, ...params })
```

Unexpected errors use `log.error` with the ref ID and stack (W2). Acceptance: a failed
generation attempt is findable in Loki by tenant ID or code string.

### W4 — UI code mapping + locales

`packages/billing/src/components/billing-dashboard/ManualInvoices.tsx`:

- Replace the message-sniffing in `translateManualInvoiceError` (~235) with:
  1. `result.code` present and key `manualInvoices.errors.<code>` exists → translated string
     with `result.params` interpolated.
  2. Unknown/missing code → `result.message` verbatim.
  3. `UNEXPECTED` → translated generic including `{{ref}}`.
  4. Thrown (non-envelope) errors in the `catch` (~698): keep today's generic
     translation path — the codes for those flows arrive with alga0002126/0002127.
- Sales-order branch keeps its existing `salesOrder*` translations.
- Add keys to `server/public/locales/<lang>/msp/invoicing.json` for **every** locale
  directory present (en, de, es, fr, it, nl, pl, pt, xx, yy — follow the repo's locale-parity
  convention; see commit 89b1d22f50 for the pattern):
  `manualInvoices.errors.NO_BILLING_EMAIL` ("{{clientName}} has no billing email. Set an
  email address on the client's billing location, then try again."),
  `…SERVICE_NOT_FOUND`, `…INVALID_QUANTITY`, `…NO_TAX_RATE`, `…DISCOUNT_TARGET_NOT_FOUND`,
  `…CLIENT_NOT_FOUND`, `…INVOICE_NUMBER_CONFLICT` (reuse existing text), `…PERMISSION_DENIED`,
  `…UNEXPECTED` ("Something went wrong generating the invoice. Quote reference {{ref}} when
  contacting support."), plus `manualInvoices.warnings.noBillingEmail` for W5.

### W5 — Pre-submit billing-email guard

- New action in `manualInvoiceActions.ts`: `getClientBillingEmailStatus(clientId)` →
  `{ hasBillingEmail: boolean }`, delegating to `invoiceService.getClientBillingEmail`
  (`invoiceService.ts:307`).
- In the manual-invoice dialog, when the selected client changes, fetch status; if absent,
  render a persistent inline warning `Alert` (`manualInvoices.warnings.noBillingEmail`) —
  non-blocking (server still validates), submit stays enabled.

### W6 — Edit-path atomicity

`updateInvoiceManualItemsInternal` (`invoiceModification.ts:799`) commits item mutations,
then calls `billingEngine.recalculateInvoice(invoiceId)` (line ~1011) in a **separate**
transaction — a tax failure there leaves committed items with stale totals.

- Thread the open transaction: give `recalculateInvoice` (billingEngine.ts ~4873) an
  optional `trx?: Knex.Transaction` parameter, used instead of opening its own; call it
  inside the `withTransaction` block from `updateInvoiceManualItemsInternal`.
- **Verify during implementation** that nothing inside `recalculateInvoice` opens its own
  nested transaction/connection; if threading is not cleanly possible, leave the order as-is,
  return a dedicated handled error telling the user totals were not refreshed, and drop a
  `// LEVERAGE: friction billing-engine-trx — recalculateInvoice cannot join an open transaction`
  marker instead of forcing it.

### W7 — Tests

- Unit tests for the action error mapping (pattern precedent: commit bbbdf16150,
  "unit-test loaner/restock error mapping"):
  - each known failure → its code + params (billing email missing, unknown service, zero
    quantity, missing tax rate, duplicate invoice number, permission denied);
  - unexpected throw → `UNEXPECTED` + ref present + `log.error` called;
  - handled failures emit `log.warn` with tenant/client context.
- UI-level test: envelope with `NO_BILLING_EMAIL` renders the specific translated message,
  not "Error generating invoice"; `UNEXPECTED` renders the ref.
- Locale parity check passes (all locale files contain the new keys).

### W8 — Live verification (dev stack, port 3954)

1. Create/choose a client whose billing location has no email.
2. Open Billing → Invoicing → Generate: selecting the client shows the inline warning (W5).
3. Submit anyway → specific billing-email message with client name (W4), and the dev-server
   log shows the `[generateManualInvoice] NO_BILLING_EMAIL` warn line (W3).
4. Set the billing-location email → invoice generates successfully.
5. Edit the invoice, force a recalc failure (e.g. temporarily remove the tenant's tax rate)
   → error surfaces with code and **no stale partial state** (W6).

## Out of scope (ticketed)

- alga0002126 — deploy-skew stale-tab detection ("Failed to find Server Action").
- alga0002127 — session-expiry UX (`AuthenticationError` → sign-in redirect).
- alga0002128 — `next_number` INVOICE seeding (TIC001000 first-invoice numbers).

## Support follow-up (not code)

Andrew's concrete unblock: set a billing email on Omni Energy Partners' billing location.
Worth replying on alga0002092 once this ships — until then the product genuinely cannot tell
him what was wrong.
