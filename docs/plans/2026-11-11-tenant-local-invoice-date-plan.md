# Tenant-local invoice dates — implementation plan

Card: `e81a9428` · "Month end billing - invoices show incorrect date"
Ticket: alga-2026-0002770 (CloudVBS / Lynda Gaiao)
Branch: `feature/month-end-billing-invoices-show-incorrect-date`
Base at authoring time: `f997e0b7ef` (all line numbers below are against this base)

## 1. Problem

Every invoice-creation path except Month-End Close stamps the **server host's UTC
calendar date** on the invoice. A tenant whose local date is ahead of UTC (Sydney
on `2026-10-18T22:00Z` = 19 Oct locally) gets invoices dated the 18th, and because
`due_date` is derived from the invoice date, the due date is a day early too.

Month-End Close is already correct: `recurringBillingRunActions.ts:446-452` resolves
the tenant timezone with `resolveEffectiveTimeZone(knex, tenantId)` and converts the
instant to a `PlainDate` in that zone before passing `invoiceDate` down.

The defect is that this "tenant-local today" conversion is **inline in one action**
and every other caller falls back to `Temporal.Now.plainDateISO()`.

## 2. Decision — one helper, two layers

Add to `packages/db/src/lib/workDate.ts` (already owns
`resolveEffectiveTimeZone`, `normalizeIanaTimeZone`, `computeWorkDateFields`; already
re-exported through `@alga-psa/db`, which billing imports):

```ts
/** Convert an instant to the calendar date in the given IANA zone. */
export function localDateForInstant(
  instant: Temporal.Instant | Date,
  timeZone: string | null | undefined,
): Temporal.PlainDate

/** Today's calendar date in the tenant's effective (billing) timezone. */
export async function resolveTenantToday(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
): Promise<Temporal.PlainDate>
```

- `localDateForInstant` is pure: `toTemporalInstant(instant).toZonedDateTimeISO(normalizeIanaTimeZone(tz)).toPlainDate()`.
  This makes the boundary behaviour unit-testable without mocking the clock.
- `resolveTenantToday` = `localDateForInstant(Temporal.Now.instant(), await resolveEffectiveTimeZone(knexOrTrx, tenant))`.
- **Tenant basis, not user basis.** Do not pass a `userId`: invoice dates must not
  change depending on which admin pressed the button. Month-End Close already uses
  the tenant chain (tenant timezone → UTC fallback).
- Keep the existing UTC fallback (no saved `tenant_settings.settings.timezone`).

This is the general layer: the next date-sensitive billing path calls the same
helper instead of re-deriving a zone conversion.

## 3. Call sites (all become `await resolveTenantToday(knexOrTrx, tenant)`)

| # | File:line | Current | Change |
|---|---|---|---|
| 1 | `packages/billing/src/actions/invoiceGeneration.ts:4043` | `const currentDate = options.invoiceDate ?? Temporal.Now.plainDateISO().toString();` | `?? (await resolveTenantToday(knex, tenant)).toString()`. `knex`/`tenant` are in scope (`createInvoiceFromBillingResultImpl`, knex may be a transaction). Fixes the recurring-run path Lynda hit, and `due_date` follows because `dueDateForPaymentTerms(currentDate, …)` derives from it. |
| 2 | `invoiceGeneration.ts:2511` | `const previewInvoiceDate = Temporal.Now.plainDateISO().toString();` | tenant-local today. Preview must show the date the invoice will carry. |
| 3 | `invoiceGeneration.ts:2272` | `issueDate: toISODate(Temporal.Now.plainDateISO())` | tenant-local today (`adaptToWasmViewModel`; `knex`/`tenant` already in scope). |
| 4 | `salesOrderInvoicingActions.ts:247` | `getDueDate(header.client_id, Temporal.Now.plainDateISO().toString())` | tenant-local today (inside the `withTransaction`; pass `trx`). |
| 5 | `salesOrderInvoicingActions.ts:387` | `invoice_date: Temporal.Now.plainDateISO().toString()` | same resolved date as #4 — resolve once per order and reuse so invoice and due date cannot drift. |
| 6 | `hourBlockActions.ts:325` (caller) | `const currentDate = …` then `getDueDate(clientId, currentDate)` | tenant-local today; `dueDate` derives from it. Leave `insertInvoiceForHourBlock` (`:228`) using the caller-supplied `dueDate`; pass the base date in the input if `insertInvoiceForHourBlock` must stamp `invoice_date` itself (it does, line 228) — add `invoiceDate` to its input alongside `dueDate`, defaulting to today only if absent. |
| 7 | `manualInvoiceActions.ts:188` | `const currentDate = Temporal.Now.plainDateISO().toString();` | tenant-local today (also the due-date base). |
| 8 | `manualInvoiceActions.ts:348` | same, in the manual-invoice update/rebuild path | tenant-local today (keep the two paths consistent). |
| 9 | `invoiceGeneration.ts:1572` | `previewAutomaticInvoiceDiscounts(…, Temporal.Now.plainDateISO().toString())` | tenant-local today: discount applicability is date-keyed, so the discount preview must agree with the invoice date. |

Order: helper + tests first; then #1 (customer-facing path); then #2/#3; then
#4/#5; then #6; then #7/#8; then #9.

Refactor Month-End Close (`recurringBillingRunActions.ts:446-452`) to build
`monthEndCloseInvoiceDate` via `localDateForInstant(Temporal.Instant.from(now.toISOString()), effectiveTimeZone)`
(keeping its own `resolveEffectiveTimeZone` call because the gate needs the zone).
Behaviour identical; one conversion implementation.

## 4. Tests

`packages/db/src/lib/workDate.test.ts` (new or extended):
- `localDateForInstant('2026-10-18T22:00:00Z', 'Australia/Sydney')` → `2026-10-19`
- same instant, `'UTC'` → `2026-10-18`
- null/empty/invalid zone → UTC fallback, no throw
- DST edges: `2026-10-03T15:30Z` Sydney (spring-forward day) and a US zone counterpart.

Billing:
- Unit/MCP-level test per path that currently mocks `Temporal.Now`: assert the
  invoice row's `invoice_date` (and `due_date`) for a tenant with
  `settings.timezone='Australia/Sydney'` and a stubbed instant at `2026-10-18T22:00Z`.
  At minimum the recurring-run path (#1) and manual invoice (#7); extend to
  sales-order, hour-block, and preview if cheap.
- Regression: tenant with no timezone → UTC date (existing behaviour).
- Regression: explicit `options.invoiceDate` still wins over the helper (#1).
- Month-End Close: existing period/gating tests must stay green.

Grep for `Temporal.Now` mocks in the affected suites and update them — they will
otherwise pin the old behaviour.

## 5. Out of scope (deliberately not in this PR)

- `invoiceGeneration.ts:3341` and `:3468` — project invoice `cycleEnd = today + 1`.
  That is a billing-window concern, not an invoice date.
- `billingAndTax.ts:333/1765/1898`, `invoiceModification.ts` `updated_at`/`finalized_at`
  stamps, `billingEngine.ts` window ends, `prepaidBlockFollowOnInvoice.ts:67`,
  `billingCurrencyActions.ts:34` — audit only; no date stamped on an invoice document.
  File follow-ups for any that turn out to be customer-visible.
- Month-End Close **gating** logic — untouched apart from the shared conversion.
- Draft invoice date editing (the workaround) — unchanged.

## 6. Risks

- Extra settings query per invoice. Acceptable; several callers already resolve
  tenant settings in the same request. Do not add a cache in this PR (tenant
  timezone changes must take effect immediately).
- `createInvoiceFromBillingResultImpl` may run inside a transaction: helper takes
  `Knex | Knex.Transaction` and reads through `tenantDb(trx, tenant)`.
- Time-based tests: prefer stubbing the instant at the helper boundary over
  stubbing `Date.now` globally.
- `LEVERAGE` signals worth recording while in the code: the duplicated
  `resolveEffectiveTimeZone` (`packages/db/src/lib/workDate.ts:79` and
  `server/src/lib/utils/workDate.ts:81`) and the repeated server-date idiom
  replaced here.

## 7. Pre-flight (before telling the customer it is fixed)

CloudVBS must actually have `tenant_settings.settings.timezone` saved — with no
timezone the helper falls back to UTC and their invoices stay unchanged. Read-only
check on the tenant DB; record the answer on the card.

## 8. Acceptance criteria

- [ ] Tenant `Australia/Sydney`, instant `2026-10-18T22:00Z`: recurring run creates
      `invoice_date = 2026-10-19`, `due_date` computed from the 19th.
- [ ] Same boundary holds for sales-order, hour-block, and manual invoices.
- [ ] Invoice preview date equals the created invoice's date.
- [ ] No saved tenant timezone → UTC date, with a test.
- [ ] Month-End Close unchanged and uses the shared conversion.
- [ ] Explicit `options.invoiceDate` still respected.
