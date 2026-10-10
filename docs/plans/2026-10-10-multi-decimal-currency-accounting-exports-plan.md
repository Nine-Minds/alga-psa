# Multi-decimal currency support in accounting exports/imports (alga0002091)

- **Ticket:** alga0002091 — Accounting exports (QBO API/CSV, Xero) assume 2-decimal currencies, corrupting JPY amounts
- **Branch:** `feature/alga0002091-accounting-exports-qbo-api-csv-xero`
- **Date:** 2026-10-10
- **Grounded against:** worktree at origin/main `b0d0b4dacf`

## Problem

Money is stored as currency-aware integer **minor units** (JPY minor unit = 1 yen, 0 fraction
digits; USD = cents, 2 digits). The UI already renders minor units through
`formatCurrencyFromMinorUnits` / `useCurrencyFormat()`, which look up each currency's fraction
digits. The accounting adapters and the accounting-sync appliers instead convert with a
hard-coded `/100` on the way out and `*100` on the way back. A currency whose exponent is not 2
is therefore mis-scaled by a factor of 100 in both directions:

- A JPY 10,000 vendor bill (stored `10000`) exports to QuickBooks as **JPY 100**.
- A JPY payment pulled back from Xero reconciles at 1/100th of its real value, so reconciliation
  silently drifts.
- Three-digit currencies (BHD, KWD, exponent 3) are wrong the other way.

The root cause is a literal `100` standing in for `10 ** currencyFractionDigits(currency)`. The fix
is to key **every** export/import money conversion on the document's own `currency_code` using the
existing currency-aware helpers in `@alga-psa/core`, and to delete the per-adapter cents helpers so
the literal cannot reappear.

## Design decisions

1. **One shared number helper, added to core once.** `@alga-psa/core`
   (`packages/core/src/lib/formatters.ts`) already has the forward direction —
   `toMinorUnits(value, locale, currency)` = `Math.round(value * 10 ** digits)` — but **no numeric
   inverse**. Add it, paired with `toMinorUnits` and with the identical argument order:

   ```ts
   /**
    * Convert a currency's integer minor units (e.g. cents) back to a major-unit number
    * (e.g. dollars), using the currency's own exponent — so JPY divides by 1, not 100.
    * The numeric inverse of {@link toMinorUnits}; replaces hardcoded `/ 100`.
    */
   export function fromMinorUnits(value: number, locale: string = 'en-US', currency: string = 'USD'): number {
     return value / Math.pow(10, currencyFractionDigits(currency, locale));
   }
   ```

   It is reachable as `import { fromMinorUnits } from '@alga-psa/core'` because
   `packages/core/src/index.ts:40` does `export * from './lib/formatters'`. **No new per-adapter
   cents helper is introduced; the existing ones are deleted.**

2. **Three core helpers cover the three output shapes.** We never re-derive scaling in an adapter:
   - **Outbound JSON number** (QBO `Amount`/`UnitPrice`/`TotalTax`, Xero `exportedTotal`): new
     `fromMinorUnits(minor, 'en-US', currency)`.
   - **Outbound CSV string** (QBO CSV `*ItemRate`/`*ItemAmount`/`TaxAmount`, Xero CSV `*UnitAmount`):
     `minorUnitsToDecimalText(minor, currency, 'en-US')`. This already emits ungrouped text with a
     `.` separator and exactly the currency's fraction digits, so it *replaces both* the `/100` and
     the `.toFixed(2)`. For USD it is byte-for-byte identical to `(cents/100).toFixed(2)`
     (`1050 → "10.50"`, `1000 → "10.00"`); for JPY it yields whole yen (`10000 → "10000"`).
   - **Inbound number → minor units** (QBO/Xero read-back and reconciliation): existing
     `toMinorUnits(amount, 'en-US', currency)` replaces every `Math.round(x * 100)`.

3. **Currency is always the document's own `currency_code`, never the tenant default or a literal
   `'USD'`.** Where the document's currency is genuinely absent at a conversion site, fall back to
   `'USD'` (exponent 2) — this is the only value that keeps today's 2-digit output byte-for-byte
   unchanged, satisfies the "USD unchanged" requirement, and preserves current behaviour for the
   missing-currency edge. `currency_code` is `?: string | null` on every document row, so each site
   resolves `const currency = doc.currency_code ?? 'USD'` (or the already-present field).

4. **USD and every other 2-digit currency stay byte-for-byte unchanged.** For exponent 2,
   `fromMinorUnits` = `/100`, `toMinorUnits` = `Math.round(*100)`, and `minorUnitsToDecimalText`
   = `(cents/100).toFixed(2)`. The change is a no-op for 2-digit currencies and only corrects the
   0- and 3-digit cases.

5. **Currency must be threaded through the payment-push / credit-application pipeline**, because
   today the op payload and one provider request contract carry no currency at all. This is a
   contract change (type additions), which is the technically correct fix rather than guessing a
   currency at conversion time. See the "Accounting-sync sweep" section.

6. **Explicitly NOT touched** (verified not money-scaling): `coerceChargeCents` (qbo ~1714, xero
   ~1419) and `coerceCents` (xeroCsv ~676) only `Math.round` values that are *already* integer
   minor units — no `*100`/`/100`; the effective-tax-rate `* 100` at `quickBooksOnlineAdapter.ts`
   ~1532 and `xeroAdapter.ts` ~1037 are percentage computations (dimensionless ratio × 100), not
   currency conversions; `xeroAdapter.ts` ~1508 `Math.round(raw.amountCents)` is already minor
   units. These are left as-is and called out in code review so they are not "fixed" into bugs.

## Sites to change

### A. Core helper (1 file)

| File | Change |
|---|---|
| `packages/core/src/lib/formatters.ts` | Add `fromMinorUnits(value, locale, currency)` (see decision 1). Re-exported automatically via `src/index.ts`. |

### B. QuickBooks Online API adapter — `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts`

Delete the module-level `centsToAmount` (~1710) and `amountToCents` (~1725); replace all call
sites with the core helpers, each keyed on the in-scope currency.

| Line (approx) | Direction | Current | Replace with | Currency source |
|---|---|---|---|---|
| 597 | export | `centsToAmount(lineQuantity.unitPriceCents)` | `fromMinorUnits(lineQuantity.unitPriceCents, 'en-US', invoice.currency_code ?? 'USD')` | `invoice.currency_code` (CurrencyRef set 661) |
| 606 | export | `centsToAmount(netAmountCents)` | `fromMinorUnits(netAmountCents, 'en-US', invoice.currency_code ?? 'USD')` | `invoice.currency_code` |
| 631 | export | `centsToAmount(invoiceTaxCents)` | `fromMinorUnits(invoiceTaxCents, 'en-US', invoice.currency_code ?? 'USD')` | `invoice.currency_code` |
| 867 | export | `centsToAmount(amountCents)` | `fromMinorUnits(amountCents, 'en-US', bill.currency_code ?? 'USD')` | `bill.currency_code` (CurrencyRef set 881) |
| 1011 | export | `centsToAmount(payload.totals.amountCents)` | `fromMinorUnits(payload.totals.amountCents, 'en-US', payload.bill.CurrencyRef?.value ?? 'USD')` | `payload.bill.CurrencyRef.value` |
| 1483 | import | `amountToCents(qboInvoice.TxnTaxDetail?.TotalTax ?? 0)` | `toMinorUnits(..., 'en-US', qboInvoice.CurrencyRef?.value ?? 'USD')` | `qboInvoice.CurrencyRef.value` |
| 1484 | import | `amountToCents(qboInvoice.TotalAmt ?? 0)` | `toMinorUnits(..., 'en-US', qboInvoice.CurrencyRef?.value ?? 'USD')` | `qboInvoice.CurrencyRef.value` |
| 1499 | import | `amountToCents(line.Amount ?? 0)` | `toMinorUnits(..., 'en-US', qboInvoice.CurrencyRef?.value ?? 'USD')` | `qboInvoice.CurrencyRef.value` |
| 1819 | import | `Math.round(Number(line?.Amount) * 100)` | `toMinorUnits(Number(line?.Amount), 'en-US', currency)` | `payload.CurrencyRef?.value` — hoist the `currency` read (1827) above the loop |
| 1831 | import | `Math.round(Number(payload?.TotalAmt) * 100)` | `toMinorUnits(Number(payload?.TotalAmt), 'en-US', currency)` | `payload.CurrencyRef?.value` |
| 1834 | import | `Math.round(Number(payload?.UnappliedAmt) * 100)` | `toMinorUnits(Number(payload?.UnappliedAmt), 'en-US', currency)` | `payload.CurrencyRef?.value` |

Note: sites 1483/1484/1499/1819/1831/1834 were **not in the original card list** but are the same
defect on the QBO read-back/payment-import path; they must change for the round-trip to reconcile.
Keep `Number.isFinite`/guards intact; `toMinorUnits` throws `MoneyInputError` only on a negative or
non-finite input, so preserve the existing "finite and > 0" checks around it (wrap non-finite
inputs before calling, matching current guards).

### C. QuickBooks CSV adapter — `packages/billing/src/adapters/accounting/quickBooksCSVAdapter.ts`

Delete the private `centsToAmount` (~662). At the row build (~302-307), resolve
`const currency = invoice.currency_code ?? 'USD'` and format with `minorUnitsToDecimalText`:

| Line | Current | Replace with |
|---|---|---|
| 302 | `this.centsToAmount(unitPrice).toFixed(2)` | `minorUnitsToDecimalText(unitPrice, currency, 'en-US')` |
| 303 | `this.centsToAmount(lineAmount).toFixed(2)` | `minorUnitsToDecimalText(lineAmount, currency, 'en-US')` |
| 307 | `this.centsToAmount(taxAmount).toFixed(2)` | `shouldExcludeTax ? '' : minorUnitsToDecimalText(taxAmount, currency, 'en-US')` |

### D. QuickBooks Desktop (IIF) adapter — `packages/billing/src/adapters/accounting/quickBooksDesktopAdapter.ts`

| Line | Direction | Current | Replace with | Currency source |
|---|---|---|---|---|
| 31 | export | `${line.amount_cents / 100}` | `${fromMinorUnits(line.amount_cents, 'en-US', line.currency_code ?? 'USD')}` | `line.currency_code` (required field on `AccountingExportLine`) |

(This IIF path is live: registered in `registry.ts`, used by the export download route.)

### E. Xero API adapter — `packages/billing/src/adapters/accounting/xeroAdapter.ts`

| Line | Direction | Current | Replace with | Currency source |
|---|---|---|---|---|
| 809 | export | `payload.invoice.amountCents / 100` | `fromMinorUnits(payload.invoice.amountCents, 'en-US', payload.invoice.currency ?? 'USD')` | `payload.invoice.currency` |
| 1270 | import | `Math.round(Number(record?.Amount) * 100)` | `toMinorUnits(Number(record?.Amount), 'en-US', record?.CurrencyCode ?? 'USD')` and set `normalized.currency = record?.CurrencyCode` | `record.CurrencyCode` (Xero payment) |
| 1360 | import | `Math.round(Number(allocation?.Amount) * 100)` | `toMinorUnits(Number(allocation?.Amount), 'en-US', record?.CurrencyCode ?? 'USD')` | `record.CurrencyCode` (credit note) |
| 1510 | export | `Math.round(raw.amount * 100)` | `toMinorUnits(raw.amount, 'en-US', currency)` — thread `currency` into `normalizeTaxComponents(input, currency)` from its call site (`invoice.currency_code ?? exportLines[0]?.currency_code ?? 'USD'`, ~533) | call-site invoice currency |

Populating `normalized.currency` on the Xero payment path (1270) also fixes the dropped-currency
gap — `NormalizedExternalPaymentPayload.currency` exists but Xero currently never sets it, unlike
QBO (`quickBooksOnlineAdapter.ts:1827`).

### F. Xero CSV adapter — `packages/billing/src/adapters/accounting/xeroCsvAdapter.ts`

| Line | Direction | Current | Replace with | Currency source |
|---|---|---|---|---|
| 268 | export | `(lineQuantity.unitPriceCents / 100).toFixed(2)` | `minorUnitsToDecimalText(lineQuantity.unitPriceCents, invoice.currency_code ?? 'USD', 'en-US')` | local `currency` (~202) |

### G. QBO provider operations — `packages/billing/src/adapters/accounting/qboProviderOperations.ts`

| Line | Direction | Current | Replace with | Currency source |
|---|---|---|---|---|
| 23 (`toCents`) | import | `Math.round(amount * 100)` | `toMinorUnits(amount, 'en-US', currency)` — give `toCents` a `currency` param, passed from `entity?.CurrencyRef?.value ?? 'USD'` at the call site (~93) | QBO Payment response `CurrencyRef` |
| 62 | import | `Math.round(remainingDollars * 100)` | `toMinorUnits(remainingDollars, 'en-US', creditMemo.CurrencyRef?.value ?? 'USD')` | `creditMemo.CurrencyRef.value` |
| 66 (`recordPayment`) | export | `Math.round(request.amountCents) / 100` | `fromMinorUnits(request.amountCents, 'en-US', request.currency ?? 'USD')` and emit `CurrencyRef: { value: request.currency }` on the payload when present | `request.currency` (field already on `ProviderPaymentRequest`) |
| 98 (`applyCredit`) | export | `Math.round(request.amountCents) / 100` | `fromMinorUnits(request.amountCents, 'en-US', request.currency ?? 'USD')` | `request.currency` — **requires adding `currency?` to `ProviderCreditApplicationRequest`** |

### H. Accounting-sync appliers & producers (the card's sweep — "any other accounting-sync code")

These share the identical defect and sit on the same payment/credit pipeline; fixing the adapters
without them would leave JPY payment-push and credit application mis-scaled.

| File:line | Direction | Current | Fix |
|---|---|---|---|
| `services/accountingSync/paymentPushApplier.ts:289` | export | `Math.round(payload.amountCents) / 100` | `fromMinorUnits(payload.amountCents, 'en-US', payload.currencyCode ?? 'USD')` |
| `services/accountingSync/paymentPushApplier.ts:334` | import | `Math.round(unappliedAmt * 100)` | `toMinorUnits(unappliedAmt, 'en-US', currency)` |
| `services/accountingSync/paymentPushApplier.ts:390` | display | `unappliedCents / 100` | `fromMinorUnits(unappliedCents, 'en-US', currency)` |
| `services/accountingSync/creditApplicationApplier.ts:309` | import | `Math.round(remainingDollars * 100)` | `toMinorUnits(remainingDollars, 'en-US', currency)` |
| `services/accountingSync/creditApplicationApplier.ts:460` | export | `Math.round(payload.amountCents) / 100` | `fromMinorUnits(payload.amountCents, 'en-US', payload.currencyCode ?? 'USD')` |
| `services/accountingSync/paymentApplier.ts:67` | import | `Math.round(amount * 100)` | `toMinorUnits(amount, 'en-US', currency)` |
| `services/accountingSync/qboItemResolver.ts:121` | import | `Math.round(Number(amount) * 100)` | `toMinorUnits(Number(amount), 'en-US', currency)` |
| `actions/qboOnboardingActions.ts:705` | import | `match.externalTotal / 100` | `fromMinorUnits(match.externalTotal, 'en-US', currency)` |

**Contract/threading changes so the above sites have a `currency` to use:**

- `RecordPaymentPayload` (`paymentPushApplier.ts:28`): add `currencyCode: string`.
- apply_credit op payload: add `currencyCode: string`.
- `ProviderPaymentRequest` already has `currency?` — pass it from `payload.currencyCode` at
  `paymentPushApplier.ts:299`.
- `ProviderCreditApplicationRequest` (`packages/types/.../accountingExportAdapter.interfaces.ts`):
  add `currency?: string`; pass it at `creditApplicationApplier.ts:481`.
- Producers `syncProducers.ts` (`enqueueExternalPaymentPush` ~350, `enqueueCreditApplication` ~449):
  source the invoice's `currency_code` (the producer already loads/looks up the invoice mapping) and
  put it in the op payload. Where the producer does not currently read the invoice row, add a scoped
  `currency_code` select. The non-providerOps legacy inline branches in both appliers consume the
  same `currencyCode`.
- `paymentApplier.ts` / `qboItemResolver.ts` / `qboOnboardingActions.ts`: resolve currency from the
  QBO entity's `CurrencyRef.value` or the matched Alga invoice's `currency_code`, falling back to
  `'USD'`.

### I. Test simulator — `packages/billing/src/services/accountingSync/testing/qboSimulator.ts`

Lines 104 (`Math.round(cents)/100`) and 348 (`Math.round(qty*unitPrice*100)`) must become
currency-aware too, otherwise the simulator cannot faithfully round-trip a JPY document in tests.
Thread the currency already present on the simulated entity (`CurrencyRef`).

## Explicitly OUT of scope (separate concern — note, do not fix here)

The following `/100` sites are invoice/quote **display** and billing-**compute** formatting, not
accounting export/import, and are governed by `formatCurrency` (which independently hardcodes 2
digits at `formatters.ts:91`). They are a distinct currency-display defect and out of this card's
"accounting adapters" done-criteria. Drop a `// LEVERAGE: pattern currency-minor-units — <note>`
marker at each so they are counted for a follow-up, but do not change them here:
`actions/invoiceJobActions.ts:302,530`, `actions/quoteActions.ts:560`,
`lib/quote-email-templates.ts:41,87,123`, `lib/billing/compute/*` (`format(cents/100)` lines),
`components/billing-dashboard/quotes/quoteLineItemDraft.ts:337`. (The percentage `/100`/`*100`
sites in `contractInvoiceAdjustments`, `prepaidBalanceAlerts`, `projectBillingConfig`,
`billingViewHelpers` are not money-scaling and are irrelevant.)

## Tests (80/20, high value)

New Vitest specs (runner is Vitest; follow the `*.test.ts` pure-unit pattern already used by
`xeroAdapter.fetchChanges.test.ts` — `vi.mock` the DB/clients, dynamic-import the adapter in
`beforeEach`). Each test asserts the JPY case **alongside** the existing USD case so the
USD-unchanged guarantee is locked in.

1. **QBO API vendor bill** — JPY bill stored `10000` exports with line `Amount: 10000` (not `100`);
   USD `1050` still exports `10.5`.
2. **QBO API invoice** — JPY invoice: `UnitPrice`, line `Amount`, and `TxnTaxDetail.TotalTax` equal
   the stored minor units; USD unchanged.
3. **QBO CSV row** — JPY row emits `*ItemRate`/`*ItemAmount`/`TaxAmount` as whole-yen strings with
   no decimal point; USD still emits `"10.50"`-style two-decimal strings (byte-for-byte).
4. **QBO Desktop IIF** — JPY `!TRNS` AMOUNT column is whole yen.
5. **Xero export** — JPY `exportedTotal` fallback equals stored minor units; USD unchanged.
6. **Xero read-back / payment import** — `normalizeXeroPayment` on a JPY payment record
   (`Amount: 10000, CurrencyCode: 'JPY'`) yields `amountCents: 10000` and `currency: 'JPY'`;
   USD record unchanged.
7. **Round-trip reconciliation** — a JPY amount exported (minor units → major) and read back
   (major → minor) returns the identical minor-units value; same for USD. One focused test per
   provider (QBO via the simulator, Xero via normalize).
8. **Core helper** — add `fromMinorUnits` cases to the formatters test (JPY=0, USD=2, BHD=3) and
   assert `fromMinorUnits(toMinorUnits(x, l, c), l, c) === x` for representative values.

## Verification / done criteria

1. `grep -rnE "(/ ?100|\* ?100)" packages/billing/src/adapters/accounting packages/billing/src/services/accountingSync` returns **no money-scaling** matches (only the two tax-rate `*100` lines and the round-only `coerce*` helpers remain, each annotated).
2. `npm run build` / typecheck passes (new type fields wired end to end).
3. New and existing adapter/applier Vitest suites pass; existing USD fixtures produce identical
   output (byte-for-byte for CSV/IIF strings, numerically identical for JSON).
4. JPY exports produce whole-yen amounts equal to the stored minor units; USD output unchanged.
5. Update ticket alga0002091 on completion (XO/captain action — not performed by the design desk).

## Risks

- **Missing currency fallback.** Defaulting to `'USD'` where a document has no `currency_code`
  preserves today's behaviour exactly for the 2-digit case; it does not introduce a regression and
  is the only fallback that keeps USD byte-for-byte. Fail-fast is inappropriate here because it
  would break existing USD flows that rely on the implicit default.
- **Contract additions ripple.** Adding `currencyCode`/`currency` to the op payloads and provider
  request types touches producers, appliers, provider ops, and their tests together; they must land
  in one change so the pipeline type-checks.
- **`minorUnitsToDecimalText` input domain.** It throws on unsupported currency / non-integer /
  negative. CSV inputs are non-negative integer minor units, and currency is resolved to a supported
  code (or `'USD'`), so this is safe; keep the existing `shouldExcludeTax` empty-string branch.

## Files to change (summary)

- `packages/core/src/lib/formatters.ts` (+ formatters test)
- `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts`
- `packages/billing/src/adapters/accounting/quickBooksCSVAdapter.ts`
- `packages/billing/src/adapters/accounting/quickBooksDesktopAdapter.ts`
- `packages/billing/src/adapters/accounting/xeroAdapter.ts`
- `packages/billing/src/adapters/accounting/xeroCsvAdapter.ts`
- `packages/billing/src/adapters/accounting/qboProviderOperations.ts`
- `packages/billing/src/services/accountingSync/paymentPushApplier.ts`
- `packages/billing/src/services/accountingSync/creditApplicationApplier.ts`
- `packages/billing/src/services/accountingSync/paymentApplier.ts`
- `packages/billing/src/services/accountingSync/qboItemResolver.ts`
- `packages/billing/src/services/accountingSync/syncProducers.ts`
- `packages/billing/src/services/accountingSync/testing/qboSimulator.ts`
- `packages/billing/src/actions/qboOnboardingActions.ts`
- `packages/types/src/interfaces/accountingExportAdapter.interfaces.ts` (add `currency?` to `ProviderCreditApplicationRequest`)
- New Vitest specs under `packages/billing/src/adapters/accounting/` (and applier round-trip)
- `// LEVERAGE:` markers only (no behavioural change) at the out-of-scope display/compute sites listed above
