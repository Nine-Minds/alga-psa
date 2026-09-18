# PRD — Update-Action Patch Fields UX

**Status:** Draft (pending approval)
**Branch:** `feature/workflows-update-patch-ux`
**Date:** 2026-08-22

## Problem statement

Update-style business actions in the workflow designer (`tickets.update_fields`, `contacts.update`, `clients.update`, `projects.update`, `opportunities.update`) take a nested `patch` object: every field is optional, and only fields the author fills in are changed on the existing record. The Input Mapping editor renders this as a flat pile of individual fields ("Object fields" under a "Patch object" group), each with a Reference/Fixed/Expression source-mode dropdown and an optional Raw JSON mode.

Nothing in the UI communicates the central mental model: **you are modifying an existing record, and anything you leave blank keeps its current value.** Less technical users read the panel as a blank form — they either think they must fill everything in, or don't understand why filling one field didn't wipe the others, or can't tell at a glance what the step will actually change. Jargon compounds it: "Patch object", "Attributes merge", "Idempotency Key", "expected_updated_at" appear as peer fields next to Status and Priority.

## User value

Non-technical workflow authors can configure "update this ticket/contact/client" steps correctly on the first try, and anyone reading a workflow can see at a glance exactly which fields a step changes and to what.

## Goals

1. Make the edit-existing-data framing explicit: the panel states what record is being updated (and where it comes from), and that untouched fields keep their current values.
2. Replace the flat everything-at-once field pile with a **changes-first** model: the author explicitly adds each field they want to change; every configured row reads as "Set <Field> to <value>"; everything else is visibly "unchanged".
3. A readable change summary of the step (on the step card and/or panel footer): "Changes Status and Priority · everything else unchanged".
4. Move plumbing fields (`expected_updated_at`, `idempotency_key`) and power features (Raw JSON mode, `custom_fields`/`attributes` records) out of the primary flow into an Advanced section.
5. Plain-language copy throughout: no "Patch", "merge", or schema jargon in the primary UI.
6. Generic implementation: driven by the action schemas (the `patch`-object shape), not hardcoded per action, so all five update actions (and future ones) get the UX automatically.

## Non-goals

- No changes to the action input schemas, runtime patch semantics, or REST/temporal execution — this is a UI-layer redesign; the same definition JSON is produced.
- No redesign of `transform.assign` / the MappingExprEditor (separate surface, out of scope).
- No live fetching of the target record's current values at design time (the record is usually only known at run time). "Current value" affordances are framing, not data.
- No changes to the source-mode system (Reference/Fixed/Expression) itself or the picker infrastructure — reused as-is inside the new rows.
- No changes to create-style actions (their blank-form rendering is correct).

## Target users / primary flows

MSP admins authoring workflows; explicitly including less technical users.

1. **Configure an update:** add `Update Ticket Fields` step → pick which ticket (existing target-id field) → "Add a field to change" → pick Status → choose value (picker/fixed/expression) → summary shows "Changes: Status".
2. **Read an existing step:** open a workflow someone else built → the step card and panel summarize what it changes without expanding every field.
3. **Stop changing a field:** remove its change row; the field returns to "keeps its current value".
4. **Power use:** open Advanced for raw JSON, attributes/custom fields, concurrency/idempotency inputs.

## UX/UI notes

Three candidate UI shapes were mocked against the existing mapping-editor chrome (see SCRATCHPAD for mockup location); decision pending review:

- **Option A — Changes list ("rule builder"):** panel starts with a target banner ("Updates the ticket from *Ticket created*; fields you don't add keep their current values") and an empty changes list + "Add a field to change" dropdown; each change is a sentence-shaped row "Set **Status** to <value>" with the existing source-mode control tucked behind the value; removable per row.
- **Option B — Full form with explicit unchanged states:** keep all fields visible, but every row defaults to a muted "Keeps current value" state with an explicit "Change" toggle per field; changed rows highlight (accent bar + "will change" chip) and offer "Revert to unchanged".
- **Option C — Summary-first with drill-in:** the collapsed step shows only the change summary and target; editing opens a two-column dialog — left: field catalog grouped (Details / Assignment / Dates / Tags), right: the configured changes; closest to a "diff you author".

**DECISION (2026-08-22, Robert): Option C — summary-first step card + two-pane change dialog.** The step card reads as the change summary ("Updates the ticket from 'Ticket created' · Changes Status, Priority, Due date · all other fields unchanged"); editing opens a dialog with a grouped field catalog (Details / Assignment / Dates & tags / Advanced) on the left and the authored changes ("Set <Field> to <value>" rows) on the right. Mockup: `/tmp/workflow-update-ux-options/patch-c.html` (copy archived alongside this plan as `mockup-option-c.html`).

Common to all options:
- Target framing header derived from the action's id field (`ticket_id` etc.) and its configured source ("the ticket from step *Ticket created*", "a fixed ticket", "from expression").
- Existing primitives (`@alga-psa/ui` Button/Card/Badge/CustomSelect/Switch, `StructuredLiteralGroup` styling), i18n via `useTranslation('msp/workflows')`, stable `id`s, ReflectionContainer.
- Existing source-mode + picker components reused unchanged inside change rows (including dependent pickers like `patch.assignment`).
- Validation: the schema's "Patch must include at least one field" surfaces as friendly inline guidance ("Add at least one field to change") instead of a schema error.
- Step-card summary uses field display labels, capped with "+N more".

## Data model / API notes

- Definition JSON emitted is unchanged: same `patch` object, same source-mode encodings. Absent = unchanged, exactly as today.
- Detection of "update-style action" is schema-driven: an input object property named `patch` (object, described as patch) — same signal `InputMappingEditor` already receives via `ActionInputField.children`. Add a UI hint in the action registry (`ui.updateTarget`?) only if schema inference proves insufficient; prefer inference.
- Existing hardcoded dependent-picker path list (`WorkflowActionInputFixedPicker.tsx` `candidatePaths` including `patch.assignment.primary.type`) must keep working; generalizing it is optional cleanup, not required.

## Risks / rollout

- The mapping editor renders all actions through one generic pipeline; the patch-specific presentation must not regress non-patch actions — gate on the `patch`-object detection.
- Existing workflows with configured patch fields must load into the new UI showing exactly those fields as changes (round-trip fidelity).
- Migration/back-compat: none needed at data level (definition JSON unchanged).

## Open questions

- ~~Which of the three UI options (A/B/C)?~~ Resolved: Option C.
- Dialog vs side panel: Option C's editor is a modal dialog, diverging from the inline mapping panel other actions use. Confirm during implementation that the dialog hosts the existing mapping-field components without forking them (the panel remains for non-patch actions).
- Should the Advanced section include `expected_updated_at`/`idempotency_key` per-action, or hide them entirely behind a designer-level "show advanced inputs" preference? (Current plan: collapsed Advanced section per step.)

## Acceptance criteria / definition of done

- Opening any `*.update*` action's input panel shows the target framing ("updating the existing X; unlisted fields keep their current values") and a changes-first presentation per the chosen option.
- Only fields the author explicitly adds/enables are emitted into `patch`; removing a change removes the key; existing definitions round-trip losslessly.
- Step card / panel shows a plain-language change summary.
- `expected_updated_at`, `idempotency_key`, raw JSON, and record-typed fields (`custom_fields`, `attributes`) live in an Advanced section.
- No "Patch object" / merge jargon in primary copy; all new strings translated with defaults.
- All five update actions get the UX with zero per-action UI code; create-style actions render exactly as before.
- Dependent pickers (assignment inside patch) still function.
