# Design — a note-only evidence edit survives a "Source removed" citation

Card `b25b323d` — Opportunity stage evidence: allow a note-only edit while a "Source removed" citation
is listed (Joymode, alga-2026-0002932).

Builds on the citation feature from card `5654bdb6` / PR #4397 (stream: declare a stage with a note and
any number of the deal's own interactions/documents as sources). Line references are to that branch until
it merges.

## The problem, precisely

- Edit mode of `DeclareStageDialog` submits `{ note, citations }` where `citations` is **the whole list the
  dialog shows**, including entries whose source is gone (`missing: true`, rendered as a muted
  "Source removed" badge, `OpportunityStepTimeline.tsx:386-390`).
- `writeDeclaration` in `packages/opportunities/src/lib/stageEngine.ts` guards **every supplied citation**
  with `assertRefBelongsToOpportunity` before writing anything ("One bad citation refuses the whole write",
  `:243-247`).
- A document that was unlinked from the opportunity (or an interaction that was deleted) no longer resolves,
  so the guard throws `OpportunityDeclarationError` and the *entire* edit is refused. The user's note is
  lost, and the stage's evidence becomes effectively immutable — while the UI is explicitly telling them
  the source is gone and offering a remove control.

## Decision 1 — guard the citations an edit *introduces*, not the ones it *keeps*

In `writeDeclaration`, partition the supplied citations against the live declaration (`current.citations`,
already computed there):

| supplied vs live | handling |
| --- | --- |
| present in live (same `type` + `id`) | carried forward unchanged, **no validation** |
| not in live | validated with `assertRefBelongsToOpportunity`; failure refuses the whole write |
| in live, absent from supplied | dropped from the new declaration |

Only a **new** citation can refuse the write. The guard exists to stop a client asserting a source that
does not belong to this deal — not to freeze a declaration forever because one of its sources was later
detached. A citation was validated when it was recorded; its disappearance is precisely what the
"Source removed" badge reports, and the row is history that must stay amendable.

This keeps the existing patch semantics (`content.citations === undefined` → leave citations alone) and
extends them to the round-trip case.

## Decision 2 — fix it in the engine, not in the dialog

The tempting narrow fix is "in edit mode, omit `citations` when the user did not touch them". Rejected: it
makes correctness depend on a client convention, leaves every other caller (server action, EE, tests,
future UI) able to hit the same wall, and silently changes what the dialog means to submit. The dialog
keeps sending what it shows; the engine accepts a declaration that repeats its own live citations.

## Decision 3 — a dead citation is removed explicitly, never automatically

No pruning on read or write. If the user wants the removed source gone from the declaration they use the
existing remove control (already rendered for `missing` sources); otherwise the citation stays and keeps
saying "this is what the stage cited". The only writes that delete citation rows are a user's removal or a
stage correction's supersede — unchanged by this card.

## Edge cases

- **Note-only edit with a dead citation listed** → written; note changed, citation rows identical, one
  supersede of the evidence row as today.
- **User removes the dead citation in the same edit** → written without it (dropped is always allowed).
- **Re-adding a source that is no longer attached** (removed in an earlier edit, now added again) → it is
  new relative to the live declaration → validated → refused with the existing user-facing message
  ("That source is not attached to this opportunity"). That is the guard doing its job.
- **Legacy checkpoint with several live declarations** → `current` is the newest; unchanged means present
  in that newest declaration. Unchanged behaviour.
- **No note and no citations** → unchanged (nothing to write when there is no live declaration).

## Tests

In `packages/opportunities/tests/stageEngineCitation.test.ts`:

1. amend only the note while the live declaration cites a document that has since been unlinked → written,
   citation rows preserved, no validation error;
2. supply a genuinely foreign citation → refused, and nothing written (no supersede, no new row);
3. drop the dead citation → written without it;
4. drop then re-add across edits → second edit refused.

In `declareStageDialog.test.tsx`: edit mode with a `missing` source keeps submit enabled and round-trips
the source in the submitted content (guards the client contract this design relies on).

## Explicitly out of scope

- Garbage-collecting orphaned citation rows, or remembering a removed source's last label.
- Permission-aware validation (the guard checks attachment, not read access; unchanged).
- Any change to the declare path's ordering, the supersede rules, or the ladder UI.
