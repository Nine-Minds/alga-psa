# Saved invoices overtax mixed-taxability fixed bundles: design

Card 2897d0a9 · ticket alga-2026-0002499 (AJATechnologies) · 2026-10-17

## Problem

The invoice preview taxes each member of a fixed bundle using that member's own
taxability and tax region. Saving the invoice recalculates tax from the parent
charge, so a bundle that mixes taxable and non-taxable members is taxed on its
full amount.

| Fixture | Members | Preview tax | Saved tax |
|---|---|---|---|
| S1 (FL 6%) | EUR 225 taxable + 675 non-taxable | 13.50 | 54.00 |
| R (AJA-shaped, custom FMV) | 90 taxable + 810 non-taxable | 5.40 | 54.00 |

## Root cause

All paths are in `packages/billing/src/services/invoiceService.ts` unless noted.

1. `computeFixedCharges` (`packages/billing/src/lib/billing/compute/computeFixedCharges.ts:1035-1058`, `:1102-1109`)
   gets the correct result. Each member `IFixedPriceCharge` carries its own
   `is_taxable`, `tax_region` and `tax_amount`.
2. `persistFixedInvoiceCharges` (`:1271-1335`) groups the members into one
   `invoice_charges` parent. The parent's `is_taxable` is set to
   "any member taxable" (`:1285-1287`, `:1317`), and its `tax_region` comes from
   the first member that has one (`:1282`, `:1313`). The member's
   `tax_amount`/`tax_rate` are written to `invoice_charge_fixed_details`
   (`:1361-1370`), but its taxability and region are **not stored anywhere**.
   That table has no columns for them; see migration
   `20250412214804_add_invoice_item_details_tables.cjs:35-46`.
3. `calculateAndDistributeTax` (`:1645`) runs on every internally taxed save
   and recalculation. It throws away the per-member tax from step 2 and
   rebuilds it:
   - `:1759-1770` fetches fixed details without any tax fields. The comment
     there reads "Tax info … should now be on the parent invoice_item".
   - `:1787` sets `isTaxable = parentItem.is_taxable === true`, so every
     member of a bundle with any taxable member is treated as taxable.
   - `:1795` sets `taxRegion = parentItem.tax_region || client default`, so
     every member is taxed in the parent's single region.
   - The full allocated amounts become the region's taxable base, and tax is
     distributed across every detail. Step 7 (`:1970-1993`) sums the details
     back onto the parent, giving S1 = 900 × 6% = 54.00.
4. The parent's `tax_rate` is right because step 8 keeps the effective rate
   calculated at persist time (`:1307-1309`). Only `tax_amount` is wrong, as
   the card reported.

There is a second latent defect in the same function. Step 6 updates
`tax_amount` only for details that are taxable. A detail that is not taxable
keeps whatever `tax_amount` it already has, and step 7 adds it into the
parent. If the taxability fix is applied without resetting those rows, a
detail that was taxed before the fix stays taxed when the invoice is
recalculated.

## Customer impact (read-only production query, 2026-10-17)

These were `SELECT`s inside `BEGIN TRANSACTION READ ONLY` on the production
Citus coordinator (`stackgres-pgvector/pgvector-coord-0`, db `server`).
Member taxability is derived the same way the engine does it:
`service_catalog.tax_rate_id → tax_rates.region_code`.

- **AJATechnologies has no saved invoices that contain a fixed bundle**
  (no `invoice_charge_fixed_details` rows). AJA is not overtaxed today.
  They are exposed once their custom-FMV bundle invoices.
- **No production invoices are overtaxed.** Eleven tenants have saved fixed
  bundles. Only one saved bundle mixes taxability: one Cross Industries, LLC
  draft dated 2026-02-12. It has 0 tax on its details, because its parent is
  non-taxable (the taxable member was probably made taxable later, or the
  client is exempt). Measured overtax across all tenants is 0 cents.
- **Contract lines that will hit the bug when invoiced:** fixed lines whose
  members mix taxability or regions exist at RightPath Consulting (7),
  CloudVBS (2), Cross Industries (2) and XOGENT (1). This query counts
  template lines too, so it is an upper bound.

The sizing SQL is in the appendix. Re-run it immediately before deploying.

## Approaches

**Chosen: store each member's tax decision on its detail row and use it when the invoice is saved.**
`computeFixedCharges` already decides taxability and region for each member,
and the preview shows that decision. Storing it with the invoice means the
saved total uses the same decision the preview showed. It also stays stable
when a draft is recalculated later, even if the service catalog has changed
since.

**Rejected: look up member taxability from `service_catalog` when the invoice is saved.**
The catalog can change after the invoice is created. Recalculating an old
invoice would then change its tax retroactively. The lookup would also lose
the region fallback chain that `computeFixedCharges` applies
(service → contract-line location → client default).

**Rejected: split mixed bundles into one parent row per taxability.**
That changes the invoice line layout and the preview/PDF contract. The card
explicitly rules this out.

**Rejected: make `calculateAndDistributeTax` reuse the `tax_amount` already stored per detail.**
Recalculation (adding manual items, discount reconciliation, switching tax
source back to internal) has to recalculate tax in each region against the
current invoice. Treating stored tax as final would make bundles the only
charges that never get recalculated.

## Design

### 1. Migration: add member tax columns to the fixed-details table

Create `server/migrations/20261017000000_add_member_tax_to_invoice_charge_fixed_details.cjs`:

```js
table.boolean('is_taxable').nullable();
table.text('tax_region').nullable();
```

- Both columns are nullable, with no default and no backfill. `NULL` means
  "legacy row: no member decision was stored", and those rows keep today's
  behaviour of inheriting from the parent (see §3). Finalized invoices
  therefore never change their tax.
- Adding a nullable column to a Citus-distributed table is a metadata-only
  `ALTER`, so it is safe online.
- `packages/db` tenant metadata needs no change; the table is already
  registered.
- Add both fields to any TypeScript row type for this table. Check
  `packages/types` and the billing interfaces.

### 2. Store the member's decision when the invoice is saved

Edit `persistFixedInvoiceCharges` (`:1361-1370`) so the fixed-detail insert
also writes:

```ts
is_taxable: detail.is_taxable === true,
tax_region: detail.tax_region ?? null,
```

These fields come straight from `computeFixedCharges`
(`computeFixedCharges.ts:1104-1109`, `:881-882`, `:1252`).

Leave the parent's `is_taxable` ("any member taxable") and `tax_region` as
they are. The final pass at `:2012` zeroes tax on non-taxable items, and it
needs the parent's `is_taxable` to stay "any member taxable". The parent
region is still used to pick the region group for the parent's own row.

### 3. Tax each detail from its own stored decision in `calculateAndDistributeTax`

- **`:1761-1768` (fetch details).** Also select `iifd.is_taxable as detail_is_taxable`
  and `iifd.tax_region as detail_tax_region`. Replace the comment that says
  tax info lives on the parent.
- **`:1787` (taxability).** Use
  `const isTaxable = (detail.detail_is_taxable ?? parentItem.is_taxable) === true;`
  A legacy `NULL` falls back to the parent's flag. Combine this with the
  parent check: a parent explicitly marked `is_taxable === false` also forces
  every detail to non-taxable. The final pass already zeroes such a parent,
  and this keeps details and parent consistent.
- **`:1795` (region).** Use
  `detail.detail_tax_region || parentItem.tax_region || clientDefault || ''`.
  Look up the client default region once, before the loop. Today the loop
  awaits `getClientDefaultTaxRegionCode` for every detail.
- **Reset stale tax (the latent defect).** Before step 6, add a
  `{ tax_amount: 0, tax_rate: 0 }` update to `detailUpdates` for every fixed
  detail that did not become a taxable entity. Step 7's sum then includes only
  tax calculated in this pass. This also repairs any draft overtaxed before
  the fix the next time it is recalculated, provided its detail rows carry
  member flags.
- Region grouping (`:1830-1860`) needs no change. Detail entities are already
  grouped by `entity.taxRegion`, and the safety check creates a group for a
  region that only a detail uses.
- Add `// LEVERAGE: friction fixed-bundle-tax-carrier` at the detail loop.
  Fixed bundles are the only charges that `calculateAndDistributeTax` taxes
  through a child table with its own tax rules. A future "taxable line" layer
  shared by preview (`computeFixedCharges`) and saved tax would remove the
  duplication. This card does not build that layer.

### 4. Other callers of `calculateAndDistributeTax`

They all use the corrected function, so none needs its own change:

- `invoiceGeneration.ts:4164` (generate/save)
- `billingEngine.ts:7497` (`recalculateInvoice`)
- `manualInvoiceActions.ts:267`
- `hourBlockActions.ts:259`
- `salesOrderInvoicingActions.ts:349/401`
- `taxSourceActions.ts:255` (switching tax source back to internal)
- `server/src/lib/api/services/InvoiceService.ts:2039`
- `ee/.../invoicingHostApi.ts:135`

How the change affects each kind of caller:

- **Manual, hour-block and sales-order invoices** never create fixed details,
  so their behaviour is unchanged.
- **Recalculating a draft that contains a bundle** (for example after adding a
  manual line) now reproduces the per-member result.
- **External and pending-external tax** return before the internal path, so
  they are unaffected.
- **Credits and discounts are unchanged.** Discounts and credits are still
  left out of the taxable base (`:1868`), as they are today. The only change
  is that non-taxable members are no longer in the base either.
  `recalculatePercentageDiscountInvoiceCharges` works on `net_amount` and
  does not depend on taxability.

## Tests

1. **Integration tests for the saved path** (DB-backed). Add a new
   `describe` block to
   `server/src/test/infrastructure/billing/invoices/billingInvoiceGeneration_tax.test.ts`,
   or create a new file `fixedBundleMixedTaxability.test.ts` next to it, using
   the `fixedPriceAndTimeBasedPlans.test.ts` setup. Create a fixed line with
   two members: one service with a tax rate (6% region) and one without.
   Then:
   - **S1 shape (proportional FMV):** fee 900 split 225/675. Assert
     `previewInvoice` tax, `generateInvoice` saved `invoices.tax`, and the
     parent row's `tax_amount` are all 1350 cents. Assert the non-taxable
     detail's `tax_amount` is 0, and that the detail rows store
     `is_taxable`/`tax_region`.
   - **R shape (custom FMV 90/810):** preview and saved tax are both 540
     cents.
   - **S2 shape (zero catalog / legacy wizard)** and **T shape (zero-FMV
     fallback allocation):** preview tax equals saved tax to the cent.
   - **Recalculation:** after generating, add a manual taxable line through
     `manualInvoiceActions` (or call `recalculateInvoice`). The bundle's
     parent tax is still 1350, and the invoice's tax increases only by the
     manual line's tax.
   - **Repair a stale draft:** seed a detail with stored `is_taxable=false`
     and a stale non-zero `tax_amount`, then recalculate. The detail's tax
     becomes 0 and the parent's sum drops.
   - **Legacy row:** detail rows with `NULL` flags under a taxable parent are
     taxed exactly as before (this guards against regressions in historical
     recalculations).
   - **Mixed regions:** two taxable members in different regions are each
     taxed at their own region's rate, matching the preview.
2. **Fast unit or contract test.** Extend
   `invoiceServiceTenantScoped.contract.test.ts` or the static test. Add an
   assertion that the fixed-details select in `calculateAndDistributeTax`
   includes `iifd.is_taxable`, so the column can't silently drop out of the
   query.
3. **Existing suites that must stay green:** `billingInvoiceGeneration_tax`,
   `_consistency`, `_discounts`, `_subtotal`, `fixedPriceAndTimeBasedPlans`,
   `manualInvoice`, `externalTaxImport.integration`,
   `computeFixedCharges.allocation`, and the billing unit tests.
4. **Smoke test** on the C150b fixtures in tenant Oz: regenerate drafts for
   S1, S2, T and R. Check that saved `invoices.tax` equals the preview tax.
   For R, expect 5.40.

## Implementation order

1. Re-run the appendix sizing SQL against production to confirm the impact
   numbers still hold.
2. Write the migration and add the new fields to the types.
3. Store the member fields in `persistFixedInvoiceCharges`.
4. Update `calculateAndDistributeTax`: per-detail taxability and region, the
   stale-tax reset, and the client default region looked up once.
5. Add the integration tests and unit test, then run the suites listed in
   Tests §3.
6. Smoke-test S1, S2, T and R on the local stack.
7. Data repair: none required. Production shows 0 cents overtaxed. Mention
   this in the PR. If the pre-deploy re-run finds overtaxed **drafts**,
   recalculate them after deploy. Do not touch finalized invoices; any
   correction there is a credit or adjustment the customer decides on.

## Deliberately not done

- **No change to the preview, the PDF, or line layout.** The bundle is still
  one parent line.
- **No backfill of member flags on existing rows,** because the only source
  would be today's catalog, which is retroactive. Legacy rows keep inheriting
  from the parent.
- **No change to how the parent row is aggregated** (`is_taxable` = any
  member taxable, first member region).
- **Rounding parity for regions with several entities is not addressed.**
  The preview rounds each member separately. The saved path rounds the
  regional total once and spreads the remainder. Today both are exact for
  S1, S2, T and R. A one-cent difference is possible when several taxable
  entities share a region. That behaviour already applies to every charge
  type and is out of scope.
- **Billing-profile tax exemption is not fixed here.** This looks like a
  sibling bug, not yet verified. `computeFixedCharges` and the other compute
  functions zero tax when `isTaxExemptForProfile` is true, but
  `calculateAndDistributeTax` and `TaxService.calculateTax` only check
  `clients.is_tax_exempt`. Saved invoices for a tax-exempt billing profile
  may therefore be taxed while the preview shows 0. This design does not
  make it worse: it stores the same service taxability the parent already
  used. Recommend a separate card to verify and fix it.
- **The shared "taxable line" layer is not extracted.** It is recorded as a
  `LEVERAGE` marker instead.

## Risks

- **The stale-tax reset changes recalculation results for any existing draft
  whose detail rows are inconsistent.** That is the intended repair, and
  production has none affected today.
- **The migration has to land before code that writes the new columns.**
  The migration and the code ship in the same PR, and migrations run first
  in the deploy, so the order holds.
- **Some tests or code may build `invoice_charge_fixed_details` rows with
  hand-written inserts.** The new columns are nullable, so those inserts keep
  working, and those rows get legacy (inherit-from-parent) behaviour.

## Appendix: impact-sizing SQL

Run against production inside `BEGIN TRANSACTION READ ONLY`.

```sql
with d as (
  select ic.tenant, ic.invoice_id, ic.item_id, iid.service_id, ifd.tax_amount detail_tax,
         (tr.region_code is not null) svc_taxable, tr.region_code svc_region
  from invoice_charges ic
  join invoice_charge_details iid on iid.tenant=ic.tenant and iid.item_id=ic.item_id
  join invoice_charge_fixed_details ifd on ifd.tenant=iid.tenant and ifd.item_detail_id=iid.item_detail_id
  left join service_catalog sc on sc.tenant=iid.tenant and sc.service_id=iid.service_id
  left join tax_rates tr on tr.tenant=sc.tenant and tr.tax_rate_id=sc.tax_rate_id
), p as (
  select tenant, invoice_id, item_id, bool_or(svc_taxable) a, bool_or(not svc_taxable) b,
         count(distinct svc_region) r,
         sum(case when not svc_taxable then detail_tax else 0 end) overtax_cents
  from d group by 1,2,3
)
select t.client_name, i.status, count(distinct p.invoice_id) invoices, count(*) bundles, sum(overtax_cents)
from p join invoices i on i.tenant=p.tenant and i.invoice_id=p.invoice_id
join tenants t on t.tenant=p.tenant
where (a and b) or r>1 group by 1,2;
```
