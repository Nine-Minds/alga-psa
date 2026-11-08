# Design of record — C2: Print work tags from tickets and assets

Card: alga-2026-0002683 (2/6), board card `0365032e-6368-42ae-80fd-9a9435cfb3a2`.
Customer: Joymode Business Solutions (Munjal Thakkar).
Branch: `feature/alga-2026-0002683-2-6-print-work-tags-from-ticke`.
Base: `main` at `c5a8b29e4a`. C1 (PR #3821, merge `dd192d4dd4`) is already merged into it.

This document is the design for this card only. Where it differs from `PLAN.md` or `ANALYSIS.md`, this document wins. Where it differs from C1's PRD (`ee/docs/plans/2026-10-20-label-rendering-foundation/PRD.md`), C1's PRD still governs the foundation, and this card changes only the points listed under "Changes to C1 behaviour".

## 1. What C1 left us (verified in this worktree)

| Piece | Where | State on this base |
|---|---|---|
| Label contracts | `packages/types/src/lib/labels.ts` | `LabelClass` = `ticket-work-tag` \| `asset-identity` \| `stock-unit-identity`. A uniform `LabelViewModel` (`url`, `identifier`, `code128Value`, `title`, `clientName`, `detail`, `secondaryIdentifier`, `serialSuffix`, `tenantClient`), `LabelViewModelProvider`, `LabelPrintFailure`. |
| Composition root | `server/src/lib/labels/printLabels.ts`, `server/src/app/api/labels/pdf/route.ts` | `POST /api/labels/pdf` with `{ labelClass, ids, templateCode?, layout? }`. Internal users only. **If any id is null (missing or denied), the whole request returns 404.** Maximum 200 ids. The default layout is 4×2 in, one per page. The route is on the middleware API-key skip-list (`server/src/middleware.ts:228`). |
| Ticket provider | `packages/tickets/src/lib/labelViewModelProvider.ts` | `ticket:read` plus `authorizeTicketRecordAccess`. Fills `identifier` (ticket number), `title`, `clientName`. **`detail`, `secondaryIdentifier` and `serialSuffix` are always null**, with a comment that defers them to C2. Tickets must not import assets. |
| Asset provider | `packages/assets/src/lib/labelViewModelProvider.ts` | `asset:read` plus a kernel record check (copied from `assetActions.ts`, with a `LEVERAGE: pattern asset-read-authorization` marker). Fills tag, name, client and `code128Value` (printable-ASCII tag only). Never the serial number. |
| Renderer | `packages/billing/src/lib/label-batch/renderLabelBatchHtml.ts`, `packages/billing/src/services/labelPdfService.ts` | **Standard templates only**, chosen by `templateCode` (`resolveTemplateAst` → `getStandardLabelTemplateAstByCode`). All-or-nothing: a 422 lists every failing record. `tenantClient` = `{ name, logoUrl }` from `fetchTenantParty`. |
| Standard templates | `packages/billing/src/lib/label-template-ast/standardTemplates.ts` | `standard-ticket-work-tag`, `standard-asset-label` (QR only), `standard-asset-label-code128`, `standard-stock-unit-label`. They show a text brand line (`tenantName`) but **no logo node**, even though a `tenantLogo` binding exists in `bindings.ts`. |
| Template registry | `packages/billing/src/lib/document-templates/registry.ts` | One generic `work-tag` document type covers every class. The designer can create custom `work-tag` templates, and `DocumentTemplatesPage.tsx` offers "Set as Default". |
| Template assignments | `server/migrations/20260627100100_create_document_template_assignments.cjs`, `packages/billing/src/lib/document-templates/storage.ts` | **One tenant default per `document_type`.** `scope_type` is limited by CHECK to `tenant` \| `client`. So a single `work-tag` default would apply to every label class, and the renderer ignores it anyway. |
| Ticket detail header | `packages/tickets/src/components/ticket/TicketDetails.tsx` ~3757–3800 | Has Duplicate and a `more-actions` dropdown (template, workflow). **No print action.** |
| Ticket list bulk bar | `packages/tickets/src/components/BulkTicketActionBar.tsx`, `TicketingDashboard.tsx` (`selectedTicketIds`, select-all-matching ~1322) | Bulk actions: assign, bundle, move, delete, status, priority, tags, due-date. |
| Asset detail header | `packages/assets/src/components/AssetDetailHeader.tsx` ~199 | `PrintButton` (browser print of the page), Remote access, Create Ticket, Actions dropdown. |
| Asset list | `packages/assets/src/components/AssetDashboardClient.tsx` (`selectedAssetIds`, `BulkActionBar` from `@alga-psa/ui`) | Bulk status, assign, group, location, delete. |
| Ticket↔asset link | `asset_associations` with `entity_type = 'ticket'` (`assetActions.ts` ~2880, ~3354, `listEntityAssets` ~3679) | One ticket can have several linked assets. |

## 2. What changes

### 2.1 The data that goes on a ticket work tag

| Tag field | Source | Rule |
|---|---|---|
| MSP name and logo | `tenantClient` (name + logo from `fetchTenantParty`) | The renderer supplies it. The logo is **inlined as a `data:` URL** in `labelPdfService` (see risk R1). |
| Client name | `clients.client_name` | Shown unless the template hides `clientName` (§2.4). |
| Short item description → `title` | Ticket title | The single-print dialog can edit it before printing (§2.3). |
| Ticket number → `identifier` | `tickets.ticket_number` | Never edited, never hidden. |
| Work reason → `detail` | Category path: `subcategory` if set, else `category`, else null | The single-print dialog can edit it. |
| Linked asset tag → `secondaryIdentifier` | `assets.asset_tag` of **the** linked asset | Used only when exactly one linked asset is readable by the caller. In single print the caller can pick among the readable linked assets. Otherwise null. |
| Serial suffix → `serialSuffix` | Last 4 characters of that asset's `serial_number` | **Only when the serial is at least 8 characters**, so the suffix can never be the whole serial. Rendered as `S/N …1234`. |
| QR | `recordUrl('ticket', id, baseUrl)` | Unchanged C1 invariant. |

Tickets may not import assets, so the linked-asset fields are composed in the **composition root**, not in the ticket provider:
- New read-only function in the assets package, `packages/assets/src/lib/ticketLinkedAssetLabels.ts`: `getTicketLinkedAssetLabelParts(context, ticketIds, chosen?: Record<ticketId, assetId>)` → `Record<ticketId, { assetId, assetTag, serialSuffix } | null>`. It applies `asset:read` and the same per-record kernel check as the asset provider, so an asset the caller cannot read never contributes. That check is currently copied, so first move it into a non-action `packages/assets/src/lib/assetReadAuthorization.ts` used by both. This settles the `asset-read-authorization` LEVERAGE marker.
- `printLabels` merges these parts into ticket view models after the ticket provider has authorized the ticket. The ticket provider fills `detail` from the category join; that is ticket-owned data.

### 2.2 Batch semantics: skip unreadable records and count them (changes C1)

`printLabels` stops treating any null from a provider as a whole-request 404:
- Nulls are **dropped**, and the count goes back as `skipped` (response header `X-Label-Skipped`, alongside `X-Label-Count`).
- If **every** record is null, the response is the same uniform `404 Not found.` as before.
- The response never says *which* ids were skipped or *why* (missing and denied look the same). Every id was supplied by a caller who saw it in a list, so a count reveals nothing new.
- Single-record requests behave as before: one null is a 404.
- Render failures, such as a tag too long for Code 128, stay all-or-nothing 422 with `failures[]` and `suggestedTemplateCode`, exactly as in C1. Indices in `failures` refer to the **printed** order after skips. The UI offers to reprint with the suggested template, or to drop the failing records and print the rest.

### 2.3 Request shape additions

`POST /api/labels/pdf` body additions. All are optional, and all are validated in `printLabels`:
- `templateId?: string`: a tenant custom `work-tag` template id (UUID) **or** a standard code. It supersedes `templateCode`, which stays accepted as an alias for standard codes. The template must belong to the request's label class (§2.4). Otherwise 400.
- `overrides?: { title?: string; detail?: string }`: **only** for `labelClass: 'ticket-work-tag'` with exactly one id. Plain text, trimmed, at most 120 characters each, control characters stripped. They cannot touch `url`, `identifier`, `code128Value` or any asset field. They are not persisted.
- `linkedAssetId?: string`: single ticket only. It must be linked to that ticket through `asset_associations` **and** readable by the caller. Otherwise the request treats it as absent (no error, so it reveals nothing).

New read-only route `GET /api/labels/templates?labelClass=…` (same auth and skip-list treatment as the PDF route) returns `{ defaultTemplateId, templates: [{ id, name, source }] }` for the print dialog. It lives in `server/src/app/api/labels/templates/route.ts` and calls billing storage. It needs no record access, only an internal user plus `ticket:read` or `asset:read` matching the class.

### 2.4 Tenant templates control field visibility (changes C1)

Two parts, both in billing.

**(a) A per-class tenant default, actually used by the renderer.**
- Custom `work-tag` templates record their label class in `metadata.labelClass`. It is required for `work-tag` customs and validated on save in `documentTemplateActions.ts`. The designer sets it from the standard template being cloned, or from a class picker on "New".
- Existing customs without it are treated as `ticket-work-tag`. This is a read-time default; no data migration is needed, because C1 shipped no tenant label usage.
- Migration `server/migrations/<ts>_document_template_assignments_label_class_scope.cjs` changes `document_template_assignments` as follows:
  - Add nullable `scope_key varchar(64)`.
  - Widen `scope_type` CHECK to `('tenant','client','label_class')`.
  - Widen the scope_id CHECK so `label_class` rows have `scope_id IS NULL AND scope_key IS NOT NULL`.
  - Replace the tenant-scope unique index with `(tenant, document_type, scope_type, coalesce(scope_key,''))` WHERE `scope_id IS NULL`.
  - The migration is Citus-safe: it only adds a column, constraints and an index on a tenant-distributed table, with no cross-shard work. Mark the column site `// LEVERAGE: friction document-template-scope — scopes beyond tenant/client are bolted on via scope_key`.
- Storage gets `fetchLabelClassDefaultTemplate(knex, tenant, labelClass)` and `setDefaultAssignment` gets a `{ scopeType: 'label_class', scopeKey }` arm.
- On `DocumentTemplatesPage`, the `work-tag` type shows a **Class** column, and "Set as Default" sets the default *for that template's class*. A plain `tenant`-scope assignment is never written for `work-tag`.

**(b) Hidden fields as a template setting.**
- `TemplateAstMetadata` gains `labelSettings?: { hiddenFields?: LabelHideableField[] }`. This touches `packages/types/src/lib/invoice-template-ast.ts` and the strict zod schema in `packages/billing/src/lib/invoice-template-ast/schema.ts`.
- `LabelHideableField` = `clientName | title | detail | secondaryIdentifier | serialSuffix | tenantLogo | tenantName`. It never includes `url` or `identifier`.
- The renderer **nulls hidden fields in the model before evaluation**. A hidden client name is therefore absent from the HTML even if a custom text node binds it.
- The designer gets a "Fields shown on the label" checkbox group for `work-tag` documents, next to print settings.
- Defaults: all fields shown, as the customer asked. The tenant hides the client name by setting a default template that hides it.

**Template resolution for a print:** explicit `templateId` → per-class tenant default → class standard. The resolved custom AST goes through the same path as a standard one: evaluate, barcode prepass, render, canonical-URL check. `LABEL_FALLBACK_TEMPLATE_BY_CODE` still applies only to standard codes.

**Sensitive data stays out by construction.** `LabelViewModel` has no comment, description, credential or full-serial field, and the binding catalog (`label-template-ast/bindings.ts`) is the allowlist. A tenant template cannot bind something the view model does not carry. A test asserts this (T-sens below).

### 2.5 Standard templates

- `standard-ticket-work-tag`: add a small logo `image` node (`tenantLogo`, max 8 mm high) before the brand line. Collapse the brand line when there is a logo. Render the serial suffix as `S/N …{suffix}` and the linked asset tag as `Asset {tag}`, each only when present (the evaluator's empty fallback means an empty text node; reserve no space).
- `standard-asset-label` and `standard-asset-label-code128`: add the same logo node.
- Keep the C1 rules: wrap identifiers anywhere, cap free text at whole lines, re-run C1's containment e2e (Range.getClientRects) for every changed template.

### 2.6 UI

A shared client component, `packages/ui/src/components/labels/LabelPrintDialog.tsx`, plus a `useLabelPrint` hook. It only `fetch`es `/api/labels/*`, so neither tickets nor assets import billing. It provides:
- A template select, defaulting to the tenant's class default.
- A layout select:
  - "One per label (4×2 in roll)", the default
  - "Letter sheet, 2×5 (Avery 5163-style)"
  - "A4 sheet, 2×7 (4×38 mm style)"

  These presets are constants in the dialog. The layout choice is remembered per browser (localStorage key `alga.labels.layout`); it is **not** a server write.
- For a single ticket only, editable Item and Reason fields and the linked-asset picker.
- Print: POST, then open the PDF blob in a new tab (`application/pdf`, the browser's print dialog does the rest). Show "Printed N labels. M records were skipped because they could not be opened." when `X-Label-Skipped` > 0. Show the 422 failures list with "Use {suggested}" / "Skip these and print the rest".

Entry points:
1. **Ticket detail:** a visible `Print work tag` button with a Printer icon in the header action row, before Duplicate (`TicketDetails.tsx` ~3757), id `${id}-print-work-tag-button`. Shown when the user has `ticket:read`, which they do if the page rendered.
2. **Asset detail:** `Print asset label` in `AssetDetailHeader.tsx`, id `asset-print-label-button`. Keep the existing page `PrintButton` but relabel it "Print page" so the two cannot be confused.
3. **Ticket list:** a bulk action `print-labels` ("Print work tags") in `BulkTicketActionBar.tsx`, wired in `TicketingDashboard.tsx` with `selectedTicketIdsArray`.
4. **Asset list:** a `BulkActionBar` action "Print labels" in `AssetDashboardClient.tsx` with `selectedAssetIds`.

For 2–200 records, the batch entry points open the same dialog without the single-record fields. Above 200 the action is disabled, with a tooltip giving the limit (`MAX_LABELS_PER_REQUEST`). It does not split into several PDFs.

i18n: new strings go in the existing tickets and assets namespaces (and `ui` for the dialog) with `defaultValue`s, following `docs/AI_coding_standards.md`.

## 3. Decision on PLAN.md question 4: is a print recorded?

**Decision: no. A print records nothing**: no `documents` row, no ticket or asset history entry, no event, no audit row. The server keeps only its ordinary request log line.

Why:
- The customer's first invariant is "printing has no side effects". The strongest and most testable reading is *zero writes*, which also makes the proof test simple and absolute (§6, T-noside).
- A label is a snapshot of live data that can be reproduced at any time; the QR always opens the live record. A stored PDF per print would grow `documents` and clutter the ticket and asset Documents tabs for no retrieval value.
- An `asset_history` entry would publish asset change events (`assetChangeEvents.ts`) that workflows and timelines react to. A print would then *cause* behaviour, which breaks the invariant in spirit.
- Accountability for physical custody belongs to C4's custody events (received, moved, handed off), which record real-world actions. Printing a tag is not one.
- If a later need appears (for example "when was this tag last printed"), it should be a dedicated, non-evented print log designed then, not a reuse of documents or history.

## 4. Order of work

1. **Plan files.** Write the alga-plan PRD, `features.json` and `tests.json` in `ee/docs/plans/2026-10-23-print-work-tags/`. The dossier folder is already on main through C1; commit this design with it.
2. **Asset read authorization extraction.** Move it to `packages/assets/src/lib/assetReadAuthorization.ts`, used by `assetActions.ts` and the asset label provider. This is a pure refactor; existing tests must stay green.
3. **Ticket provider.** Fill `detail` from the category/subcategory join.
4. **`getTicketLinkedAssetLabelParts`** in assets, plus the composition-root merge in `printLabels`.
5. **`printLabels` changes:** skip-and-count, `templateId`, `overrides`, `linkedAssetId`, and the `X-Label-Skipped` header in the route.
6. **Billing templates:**
   - `labelSettings.hiddenFields` (types and schema)
   - `metadata.labelClass` on customs
   - the assignment migration and storage arm
   - per-class resolution in `renderLabelBatchHtml` / `labelPdfService`
   - logo inlining
   - standard template logo and suffix updates
7. **`GET /api/labels/templates`.**
8. **Designer and DocumentTemplatesPage:** class column, per-class default, hidden-fields checkboxes.
9. **UI:** `LabelPrintDialog` and `useLabelPrint`, then the four entry points.
10. **Tests** (§6) alongside each step, then the smoke test (§7).

## 5. Non-goals

- Scanning, mobile routing, app links, and unit or RMA detail routes. All are C3.
- Stock-unit labels in the UI. The provider exists, and the entry point is C3's.
- Custody location or next action on the work tag. C4 adds these fields to the tag.
- RMA, project, task or box labels (C5, C6).
- Print history or print audit (decision §3).
- Client-scoped (`scope_type = 'client'`) label template overrides. The tenant per-class default is enough for C2.
- Direct printer drivers (ZPL/EPL, raw thermal). Output is PDF to the browser print dialog.
- Splitting batches over 200 records into several PDFs.
- Any change to stock, billing, asset state, time entries or ticket state.

## 6. Tests later steps must write (minimum)

| Id | Kind | Asserts |
|---|---|---|
| T-noside | Integration (DB) | Run `printLabels` for a ticket batch and an asset batch against a seeded tenant, with a knex `query` listener: **no statement other than SELECT is issued**. Before/after equality of row counts and `max(updated_at)` for `stock_levels`, `stock_units`, `stock_movements`, `invoices`, `invoice_charges`, `time_entries`, `assets`, `asset_history`, `tickets`, `documents`. |
| T-skip | Unit + integration | A mixed batch (readable, unreadable, missing, cross-tenant) prints only the readable records, in order, with `skipped = 3`. An all-unreadable batch is a 404 with the same body as a missing id. A single unreadable id is a 404. |
| T-asset-link | Integration | Linked asset tag and suffix appear only for exactly one readable linked asset. An unreadable linked asset contributes nothing. A `linkedAssetId` not linked to the ticket is ignored. |
| T-suffix | Unit | Serials shorter than 8 characters produce no suffix. Otherwise the suffix is exactly the last 4 characters. The full serial never appears in the HTML. |
| T-sens | Unit | Rendering a tenant custom template that tries to bind `ticket.description`, `comments`, `serial_number` or credential-like paths yields empty output. The binding catalog equals the documented allowlist. |
| T-hidden | Unit (renderer) | `hiddenFields: ['clientName']` removes the client name from the HTML even when a custom text node binds `clientName`. `url` and `identifier` cannot be hidden (schema rejects). |
| T-resolve | Integration | Template resolution order is explicit `templateId` → class default → standard. A template of the wrong class gives 400. A custom template with no `labelClass` is treated as a ticket template. Setting the asset default does not change ticket printing. |
| T-overrides | Unit | `overrides` are accepted only for a single ticket. They are trimmed, length-capped and stripped of control characters, and can never change the QR, identifier or Code 128. |
| T-qr | E2E (C1 harness) | The QRs decoded from a ticket work tag and an asset label PDF equal `recordUrl`. The Code 128 equals the asset tag. Containment holds with the logo, a long title and an RMM-length tag. |
| T-ui | Component | The ticket detail button, asset detail button and both list bulk actions open the dialog with the right `labelClass` and ids. The skipped-count message appears. The action is disabled above 200. |
| T-migration | Migration | Up and down. A `label_class` row needs `scope_key`. There can be only one default per (tenant, work-tag, class). Existing sales-order assignments are untouched. |

## 7. Smoke test (done criteria)

On the card's dev server, signed in as the canonical QA user:
1. Open a ticket that has one linked asset with a serial. Click **Print work tag**. The PDF shows the logo, MSP name, client, title, ticket number, category reason, `Asset {tag}`, `S/N …last4` and a QR.
2. Open an asset, click **Print asset label** and choose the Code 128 template. Check the tag, name, client, QR and barcode.
3. In the ticket list, select 3 tickets including one the QA user cannot read (use a second restricted user for this step). The PDF has 2 labels and the dialog reports 1 skipped. Do the same with assets.
4. Hide the client name in a tenant work-tag template, set it as the ticket default, and reprint: no client name.
5. Scan both QRs with a phone camera. In a signed-out browser: sign-in, then land on the ticket or asset (`callbackUrl` round trip).
6. Confirm in the DB that the T-noside tables are unchanged after the prints.

## 8. Risks

- **R1: the logo does not load in Puppeteer.** `getClientDocumentLogoUrl` returns an app URL, and `composeLabelSheets` emits no `<base>` and no session. Mitigation: `labelPdfService` reads the logo bytes server-side and inlines a `data:` URL, capped at 256 KB, with a format whitelist (png, jpeg, svg+xml sanitized or rasterized). If the logo cannot be read it is omitted, never an error. Verify in the smoke test.
- **R2: the assignment migration on Citus.** The table is tenant-distributed. Adding a column, CHECKs and a partial unique index is supported, but test it on the Citus compose profile, not only plain Postgres.
- **R3: the skip count as an oracle.** The design reports only a count over ids the caller supplied, never which ids or why. Revisit if C3 exposes an id-guessable batch endpoint.
- **R4: linked-asset authorization across packages.** The asset kernel check must run inside the assets package. The composition root must never read `assets` directly.
- **R5: select-all-matching on the ticket list** can exceed 200 ids. The action is disabled with the limit shown; no silent truncation.
- **R6: changing the standard templates** can break C1's containment guarantees (text spilling out of the cell). Re-run C1's containment e2e for every standard template changed.
- **R7: the strict AST schema.** Adding `labelSettings` and `labelClass` to metadata changes the shared invoice and quote schema. Both keys are optional and ignored outside `work-tag`, and invoice and quote round-trip tests must stay green.

## 9. Decisions later steps must honour

1. Printing writes nothing (§3), and T-noside proves it at the SQL-statement level.
2. Batches skip unreadable records and report only a count. All-unreadable and single-unreadable return the uniform 404. Render failures stay all-or-nothing 422.
3. Linked asset fields come from the assets package through the composition root, behind the asset kernel check. Tickets never import assets.
4. The serial suffix is the last 4 characters and only for serials of at least 8 characters. A full serial never reaches the view model.
5. Field visibility is a template setting (`metadata.labelSettings.hiddenFields`), enforced by nulling the model before evaluation. `url` and `identifier` cannot be hidden.
6. Tenant label defaults are per label class (`document_template_assignments.scope_type = 'label_class'`, `scope_key = class`). Custom `work-tag` templates carry `metadata.labelClass`.
7. The QR is only `recordUrl` (C1 invariant). Code 128 is only the asset tag (C1 deviation retained).
8. Print-time item and reason overrides apply to single ticket prints only, are not persisted, and never touch identifiers or codes.
9. Output is a PDF opened in the browser. The layout choice is remembered client-side only.
10. Edition is CE (web), as C1 decided. No EE-only code in this card.
11. Permissions are `ticket:read` / `asset:read` plus record-level checks, and internal users only. No new RBAC resource or action.
