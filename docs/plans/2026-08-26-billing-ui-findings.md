# Billing UI findings

Running log of screen-level defects found while reviewing the billing surfaces.
Findings only — no remediation design yet. A plan will be derived from this list
once the sweep is complete.

Each finding records what the screen does, what it should do, and the code that
proves it, so the eventual fix can be scoped without re-deriving the evidence.

**Environment:** local wire-in dev server, `http://localhost:3738`.

**Validation legend:**

- `code` — confirmed by reading the implementation.
- `data` — confirmed by querying the environment's database.
- `browser` — confirmed by driving the running app.

---

## Credit management

### CM-1 — Add Credit dialog: the amount field never states its currency

**Screen:** Credit Management (`/msp/billing?tab=credits`) → **Add Credit** dialog
**Component:** `packages/billing/src/components/credits/AddCreditButton.tsx:169`
**Validated:** `code` ✅ · `browser` ⏳ (blocked on dev sign-in)

#### What the screen does

The Amount field renders a bare, unadorned number. No symbol, no currency code,
no hint anywhere in the dialog. Whoever is issuing the credit types `500` with
nothing on screen telling them whether that is 500 USD, EUR, or JPY.

#### Why it is wrong

The currency is not ambiguous to the *system* — only to the *user*. `grantCredit`
already resolves it from the client and stamps it onto both ledger rows:

```ts
// packages/billing/src/actions/creditActions.ts:615
const clientCurrency = client.default_currency_code || 'USD';
```

It is then written to `transactions.currency_code` (`creditActions.ts:644`) and
`credit_tracking.currency_code` (`creditActions.ts:661`).

So the dialog withholds a fact the server is about to act on. The client is
already selected in the same dialog, one field above the amount — the value is
available at exactly the moment the user needs it.

The gap is visible without leaving the screen. The credits table *behind* the
dialog formats the very same amounts **with** currency:

```ts
// packages/billing/src/components/credits/CreditsTable.tsx:92,95
const currency = record.currency_code || 'USD';
… formatCurrencyFromMinorUnits(remaining, undefined, currency)
```

A number typed as a plain `500` reappears in the table one row later as
`€500.00`. The user learns the currency only after committing the credit.

#### Expected

The amount field should state the currency of the client selected in the dialog,
derived from `default_currency_code` (falling back to `USD`, matching the
server). It should react to changing the client selection, since the correct
currency is a property of the client, not of the form.

#### Two things the fix has to account for

1. **`AddCreditButton` never passes `currencyCode`.** The field uses the shared
   `CurrencyInput` (`packages/ui/src/components/CurrencyInput.tsx`), which accepts
   a `currencyCode` prop, but the call site omits it — so it silently defaults to
   `USD`. That default currently drives fraction digits only, which is its own
   latent bug: a JPY client's credit is entered against a 2-decimal field.

2. **Passing `currencyCode` alone would not fix the display.** `CurrencyInput`
   formats via `Intl.NumberFormat` *without* `style: 'currency'`:

   ```ts
   // packages/ui/src/components/CurrencyInput.tsx:30-31
   export function formatCurrencyValue(value: number, locale: string, currencyCode = 'USD'): string {
     const fractionDigits = currencyFractionDigits(currencyCode, locale);
     return new Intl.NumberFormat(locale, { minimumFractionDigits: …, maximumFractionDigits: … }).format(value);
   }
   ```

   Compare `formatCurrencyFromMinorUnits` (`packages/core/src/lib/formatters.ts:30`),
   which *does* pass `style: 'currency'` and therefore renders a symbol. As it
   stands, `CurrencyInput` uses `currencyCode` purely to pick decimal places and
   has **no currency affordance at all**.

#### Scope — this is a shared-component gap, not a one-screen typo

`CurrencyInput` has 12 production call sites. They split cleanly:

| Call site | passes `currencyCode` | shows currency to the user |
| --- | --- | --- |
| `inventory/StockOverview.tsx:518` | yes | no |
| `inventory/PoLandedCostDialog.tsx:284` | yes | yes — via label |
| `inventory/PurchaseOrdersManager.tsx:788` | yes | no |
| `inventory/StockUnitsManager.tsx:812` | yes | no |
| `inventory/SalesOrdersManager.tsx:895` | yes | no |
| `inventory/VendorPriceList.tsx:249` | yes | no |
| `opportunities/OpportunityValueFields.tsx:86,94,102` | yes | yes — via label |
| `settings/opportunities/OpportunitiesSettingsBody.tsx:298` | yes | no |
| `billing/credits/AddCreditButton.tsx:169` | **no** | no |
| `billing/credits/TransferCreditDialog.tsx:141` | **no** | no |

Every other call site threads a currency through; the two credits dialogs are the
only ones that do not.

Note that even the compliant call sites get no symbol — because the component
cannot render one. **Two packages independently worked around this in the label:**

```ts
// packages/inventory/src/components/PoLandedCostDialog.tsx:286
label={t('poLandedCost.fields.amount', 'Amount ({{currency}})', { currency })}
```

```ts
// packages/opportunities/src/components/dialogs/OpportunityValueFields.tsx:65-66
const symbol = getCurrencySymbol(currencyCode);
const withSymbol = (label: string) => `${label} (${symbol} ${currencyCode})`;
```

Two separate hand-rolled solutions to the same missing capability is the tell:
the affordance belongs in `CurrencyInput` itself, not in each caller's label
string.

The building block already exists and is already in use in this package. The
design system ships a `useCurrencyFormat()` hook whose `symbol()` member is
documented for exactly this purpose:

```ts
// packages/ui/src/lib/currency/useCurrencyFormat.tsx:24-25
/** Bare currency symbol ("$", "€") for input adornments. */
symbol: (currencyOverride?: string) => string;
```

`billing-dashboard/ContractLineDialog.tsx:66` already destructures `symbol` from
it. So the credits dialogs are not missing a capability the product lacks — they
are simply not using one it already has.

<!-- LEVERAGE: friction currency-input-affordance — CurrencyInput takes a
     currencyCode but can only express it as decimal places; callers that need
     to show the currency re-implement it in their label string. -->

### CM-2 — Transfer Credit dialog: same omission, and it hides a hard server rejection

**Screen:** Credit Management → **Transfer Credit** dialog
**Component:** `packages/billing/src/components/credits/TransferCreditDialog.tsx:141`
**Validated:** `code` ✅ · `browser` ⏳

The identical `currencyCode` omission as CM-1, but the consequence is worse. A
transfer moves a credit between two clients, and the server refuses outright when
their currencies differ:

```ts
// packages/billing/src/actions/creditActions.ts:1944-1948
// Credits never change currency: the target client must bill in the
// same currency as the source credit.
const transferCurrency = sourceCredit.currency_code || 'USD';
if ((targetClient.default_currency_code || 'USD') !== transferCurrency) {
    throw new Error('Credits cannot mix currencies: the target client uses a different currency');
}
```

The dialog shows neither the source credit's currency nor the target client's, so
there is no way to see the mismatch coming. The user picks a target, fills in an
amount, submits, and only then gets a rejection for a condition that was knowable
the moment the target was selected.

Worth deciding alongside CM-1 — same component, same root cause, but this one
also wants the target's currency surfaced next to the client picker so the
constraint is visible before submit.

---

## Prepayment invoices

**Where this screen lives.** `/msp/billing?tab=invoicing&subtab=generate`, then
pick **Prepayment** from the invoice-type selector on the tab-bar row. The type
is not in the URL (`InvoicingHub.tsx:46-47`), so the screen cannot be linked to
directly and resets to `automatic` on every mount. It is also gated on the
`billing-enabled` feature flag in two places (`InvoicingHub.tsx:103`,
`GenerateTab.tsx:124`).

**Component:** `packages/billing/src/components/billing-dashboard/PrepaymentInvoices.tsx`

### PP-1 — Generate Prepayment Invoice: the amount field never states its currency

**Component:** `PrepaymentInvoices.tsx:165-174`
**Validated:** `code` ✅ · `browser` ⏳

Same defect as CM-1, one layer worse: this screen does not use `CurrencyInput`
at all. The amount is a **raw numeric `Input`**:

```tsx
// packages/billing/src/components/billing-dashboard/PrepaymentInvoices.tsx:167-174
<Input
  type="number"
  min="0.01"
  step="0.01"
  value={amount}
  onChange={(e) => setAmount(e.target.value)}
  …
/>
```

As with CM-1, the server already knows the currency and stamps it on the
resulting invoice:

```ts
// packages/billing/src/actions/creditActions.ts:801
currency_code: client.default_currency_code || 'USD',
```

The client is selected in the field directly above the amount, so the value is
available at the moment it is needed.

Because it bypasses `CurrencyInput` entirely, this field also loses what that
component does provide:

- **No locale-aware parsing.** `parseFloat(amount)` (`PrepaymentInvoices.tsx:55`)
  against a raw string, where `CurrencyInput.parseCurrencyValue` handles the
  locale's decimal and group separators.
- **Decimal places hardcoded to 2** via `step="0.01"`, wrong for zero-decimal
  currencies (JPY) and three-decimal ones. `currencyFractionDigits` exists for
  precisely this.

### PP-2 — Generate Prepayment Invoice: the amount is sent in the wrong units (100× understatement)

**Component:** `PrepaymentInvoices.tsx:70`
**Validated:** `code` ✅ · `browser` ⏳
**This is a correctness bug, not a presentation one.**

The form collects major units and passes them straight into an action whose
contract is **minor units**:

```tsx
// PrepaymentInvoices.tsx:57,70
const numericAmount = parseFloat(amount);
…
const result = await createPrepaymentInvoice(selectedClient || '', numericAmount);
```

`createPrepaymentInvoiceInternal` writes that number to the invoice with no
conversion — `subtotal: amount`, `total_amount: amount`
(`creditActions.ts:793,795`).

Four independent confirmations that the contract is cents:

1. **Invoice totals are rendered from minor units.** `DraftInvoiceDetailsCard.tsx:306`
   formats `total_amount` through `money()`, which is
   `formatCurrencyFromMinorUnits` (`useCurrencyFormat.tsx:61-62`).
2. **The other caller enforces integers.** `prepaidAutoReplenishment.ts:91-92`
   rejects anything that is not a positive integer — "Replenishment amount must
   be a positive integer."
3. **The integration test says so outright.**
   ```ts
   // server/src/test/infrastructure/billing/credits/creditCreationAndDates.test.ts:234
   const prepaymentAmount = 15000; // $150.00 credit
   ```
4. **The sibling dialog converts and this one does not.** `AddCreditButton.tsx:93`
   does `toMinorUnits(amount, i18n.language)` before calling `grantCredit`;
   `PrepaymentInvoices` has no equivalent step.

**Effect:** typing `150` creates a prepayment invoice for **$1.50**, not $150.00
— and the credit it issues on finalization is off by the same factor. Entering a
value with cents (`150.50`) additionally sends a non-integer into a cents column.

This compounds PP-1 rather than sitting beside it: the field shows no currency,
so nothing on screen contradicts the user's assumption that they typed dollars.

Note the REST surface has the same looseness — `createPrepaymentInvoiceSchema`
uses `amountSchema` (`z.number().min(0)`) where the file already defines
`monetaryAmountSchema` (`z.number().int().min(0)`, commented "For cent-based
amounts") for this exact purpose (`financialSchemas.ts:112-113,190-194`).

### PP-3 — Generate Prepayment Invoice: the amount is a native number spinner that scrolls by the penny

**Component:** `PrepaymentInvoices.tsx:167-174`
**Validated:** `code` ✅ · `browser` ⏳

`type="number"` with `step="0.01"` gives the field the browser's native spinner.
Hovering it and turning the scroll wheel walks the amount **one cent per tick** —
so an idle scroll over the form silently edits the money, and reaching a
meaningful figure by wheel is absurd. It also inherits the rest of the native
number-input baggage: up/down arrow keys nudge by a cent, and the spinner arrows
occupy the field.

**There is an Alga control for this, and it is the same one PP-1 and PP-2 point
to.** `CurrencyInput` renders `type="text"` (`CurrencyInput.tsx:106`), not
`type="number"` — so it has no spinner, no wheel stepping, and no arrow-key
nudge, while still accepting only numeric input through
`parseCurrencyValue`/`formatCurrencyValue`.

So the fix here is not a bespoke `onWheel` blocker. Adopting `CurrencyInput` on
this screen resolves PP-1, PP-2, and PP-3 together:

| Finding | What adopting `CurrencyInput` gives |
| --- | --- |
| PP-1 currency display | a `currencyCode` prop to thread the client's currency through (plus the `CurrencyInput` affordance change proposed in CM-1) |
| PP-2 wrong units | the same major→minor conversion boundary the sibling dialog already uses |
| PP-3 penny spinner | `type="text"`, so the spinner and wheel stepping disappear outright |

A hand-rolled `onWheel={e => e.currentTarget.blur()}` would suppress the symptom
and leave the field diverging further from every other money input in the
product.

**Wider than this screen.** `type="number"` is used ~136 times across the billing
components. Not all of those are monetary — that count needs a pass to separate
money fields from quantity/day-count fields before it means anything — but the
pattern is clearly not confined to the prepayment form. Worth a sweep of its own
once the credits and prepayment screens are settled.

### PP-4 — Generate Prepayment Invoice: Description is mandatory, and then thrown away

**Component:** `PrepaymentInvoices.tsx:49-53,70,181-196`
**Validated:** `code` ✅ · `browser` ⏳

The form makes Description a hard requirement. It gates validation:

```tsx
// PrepaymentInvoices.tsx:49-53
if (selectedClient === null || !amount || !description) {
  setError(t('prepayment.errors.allFieldsRequired', { defaultValue: 'Please fill in all fields' }));
  return;
}
```

and it disables the submit button (`PrepaymentInvoices.tsx:198`,
`disabled={… || !description}`). Nothing on screen marks it optional.

**The value is then never sent.** The call passes two arguments:

```tsx
// PrepaymentInvoices.tsx:70
const result = await createPrepaymentInvoice(selectedClient || '', numericAmount);
```

This is not an omission at the call site that could be patched by adding an
argument — `createPrepaymentInvoice` **has no description parameter at all**. Its
signature is `(clientId, amount, manualExpirationDate?, billingProfileId?)`
(`creditActions.ts:705-716`), and `createPrepaymentInvoiceInternal` writes no
description onto the invoice (`creditActions.ts:787-806`).

Downstream, the ledger entry the prepayment eventually produces carries a
hardcoded string, so the user's text could not survive even if it were passed:

```ts
// packages/billing/src/actions/invoiceModification.ts:1206
description: 'Credit issued from prepayment',
```

Compare the sibling dialog, which does this properly end to end: Add Credit
labels the field **"Description (optional)"**, leaves it out of validation, and
threads it through to the transaction — `description?.trim() || 'Credit granted'`
(`creditActions.ts:637`).

So the user is compelled to compose a reason for every prepayment, and that
reason is discarded silently. Either the field should be honoured (plumbed
through the action to the transaction, as Add Credit does) or it should stop
being required — but the current state demands work and then discards it.

### PP-5 — Generate Prepayment Invoice: Credit Memo is an inert option that advertises a feature the product does not have

**Component:** `PrepaymentInvoices.tsx:44-45,66-68,85-89,99-107`
**Validated:** `code` ✅ · `browser` ⏳

The Type selector offers two choices, **Prepayment Invoice** and **Credit Memo**.
Choosing Credit Memo commits the UI to the idea: the card retitles itself to
"Generate Credit Memo" (`:115`), the body copy is replaced with a paragraph
explaining what credit memos do (`:122-124`), the description placeholder changes
to "Reason for credit memo" (`:187`), and the submit button relabels to "Generate
Credit Memo" (`:205`).

Submitting then throws immediately, before any work is attempted:

```tsx
// PrepaymentInvoices.tsx:66-68
if (type === 'credit_memo') {
  throw new Error(CREDIT_MEMOS_UNSUPPORTED_ERROR);
}
```

…surfacing "Credit memos are not yet supported" (`:86-88`).

**There is no credit-memo feature anywhere else in the product.** Every other
`CreditMemo` occurrence in the codebase is QuickBooks Online's *entity type* in
the accounting sync adapter — the name QBO gives an exported Alga credit note
(`adapters/accounting/quickBooksOnlineAdapter.ts:117-118,600`) — an integration
detail, not a user-facing capability. So the option is not a temporarily disabled
feature; it advertises something that was never built.

That is also a naming hazard. Alga *does* have credit notes (`credit_tracking`,
`isCreditNote`), so "Credit Memo" reads to a user like a real adjacent concept
rather than a dead end.

**Removal has a tail.** The dead strings are carried in **all 10 locale bundles**
(`server/public/locales/*/msp/invoicing.json` — en, de, es, fr, it, nl, pl, pt,
plus the xx/yy pseudo-locales) and are asserted by an i18n contract test
(`packages/billing/tests/PrepaymentInvoices.i18n.test.ts:34-48`). Whichever way
this goes, those five keys and that test move with it.

The real decision is product, not code: either credit memos get built, or the
option comes out. Leaving a selectable type whose only behaviour is an error
message is the one option that should not survive.

---

## Hour blocks

**Where this screen lives.** Client details → **Hour Blocks** section → **Sell
hour block** dialog. The section is gated on the `release-v1-5-feature` flag
(`packages/clients/src/components/clients/ClientDetails.tsx:302,1460`) and is
rendered through the client cross-feature provider
(`msp-composition/src/clients/MspClientCrossFeatureProvider.tsx:59-60`).

**Component:** `packages/billing/src/components/hour-blocks/SellHourBlockDialog.tsx`

**Units are handled correctly here** — `total` is `Math.round(hours * rate * 100)`
(`:88-90`), the rate seeds from `default_rate / 100` (`:84`), and submit sends
`hourlyRate: Math.round(rateNumber * 100)` (`:144`). PP-2 is a prepayment-specific
defect, not a house pattern. Worth stating explicitly so the eventual fix does not
"correct" units that are already right.

### HB-1 — Sell hour block: the Hours spinner steps off-grid and can never reach a whole number

**Component:** `SellHourBlockDialog.tsx:192-200`
**Validated:** `code` ✅ · `browser` ⏳

```tsx
<Input
  id="hb-hours"
  type="number"
  min="0.1"
  step="0.5"
  …
  placeholder={t('sell.hoursPlaceholder', { defaultValue: 'e.g. 10' })}
/>
```

Two problems, and the second is the interesting one.

**The wheel edits the value.** As with PP-3, this is a native number input, so
hovering it and scrolling walks the hours. An idle scroll over the dialog
silently changes what is being sold.

**The step grid is anchored to `min`, not to zero.** For `input type=number` the
step base is the `min` attribute when one is present. With `min="0.1"` and
`step="0.5"`, the reachable values are 0.1, 0.6, 1.1, 1.6, 2.1 … — the stepper
can **never land on a whole number of hours**. The field's own placeholder says
"e.g. 10", a value its spinner cannot produce.

Whether the browser also flags a typed `10` as a step mismatch is worth checking
live, but it cannot block submission: the dialog is not a `<form>` and the submit
button is a plain `onClick` running JS validation (`:123-135`, `:268`), so native
constraint validation never runs. The damage is confined to the spinner and the
wheel — but "the arrows give you 0.6 hours" is not defensible either way.

### HB-2 — Sell hour block: the Rate spinner scrolls by the penny

**Component:** `SellHourBlockDialog.tsx:204-212`
**Validated:** `code` ✅ · `browser` ⏳

`type="number"` with `step="0.01"` — the same native-spinner defect as PP-3, on a
money field.

**Credit where due: this screen does show the currency.** The label carries it:

```tsx
// SellHourBlockDialog.tsx:203
<Label htmlFor="hb-rate">{t('sell.rateLabel', { defaultValue: 'Rate per hour ({{currency}})', currency: currencyCode })}</Label>
```

That is the *third* independent instance of the label workaround catalogued in
CM-1 (after `PoLandedCostDialog` and `OpportunityValueFields`), which strengthens
that finding rather than weakening this one: three teams each solved "show the
currency on an amount field" by hand because the shared input cannot.

The fix is `CurrencyInput`, which renders `type="text"` (`CurrencyInput.tsx:106`)
and so drops the spinner and the wheel outright, while taking `currencyCode` as a
prop instead of a hand-built label.

**Note there is no Alga control for the Hours field.** The UI kit has
`CurrencyInput` for money and nothing for plain numerics — no `NumericInput`,
`QuantityInput`, or duration control. So HB-1 has no drop-in answer today. Given
PP-3 already flagged ~136 `type="number"` uses across billing, a `NumericInput`
sibling to `CurrencyInput` (text-backed, locale-aware, no wheel, explicit
precision) is the shape worth considering — decide it with PP-3 rather than
separately.

<!-- LEVERAGE: pattern numeric-input-control — money fields have CurrencyInput;
     plain numeric fields have nothing, so each screen hand-rolls
     type="number" with ad-hoc min/step and inherits the native spinner. -->

### HB-3 — Sell hour block: the scope checkboxes are raw HTML, not the Alga control

**Component:** `SellHourBlockDialog.tsx:234-240`
**Validated:** `code` ✅ · `browser` ⏳

The scope list builds its checkboxes by hand:

```tsx
<input
  type="checkbox"
  className="h-4 w-4 rounded border-[rgb(var(--color-border-200))]"
  checked={scopeServiceIds.has(service.service_id)}
  onChange={() => toggleScope(service.service_id)}
/>
```

The file never imports `Checkbox`. A bare `input type="checkbox"` renders its
checked state in the **browser's default accent colour — blue on Chrome and most
platforms** — regardless of the Alga theme. That is the hardcoded blue on screen:
not a colour someone typed, but the absence of the one line that sets it.

`packages/ui/src/components/Checkbox.tsx` exists and does it properly:

```tsx
// packages/ui/src/components/Checkbox.tsx:83-97
className={cn('alga-checkbox shrink-0 rounded-md border-[rgb(var(--color-border-300))] text-primary-500 … focus:ring-2 focus:ring-primary-500 …')}
style={{ accentColor: 'rgb(var(--color-primary-500))' }}
```

Going raw costs more than the colour:

- **Theme accent** — `accentColor: rgb(var(--color-primary-500))` is exactly what
  keeps checkboxes on-brand; the raw input has no `accentColor` at all.
- **Focus treatment** — the Alga control has a `primary-500` focus ring; the raw
  one falls back to the UA default.
- **Border token** — the raw input uses `--color-border-200`, the control uses
  `--color-border-300`, so even unchecked it is subtly off from every other
  checkbox.
- **UI-reflection registration** — `Checkbox` registers itself via
  `useRegisterUIComponent` and stamps `withDataAutomationId`
  (`Checkbox.tsx:47-56,99`). These raw inputs are invisible to that layer, so the
  scope selector cannot be driven or asserted by the automation harness.

**88 files** already import the shared `Checkbox`. This dialog is the exception,
not a house style.

### HB-4 — Sell hour block: non-hourly services can be sold as hour blocks

**Component:** `SellHourBlockDialog.tsx:52` (dropdown), `hourBlockActions.ts:292-330` (server)
**Validated:** `code` ✅ · `browser` ⏳

The service dropdown is populated with every active catalog service:

```tsx
// SellHourBlockDialog.tsx:52
getServices(1, 999, { is_active: true, item_kind: 'service' })
```

`item_kind: 'service'` separates services from products. It says nothing about
how the service is billed. `IService.billing_method` is a required
`'fixed' | 'hourly' | 'usage'` (`packages/types/src/interfaces/billing.interfaces.ts:310`),
so **fixed-price and usage-based services are offered in a dialog that sells
hours at a rate per hour** — and the picked service's `default_rate` is then
loaded straight into a field labelled "Rate per hour" (`SellHourBlockDialog.tsx:83-86`).

**The server does not catch it either.** `createHourBlockPurchaseInvoice`
validates that the service *exists* and nothing more (`hourBlockActions.ts:316-318`)
— there is no `billing_method` check on any path. It proceeds to write a charge
of `quantity: hours, rate: hourlyRate` described as
`Prepaid hour block — ${service.service_name}` (`hourBlockActions.ts:241-247`)
and to track the block in `total_minutes` (`:215`). A fixed-price service ends up
with a minute-denominated balance that nothing will draw down coherently.

**The filter already exists.** `getServices` accepts a `billing_method` option
(`serviceActions.ts:175`, applied at `:233-234`), so constraining the dropdown is
a matter of passing `billing_method: 'hourly'`. The server-side guard is the
other half — a UI filter alone would leave the action and REST paths open.

One question for the product side before this is scoped: is "hourly only" the
right rule, or should usage-based services be sellable as blocks too? The
tracking unit is minutes, which argues for hourly-only, but that is worth
confirming rather than assuming.

---

## Contract wizard — bucket pools (hourly line)

**Where this screen lives.** Create contract wizard → **Hourly services** step →
*Bucket pools for this line*. Gated on the pool-editor flag
(`HourlyServicesStep.tsx:382`).

**Component:** `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/BucketPoolDraftEditor.tsx`

The file holds two editors that drift from each other and must be read as a pair:

- `CreateDraftPoolForm` (`:368-543`) — the inline "New bucket pool" form.
- `DraftPoolCard` (`:134-357`) — the card for a pool already added.

Several findings below reproduce differently in the two, which is itself a
signal: the same controls were implemented twice with different guards.

### CW-1 — Member services: the picker is empty with no explanation

**Component:** `BucketPoolDraftEditor.tsx:459-470` (create form), `:302-315` (saved card)
**Validated:** `code` ✅ · `browser` ⏳

The member options are not the service catalogue. They are **the hourly services
already added to this contract line**:

```tsx
// HourlyServicesStep.tsx:386-391
lineServices={data.hourly_services
  .filter((service) => service.service_id)
  .map((service) => ({ service_id: service.service_id, service_name: … }))}
```

So a pool added before any hourly service is configured — or while the service
rows are still blank, since `.filter(service => service.service_id)` drops
un-chosen rows — has nothing to offer. Nothing on screen says so.

The two editors then fail differently:

- **Create form** — the `<select>` renders unconditionally, so it appears with
  only the "Select a service…" placeholder inside it. This is the empty dropdown
  as reported.
- **Saved card** — the picker is wrapped in `{!pool.covers_all_services && unpooledServices.length > 0 && …}`
  (`:302`), so it disappears entirely. But the **"Member services" `<Label>` above
  it renders unconditionally** (`:278-280`), leaving a heading with nothing
  beneath it — arguably worse, since it reads as a control that failed to load.

There is a knock-on: the create form's submit is
`disabled={(!coversAll && members.length === 0)}` (`:534`). With no line services
there is no way to add a member, so the only route forward is toggling "Covers
all services on this line" — and nothing communicates that either.

**Expected:** the picker should say why it is empty and what to do — add hourly
services to the line first — rather than presenting an empty control or an
orphaned label. This is a missing empty state, not a data bug: the dropdown is
correctly scoped, it just refuses to explain itself.

### CW-2 — After-hours burn multiplier cannot be switched on, silently, when no business-hours schedule exists

**Component:** `BucketPoolDraftEditor.tsx:503-508` (create form), `:222-270` (saved card)
**Validated:** `code` ✅ · `data` ✅ · `browser` ⏳

The switch carries no `disabled` prop anywhere. What defeats it is its own state
handler:

```tsx
// BucketPoolDraftEditor.tsx:506-507
checked={afterHoursMultiplier !== ''}
onCheckedChange={(checked) => setAfterHoursMultiplier(checked ? (defaultSchedule ? '1.5' : '') : '')}
```

`defaultSchedule` comes from the tenant's business-hours schedules
(`:64`). **When there are none, toggling the switch on sets the multiplier to
`''` — and `''` is exactly the value that renders the switch as off.** It snaps
straight back with no message. Indistinguishable from a disabled control, which
is how it was reported.

**Confirmed against this environment's database:** `business_hours_schedules`
holds **zero rows across all tenants**. So `listBucketBusinessHoursSchedules()`
returns `[]` on every load here, and the switch is unusable for everyone.

The saved-pool card fails the same way by a different route. Its switch *does*
flip (`:224-231`), but the rule can never be committed — the Apply button's guard
requires a schedule id:

```tsx
// BucketPoolDraftEditor.tsx:265-268
const multiplier = parseFloat(ruleMultiplierInput);
if (Number.isFinite(multiplier) && multiplier > 0 && effectiveScheduleId) {
  onUpdate({ after_hours_multiplier: multiplier, business_hours_schedule_id: effectiveScheduleId });
}
```

With no schedules, `effectiveScheduleId` is `''`, so **"Apply after-hours rule" is
a no-op that reports nothing** — the user clicks, and the UI does not change.
The schedule `<select>` beside it also renders with zero options.

Two aggravating factors:

1. **The load failure is swallowed.** `HourlyServicesStep.tsx:51-53` catches the
   error and comments "the rule simply has no schedule to pick from" — an empty
   list from a *failed request* and an empty list from *no schedules configured*
   are indistinguishable to the user, and neither is surfaced.
2. **There is no route to fix it from here.** Nothing in this UI creates a
   business-hours schedule or links to where one is created.

**Expected:** the after-hours rule should state its precondition. If no schedule
exists, say so and point at where to create one, rather than presenting a switch
that silently refuses or a button that silently does nothing.

### CW-3 — The burn multiplier field is unlabeled and stepped to a thousandth

**Component:** `BucketPoolDraftEditor.tsx:316-324` (create/saved member row)
**Validated:** `code` ✅ · `browser` ⏳

The number sitting beside the service picker is the **per-service burn
multiplier**. It has no visible label — only `aria-label` and a `w-20` box:

```tsx
<Input
  type="number"
  min="0.001"
  step="0.001"
  className="w-20"
  value={newMultiplier}
  onChange={(e) => setNewMultiplier(e.target.value)}
  aria-label={t('bucketPools.labels.multiplier', { defaultValue: 'Multiplier' })}
/>
```

Once added, the value is rendered as `× {burn_multiplier}` (`:287-289`), so the
concept *is* named — but only after the fact. At the moment of entry, the field
is an anonymous number box. Every other field in this editor has a visible
`<Label>`; this one is the exception.

**On the precision:** `step="0.001"` is the same grid the after-hours multiplier
uses (`:236-238`, `:513`), so it is at least internally consistent, and a
thousandth is plausible for a weighting factor. But it is asserted nowhere —
there is no schema or DB constraint in this path pinning multiplier precision,
and the placeholder for the after-hours sibling suggests "e.g. 1.5". Worth a
deliberate decision rather than inheriting `0.001` by default; if three decimals
is right, the field should say what the units are.

### CW-4 — "Overage rate ($/hr)" hardcodes the currency symbol — in every locale

**Component:** `BucketPoolDraftEditor.tsx:191`, `:424`
**Validated:** `code` ✅ · `browser` ⏳

The suspicion is correct: the `$` is literal text inside the label string, not
derived from any currency.

```tsx
// BucketPoolDraftEditor.tsx:191 and :424 — both occurrences
<Label className="text-xs">{t('bucketPools.labels.overageRate', { defaultValue: 'Overage rate ($/hr)' })}</Label>
```

`BucketPoolDraftEditor` receives no currency prop at all — no `currencyCode`, no
`useCurrencyFormat()` — so it has nothing to derive one from even if the string
were parameterised.

**The symbol has been translated as if it were part of the words.** All eight
shipped locales carry it:

| Locale | `bucketPools.labels.overageRate` |
| --- | --- |
| en | Overage rate ($/hr) |
| de | Überschreitungstarif ($/Std.) |
| es | Tarifa por exceso ($/h) |
| fr | Tarif de dépassement ($/h) |
| it | Tariffa di superamento ($/ora) |
| nl | Overschrijdingstarief ($/uur) |
| pl | Stawka za przekroczenie ($/godz.) |
| pt | Taxa de excedente ($/h) |

A contract in EUR shows "($/Std.)". The per-hour part was localised correctly;
the currency was not, because it was never treated as data.

Contrast the hour-block dialog (HB-2), which parameterises it —
`'Rate per hour ({{currency}})'` with `currency: currencyCode`. That is the
existing convention this screen should follow, pending the broader
`CurrencyInput` decision in CM-1.

### CW-5 — Every numeric field in the pool editor is a native spinner

**Component:** `BucketPoolDraftEditor.tsx:181, 193, 236, 319, 421, 425, 473, 513`
**Validated:** `code` ✅ · `browser` ⏳

Eight `type="number"` inputs across the two editors — total hours, overage rate,
after-hours multiplier, and the member burn multiplier, each duplicated between
the create form and the saved card. All carry the wheel-edit behaviour from PP-3
and HB-1/HB-2: hovering and scrolling silently changes the value.

The steps make it worse than usual on this screen. The multipliers use
`step="0.001"`, so one wheel tick moves a burn weight by a thousandth; the
overage rate uses `step="0.01"`, a penny per tick.

This is the same defect as PP-3, HB-1 and HB-2, and the third screen it has
turned up on. Eight more call sites here brings the count high enough that a
shared control is clearly the answer rather than per-field patches — see the
`NumericInput` note under HB-2.

### CW-6 — "Apply after-hours rule": where it is, and why it appears to do nothing

**Component:** `BucketPoolDraftEditor.tsx:257-271` (wizard), `BucketPoolEditor.tsx:424-425` (contract detail)
**Validated:** `code` ✅ · `browser` ⏳

Logged because the button is hard to find at all, which is itself the first half
of the finding.

**Where it is.** The button exists in two editors and, in both, only on a pool
that has *already been added* — inside the `{ruleEnabled && …}` block that opens
when the After-hours burn multiplier switch is turned on:

- Wizard: `BucketPoolDraftEditor.tsx:257-271`, id `apply-wizard-after-hours-rule-button`
- Contract detail: `BucketPoolEditor.tsx:424-425`, id `apply-after-hours-rule-button`

**Where it is not.** The wizard's *create* form (`CreateDraftPoolForm`) has no
apply button — its after-hours values are folded into "Create pool"
(`:503-531`). So the control appears in one of the two pool editors and not the
other, for the same conceptual action.

That alone explains "I don't see where that button is": in the create form it
does not exist, and on the saved card it is hidden until the switch is on — and
per CW-2, in an environment with no business-hours schedules the create-form
switch will not stay on at all.

**Why it does nothing.** Both implementations guard on a schedule id:

```ts
// BucketPoolEditor.tsx:334-337 (the wizard copy at :265-268 is identical in effect)
const multiplier = parseFloat(ruleMultiplierInput);
if (Number.isFinite(multiplier) && multiplier > 0 && effectiveScheduleId) {
  onSetRule(multiplier, effectiveScheduleId);
}
```

There is no `else`. With `business_hours_schedules` empty — confirmed in CW-2,
zero rows across all tenants in this environment — `effectiveScheduleId` is `''`,
so the click falls through the `if` and returns. **No state change, no error, no
toast, no disabled state to explain it.** The note "seems to not do anything" is
accurate: it does nothing, and says nothing.

This is the same root cause as CW-2 and should be fixed with it. Recorded
separately because the discoverability problem is independent: even with
schedules present, the button's placement is inconsistent between the two
editors.

---

## Billing simulator

**Where this screen lives.** Contract simulator workspace (Enterprise-only —
the CE build stubs every entry point with "Contract simulator is only available
in Enterprise Edition", `packages/ee/src/lib/billing/simulator/index.ts`).

**Components:** `ee/server/src/components/billing/simulator/ContractSimulatorWorkspace.tsx`
**Engine:** `ee/server/src/lib/billing/simulator/loadSimulationCalculationInput.ts`

### BS-1 — "Simulation notes" repeats the same rate-gap warning once per period

**Component:** `ContractSimulatorWorkspace.tsx:764-807` (render), `loadSimulationCalculationInput.ts:668-673,1004-1009` (emit)
**Validated:** `code` ✅ · `browser` ⏳

The notes list renders every diagnostic verbatim, with no grouping and no dedup:

```tsx
// ContractSimulatorWorkspace.tsx:777-779
{result.diagnostics.map((diagnostic, index) => (
  <li key={`${diagnostic.message}-${index}`} …>
```

The engine pushes the rate-gap warnings from **inside the per-period loop**, once
per affected service per billing period:

```ts
// loadSimulationCalculationInput.ts:1004-1009 (hourly; usage at :668-673 is the same shape)
if (!hasResolvableHourlyRate(service)) {
  diagnostics.push({
    severity: "warning",
    line_key: line.key,
    message: `${service.service_name} has no ${currencyCode} hourly rate, so its hours were omitted from invoice ${periodIndex + 1}.`,
  });
  continue;
}
```

So a 12-period horizon with one un-rated hourly service produces **12 warnings**;
two such services produce 24. The condition being reported — the service has no
rate in this currency — is a property of the *service*, not of any one period,
so every repetition after the first carries no new information.

**A naive dedup will not work.** The period index is interpolated into the
message (`…omitted from invoice ${periodIndex + 1}`), so all N strings are
distinct. Folding requires either grouping on a structured field
(`line_key` + service + reason) or moving the check out of the period loop.

**The right shape already exists in the same file.** `simulateLineDiagnostics`
runs once per line, outside the period loop, and already states rate gaps exactly
once for product/license services:

```ts
// loadSimulationCalculationInput.ts:432-437
message: `${service.service_name} has no ${currencyCode} ${chargeType} price. Add a catalog or service rate to include it.`,
```

Note it also ends with an actionable instruction ("Add a catalog or service
rate to include it"), which the hourly and usage variants omit. The hourly and
usage paths should follow that precedent: report the gap once per service, name
the affected periods if that matters, and say what to do about it.

`SimulationDiagnostic` currently carries only `severity`, `line_key` and a
prebuilt `message`, so there is no structured field to group on today — worth
deciding whether folding happens in the engine (preferred: the UI then stays
dumb) or whether the type grows a code/service id for the UI to group by.

### BS-2 — The horizon is counted in *client* billing periods, and the control never says so

**Component:** `ContractSimulatorWorkspace.tsx:66,503-514,651` (control), `hypotheticalPeriods.ts:109-140` (engine)
**Validated:** `code` ✅ · `browser` ⏳

The instinct that months quietly became years is correct, and the mechanism is
that **two different cadences are in play and the UI names neither.**

The horizon selector offers a bare count:

```ts
// ContractSimulatorWorkspace.tsx:66
const HORIZON_OPTIONS = [3, 6, 12];
// …:509-511
label: t("contractSimulator.runBar.horizonOption", { defaultValue: "{{count}} billing periods", count }),
```

`3 / 6 / 12` are the familiar month counts — quarter, half-year, year — which
primes the reader to read them as months. But a "billing period" here is one
cycle of the **client's** invoice schedule:

```ts
// hypotheticalPeriods.ts:122-140
const anchor = normalizeAnchorSettingsForCycle(schedule.billing_cycle, {…});
const first = getBillingPeriodForDate(toUtcMidnight(horizon.start_date), schedule.billing_cycle, anchor);
for (let index = 0; index < horizon.period_count; index += 1) { … }
```

…and `invoice_schedule.billing_cycle` is read from the client, not the contract:

```ts
// draftContractToScenario.ts:229,260-261
const schedule = await getClientBillingCycleAnchor(…);
…
invoice_schedule: { billing_cycle: schedule.billingCycle, … }
```

So on a client whose billing cycle is annual, **"12 billing periods" projects 12
years**, regardless of the contract's own monthly cadence.

The contract's cadence is a *separate* axis carried alongside it
(`billing_frequency: draft.billing_frequency`, `draftContractToScenario.ts:269`).
It drives service-period generation and assignment
(`normalizeBillingCycle(line.billing_frequency)`, `loadSimulationCalculationInput.ts:220`),
not the invoice timeline. The two only coincide when the client's cycle and the
contract's frequency happen to match — which is the common case, and precisely
why the mismatch is disorienting when it occurs.

The engine is not confused; it is behaving as designed and even reports the
divergence in places — `Does not appear in the next {period_count} invoices
because it uses a {lineCycle} schedule and bills in {billing_timing}`
(`:237`), and `Uses the {billing_frequency} frequency, which this projection
cannot model. Monthly billing was used instead.` (`:419`). The gap is entirely in
the control's wording.

**Expected:** the selector should name the unit it is counting and where it comes
from — e.g. "12 billing periods (annual — from the client's billing cycle)" — or
show the resolved date range for the chosen horizon. The status line has the same
problem: "Simulation current · {{count}} billing periods"
(`ContractSimulatorWorkspace.tsx:702-706`) restates the ambiguous count rather
than resolving it.

Worth confirming in the browser what the timeline headers show for an annual
client, since `SimulationTimeline` may already disambiguate by rendering real
dates — if it does, the fix is narrower than it looks.

---


## Open items

- Complete `browser` validation for every finding (CM-1..2, PP-1..5, HB-1..4,
  CW-1..6, BS-1..2). Blocked: the dev server rotates the seeded user's password
  on every boot and prints it only to the service console.
- **BS-2 has a narrowing question**: check what `SimulationTimeline` renders for
  period headers on an annual client. If it already shows real dates, the fix is
  wording on the selector and status line only.
- **BS-1 needs a layering decision**: fold duplicate diagnostics in the engine
  (preferred — the UI stays dumb), or grow `SimulationDiagnostic` with a
  code/service id so the UI can group. Today it carries only severity, line_key
  and a prebuilt message, so neither is possible without a change.
- **HB-1 has one live question**: whether the browser also reports a step
  mismatch on a typed whole number, or only misbehaves in the spinner.
- **PP-2 needs a live confirmation before anything is built on it.** The code
  chain is unambiguous, but generating one prepayment invoice and reading back
  `invoices.total_amount` settles it beyond argument.
- **PP-5 needs a product decision, not just an engineering one**: build credit
  memos, or remove the option (and its five locale keys across 10 bundles, and
  the i18n contract test that asserts them).
- **PP-4 needs a product decision too**: honour Description by plumbing it
  through to the transaction the way Add Credit does, or stop requiring it.
- Triage the ~136 `type="number"` inputs across billing components (PP-3, HB-1,
  HB-2, CW-5), separating money fields from quantity fields, and decide whether a
  `NumericInput` sibling to `CurrencyInput` is the right layer. Three screens have
  now produced the same defect; CW-5 alone adds eight call sites.
- **CW-2 has an environment question as well as a code one**: `business_hours_schedules`
  is empty here, so the after-hours rule is dead for every tenant in this
  environment. Confirm whether that is expected (seed gap) or whether schedules
  are meant to exist by default — it changes whether the fix is only an empty
  state or also a seeding/setup path.
- **CW-3 needs a decision on multiplier precision**: is `step="0.001"` deliberate,
  and what unit should the field state?
- The two pool editors (`CreateDraftPoolForm` and `DraftPoolCard`) implement the
  same controls twice with different guards, which is why CW-1 and CW-2 each
  reproduce two different ways. Worth considering whether they should be one
  component before fixing them in parallel.
- Sweep for other raw `input type="checkbox"` uses that bypass the shared
  `Checkbox` (HB-3) — 88 files use the control, so the exceptions should be few
  and worth fixing together.
- **HB-4 needs a product decision**: hourly-only, or are usage-based services
  sellable as blocks too?
- Continue the sweep across the remaining credit management surfaces.
