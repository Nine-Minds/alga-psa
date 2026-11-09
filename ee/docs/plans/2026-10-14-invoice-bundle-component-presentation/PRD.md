# PRD — Invoice bundle component presentation

- Slug: `invoice-bundle-component-presentation`
- Date: `2026-10-14`
- Status: Draft (revised 2026-10-14: presentation is template-driven)

## Summary

Invoice templates can show each Fixed contract line as a bundle: the bundle row with its title, an optional subtitle and its total, then indented rows listing each service in the line with its quantity and, optionally, its change since the previous billing period (+2, -1). The template decides what the rows show:
- quantities only;
- quantities with component prices;
- nothing (today's single line).

Each client is already assigned an invoice template. An MSP that doesn't want component pricing in front of a particular customer assigns that customer a template that leaves it out. Contracts carry only the bundle's descriptive text: its invoice title and a new subtitle.

The service names, quantities and previous-period quantities behind each bundle are snapshotted when the invoice is generated. Invoice amounts, tax, accounting exports and the REST/MCP invoice API do not change.

## Problem

MSPs sell managed services as bundles: managed IT and security, hosted compute, hosted desktops. They want invoices that show what the client is paying for (how many workstations, servers, users and GB) without exposing a price for each part. Many don't want per-component pricing "floating around" a client's organization, but the client still needs to see that quantities are right. A per-period quantity change answers the client's first question, "why did my bill change?", before it becomes a support ticket.

Alga already bills these bundles correctly. A Fixed line collapses into one invoice charge priced at the line total, and each service's quantity and allocated amount are stored as detail rows behind it. None of that detail reaches invoice templates:
- The invoice read model loads detail rows only for service periods.
- Template data has no component collection.
- The template engine renders exactly one table row per line. Its group and aggregate transforms only work on the invoice lines they are given, so no template can list the services inside a bundle.

A community member tried manually and through the MCP and couldn't get there. Other MSPs asked for the same thing.

## Goals

- Give invoice templates each Fixed bundle's components (service name, quantity, quantity change and, when the template uses them, component prices). This includes lines that mix unit-priced services (seats) with allocated services.
- Extend template item tables with native sub-rows, configured in the invoice designer, so authors choose per table whether to show quantities only, quantities and prices, and quantity changes.
- Keep presentation a template decision, so per-client variation uses the existing per-client template assignment.
- Keep component prices out of client-visible data unless the template that renders the invoice for that client uses them.
- Keep issued invoices stable: components are snapshotted at generation.
- Keep invoice totals, tax, discounts, credits, accounting exports and the REST/MCP invoice API exactly as they are.

## Non-goals

- Per-contract-line display modes or any other presentation switches on contracts. The only contract-side additions are bundle text (title editor and subtitle).
- Changing what existing standard templates render. Bundle sub-rows arrive through a new standard template and the designer.
- Inventory kits and sales-order invoices. Kit components stay separate $0 charges.
- Bundles for non-Fixed lines, for recurring catalog products, or for mid-period quantity adjustment rows ("Mid-period quantity change: X"). These stay separate rows.
- Changing billing calculation, allocation, proration, tax distribution or persisted amounts.
- Rewriting saved custom invoice templates, or backfilling snapshots onto invoices generated before this ships.
- Fixing the pre-existing accounting export gap for serviceless fixed parents (see SCRATCHPAD). This work must not move export onto detail rows.
- Manual reordering of services within a bundle.

## Users and Primary Flows

**MSP billing admin: describe the bundle.**
1. Open a client contract (or contract template), then a Fixed line.
2. Under **Invoice text**, set the title, e.g. "Managed IT and Security Bundle", and the subtitle, e.g. "24x7x365 RMM, SOC monitoring and backup".
3. Save. These apply to invoices generated afterwards.

**MSP billing admin: choose how a client sees bundles.**
1. In Billing → Invoice templates, use the new standard template **Standard Invoice With Bundle Quantities**, or open a template in the designer and turn on **Bundle component rows** for its line items table, choosing **Quantities only** or **Quantities and prices** and whether to show quantity changes.
2. Assign the template to the client (existing client billing setting) or make it the tenant default.
3. Generate and preview the invoice. Bundles show their services and quantities as the template specifies. The emailed PDF matches.

**Client contact: read the invoice.**
1. Open the invoice PDF, or the invoice in the client portal (template view or the invoice details dialog).
2. See each bundle with its services and quantities. A green "+2" or red "−1" marks a change since the last invoice.
3. Ordinary charges, such as a per-device license or project labor, show quantity, rate and amount as usual.

**Template author: custom layout.**
1. In the designer, select an item table and turn on **Bundle component rows**.
2. Pick a preset, then adjust which column shows the component name, quantity, change, unit rate and amount, and which parent cells blank on bundle rows.
3. The canvas previews the rows from the bundle sample. Save and reopen; the configuration is preserved.

## UX / UI Notes

### Rendered invoice (quantities-only preset; matches the community screenshot)

| Description | Qty | Rate | Amount |
| --- | ---: | ---: | ---: |
| **Managed IT and Security Bundle**<br>24x7x365 RMM, SOC monitoring and backup | | | **$6,240.00** |
| &nbsp;&nbsp;• Managed workstations | +2 48 | | |
| &nbsp;&nbsp;• Managed servers | 6 | | |
| &nbsp;&nbsp;• SOC monitored endpoints | +2 54 | | |
| &nbsp;&nbsp;• Microsoft 365 backup users | −1 45 | | |
| Verkada Command license, camera<br>Monthly, per device | 12 | $18.00 | $216.00 |

**Bundle row.** When a table renders component rows for an item, the bundle row shows:
- the title: the line's invoice title, falling back to the contract line name;
- the subtitle as a muted second line, when set;
- the amount.

The preset blanks the Qty and Rate cells on bundle rows. The same table keeps showing qty and rate on ordinary rows.

**Component rows.**
- Indented, with a bullet marker.
- The quantity goes in the Qty column. When the table shows quantity changes, the change precedes it: green "+" for an increase, red "−" for a decrease. Nothing is shown when the quantity is unchanged or there's no previous period.
- **Quantities only:** Rate and Amount cells stay empty.
- **Quantities and prices:**
  - A unit-priced service shows its unit rate and amount.
  - An allocated (bundle-basis) service shows its allocated amount with a blank rate, because a rate derived by division would be misleading.
- Component rows never feed totals.

**Removed service.** A service billed in the previous period but absent now appears with quantity 0 and its negative change, but only in tables that show quantity changes.

**Several periods on one invoice (catch-up billing).** A service whose quantity is the same in every covered period shows one row. If the quantity differs between periods, the service gets one row per period, labelled with the period, and each change compares with the immediately preceding period.

**Templates without component rows.** Bundles render exactly as today: one row, qty 1, rate equal to amount. The subtitle shows only where the template binds it.

### Invoice designer

- Item-shaped tables (`lineItems`, `recurringItems`, `onetimeItems`, `group.items`, `ticketPresentationRows`) get a **Bundle component rows** section in the table inspector:
  - On/off toggle.
  - Preset: **Quantities only** or **Quantities and prices**. A preset fills the cell mapping:
    - Description → component name (with period label when split);
    - Qty → quantity;
    - Rate → unit rate (prices preset only);
    - Amount → amount (prices preset only).
  - **Show quantity changes** checkbox, which adds or removes the change before the quantity.
  - **Blank on bundle rows** column checklist, defaulting to Qty and Rate.
  - Per-column remapping or clearing via the binding picker, scoped to component fields.
- Turning the section on also adds the subtitle as a muted second line under the description column when the column has no lines yet.
- The canvas table preview renders component rows from the active sample. A new sample scenario, "Managed services bundles", mirrors the screenshot: two bundles (one mixing seats and allocated services), a per-device license and a labor line.

### Contract line editor: Invoice text

Fixed lines in the live contract line editor, the contract wizard's Fixed line step and the contract template line editor gain a small **Invoice text** group:
- **Title**: the existing `invoice_line_description`. This is its first mounted editor. Its placeholder is the contract line name.
- **Subtitle**: new, optional, single line.

Both stay editable after the contract has invoices, and changes apply to invoices generated afterwards.

### Client portal invoice details dialog

The dialog follows the client's resolved invoice template:
- If that template renders bundle component rows, bundle rows in the dialog list their components with the same quantity, change and price visibility.
- Otherwise the dialog is unchanged.

## Requirements

### Functional Requirements

**R1. Bundle text on contract lines**
- `contract_lines` gains nullable `invoice_line_subtitle`.
- `contract_template_lines` gains nullable `invoice_line_description` and `invoice_line_subtitle`.
- Template cloning copies both onto the client contract line.
- The live contract line editor, the wizard Fixed line step and the template line editor read and write the title and subtitle for Fixed lines.
- The contract line REST schemas accept and return both fields, and the generated MCP registry reflects them.

**R2. Component snapshot at generation**
- Every consolidated fixed parent gets a versioned snapshot in a new nullable `invoice_charges.bundle_presentation` JSONB column. It is written in the same transaction as the parent and its details, and contains:
  - `version`;
  - `subtitle`;
  - `components[]`, each with:
    - `serviceId`;
    - `name` (`service_catalog.service_name` at generation);
    - `quantity` (the raw configured/revision quantity, not the `|| 1`-clamped detail quantity);
    - `pricingBasis` (`unit` | `bundle`);
    - `order`;
    - `servicePeriodStart`/`End`;
    - `detailItemIds[]`;
    - `previousQuantity` (number or null);
    - `comparison` (`compared` | `no_prior_period`).
- Fixed charge computation carries the raw quantity and `pricing_basis` on each charge. Amounts are unchanged.
- Component order follows `contract_line_service_configuration.created_at`, then service name, deterministically.
- The snapshot holds no amounts. Prices are read from `invoice_charge_fixed_details.allocated_amount` and the detail `rate` only when needed (R4).
- Existing columns and values of parent, detail and fixed-detail rows are unchanged.

**R3. Previous-period quantities**
- The comparison source is the same contract line's invoice detail rows. It uses the latest service period ending on or before this bundle's earliest covered period start, on invoices that are not cancelled and are not this invoice. Detail rows are the only quantity history for allocated services, which are edited in place.
- For each service, sum the quantities within that period. Use that invoice's snapshot quantity when present, otherwise the detail quantity.
- If the line had a prior period but a service has no row in it, that service's previous quantity is 0.
- A service present in the prior period but absent now gets a component with quantity 0 and empty `detailItemIds`.
- If the line has no prior billed period (first invoice, or a new line after renewal), `comparison = no_prior_period`.
- The lookup is one batched query per invoice.
- Regenerating a draft recomputes the snapshot. An issued invoice's snapshot never changes.

**R4. Template data and price inclusion**
- The invoice model loads `bundle_presentation`, plus fixed-detail amounts when requested, behind an explicit opt-in option. REST/MCP invoice item responses are unchanged.
- A pure component builder, shared by the persisted mapper, the draft preview and the designer samples, turns a snapshot into each bundle item's:
  - `subtitle`;
  - `components[]`, each with `name`, `quantity`, `quantityChange`, `periodLabelStart`/`End`, `pricingBasis`, and `unitPrice`/`total` when pricing is included;
  - `hasComponents: true`.
- `quantityChange` is null when the quantity was not compared or is unchanged.
- When pricing is included:
  - `total` is the allocated amount;
  - `unitPrice` is set for unit-basis services only.
- Bundle items keep `quantity` 1 and `unitPrice` equal to total in the data. Blanking on bundle rows is a table setting (R5).
- **Price inclusion rule.** Component `unitPrice`/`total` are included only when the AST that will render the document binds a component price field. Detection uses a shared AST inspection helper, e.g. `templateUsesComponentPricing(ast)`.
  - Every client-visible path resolves the client's template before building data and applies the rule: client portal template view, portal PDF download, the portal details dialog, PDF generation and emailed PDFs.
  - MSP-only authoring paths may always include prices: the designer, its existing-invoice preview and samples.
  - The MSP invoice preview uses the template it renders.
- Every persisted-invoice entry point gets components through the shared mapper: MSP preview and drawer, PDF and emailed PDF, client portal view and download, and the designer existing-invoice preview.
- Components flow through `recurringItems`, `onetimeItems`, `groupsByLocation` and `ticketPresentationRows` canonical rows.
- The draft/recurring preview view model represents each Fixed line as a consolidated bundle item with the line's invoice title and components from the shared builder, matching persisted invoices. The operator-facing AutomaticInvoices preview dialog keeps its current per-service breakdown.
- Items without a snapshot (invoices generated before this ships) map exactly as today.

**R5. Template engine: child rows**
- `dynamic-table` nodes gain optional `childRows`:
  - `sourcePath`, relative to the row binding (e.g. `item.components`);
  - `itemBinding` (e.g. `component`);
  - `cells` keyed by column id, each with a value expression, a format, optional `lines`, and an optional leading `change` value in `signed-number` format;
  - `parentBlankColumns`: column ids whose parent cell renders empty when that row has child rows;
  - optional style.
- The type definitions and the strict AST schema support `childRows`, and so does the designer workspace round trip.
- The React/HTML renderer and the designer canvas table preview render child rows directly under their parent.
  - Child rows are indented with a marker.
  - Unmapped columns render empty.
  - A change of null or 0 renders nothing. Positive and negative changes are signed and toned.
  - A row with a missing or empty source renders no child rows and raises no error.
- Child rows are presentation only. Transforms, aggregates and totals operate on parent rows exactly as before.
- PDF output keeps parent and child rows readable across page breaks, with repeated headers.
- Collection descriptors give `items` a nested `components` descriptor, so binding pickers offer component fields.
- The designer inspector provides the Bundle component rows section described in UX: toggle, preset, quantity-changes checkbox, parent-blank checklist and per-cell remapping.

**R6. Standard template and documentation**
- A migration adds a new standard template, **Standard Invoice With Bundle Quantities** (`standard-bundle-quantities`). It is based on `standard-default`, with:
  - component rows using the Quantities only preset;
  - quantity changes shown;
  - Qty and Rate blanked on bundle rows;
  - the subtitle line under descriptions.
- Existing standard templates and saved custom templates are untouched.
- `docs/billing/invoice_templates.md` documents:
  - the component fields;
  - `childRows`;
  - the presets;
  - the price inclusion rule;
  - snapshot behavior;
  - how to assign the new template per client.

**R7. Client portal invoice details dialog**
- `InvoiceDetailsDialog` resolves the client's invoice template.
- If that template has component rows, the dialog renders component rows under bundle rows with the same quantity, change and price visibility.
- The dialog uses the opt-in loader, the shared builder and the price inclusion rule. Its browser payload carries component prices only when that template binds them.

**R8. Localization**
- New MSP UI strings (designer section, presets, contract "Invoice text") use their existing namespaces in all locale packs and pass locale validation.
- On documents, quantities, signed changes and period labels use the document's effective locale through the shared field formatting.
- Stored snapshots stay language-neutral.

### Non-functional Requirements

- One pure component builder serves persisted invoices, draft previews and designer samples, so they cannot drift.
- Snapshot writes and the previous-period lookup run inside the existing invoice persistence transaction, with one batched lookup per invoice.
- Citus: all new columns are nullable additions to existing distributed tables, and the lookups stay tenant-scoped.

## Data / API / Integrations

| Area | Change |
| --- | --- |
| Migrations | `contract_lines.invoice_line_subtitle`; `contract_template_lines.invoice_line_description` and `invoice_line_subtitle`; `invoice_charges.bundle_presentation` JSONB; new standard template row. |
| `packages/types` | Contract and template line fields; `IInvoiceCharge.bundle_presentation`; `WasmInvoiceLineItem` `subtitle`/`hasComponents`/`components`; `WasmInvoiceBundleComponent`; `dynamic-table.childRows` in `invoice-template-ast.ts`. |
| `compute/computeFixedCharges.ts` | Carry raw quantity and `pricing_basis` on fixed charges. |
| `services/invoiceService.ts` | Build and persist the snapshot, with a batched previous-period lookup, in `persistFixedInvoiceCharges`. |
| `models/invoice.ts` | Opt-in loading of snapshot and fixed-detail amounts. |
| `lib/adapters/invoiceAdapters.ts` + new component builder | Attach components and apply the price inclusion flag. |
| `lib/invoice-template-ast/*` | Schema, evaluator child-row scoping, `templateUsesComponentPricing`, descriptors, react-renderer child rows. |
| `services/pdfGenerationService.ts`, `actions/invoiceQueries.ts`, client portal `client-billing.ts` | Resolve the template before building data and pass the price inclusion flag. |
| `actions/invoiceGeneration.ts` | Preview view model uses consolidated bundles and the shared builder. |
| Invoice designer | Inspector section, canvas child rows, workspace round trip, bundle sample. |
| Contract UI and clone | "Invoice text" in `ContractLines.tsx`, `FixedLineEditor.tsx` and the template line editor; clone in `contractLineRepository.ts`. |
| REST/MCP | `contractLineSchemas.ts` gains title and subtitle. Invoice item endpoints are unchanged. |
| Unchanged | Accounting export selector and adapters, tax distribution, reports, discounts and credits, invoice email body, existing standard templates. |

## Security / Permissions

- Existing permissions apply. Contract line text edits use the existing contract/billing update permission, and template edits use the existing invoice template permission.
- Client-visible invoice data contains component prices only when the client's resolved template binds them (R4).

## Observability

No new observability work.

## Rollout / Migration

- All changes are additive. Existing standard and custom templates render exactly as before.
- Snapshots are written for every Fixed bundle generated after release. A template without component rows ignores them.
- Invoices generated before release have no snapshot. They render as single bundle rows even in templates with component rows. No backfill.
- MSPs opt in by assigning the new standard template, or by enabling component rows in a custom template.

## Open Questions

- Should component rows later be added to the grouped, by-location and by-ticket standard layouts as additional new templates?
- Should a customer-facing service name field replace `service_name` for component names?
- Should operators be able to reorder components within a line?

## Acceptance Criteria (Definition of Done)

- With **Standard Invoice With Bundle Quantities** assigned to a client:
  - the invoice's PDF, MSP preview, client portal view and client portal details dialog show each Fixed bundle's title, subtitle and total;
  - its services are listed with quantities and no component rate or amount, matching the screenshot layout;
  - ordinary charges keep qty, rate and amount.
- A custom template using the **Quantities and prices** preset shows unit rates for unit-priced services and allocated amounts for every service. The component amounts sum to the bundle total.
- A second period with changed quantities shows correct +N/−N changes, including an added service and a removed service at 0. The first period shows no changes, and a cancelled prior invoice is ignored.
- Clients on existing standard or custom templates see no change in invoice output.
- Invoice subtotal, tax, total, accounting export lines and `/api/v1/invoices/{id}/items` responses are unchanged.
- Changing a line's title or subtitle after an invoice is issued doesn't alter that invoice.
- In the client portal, component prices are absent from network payloads unless the client's template binds them.
- Designer component row settings survive save and reopen and render the same on the canvas and in the PDF.
