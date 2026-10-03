# Plan: Workflow designer usability

- **Ticket:** alga-2026-0002481
- **Card:** b123a873, "Workflow designer UI improvements: discoverability, add-step flow, field mapping"
- **Branch:** `feature/workflow-designer-ui-improvements-discoverabilit`
- **Implementation commit:** `72f3861c65`

This plan was written after the work was done. The design session ran as an evaluation-driven loop, and the implementation is already on the branch.

The full ALGA plan is in [`ee/docs/plans/2026-10-03-workflow-designer-usability/`](../../ee/docs/plans/2026-10-03-workflow-designer-usability/PRD.md): the PRD, 72 features and 30 tests (all implemented), and the scratchpad. This file is the card's design-session deliverable and summary.

## 1. Problem

First-time admins could place a trigger in the EE workflow designer, then didn't know what to do next.

- **Comparing against named records was impractical.** "Priority is P1" meant copying UUIDs out of another page's URL.
- **Filling an input took several dropdowns,** then hand-written JSONata.
- **Placing steps was unpredictable.**
- **Suggestions were type-blind.**
- **Some designer options resolved to nothing at run time.** Examples: the loop `$index`, the caught error's `stack`/`name`, and the Try/Catch capture name.
- **Testing a workflow meant pasting UUIDs into JSON.** It then returned errors that explained nothing.

## 2. How the scope was set

Each round, a fresh evaluator agent built one of five realistic MSP workflows using only the designer UI, then graded it from 1 to 10:

1. ticket escalation
2. customer-reply triage
3. contract-end date trigger
4. onboarding loop with a wait
5. Try/Catch email fallback

A fixer agent fixed the root causes of each friction list before the next round.

Scores: 4, 6, 6, 7, 6, 7, 7, 7, 8, 8, 8. The exit condition was three consecutive scores above 7, on different scenarios, with the code frozen.

## 3. What changed (summary)

- **Discovery:**
  - The trigger panel lists the fields its payload carries and offers a one-click, pre-wired lookup step.
  - Palette and event search are ranked and understand synonyms.
- **Structure:**
  - Steps insert where expected, at always-visible "+" points.
  - Each step sees only data from steps on its own execution path.
  - Default output names are unique.
- **Conditions:** a builder with entity pickers, and plain-English step summaries.
- **Inputs:**
  - One "Value from" control and one searchable field picker.
  - Text mode with fields and a preview for every free-text input, checked across the whole action catalog.
  - Suggestions that respect type, record kind and role.
  - Purpose-built assignment and recipient editors.
  - Comment visibility must be chosen explicitly.
- **Runtime parity:**
  - The designer and the runtime share one expression function catalog, which adds `truncate` and `substring`.
  - One caught-error definition.
  - The loop index is `index`.
- **Lifecycle:**
  - A "Saved" indicator, a publish confirmation and an Active/Paused switch.
  - A session-expired dialog that keeps your draft.
  - Back after a save works.
  - Pausing from settings works.
- **Run dialog:**
  - A picker for every kind of record ID.
  - Fill a payload from a real record.
  - Date-trigger dates derived from the trigger.
  - Inline, plain-language validation.
  - Draft payloads are kept.
  - Clear engine errors.
- **Run Studio and the workflow list:**
  - Steps are shown by name, and the run source is labelled.
  - The workflow list has a row menu and an accurate "Unpublished changes" badge.
- **Shared UI:**
  - `CustomSelect` first-click fix.
  - `SearchableSelect` ranking, groups and wider popovers.
  - Search inside multi-user pickers.

## 4. Remaining card steps

- **Smoke Test:** run the five primary flows in the real UI. Build, publish (confirm), test-run against a real record, read the run outcome and pause.
- **Done before Smoke Test:** PRD follow-up 1. Example copy taken from the evaluation scenarios was replaced with neutral wording.
- **Pull Request, review preparation, human review, CI, merge and deploy:** as set by the board template.

## 5. Risks

- **If branches:** an If-branch step can no longer reference the other branch's outputs. Existing references now show as unavailable.
- **Comment visibility:** comment steps that never set visibility show "1 required missing" in the designer. Runtime behaviour is unchanged.
- **App-wide UI changes:** `SearchableSelect` ordering, the multi-user picker search and `CustomSelect` scrolling change everywhere in the app.
- **Fewer suggestions:** "Apply suggestions" now fills far fewer inputs, by design.
- **Untested:** the Playwright specs were updated but not run, and the new `tickets.find` name joins have no database-backed test.
