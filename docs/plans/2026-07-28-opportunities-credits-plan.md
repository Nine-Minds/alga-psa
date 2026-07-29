# Opportunities Credits UI Implementation Plan

## Context

This card was originally named "Improve opportunities UI", but the current
Design Session facts narrow the work to the credits/prepayments opportunity
flow on the renamed `improve/credits-ui` branch. The worktree still reports
`/home/robert/alga-copies/improve-opportunities-ui`; use the card dossier as
the current scope source.

The "Cannot create clients" symptom seen on this branch is a shared database
migration collision from another branch dropping credit tables. Treat that as
environment/base drift to resolve by rebasing onto main after the conflicting
branch lands, not as an opportunities feature bug.

## Scope

- Implement hybrid stage movement: users can manually declare any stage, with
  the evidence recorded as `user_declared` through `stageEngine`, while the
  existing quote lifecycle still auto-advances stages.
- When an opportunity reaches Won, automatically promote prospect clients to
  active.
- Keep the Queue tab cards restyled to match the Suggestions card sizing, add
  a cards/datatable view toggle, and turn the decorative queue circle into a
  real click-to-complete control.
- Add v1 actions guidance using built-in stage-based suggested next actions.
  The user can accept a suggestion or enter free-form action guidance.
- Defer per-client playbooks, industry playbooks, and tenant-level actions
  configuration.
- Extract opportunities copy into an `msp/opportunities` namespace, following
  the `msp/clients` client command center pattern.
- Provide translations for `en`, `de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`,
  and pseudo-locales.
- Replace server-composed user-facing opportunity sentences with structured
  translation keys.
- Remove the standalone Add prospect button.
- Add `onAddNew` quick-add to `ClientPicker` in `CreateOpportunityDialog`,
  defaulting new clients to `lifecycle_status=prospect`.

## Implementation Notes

- Keep stage mutation evidence explicit so downstream history can distinguish
  automatic quote lifecycle movement from manual declarations.
- Make the Won-to-active client promotion transactional with the opportunity
  stage update where practical, or clearly handle partial failure if existing
  service boundaries prevent that.
- Keep the action-guidance v1 data model simple enough to support fixed
  built-in suggestions now without blocking later tenant-configured playbooks.
- Preserve the existing opportunity UI information density; this is an
  operational workflow screen, not a marketing page.
- Do not treat the shared-database migration collision as feature scope.

## Verification Plan

- Add or update focused behavioral tests for manual stage declaration evidence,
  quote lifecycle auto-advance preservation, and Won prospect-to-active
  promotion.
- Add or update UI tests or component tests covering Queue cards/datatable
  toggle behavior, click-to-complete behavior, stage-based action guidance,
  and ClientPicker quick-add defaulting new clients to prospect.
- Run the relevant opportunities unit/component test subset.
- Run translation validation after extracting `msp/opportunities` keys.
- Smoke the create-opportunity flow enough to confirm ClientPicker quick-add
  works when the shared DB migration collision is not present.

## Stop Condition

Draft Implementation should make the code changes and leave the card at the
Implement layout step for captain review, per bridge order
`92a87130-13a8-4906-b425-3135ac557bc3`.
