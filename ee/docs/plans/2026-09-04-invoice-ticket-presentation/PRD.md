# PRD — Invoice ticket presentation and designer integration

- Slug: `invoice-ticket-presentation`
- Date: 2026-09-04
- Status: Local draft implemented; verification and remaining acceptance matrix in evidence/README.md
- Related work: alga0002322; [merged predecessor PR #3314](https://github.com/Nine-Minds/alga-psa/pull/3314), revision `45d8f81f875322342923a00bc81c4bd2cf4c40e7`

## Summary

The standard by-ticket invoice will use one primary charge table. Eligible billed time will appear once per ticket, project task, or ticketless group. Other charges will remain individual rows. Immutable coverage checks will determine which original time-charge rows can be replaced. The invoice's stored financial totals and accounting records remain authoritative.

New time snapshots will distinguish uniform, mixed, and unavailable rate information. The designer will resolve source collections and transformed collections through shared metadata and the existing evaluator. Entry detail remains an explicit custom-layout choice. Document labels will use the recipient's document locale, including rate states and fallback text.

## Problem

The current `standard-invoice-by-ticket` renders all original charges and then renders ticket rollups containing the same time amounts. Totals are calculated once, but readers see two presentations of the same charges. The template catalog also describes an obsolete per-entry layout.

Version-1 time snapshots store one base rate per entry. The compute path supports overtime within an entry, so a two-hour entry can correctly cost $375 while the renderer incorrectly claims a uniform $150 hourly rate. Comparing base rates between entries cannot detect this case.

The table inspector chooses ticket/time presets by exact binding ID. Canvas collection resolution maintains a separate fixed map and substitutes invoice items for unknown bindings. A transformed billed-time collection can therefore lose its authoring fields or display unrelated rows.

Existing rendering evidence used seeded snapshots. It does not establish that production billing generates and persists the necessary detail, or that every charge appears exactly once on the entire default invoice.

## Goals

- Give invoice recipients one primary row per ticket in the fully snapshotted usual case, plus every other charge once.
- Preserve exact minor-unit amounts, tax, discounts, credits, export descriptions, and immutable source metadata.
- Show honest rate information for mixed rates within and between entries, and for historical data with insufficient evidence.
- Make billed-time authoring work from source selection through transforms, canvas, full preview, save/reopen, and PDF.
- Provide localized optional-detail instructions and portal guidance supported by actual client-visible screens.

## Non-goals

- Recalculate billing, change overtime/minimum/rounding rules, regroup accounting records, or change accounting mappings and descriptions.
- Backfill historical snapshots from current tickets, time entries, contracts, or rates.
- Automatically select the by-ticket template for all clients or silently convert saved custom layouts.
- Build a new client-portal time ledger, support arbitrary new transform operations, or redesign other document editors.
- Send customer messages, change the source support ticket, or advance/approve/merge the workflow as part of this design assignment.

## Users and Primary Flows

1. A billing operator approves time for multiple tickets and generates an invoice using the supported billing action. Selecting the standard by-ticket layout produces a single charge presentation and the usual financial totals.
2. A recipient reads ticket number/title, customer-visible description, hours, rate state, and amount. Non-time charges and adjustments appear once in the same table.
3. A layout author opens an existing custom invoice layout, selects billed-time data, adds appropriate columns, applies a sort or filter, binds its output, saves, and reopens. Canvas, full preview, and PDF resolve the same rows.
4. A recipient who needs more information can review client-visible ticket updates in the portal where access is available, or request a printed entry breakdown. The document makes no promise of an invoice-specific rate ledger in the portal.

## UX / UI Notes

### Primary charge table

Use a new renderer-only collection, provisionally `ticketPresentationRows`, for the standard by-ticket table. Keep the established `items`/`lineItems`, `ticketGroups`, and `timeEntries` bindings available for existing templates and explicit supporting detail.

Columns are **Ticket / Work item | Description | Qty / Hours | Rate | Amount**. Time rows show billed hours; other charges retain their original quantity and unit. The work-item cell is blank for ordinary charges. Ticket labels combine the immutable ticket number and title. The description cell contains only eligible customer-visible snapshot content. The table must wrap long titles/descriptions and repeated headers must remain readable across PDF pages.

Illustrative primary rows, before tax or adjustments:

| Ticket / Work item | Description | Qty / Hours | Rate | Amount |
| --- | --- | ---: | --- | ---: |
| Ticket A | Customer-visible work description | 2 h | Mixed rates | $375.00 |
| Ticket B | Customer-visible work description | 1 h | $150.00 | $150.00 |
| | Non-time service | 1 | $50.00 | $50.00 |

This example has a $575.00 charge subtotal. It contains no second service-charge table or billed-time summary table. The financial totals block uses stored invoice amounts.

### Optional supporting detail

Keep **Billed Time by Ticket** (`ticketGroups`) and **Billed Time Entries** (`timeEntries`) as explicit authoring sources. Add **Charges by Ticket** for the complete primary presentation. Explain that the first two are detail collections and may be incomplete on older invoices; they are not a complete charge ledger.

A custom layout may add a separately titled **Billed-time detail — included in the charges above** section with entry dates, work-item label, hours, honest rate state, and amount. A nested `entries` table is also supported. Supporting amounts are informational and must not feed totals. Existing custom layouts that already contain both original items and detail retain that authored structure. New instructions must explain how to replace the primary table or deliberately add supporting detail.

When some time charges cannot be rolled up, display a localized note: **Some billed time is shown as service charges because ticket detail is unavailable.** With no usable detail, use **Ticket detail is unavailable. All charges are shown below.** Suppress both notes for an invoice containing only non-time charges.

## Requirements

### R1. Charge coverage and replacement

Build the presentation from canonical invoice charges and their immutable link/snapshot metadata, before layout transforms. This is a renderer projection and must never mutate `items`, accounting descriptions, or stored amounts.

Replacement is atomic at the owning invoice-charge level. A charge is eligible only when:

1. It is positively identified as time-only from immutable charge/link provenance. A service ID, positive duration, or the existence of one snapshot is insufficient.
2. Every persisted time-entry link owned by the charge has a supported, valid snapshot. Preserve link identity and expected link count, including null or invalid snapshots, in the read model. Current reads discard null snapshots and must change for this renderer metadata.
3. Links are unique, belong to the same invoice/tenant and owning charge, and every source contribution can be assigned exactly once. Preserve `(item_id, entry_id)` identity; do not deduplicate globally by entry ID or ticket number.
4. Integer snapshot net amounts sum exactly to the owning charge's canonical net contribution to the primary table. Do not use a floating-point tolerance or rounded display hours to prove money coverage.
5. No unaccounted non-time component, inline adjustment, cap write-down, or other amount discrepancy remains in that charge.

For an eligible charge, replace all of its amount contributions with work-item rows. Several eligible charges for the same ticket merge into one row, including charges for different services or rates. One eligible charge spanning several tickets can contribute to several rollup rows; its contribution amounts still partition the original charge exactly. Keep contributing charge/link IDs in renderer metadata for reconciliation, outside the printed columns.

For an ineligible charge, emit the complete original charge once and emit none of its snapshots in the primary rollup. Never display a guessed residual amount. Do not discard a valid zero-value charge or a negative adjustment. Known duplicate/conflicting attribution makes every affected charge ineligible. If the projection as a whole cannot establish a partition, use the canonical charge presentation for the whole invoice with unavailable time-rate cells.

Required invariants, checked against persisted charges rather than a handcrafted expected row array:

- Each canonical charge is either retained once or fully partitioned among replacement rows, never both.
- Replacement contribution amounts for each removed charge equal its canonical net amount exactly.
- The sum of primary row net amounts equals the sum of canonical charge net amounts.
- Invoice-level subtotal, tax, discount/credit treatment, total, and balance remain the canonical values from the existing pipeline. Presentation rows are not an alternative accounting input.

### R2. Fallbacks, mixed services, and financial treatments

| Condition | Primary presentation |
| --- | --- |
| All eligible time charges for one ticket | One ticket row across entries and services; service names remain available in optional detail. |
| No snapshots on a legacy invoice | Every original charge once; no speculative ticket rows; no uniform rate claim for time with unknown rate evidence. |
| Some charges have complete snapshots | Roll up eligible charges and retain all other charges once. |
| A charge has only some valid snapshots | Retain that whole charge; omit all its contributions from primary rollups. Optional detail is explicitly incomplete. |
| Supported version-1 snapshots with complete amount coverage | Rollup is allowed, but rate evidence is unavailable as specified in R3. |
| Unknown snapshot version, malformed values, duplicate links, or amount mismatch | Retain affected charges once; never coerce invalid money or duration into zero. |
| Project/task time | Group by immutable task identity, show the snapshotted task name; distinct tasks with identical names remain distinct. No fabricated ticket number. |
| Ticketless time | One deterministic Other billed time group for eligible contributions within the invoice; retained fallback charges remain separate. |
| Missing title or ticket number | Use remaining immutable label fields, then a localized work-type fallback. Never join current source records. |
| Products, fixed fees, usage, expenses, prepaid/hour-block information, or mixed time/non-time charges | Retain their existing rows. A time-entry link alone does not make these time-rollup candidates. |
| Separate line discount, adjustment, or credit | Retain the signed canonical row once. Preserve its original association for accounting; do not apportion it again across ticket rows. |
| Inline adjustment, bucket treatment, or project cap makes snapshot amount differ from charge | Retain the complete canonical charge. Do not invent a ticket-level allocation or implied discounted hourly rate. |
| Applied account credit, payment, invoice discount, or balance adjustment already handled in totals | Keep the established totals/balance treatment. Do not create a second charge row for it. |
| Different tax rates across time charges on one ticket | Sum net contributions for the ticket; retain authoritative tax calculation and breakdown. Do not show one invented tax rate for the rollup. |

Use existing deterministic work-item ordering: tickets by number/title/identity, then tasks, then ticketless time. Follow with retained charges in their original relative order. On a full fallback, retain original charge ordering. Preserve service-period information on retained rows.

### R3. Immutable rate semantics

Introduce a discriminated version-2 snapshot while continuing to read version 1. Retain provenance, date, billed minutes, net amount, and service metadata. Preserve any compatibility base-rate field as historical data; it is not proof of a uniform effective rate.

Version 2 records a semantic `rateKind` of `uniform`, `mixed`, or `unknown`, plus nullable `uniformRate` in minor units per hour. The minimum required immutable evidence is this explicit state captured by the actual calculator. Explicit rate-component tables are not required for this follow-up. Document that entry detail can still say Mixed rates within one entry.

- Compute the state from the rate-bearing segments actually used for a positive billed duration. Overtime with positive regular and overtime durations and different effective rates is mixed. Equal base/overtime rates remain uniform. Do not compare currency-formatted or rounded rates; preserve the calculator's supported precision when determining distinctness.
- Capture the state in both contract-line and unresolved/catalog generation paths. Minimum duration, rounding, per-entry/user-type overrides, phase rates, and overtime retain their existing arithmetic.
- Known mixed evidence survives grouping even if other entries have unknown evidence. With no known mixed entry, different proven uniform rates produce mixed; otherwise any unknown entry produces unknown. Only all-known, equal uniform rates produce a uniform ticket rate.
- All version-1 snapshots are conservatively unknown for rate presentation. Even `amount = hours × stored rate` is not proof of historical uniformity. Do not consult live contracts or infer components by dividing amount by hours.
- A within-generation adjustment that breaks the relation between billed duration, known rates, and net amount invalidates a uniform display claim. Preserve known mixed evidence where valid; otherwise show unknown. Charge/snapshot amount mismatch also invokes R2 fallback.
- An unknown or zero-duration rate basis must not fabricate $0/hour. A positively proven zero rate with positive duration may display zero normally.

For 60 minutes at 15000 plus 60 minutes at 22500, persist 120 billed minutes and 37500 net minor units with `rateKind=mixed`, `uniformRate=null`. Both entry and ticket presentations must say Mixed rates. They must never present $150 or the $187.50 average as a uniform rate.

Renderer models expose a nullable numeric rate and `rateKind`. Preserve `rateDisplay` as a compatibility binding derived at the localization boundary: numeric minor units only for a proven uniform rate, otherwise the translated state label. Correct existing time-detail `rate` bindings to return null for mixed/unknown values; old templates may show a blank cell rather than a false rate. New presets use the honest display binding. Historical fallback time-charge Rate cells in the by-ticket presentation also use unknown unless immutable evidence proves uniformity. Ordinary canonical/custom item bindings remain unchanged.

### R4. Shared collection metadata and resolution

Extend the existing document binding/catalog layer with collection descriptors containing document kind, binding ID/path, row fields and types, nested collections, localized authoring labels, and preset definitions. Keep metadata in a shared browser-safe module; runtime code must not import React inspector components.

The invoice descriptors cover canonical items, ticket/time detail, and the new primary presentation. Preserve existing invoice aliases and quote/sales-order bindings. The table source picker, Add column controls, field suggestions, and Transforms workspace consume the same descriptors.

Use `evaluateTemplateAst` and its evaluated binding map to resolve actual source and transform output rows in canvas. Pass the current AST, preview model, document kind, and row scope where relevant. Remove the blanket unknown-ID-to-items fallback. An explicit binding alias resolves normally; a missing binding, non-array result, or invalid transform yields empty/error state and a designer diagnostic, never unrelated items. Valid empty collections receive an ordinary empty state. Preserve the historical default only when a legacy workspace has no explicit source, by normalizing it to its document's canonical item source during import.

Derive transform output fields from operation semantics:

- Sort/filter preserve source fields, types, and relevant presets, even when the selected sample has zero rows.
- Group operations expose actual group keys, aggregates, and nested entries produced by the existing evaluator. Do not offer original entry fields on the group wrapper; offer them in the nested row scope.
- Aggregate operations expose their declared output fields without inventing ticket fields or monetary types from names alone. Unsupported output shape disables unsuitable presets and explains why.

Keep transform IDs, source/output bindings, columns, and nested scopes in the saved AST/workspace roundtrip. No transient UI-only schema may be required to reopen a layout. Do not change transform financial semantics or recalculate invoice totals from a filtered table. The acceptance UI journey uses a sort to preserve the complete charge set; separate filter/group tests verify the intended subset or shape.

### R5. Document localization and portal guidance

Use the existing `documents` translation namespace, `i18nLabels.ts`, document locale resolution, and shared field formatting. Localize Mixed rates, Rate unavailable, work-type fallbacks, coverage notes, optional-detail labels, and portal guidance. Keep authoring labels in the existing MSP designer namespace. At least English and French must be verified with a real locale pack; follow repository locale validation for added keys.

Keep stored snapshots and raw evaluator data language-neutral. Add a pure presentation-localization step for derived time/presentation fields, supplied with the same translator and effective locale used for AST labels. Reuse it for canvas, full preview, and PDF; it must handle nested/transformed rows using semantic markers. Do not search-and-replace arbitrary strings or translate snapshotted customer descriptions. Currency, number, and date formatting use the effective document locale, including the established locale-load fallback.

Source inspection finds ticket updates/comments/documents in the client ticket view and canonical invoice lines in the invoice dialog. It does not establish a client-visible, invoice-specific billed-entry/rate ledger. The default billing instruction is **Contact your service provider for a billed-time breakdown.** An optional portal note may say **View ticket updates in your client portal** only where client access is available and live verification supports the route. Do not add unconditional links or promise entry-level rates. No portal implementation is in scope.

Update `docs/billing/invoice_templates.md`, its template catalog, and relevant standard-template/designer help copy together. Explain the complete primary source, optional supporting sources, version-1 unknown-rate behavior, within-entry mixed rates, and conservative legacy/partial fallback.

## Data / API / Integrations

| Area | Design change |
| --- | --- |
| `packages/types/src/interfaces/billing.interfaces.ts` | Versioned snapshot union and rate evidence; version 1 remains readable. |
| `packages/types/src/interfaces/invoice.interfaces.ts` and renderer model types | Renderer-only coverage metadata, semantic rate fields, primary presentation rows and contribution references. |
| `packages/billing/src/lib/billing/compute/computeTimeBasedCharges.ts` | Capture rate state from existing regular/overtime computation without changing arithmetic. |
| `packages/billing/src/lib/billing/billingEngine.ts` | Uniform evidence for unresolved/catalog time; audit downstream amount adjustments and prevent stale uniform claims. |
| `packages/billing/src/services/invoiceService.ts` | Preserve version-2 snapshots through the existing transactional link/write path. Keep marking entries invoiced and inserting snapshots atomic. |
| `packages/billing/src/models/invoice.ts` | Retain all immutable time-entry links for coverage, validate known snapshot versions, and distinguish unavailable detail from absent time. |
| `packages/billing/src/actions/invoiceGeneration.ts` | Supply equivalent contribution/coverage information for production generation and recurring previews; previews must not pretend synthetic IDs prove persisted coverage. |
| `packages/billing/src/lib/adapters/invoiceAdapters.ts` | Build shared deterministic time collections and conservative primary charge projection. Keep canonical items untouched. |
| `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts` | Replace the by-ticket layout's two charge presentations with one primary collection; keep established totals. |
| Designer `fields`, `inspector/widgets/TableEditorWidget.tsx`, `transforms`, `preview/previewBindings.ts`, and AST/workspace roundtrip | Shared descriptors and evaluated row resolution, transform field derivation, visible binding errors. |
| `i18nLabels.ts`, `fieldFormatting.ts`, server render, and PDF locale entry points | Share locale/translator context with derived presentation labels, including canvas. |

The existing nullable JSONB `invoice_time_entries.work_item_snapshot` can carry version 2 without a schema migration. Use existing tenant-scoped queries; no new customer-facing API is required. If immutable time-only provenance cannot be proved from current charge/link records, fail closed to original rows and document the exact missing evidence before extending persistence. Do not reconstruct it from live source records.

## Security / Permissions

Preserve authenticated generation and client/tenant isolation. Snapshot only fields already approved for invoice presentation. Exclude internal comments, internal time-entry notes, staff-only descriptions, and unrelated tenants from raw renderer collections as well as printed output. Designer field discoverability must not bypass that allowlist. Contribution IDs remain internal renderer metadata.

## Rollout / Migration

This is a standalone branch from current main. New generation writes version 2; existing snapshots remain untouched. The built-in by-ticket layout changes when selected. Saved custom ASTs are not rewritten, including copies of the former built-in layout; authors explicitly opt into the new primary source. Other standard templates, location grouping, quotes, and sales orders retain their current behavior.

Keep the old detail binding IDs compatible. Their misleading time-rate values may become null or localized unavailable states; geometry, source choice, and financial values remain authored. Archived PDFs remain archived. Regenerating a PDF from a built-in layout may use the corrected layout, while invoice charge data and snapshots remain immutable. Snapshot immutability guarantees frozen billed content, not byte-identical PDF files across renderer versions.

## Implementation Sequence

1. Add versioned rate evidence and immutable coverage metadata; test existing calculator/persistence paths and conservative readers.
2. Build the pure charge projection and primary layout; verify contribution coverage and unchanged financial/export outputs.
3. Share collection descriptors and evaluated binding resolution across authoring, transforms, and canvas; preserve roundtrip compatibility.
4. Localize derived presentation values and update template/help documentation.
5. Run the DB-backed and live source-to-billing-to-PDF acceptance journeys, collect evidence, and close the checklist only against observed behavior.

## Risks and Open Questions

- Project cap processing can change `charge.total` after snapshot construction. The safe design is charge fallback and an unavailable rate claim when evidence no longer describes the billed amount; extending adjustment allocation is outside scope.
- Snapshot net amounts may be insufficient to establish coverage on some aggregated charge paths. Inspect actual persisted provenance before eligibility is granted. Equality of money alone cannot prove completeness.
- Shared designer code serves quotes and sales orders. Source normalization must use document-kind descriptors, with explicit compatibility checks.
- Grouped transform schemas differ from entry schemas. A copied preset list is not a valid substitute for the evaluator's output contract.
- Live portal route/access behavior is still unverified. Until it is verified, ship the service-provider breakdown instruction and omit the optional portal note. This does not block the billing presentation design.
- No product decision remains open for this plan. The items above are implementation investigations and verification obligations with conservative defaults.

## Acceptance Criteria (Definition of Done)

1. **Production generation and complete representation:** Create source fixtures with several approved entries for at least two tickets and a non-time charge. Execute the supported authenticated generation action, with real compute, invoice persistence, read adaptation, and PDF generation. Assert one usual-case row per ticket plus the non-time charge, and reconcile the complete primary presentation to persisted charge contributions exactly once.
2. **Rate correctness:** Include the 1h/$150 + 1h/$225 overtime entry, mixed rates between entries, a uniform-rate control, equal overtime rates, and minimum/rounded duration. Assert final persisted rate state and rendered values, not only metadata presence.
3. **Financial preservation:** Exercise actual supported tax, separate line discounts/credits, and applied account-credit/balance treatment. Compare canonical stored totals and accounting export payload descriptions/mappings before and after presentation. No assertion may rely solely on the table subtotal.
4. **Immutable rendering:** Capture generated snapshots and semantic PDF content, then edit source ticket title/description and permitted source time fields. Reload the invoice and regenerate the PDF in a fresh read path. Billed content and amounts remain unchanged. Fixture-only source mutation, if application rules prohibit editing invoiced fields, must be disclosed.
5. **Database guard:** Against migrated schema, verify a failed duplicate/already-invoiced source guard leaves no partial invoice-time linkage or snapshot writes. Verify tenant scoping through the real reader. No mock persistence satisfies this criterion.
6. **Fallbacks:** Exercise no-snapshot, partially snapshotted charge, partially covered invoice, unsupported/corrupt snapshot, project/task, ticketless, mixed-service, hour-block, and post-compute adjustment cases. Assert per-charge contribution coverage, signed amounts, visible safe rate cells, and optional incomplete-detail labeling.
7. **Designer through UI:** Modify a saved custom layout using its source picker and Add column UI; choose billed-time data, sort it, bind the output, save, close, reopen, and compare canvas/full-preview/PDF rows, order, amounts, and rate states. Include nested entry detail and explicit invalid binding behavior.
8. **Compatibility:** Existing custom layouts that do not opt in and representative other standard/document-kind layouts retain their source resolution, authored columns, and canonical financial outputs.
9. **Locale and privacy:** Verify French and English in canvas, full preview, and PDF, including mixed/unavailable rates, fallback labels, optional detail, and safe portal wording. Insert distinct customer-visible and private-note sentinels in source fixtures; only permitted content appears in persisted snapshots, renderer data, and documents.
10. **Evidence quality:** Keep a reproducible command/runbook, fixture provenance, test output, UI screenshots, extracted PDF content, and a whole-invoice coverage reconciliation. Identify every mock/shortcut. Seeded completed snapshots may test legacy/corrupt fallback only; they do not count as production generation or immutable-persistence proof. Do not add source-string, import-presence, or handcrafted-row-shape tests.

The mapped behavioral cases are in `tests.json`; all implementation and test flags start false. This design assignment validates plan structure only and does not claim live acceptance evidence.
