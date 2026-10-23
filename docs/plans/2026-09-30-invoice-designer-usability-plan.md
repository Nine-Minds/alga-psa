# Plan — Invoice designer usability

Card: bdaeb651 "Improve designer functionality". Base: `main @ 228d983a4a`.
Branch: `feature/improve-designer-functionality`.

This plan is retroactive: the design session ran as an evaluation-driven loop and the
implementation is already on the branch. The full ALGA plan (PRD, feature checklist,
test checklist, scratchpad) lives in
[`ee/docs/plans/2026-09-30-invoice-designer-usability/`](../../ee/docs/plans/2026-09-30-invoice-designer-usability/PRD.md);
this file is the card's design-session deliverable and summary.

## 1. Problem

First-time users could not predict what the invoice / quote layout designer would do:
no typography controls, layer names lost on save, inserts landing in unrelated
containers, no way to move blocks without dragging, three conflicting sizing systems, a
canvas that did not match the rendered document, duplicate layouts on re-save, and no
way to author table widths, the company-logo binding or translated labels.

## 2. How the scope was set

A fresh evaluator rebuilt the shipped Detailed invoice layout from a blank layout using
UI operations only and rated the experience 1–10; its friction list drove each round of
changes, and each saved replica was diffed against the source AST for faithfulness.
Scores: 4, 6, 6, 7, 7, 7, 8, 8, 8 (exit condition: three consecutive ratings above 7
with faithful replicas).

## 3. What changed (summary)

- **Structure:** predictable "+" placement (inside / after / page end) with an on-canvas
  marker; Arrange toolbar and shortcuts for reorder, move in/out, copy, cut, paste,
  duplicate, copy/paste style, delete; page accepts every block type; always-visible
  Outline.
- **Inspector:** Content / Style / Layout & size tabs; "Set on this block" summary;
  typography; per-side spacing with explicit "Same on all sides"; unified Size control.
- **Data:** layer names persist (`name` on AST nodes); company-logo binding; column
  widths / alignment as column CSS; real default table columns and totals rows; binding
  picker drives label, format and layer name; canonical binding ids on export.
- **Translation:** standard document label catalog; translated defaults; auto-link of
  exact standard text; "Use fixed text" opt-out; all new UI strings in 7 locales.
- **Canvas / editor:** WYSIWYG typography, surfaces and spacing; editor fits the
  viewport; Save stays in the editor and a new layout saves as one record.
- **Renderer:** authored table corners render (separate borders when rounded).

## 4. Remaining card steps

- Smoke Test: exercise the create → build → save → reopen → preview journey in the real UI.
- Pull Request, review preparation, human review, CI, merge, deploy per the board template.

## 5. Risks

- The shipped Detailed template's line-items table now shows its authored rounded
  corners in preview / PDF output.
- Designer defaults for new blocks changed (content-sized blocks, Totals 300px right,
  Logo bound to the company logo); existing layouts are unaffected.
