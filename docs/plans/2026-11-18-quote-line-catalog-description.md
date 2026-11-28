# Quote lines: edit or refresh the product description per line

Ticket alga-2026-0002804 (RightPath Consulting). Board card 84192ff5.

## Problem

RightPath keeps option text, such as include/exclude wording, in product
descriptions. To change that text on one quote today, a user has to edit the
product in the catalog and then remove and re-add the line. That loses the
line's quantity, price, phase, location, optional/taxable flags and discount
targets. It also changes the product for every future quote.

## What the code does today

These points were checked against this checkout (`df2e614614`).

- **Model.** `packages/billing/src/models/quoteItem.ts`:
  - `create()` deletes `catalog_description` from the payload. It captures the
    value from `service_catalog.description` through
    `normalizeCatalogDescription()` (trimmed, empty becomes `null`), or takes
    it from the internal `options.catalogDescriptionSnapshot` channel.
  - `update()` deletes it from the payload. It recaptures the value only when
    `service_id` changes, and sets `null` when `service_id` is cleared.
  - The `CreateQuoteItemPayload` and `update()` parameter types both omit the
    field.
- **Schemas.** `packages/billing/src/schemas/quoteSchemas.ts`
  (`createQuoteItemBaseSchema`, line 86) leaves `catalog_description` out, so
  zod strips it. The REST schemas in `server/src/lib/api/schemas/quoteSchemas.ts`
  do the same. `CreateQuoteFromTemplateItemInput` in `quoteActions.ts` excludes
  it by type.
- **Copy flows.** Duplicate, save-as-template and create-from-template go
  through `copyQuoteItemsToQuote()`, which uses the snapshot channel. Revision
  (`Quote.createRevision` in `models/quote.ts`, about line 472) inserts the
  source row with a spread, so it copies every column. The workflow worker
  keeps its own copy of the DAL (`crmWorkerDal.ts`, about lines 695–830, already
  marked `LEVERAGE: friction quote-item-dal-dup`). That copy mirrors the same
  rules.
- **Editor.** `QuoteLineItemsEditor.tsx` (line 528) renders one `Input` per line,
  bound to `item.description`. The draft row
  (`quoteLineItemDraft.ts`, `DraftQuoteItem.catalog_description`) carries the
  snapshot for preview only. `QuoteForm.buildQuoteItemWritePayload()` does not
  send it.
- **Save path.** `QuoteForm` saves line by line. It calls
  `updateQuoteItem(id, payload)` for persisted rows, `addQuoteItem` for new
  rows, and `removeQuoteItem` for removed rows. All of these reach
  `QuoteItem.update` and `QuoteItem.create`. A quote created from a template
  with draft overrides goes through `createDraftItemsOnQuote()` and then
  `QuoteItem.create`.
- **PDF.** The standard templates (`lib/quote-template-ast/standardTemplates.ts`,
  seeded by migration `20261105120000_…edited_description.cjs`) stack two lines
  in the description cell: `description` first, then `catalog_description`.
  `resolveColumnCellLines()` in `invoice-template-ast/react-renderer.tsx` drops
  a line whose text repeats an earlier one. An edited `catalog_description`
  therefore prints with no template change.
- **Lifecycle lock — this differs from the card.** The card says locked quotes
  "follow the existing quote lifecycle rules". For line items those rules are
  enforced **only in the UI**:
  - `QuoteForm.tsx:1292` sets
    `isReadOnly = isEditMode && !isTemplate && quoteStatus !== 'draft'` and
    passes `disabled={isSaving || isReadOnly}` to the editor.
  - On the server, `addQuoteItem`, `updateQuoteItem` and `removeQuoteItem`
    (`quoteActions.ts`), and `QuoteService.addItem` and `updateItem` (REST),
    check permission and quote read access through
    `assertQuoteReadAllowedForMutation`. They never check status.
  - So a REST caller can already change the price on an accepted quote. This
    design does not widen that gap (see Lifecycle), and it does not close it
    either (see Out of scope).

## Decision

### 1. Both options, built as one mechanism

The line's catalog description becomes text the user can edit on that line.
"Use current product description" is the reset for that same field. Both are
explicit writes through one channel. They do not need two separate features.

- **Option 1 (edit per line)** is what RightPath asked for. They want different
  option wording on *one* quote. Refresh on its own (option 2) does not do
  that: it still makes them edit the shared product first, which changes the
  wording for everyone. So option 1 is required.
- **Option 2 (refresh from product)** costs little once option 1 exists. It
  undoes an edit, and it lets a user pull in a catalog change on purpose
  without re-adding the line. It reuses the same capture rule: the server reads
  `service_catalog.description` and normalises it with the same function.

The cost of option 2 alone: the customer's real need stays unmet, and every
"tweak this quote" request becomes a catalog edit. The cost of option 1 alone:
after an edit there is no way back to the product text other than retyping it
or re-adding the line.

### 2. Divergence record: yes — `quote_items.catalog_description_edited`

Add the column `catalog_description_edited boolean NOT NULL DEFAULT false`.
Existing rows become `false`, which is correct because none of them can have
been edited. The column needs no tenant predicate or index; it is a plain
attribute of the already distributed `quote_items` table.

**Meaning:** at the line's last explicit write, its text differed from the
product's catalog text. The server derives the flag. The caller never sends it.

Why a flag rather than comparing with the live catalog text: a live comparison
cannot tell "the user customised this line" from "the product changed after the
line was added". Both look like a difference. The editor needs to show the
first case ("Edited for this quote"). The second case is the snapshot
guarantee working as designed and needs no badge. The flag also explains a
printed difference later, after the product has moved on.

| Event | `catalog_description` | `catalog_description_edited` |
|---|---|---|
| Line created from catalog, no caller value | captured from catalog | `false` |
| Explicit write on a catalog-backed line (create or update) | normalised caller value (`''` becomes `null`) | `normalised value !== normalised current catalog text` |
| Refresh (explicit write of the current catalog text) | catalog text | `false` (follows from the rule above) |
| `service_id` changed to another product | recaptured; any caller value ignored | `false` |
| `service_id` cleared | `null` | `false` |
| Custom or discount line | `null` (caller value refused) | `false` |
| Copy flows (duplicate, template, create-from-template without overrides, revision) | carried verbatim | carried verbatim |
| Product edited in the catalog | **unchanged** | **unchanged** |

### 3. Write rules

Add a pure helper module, `packages/billing/src/lib/quoteItemCatalogDescription.ts`.
It holds `normalizeCatalogDescription()`, moved out of `quoteItem.ts`, and
`resolveCatalogDescriptionWrite(callerValue, catalogText)`, which returns
`{ catalog_description, catalog_description_edited }`. The model, the new
lookup action and the editor draft all import it, so "unchanged" means the same
thing on the client and the server.

**The field must be present in the payload to count as an explicit write.**
The client sends `catalog_description` only when the user changed or refreshed
that line's text in this session. Leaving the field out means "no change". It
never means "recapture".

`QuoteItem.create`:
- **Accepts** `catalog_description` when `service_id` is set. It also reads the
  catalog row (it already does) and applies `resolveCatalogDescriptionWrite`.
- **Refuses** it (dropped, stored `null`) when `service_id` is null, which
  covers custom and discount lines.
- `options.catalogDescriptionSnapshot` stays the internal copy channel. Add
  `options.catalogDescriptionEdited` next to it so copies keep the flag. When
  the options channel is used, it wins over any payload value.

`QuoteItem.update`:
- **Accepts** `catalog_description` only when the stored line has a
  `service_id` and the update does not change `service_id`. It reads
  `service_catalog.description` for that `service_id` to derive the flag.
- **Refuses** it (dropped, as today) when:
  - `service_id` changes or is cleared, because the recapture wins; or
  - the stored line has no `service_id`. This covers custom lines, discount
    lines, and lines whose product was deleted and whose foreign key was set
    to `null`. For those the snapshot stays frozen.
- Remove `'catalog_description'` from the `Omit<>` on the update parameter
  type. Keep `catalog_description_edited` out of every caller-facing type.

No other path writes the column. No code path reads the catalog in response to
a product edit. The PR #3358 guarantee holds: only a write that names this line
and carries the field changes the text.

Schemas and doors:
- `packages/billing/src/schemas/quoteSchemas.ts`: add
  `catalog_description: z.string().max(4000).optional().nullable()` to
  `createQuoteItemBaseSchema`. The update schema inherits it. Replace the
  "intentionally absent" comment with the rule above.
- `CreateQuoteFromTemplateItemInput`: stop excluding the field.
  `createDraftItemsOnQuote()` passes it through as a payload value, not
  through the snapshot channel, so the flag is derived.
- REST (`server/src/lib/api/schemas/quoteSchemas.ts`, item create and update)
  gets the same field, so the public API and the editor share one rule.
  Regenerate the OpenAPI and MCP registries
  (`quotesContractsV1.ts`, `registry.generated.ts`,
  `apiRegistry.generated.ts`).
- `crmWorkerDal.ts`: port the same rules and carry `catalog_description_edited`
  in its copy path. The existing `quote-item-dal-dup` marker covers this
  duplication; the second port is more evidence for it.
- `IQuoteItem` (`packages/types/src/interfaces/quote.interfaces.ts`): add
  `catalog_description_edited?: boolean`. Rewrite the doc comment on
  `catalog_description`: it is "never refreshed automatically", rather than
  "never refreshed".

### 4. UI

All changes are in `QuoteLineItemsEditor.tsx` and `quoteLineItemDraft.ts`, using
standard components (`TextArea`, `Button`, `Tooltip` from `@alga-psa/ui`).

For each **catalog-backed line** (`service_id` set, not a discount), under the
existing line-description `Input`:
- A `TextArea` labelled **"Product description"**, holding
  `item.catalog_description`. It is multi-line because option wording is
  usually several lines. The existing `Input` keeps its role as the line title.
  It is the editable `description`, which starts as the product name.
- Under the `TextArea`, a muted caption **"Edited for this quote"** shows when
  the draft text differs from the product's current text and the line is
  flagged or dirty. Otherwise no caption.
- A small ghost `Button` **"Use current product description"** (icon
  `RotateCcw`) sets the draft text to the product's current text and marks the
  line dirty.
  - Enabled only when: the editor is not `disabled`; the line has a
    `service_id`; the current text has loaded for that service; and it differs
    from the draft text.
  - Otherwise disabled, with a tooltip giving the reason: "Matches the product"
    or "Product no longer in the catalog".
  - It is not shown at all when the editor is `disabled`. A locked quote shows
    the text read-only and offers no action.

For a line whose product was deleted (`service_id` null with a non-null
snapshot): show the snapshot as muted read-only text. Custom and discount
lines: no product-description block, as today.

Draft and save:
- `DraftQuoteItem` gains `catalog_description_edited` (taken from the server
  row) and `catalog_description_dirty` (client only).
- `buildQuoteItemWritePayload()` includes `catalog_description` only when
  `catalog_description_dirty` is set. After a save, the draft is rebuilt from
  the returned row (`createDraftQuoteItemFromQuoteItem`), which clears the
  dirty marker.
- Picker-added lines are not dirty. The server captures their text, so stale
  picker text never gets persisted as an "edit".

Current product text:
- Add a new read action, `getServiceCatalogDescriptions(serviceIds)`, in
  `serviceActions.ts`. It follows the shape of `getServiceCatalogCostInfo`:
  tenant-scoped `whereIn` and the same read permission. It returns
  `Record<service_id, normalised text | null>`.
- The editor loads it once for the distinct `service_id`s on its lines, and
  again when a line with a new `service_id` appears.
- A missing key means the product is gone.

Preview: `QuotePreviewPanel` already renders from the draft, so edits show live.

### 5. Lifecycle

There is no new lifecycle rule. The edit travels in the same `updateQuoteItem`
or `addQuoteItem` payload as `description`, price and quantity. So it is
blocked in exactly the same places those fields are blocked:

- the editor is `disabled` when
  `QuoteForm.isReadOnly = isEditMode && !isTemplate && quoteStatus !== 'draft'`;
  and
- the server enforces `assertQuoteReadAllowedForMutation` plus
  `requireBillingUpdatePermission`.

Sent, accepted, approved and every other non-draft quote are read-only in the
editor, as today. Templates stay editable, and an edited text on a template line
is copied (with its flag) into quotes created from it. A revision is a new draft
that carries the text and flag, and can be edited.

There is no separate refresh endpoint. A new endpoint would be a new door, and
it would need its own status check to avoid widening the gap. A refresh is just
a client-side fill plus the normal save.

### 6. Tests

Model — DB-backed, extending
`server/src/test/infrastructure/billing/quotes/quoteItemCatalogDescription.test.ts`.
Rewrite the existing **TR-1 and TR-2**: they currently assert that a
caller-supplied value is ignored on catalog-backed lines, which this design
reverses.
- Accept: on update of a catalog-backed line, an explicit value persists and
  sets `edited = true`. Quantity, price, description, phase, location, tax
  fields and totals stay byte-identical.
- Accept: on create with `service_id` and an explicit value, the value
  persists. `edited` is `true` when it differs from the catalog text and
  `false` when it matches.
- Accept: writing the current catalog text (refresh) sets `edited = false`.
- Accept: an explicit `''` stores `null` with `edited = true`.
- Refuse: a value on a custom line or a discount line is stored as `null`.
- Refuse: a value on a line whose product was deleted (`service_id` null)
  leaves the snapshot unchanged.
- Refuse: a value sent alongside a `service_id` change is ignored; the
  recapture wins and the flag is cleared.
- Refuse: an update with no `catalog_description` key leaves both columns
  unchanged, even after the catalog text changes.
- Guarantee: edit the product's catalog description; every existing line's
  `catalog_description` and flag stay unchanged.
- Copy: duplicate, save-as-template, create-from-template and revision carry
  the edited text and `edited = true` verbatim.
- Unit: schema tests (`quoteSchemas.test.ts`,
  `quoteItemSchemas.catalogDescription.test.ts`) accept the field and cap it at
  4000 characters. `resolveCatalogDescriptionWrite` gets a truth table.

Editor (Vitest + RTL, next to `QuoteForm.locations.test.tsx`):
- The `TextArea` renders only for catalog-backed lines, and is read-only text
  for deleted-product lines.
- Typing marks the line dirty, and the save payload carries
  `catalog_description`. An untouched line's payload omits it.
- The refresh button is disabled when the text matches, when there is no
  product, and while the current text is loading. It is hidden when the quote
  is read-only. Clicking it fills the current text and the line is saved.
- The caption shows only for a diverged, edited line.

PDF:
- In the existing "renders catalog snapshots through the DB view model and the
  seeded standard template" test, add a case: after an explicit edit, the
  rendered description cell shows `description`, then the **edited**
  `catalog_description`, and the original catalog text appears nowhere.
- Add a case where the edited text equals `description`: it prints once
  (renderer dedupe).

### 7. Out of scope

- **A server-side lifecycle gate on line writes.** All line fields, including
  price, are writable on non-draft quotes through the server action and REST.
  Closing that is a general change to `QuoteItem` writes and their two doors,
  and it needs its own card. Recommend that the XO raise one.
- Editing the product name (`service_name`) or SKU per line.
- Rich text or formatting in the description. It stays plain text, as the
  catalog column is.
- Any "product changed since added" notice or bulk refresh across lines or
  quotes.
- Changes to invoice, contract or sales-order conversion. They keep reading
  whatever the line holds.
- Activity or audit rows for description edits. Line edits do not write
  activity rows today.
- Template AST changes. The standard layouts already print the field.
- Collapsing `crmWorkerDal`'s duplicate QuoteItem DAL. It is noted by the
  existing LEVERAGE marker, not fixed here.

## Facts for Draft Implementation

1. `catalog_description` is caller-writable only when the payload names it on a line with a `service_id` and the update does not change `service_id`. Custom, discount and deleted-product lines, and `service_id` changes, still refuse it.
2. New column `quote_items.catalog_description_edited boolean NOT NULL DEFAULT false`. The server derives it as "written text ≠ current catalog text". It is cleared on recapture or clear, carried verbatim by every copy flow (snapshot channel plus revision spread plus `crmWorkerDal`), and never accepted from callers.
3. Refresh is not an endpoint. The editor fills the text from the new `getServiceCatalogDescriptions(serviceIds)` read action and saves through the normal `updateQuoteItem`, which derives `edited = false`.
4. `buildQuoteItemWritePayload` sends `catalog_description` only for lines marked `catalog_description_dirty`. Leaving it out always means "no change", and nothing ever recaptures on a product edit.
5. The lock is unchanged. The editor is disabled by `QuoteForm.isReadOnly` (`quoteStatus !== 'draft'`, templates excepted). There is no server-side status gate today, and adding one is a separate card.
6. Rewrite TR-1 and TR-2 in `quoteItemCatalogDescription.test.ts`. Add the model accept/refuse tests, the product-edit-never-propagates test, editor payload and refresh tests, and a PDF render case using the standard template, which needs no AST change.
