# Quote template instantiation drops the template

Card: f15013ea-60a0-498f-9a70-547fd0de658c

## Problem statement

Creating a quote from a saved quote template produces a blank quote. None of the
template's content transfers — not terms and conditions, not client notes, not
the description, PO number or currency, and not the line items.

The reported symptom was narrower than the defect. The reporter had built a
template specifically to hold a standing block of terms and conditions, so the
missing T&Cs were what they noticed and named. The actual behaviour is that the
entire template is discarded.

A second, independent defect sits directly behind the first: a multi-paragraph
terms block collapses into one run-on paragraph when the quote is rendered to
PDF. Anyone who hits the first bug will hit the second the moment it is fixed,
so both ship together.

## Two distinct concepts (required to read the rest)

The product has two things a user may call a "template", and they are separate
tables:

| Concept | Storage | What it carries | UI |
| --- | --- | --- | --- |
| **Business template** | `quotes` row with `is_template = true` | title, description, client_notes, **terms_and_conditions**, currency_code, po_number, line items | Billing → `quote-business-templates` → `QuoteTemplatesList` |
| **Layout** (document template) | `quote_document_templates` row | JSONB `templateAst` controlling PDF appearance | Billing → `quote-templates` → `QuoteDocumentTemplatesPage` |

The reporter correctly distinguished the two and confirmed layouts work. This
plan is about business templates only.

## Root cause

### Defect 1 — the deep link has a producer and no consumer

`BillingDashboard.tsx:192` renders the "Create Quote from Template" row action as:

```
/msp/billing?tab=quotes&quoteId=new&templateId=${id}
```

`QuotesTab.tsx:313-320` reads `quoteId`, `mode`, `subtab`, `isTemplate`,
`opportunityId`, `clientId`, `contactId` and `title`. It never reads
`templateId`. `QuoteFormProps.initialContext` (`QuoteForm.tsx:45-50`) has no
field that could carry it.

So the template id is written into the URL and then dropped on the floor. The
form opens empty, `form.template_id` stays `''`, and `QuoteForm.tsx:464` takes
the `createQuote` branch rather than the `createQuoteFromTemplate` branch at
`:465`. **`createQuoteFromTemplate` is never reached from this path.**

There is exactly one producer of `?templateId=` on the quotes tab and zero
consumers.

The server is not implicated. `createQuoteFromTemplate`
(`quoteActions.ts:1117`) copies `terms_and_conditions` correctly, as do
`duplicateQuote` (`:1179`) and `saveQuoteAsTemplate` (`:1251`). The stock
layouts bind the field and render it. The payload is correct end to end; it is
simply never requested.

### Defect 2 — `templateId` means three different things

This is what generated the bug, and leaving it in place invites the next one.
The name is overloaded across three scopes:

1. `?tab=quotes&templateId=` — a **business template** (the broken path)
2. `?tab=quote-templates&templateId=` — a **layout**
   (`QuoteDocumentTemplateEditor.tsx:514`)
3. `quotes.template_id`, the DB column — stores the **layout** id

Inside `QuoteForm` the collision is live. `form.template_id` holds the source
**business template** id in create mode (written by `handleTemplateChange` at
`:382`/`:395`, read by submit at `:464`) but holds the **layout** id in edit
mode (loaded at `:298` from `quote.template_id`). Meanwhile `documentTemplateId`
(`:149`, `:294`, `:1528`) independently holds the layout id and is what actually
gets written back as `template_id: documentTemplateId` at `:457`.

**Finding not in the original report:** line `:298` is not merely redundant, it
is mildly harmful. Loading the layout id into `form.template_id` makes the
title-required guard at `:428` (`!form.title && !form.template_id`) pass for an
edit-mode quote that has a blank title but an assigned layout. The guard is
meant to mean "title is optional because a template will supply it". A layout
supplies no title.

The resolution is to drop `:298` rather than rename around it: **a quote does
not record which business template it came from.** There is no provenance column
on `quotes`. The source template is a create-time, client-side-only concept, so
in edit mode the field must simply be empty.

### Defect 3 — text nodes swallow line breaks

`react-renderer.tsx:570-576` renders `case 'text'` as a bare
`<p>{String(content ?? '')}</p>` with no `white-space` handling. Multiline
values get `whiteSpace: 'pre-line'` everywhere else in the same file — line
items at `:333`, table cells at `:343`, field nodes at `:610` — but `text` nodes
were missed.

The stock layout's `terms-copy` node is a `text` node whose style sets only
color, lineHeight and fontSize, so every newline in a terms block is swallowed.

This renderer is shared: `pdfGenerationService.ts:29`, `server-render.ts:4`,
`quoteTemplatePreview.ts:11`, `invoiceTemplates.ts:30` and
`invoiceTemplatePreview.ts:14` all import it. The fix therefore lands on quote
PDFs, quote previews **and invoice templates** at once. That is the correct
blast radius — a text node swallowing newlines is wrong everywhere — but it
must be a conscious call, not a surprise. See Risks.

## Goals

- Creating a quote from a business template transfers the template's content:
  terms and conditions, client notes, description, PO number, currency and line
  items.
- The "Create Quote from Template" action reaches `createQuoteFromTemplate`.
- A business template id and a layout id are never again referred to by the same
  name in the same scope.
- Multi-paragraph terms render with their paragraph breaks intact in the PDF.

## Non-goals

- Changing `quotes.template_id` semantics or adding a provenance column
  recording the source business template. Out of scope; the column keeps meaning
  "layout".
- Rich-text / formatted terms and conditions. Tracked separately as a future
  request; this plan preserves plain-text line breaks only.
- Reworking the layout deep link (`?tab=quote-templates&templateId=`). It is
  correct as-is and is left alone.
- Any change to the server-side template copy logic. It is already correct and
  was verified.

## Primary flows

**Deep link (currently broken, the flow being fixed)**
Billing → Quote Templates → row menu → "Create Quote from Template" → quotes tab
opens a new quote already populated from the template → save → quote persists
with template content.

**Picker (works today, the reference behaviour)**
Quotes tab → new quote → Line items card header → "+ From template" dropdown
(`QuoteForm.tsx:1447`, `handleTemplateChange` at `:381`) → same population.

The fix makes the first flow reuse the second flow's prefill rather than
reimplementing it. The picker path is the specification.

## Design notes

- Rename the URL param and the form field to `sourceTemplateId` /
  `source_template_id`. The DB column `quotes.template_id` is untouched.
- Seeding must run after the template list loads and must apply exactly once per
  mount, or a re-render will re-clobber user edits.
- Prefill stays non-destructive — `handleTemplateChange` uses
  `current.x || template.x`, which is what lets an opportunity-seeded title or
  client survive. A deep link may in principle carry both an opportunity context
  and a source template; opportunity values win.
- On the renderer, the default must merge *under* the node's own style
  (`{ whiteSpace: 'pre-line', ...style }`), so a layout author who sets an
  explicit `whiteSpace` keeps control.
- When creating from a template the server already creates the line items;
  `QuoteForm.tsx:480` skips client-side item persistence to avoid duplicates.
  The renamed field must keep feeding that guard.

## Risks

- **Shared renderer.** The text-node change affects invoice templates too. Any
  invoice layout relying on a text node collapsing newlines would change
  appearance. Low likelihood (collapsing is not a behaviour anyone designs
  toward) but it is a cross-feature change and should be called out in review.
- **Overlapping in-flight work.** A separate unmerged change touching
  `quoteActions.ts`, `QuoteDetail.tsx`, `QuoteForm.tsx`, `QuotesTab.tsx`,
  `pdfGenerationService.ts` and two quote test files is in progress elsewhere
  (PDF filenames / document titles, `buildDocumentFileName`). It does not touch
  T&Cs or template instantiation but it hits the same files. Rebase rather than
  assume a clean tree.
- **Rename reach.** `form.template_id` is read at `:298`, `:382`, `:395`,
  `:428`, `:464`, `:465`, `:480` and `:1448`. Missing one silently reintroduces
  the collision.

## Acceptance criteria

1. "Create Quote from Template" opens a new quote carrying the template's terms
   and conditions, client notes, description, PO number, currency and line items.
2. Saving that quote calls `createQuoteFromTemplate`, and line items are not
   duplicated.
3. Edit mode leaves the source-template field empty and still round-trips the
   layout id through `quotes.template_id`.
4. A deep link naming a missing or inaccessible template degrades to a blank new
   quote without crashing.
5. No identifier named `template_id`/`templateId` in `QuoteForm` or `QuotesTab`
   refers to a business template and a layout in the same scope.
6. A terms block containing blank-line-separated paragraphs renders with those
   breaks intact in the generated PDF.
7. Tests cover the deep link end to end, the server-side field carry-through,
   and text-node line-break preservation.

## Open questions

None blocking. The scope question raised in the original report — whether the
reporter was on the broken deep-link path or the working picker path — was
settled: the deep-link path, which drops the whole template. The picker path is
reference behaviour and the interim workaround, not a second investigation.
