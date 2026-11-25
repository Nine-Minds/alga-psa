# Design — New Ticket on Board notification: Description empty for table-based HTML emails

Card: `9be1c0e2` · ticket alga-2026-0003184 (Sheffield United / Karl Stone)
Step: Design Session (delegated desk work, conn) · next: Link Spec to PSA Ticket

## What is actually broken

The board notification's Description box renders `{{{ticket.description}}}` — the **plain-text/markdown**
rendition produced by `formatBlockNoteContent()` in `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
(~L1297–1316). `descriptionHtml` is built next to it from the same call, is put in the email context, and is
**never used by the template**.

Both renditions come out of `packages/formatting/src/blocknoteUtils.ts`, and both are wrong for BlockNote 0.47
table cells:

- `convertTableToMarkdown()` (~L571): `if (Array.isArray(cell)) cellText = extractStyledTextFromContent(cell);` —
  any cell that is not an array keeps `cellText = ' '`, so every cell renders empty (`|  |  |`).
- HTML `case 'table'` (~L858): `const inlineArray = Array.isArray(cellContent) ? cellContent : [];` — same
  non-array cell becomes `<td></td>`.

The 0.47 shape is `{ type: 'tableCell', content: InlineContent[] }`. `shared/lib/utils/contentConversion.ts`
(~L95) already knows this shape and recurses into `record.content`; the two email converters do not. Inbound
table-based alert emails keep their tables as table blocks (`blocksFromEmailBody` → `convertHtmlToBlockNote(html,
{ flattenTables: true })` only flattens single-row/single-cell label/value tables), which is exactly Karl's
population. The ticket screen renders correctly because it renders BlockNote directly, never through these
converters.

So: one defect at the converter layer, surfaced twice.

## Decisions

**D1 — One cell-normalisation rule, used by both converters.**
Add an internal helper in `blocknoteUtils.ts`:

```ts
function tableCellInlineContent(cell: unknown): InlineContent[]
// - array                → the array as-is (legacy shape)
// - {type:'tableCell', content:[...]} → content
// - {content:[...]} (bare object)     → content
// - anything else        → []
```

Use it at **both** call sites — `convertTableToMarkdown()` and the HTML `case 'table'` — so the shapes cannot
drift apart again. Not exported, not duplicated: `contentConversion.ts`'s text flattening is a different concern
(label/value splitting) and stays as it is; the design only requires the *cell → inline content* rule to exist
once inside the formatting engine.

**D2 — The board notification carries the HTML rendition; the client-facing email does not change.**
The Description box must show a readable table, not `| a | b |` in a collapsed line of text. Do this by
**overriding the copy in the board template**, not by changing shared behaviour:

```js
// ticketBoardCreated.cjs
const COPY = Object.fromEntries(Object.entries(BASE_COPY).map(([lang, copy]) => [
  lang, { ...copy, descriptionVar: '{{{ticket.descriptionHtml}}}' },
]));
```

`buildBodyHtml()` keeps using `c.descriptionVar` exactly as today; `ticketCreated.cjs` (and therefore the
client-facing `ticket-created` template, and `2775d3df`'s description gating on that path) is untouched. If
`ticket.descriptionHtml` is empty the template must fall back to the existing behaviour — the subscriber already
sets `descriptionHtml = '<p>' + description + '</p>'` in that case, so the fallback is data, not a branch.
**Explicit conflict check before touching these files:** `2775d3df` (Outlook ticket-created confirmation) edits
`ticketCreatedClient.cjs` / `ticketCreated.cjs` right now; rebase and re-run its template tests.

**D3 — Sanitise where the HTML is produced, not in the template.**
`descriptionHtml` is raw BlockNote→HTML of an *untrusted inbound email body* and the template inserts it with
`{{{ }}}`. The HTML rendition that goes into the email context must be sanitised with the repo's existing
email-HTML sanitiser at the point it is built in `ticketEmailSubscriber.ts` (same allowlist already used for
other email HTML bodies). Add a test that a `<script>`/`onerror` payload in the inbound body does not survive
into `descriptionHtml`. The plain-text rendition needs no sanitising; it is text by construction.

**D4 — Fix both renditions even though the board email uses HTML.**
The text alternative (`buildText`) and every other consumer of `description` (plain-text notifications, exports)
share the same defect. D1 fixes them together; do not special-case the email.

**D5 — Do not wait on Karl's attachment; do not adopt PR #4289.**
Acceptance is a synthetic table-based inbound email, plus one live check on the card app. PR #4289 is a
separate, unmerged split of #3957: check it before starting (if it lands first, rebase on it), but do not drive,
merge or extend it here, and do not duplicate its scope.

## Change list, in order

1. `packages/formatting/src/blocknoteUtils.ts` — add `tableCellInlineContent()`; use in `convertTableToMarkdown()`
   and HTML `case 'table'`. No behaviour change for array cells or non-table blocks.
2. `server/migrations/utils/templates/email/tickets/ticketBoardCreated.cjs` — per-locale copy override setting
   `descriptionVar: '{{{ticket.descriptionHtml}}}'`; pass the derived COPY to `buildBodyHtml`. Locale strings
   unchanged (the label already exists in all 11 locales; nothing new to translate).
3. `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` — sanitise `descriptionHtml` before it enters
   the email context.
4. Tests:
   - `packages/formatting` — table with legacy array cells, `tableCell` objects, and a mixed row: markdown keeps
     cell text; HTML emits `<td>text</td>`; empty cells remain structurally empty; non-table blocks unchanged.
   - `server/.../templates` — board template renders cell text in the HTML body and in the text alternative; a
     paragraph-only description renders exactly as before; a sanitisation test for HTML injection.

## Acceptance (what the implementer must be able to show)

- A ticket whose description is a multi-row, multi-cell table produces a **New Ticket on Board** email whose
  Description box contains the cell text, visually tabular, in both new-ticket board-rule mail and watcher mail.
- Text alternative contains the cell text (no empty pipes rows).
- Non-table descriptions are byte-identical to today.
- No `<script>`/event-handler attributes survive from an inbound body.
- Client-facing `ticket-created` output unchanged (2775d3df owns that path).

## Risks

- Shared template file family (`ticketCreated*.cjs`) is under active edit by `2775d3df` → rebase, re-run its
  tests, and state in the PR which files were touched and why.
- Raw HTML into email raises the sanitisation stakes: the sanitiser must be the existing one, and the test must
  prove it ran, not just that the template escapes.
- Markdown tables are still pipes in any consumer we do not switch; that is accepted (the email is the reported
  surface) and D1 at least makes the pipes carry text.
