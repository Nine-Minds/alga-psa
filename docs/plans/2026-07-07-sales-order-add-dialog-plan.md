# Add Sales Order dialog — adversarial redesign plan

**Date:** 2026-07-07
**Branch:** `feature/sales-order-inventory-design`
**Screen:** "Add Sales Order" dialog — the create form inside
`packages/inventory/src/components/SalesOrdersManager.tsx`
**Backing action:** `createSalesOrder` in `packages/inventory/src/actions/salesOrderActions.ts`

## Why

An adversarial design pass (six critic lenses: voice, pixel, concept/IA, intent, gap,
low-effort) found the dialog was built in isolation from machinery Alga already ships. It is
simultaneously **too careless** (product chosen by hand-typed UUID, currency free-typed and
hardcoded `USD`, a `×100` cents assumption that is wrong for JPY) and **too thin** (it hides
capability the `createSalesOrder` action already accepts: expected ship date, client PO number,
notes, and — most costly — per-line `fulfillment_type`, whose omission makes the entire
downstream drop-ship workflow unreachable).

Every change below is **backed** — it adopts an existing component, action, or field, not new
backend. The mandate is two-sided: nothing unearned stays, nothing essential is missing.

## The screen's job

Create a sales order: pick the client, add priced line items (services/products), set how it
invoices and allocates stock, save. One task.

## Reuse artifacts (all confirmed to exist)

- **`ServicePicker`** — `packages/billing/src/components/billing-dashboard/contracts/ServicePicker.tsx`.
  Searchable `SearchableSelect` over `{value,label}`. Already used by contracts/quotes.
- **`getServices`** — `packages/billing/src/actions/serviceActions.ts:198` → `PaginatedServicesResponse`.
  Each service carries `service_id`, `service_name`, `sku`, `item_kind` (`'service' | 'product' | …`),
  `default_rate` (**stored in cents**), `billing_method`. Reference auto-fill pattern:
  `ServiceSelectionDialog.tsx:297` and `ManualInvoices.tsx:680` (`rate ?? service.default_rate`, ÷100).
- **Client-derived currency** — the dominant billing-UI pattern is `selectedClient?.default_currency_code
  || 'USD'` read client-side (`ContractDialog.tsx:384`, `ManualInvoices.tsx:670`, `ContractWizard.tsx:322`).
  `IClient.default_currency_code` is already present on the `clients` prop.
  (`resolveClientBillingCurrency` in `packages/billing/src/actions/billingCurrencyActions.ts` is the
  more-authoritative server resolver — it also inspects active contracts — but the UI convention here
  is the client-side read; use that for consistency.)
- **Currency-aware money** — `formatCurrency(minorUnits, currencyCode)` in
  `packages/core/src/lib/formatters.ts` derives fraction digits from the currency via
  `Intl.NumberFormat`. Use the same `Intl` approach for both display and the dollars→minor-units
  conversion, replacing the hardcoded `×100`.

## Scope (approved)

Full three tiers. Include the per-line drop-ship control. Keep invoice + allocation modes with
helper text, grouped. Add client PO number, notes, and expected ship date.

---

## Tier 1 — Wire into existing machinery (correctness)

### T1.1 Service picker replaces the UUID text box
- **File:** `SalesOrdersManager.tsx` (line-item Service cell, ~`:485-491`) and the page server
  component `server/src/app/msp/inventory/sales-orders/page.tsx`.
- The page already fetches `getAllClients()` + `listStockLocations()` and passes them as props.
  Add `getServices(1, 999, { item_kind: 'any' })` beside them (products **and** services can be
  sold), pass a `services` prop down, guarded in its own try/catch like the others.
- In the component, map services to `{ value: service_id, label: sku ? `${service_name} (${sku})`
  : service_name }` and render `<ServicePicker options={serviceOptions} value={line.service_id}
  onChange={(v) => onServicePicked(idx, v)} />`.
- This alone eliminates the "line pointing at nothing" hazard: a picker can only yield real
  `service_id`s. No separate existence check needed once the free-text box is gone.

### T1.2 Auto-fill unit price from the picked service
- On service pick (`onServicePicked`), set that line's `unit_price` from the service's
  `default_rate` (cents → dollars: `default_rate / 100`), leaving it editable for negotiated
  overrides. Mirrors `ServiceSelectionDialog` / `ManualInvoices`.
- Removes the `unit_price: '0'` default's ambiguity ("forgot to price" vs "genuinely free").

### T1.3 Currency derived from client, rendered read-only (never free text)
- Remove the free-text `<Input id="sales-order-currency-code">` (~`:450-456`) and the
  `currency_code: 'USD'` seed in `emptyForm()`.
- On client select (extend `ClientPicker.onSelect`, currently only sets `client_id`), set
  `currency_code = pickedClient?.default_currency_code || 'USD'` from the `clients` prop.
- Render currency as a **read-only** derived display (label "Currency", value = resolved code),
  grouped with the client. Currency is a property of who you bill, not a per-order choice.
- Keep the server guard as-is; the UI now always sends a real client-derived code.

### T1.4 Currency-aware money math (fixes JPY correctness bug)
- Replace `Math.round(Number(unit_price) * 100)` in `save()` (~`:235`) with an `Intl`-derived
  minor-unit conversion keyed to `form.currency_code` (fraction digits from
  `Intl.NumberFormat(undefined,{style:'currency',currency}).resolvedOptions().maximumFractionDigits`,
  matching `formatCurrency`). For JPY (0 digits) the multiplier is ×1, for 3-decimal currencies ×1000.
- Replace the hardcoded `'Unit Price ($)'` label (~`:503`); show the resolved currency (code or
  symbol) instead of a literal `$`.

---

## Tier 2 — Surface backed capability the dialog hides (gaps)

### T2.1 Per-line fulfillment type — unlocks the dead drop-ship workflow
- The action accepts per-line `fulfillment_type` (`'from_stock' | 'drop_ship'`, defaults
  `from_stock`). No line can currently be *born* drop-ship (create omits it; `SalesOrderDetail`
  has no line add/edit), so the shipped drop-ship apparatus (badge, vendor-shipment dialog with
  serial/MAC capture, `confirmDropShipAndInvoice`) is unreachable.
- Add a compact per-line `<CustomSelect>` `From stock | Drop-ship` (mirror the existing
  invoice/allocation select pattern), sent as each line's `fulfillment_type`.

### T2.2 Header fields — client PO number, notes, expected ship date
- All three are already accepted by `createSalesOrder`. Add and wire into the create payload:
  - `client_po_number` — one `<Input>` ("Client PO number").
  - `notes` — one `<TextArea>` ("Notes").
  - `expected_ship_date` — one date field ("Expected ship date"); optional.
- `order_date` stays server-defaulted (`now()`); not surfaced.

### T2.3 Running order total
- Show a right-aligned "Total" above the Cancel/Save row: `Σ quantity × unit_price`, formatted
  with `formatCurrency` in the resolved currency. Pure client-side arithmetic.

### T2.4 Inline validation instead of vanishing toasts
- Disable Save until: a client is selected **and** ≥1 line has a picked service with quantity > 0.
- Mark the specific invalid field/line inline (empty service, qty ≤ 0) rather than only firing a
  transient `toast.error` on click. The predicates already exist in `save()`; render them as state.

---

## Tier 3 — Layout & voice craft

### T3.1 Line-items table hygiene
- Render column headers (**Service / Fulfillment / Qty / Unit price**) **once** above the list,
  not repeated per line.
- Make Remove an **icon-only** button (trash icon, `aria-label`), freeing its column width.
- Right-align and currency-format the price cell.
- Wrap the line list in a max-height scroll region so the footer (Cancel/Save) stays reachable at
  ~15 lines.
- Rebalance the column split so Service gets the most room and Qty is not over-wide.

### T3.2 Grouping, ordering, and voice
- Reorder the dialog to **Client (+ derived Currency) → Items → "Billing & allocation"**.
- Group invoice mode + allocation mode in a "Billing & allocation" section beneath the items
  (kept per approval, not hidden), with **helper text** under allocation explaining the
  consequence (e.g. "Soft = reserve stock, still visible to other orders; Hard = hold stock
  exclusively"). Relabel "…mode" wording to operator-plain.
- Relabel schema-speak: "Service ID" → "Service", "Currency code" → "Currency", "Lines" → "Items".
- All new/changed strings go through `t('key', 'Default English')` in the `features/inventory`
  namespace, with matching keys added to `server/public/locales/en/features/inventory.json` (and
  the other locale files as the repo convention requires).

---

## Deliberate declines (not in this pass)

- **`ship_to`** — a free-form address object with no client-address picker to reuse. Real gap for
  physical shipments, but wiring it well needs an address source out of scope. Propose separately.
- **Per-line `tax_rate_id`** — accepted by the action but no tax-rate list is passed to this
  component, and tax is plausibly resolved at invoice generation. Defer.
- **`order_date`** — server defaults to `now()`; back-dating is an edge case. Leave out.
- **Per-line `currency_code`** — the action models it but validates it must equal the header
  currency (a fake degree of freedom). Keep it **out of the UI permanently**. Optional follow-up:
  drop it from the create contract so the model stops implying a choice the domain forbids.

## Testing / verification

- Type check the touched packages (`inventory`, and `server` for the page).
- Update the nearest contract/unit tests that assert the create payload or dialog shape (search
  `SalesOrdersManager`, `createSalesOrder`, and inventory i18n key tests — the i18n key test will
  fail if new default strings lack locale entries).
- Verify live (SSR/server-driven — reload, not hot-reload): open the dialog, pick a client and
  confirm currency auto-derives read-only; pick a service and confirm price auto-fills; set a line
  to Drop-ship; confirm the running total; confirm Save is disabled until valid; save and confirm
  the SO persists with PO number, notes, ship date, and the drop-ship line reaching its downstream
  vendor-shipment flow.
- Each change lands as its own verified, individually-committed iteration.

## Out of scope / structural proposals (surface, don't build here)

- `SalesOrderDetail` gaining line add/edit (a second path to born-drop-ship lines).
- A shared client-address picker to make `ship_to` fillable.
- Dropping per-line `currency_code` from the `createSalesOrder` contract.
