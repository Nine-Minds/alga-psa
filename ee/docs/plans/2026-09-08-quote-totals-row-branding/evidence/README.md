# Evidence — Editable Totals-Row Branding (quote/invoice)

Artifacts generated from this worktree's own code paths (PDF + HTML are
committed; `.png` screenshots of the same pages were produced locally during
verification but the repo's `*.png` ignore keeps them out of git — regenerate
with headless Chrome against the HTML files if needed):

- `grouped-quote-totals-rows-preview.html` — real `renderEvaluatedTemplateAst`
  output for the grouped quote standard template (`standard-quote-grouped`) with
  `monthly-total` recolored to teal (`#0f766e`) and `onetime-total` to crimson
  (`#9f1239`). Every other row, label, table header, and binding is untouched.
- `grouped-quote-totals-rows-preview.pdf` — headless-Chrome PDF of the same
  document. Pixel scan of the local screenshot confirms both row backgrounds
  render (teal ≈ 4.7k px, crimson ≈ 4.8k px in the totals area) with
  near-white label text.
- `grouped-quote-totals-rows-preview.json` — machine-readable edit summary.
- `invoice-totals-row-edit-preview.html` / `.pdf` — the default standard
  invoice with a recolored `total` row (teal background/light text); the
  `subtotal`/`tax` rows carry no explicit style, demonstrating that cleared
  rows restore the inherited/default appearance while the edited row renders.

## How the pieces were verified

| Layer | Mechanism | Where |
| --- | --- | --- |
| Inspector init + per-row live canvas update (T001) | `@testing-library` runtime test: inspector + `DesignCanvas` | `packages/billing/src/components/invoice-designer/inspector/TotalsRowsEditorWidget.integration.test.tsx` |
| Clear colors, prune empties, keep decor/labelStyle/siblings (T002) | same suite | above |
| Label-only `labelStyle` precedence + note (T003) | same suite + DOM style assertions | above |
| Undo of a committed color edit (T008) | same suite, store `undo()` | above |
| Quote/invoice AST round-trip of edited rows (T004/T005) | round-trip through `importTemplateAstToWorkspace` / `exportWorkspaceToTemplateAst` | `ast/workspaceAst.totalsRowsRoundtrip.test.ts` |
| Save→reopen persistence + untouched header/table branding (T007) | same round-trip suite | above |
| Renderer row colors + label override (T006) | `TemplateAstRenderer` DOM render | `lib/invoice-template-ast/totalsRowBranding.render.test.tsx` |
| Real preview + PDF (T009/T010 render path) | this folder (above) | these artifacts |

## Honest limits

A full interactive click-through of the running dev stack (port 3886) was not
performed: the Alga Dev IDE automation CLI is currently unresponsive in this
environment and the dev login rotates its password at boot into an
unreachable terminal, so driving the real UI session could not be completed.
The designer behaviour (widget → store → canvas) is instead covered by the
runtime inspector tests above, and the preview/PDF output is produced by the
same evaluator/renderer code the app uses, rendered headlessly to the PNG/PDF
artifacts in this folder.

What a human reviewer should sanity-check first: open the grouped-quote PDF
above and confirm the two totals rows read as distinct teal/crimson bands, then
open any saved grouped quote in the designer and confirm the row cards appear
under a "Totals Rows" inspector panel with per-row background/text pickers.
