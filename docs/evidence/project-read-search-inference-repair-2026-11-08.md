# Project search redaction repair evidence

**Repair revision:** `46e9baaf21b8b9ee155c58e695174bfd15dcdb51`

The branch has a committed specification at `docs/plans/2026-11-03-project-read-field-redaction.md`; this repair extends its read-projection contract to project list search.

## Terms and expected behavior

- Hidden project name: `Project Nacre-9162 Lantern`.
- Distinctive fragment and identifier-shaped copy: `Nacre-9162`.
- Visible project number: `PRJ-9163`.
- Expected action results: the hidden name and fragment return no project ID when the project name is redacted; the visible project number and visible child text return the authorized project ID. Denied and wildcard-redacted projects return no IDs.
- Expected displayed rows: with no ID returned for either hidden-name query, the redacted project row is absent. Searching its visible project number still displays the row using the hidden-name fallback label.

## Executed evidence at the repair revision

- `npx vitest run --config vitest.config.ts src/components/Projects.redaction.render.test.tsx src/lib/projectReadProjection.test.ts src/actions/projectActions.projectRedaction.test.ts` — passed, 3 files / 13 tests. The projection test removes `Project Nacre-9162 Lantern` and `Nacre-9162` from title, subtitle, and body fields across project, phase, task, and comment entry types while retaining visible text. The rendered-list test passed with the hidden name and fragment when the action supplied no IDs, and displayed the project row for `PRJ-9163` when the action supplied its authorized ID.
- `npm run typecheck` from `packages/projects` — passed.
- `npm run build` from `packages/projects` — passed.
- `node scripts/run-workspace-db-tests.mjs ../packages/projects/src/actions/projectActions.searchRedaction.db.test.ts` — **not executed**. The runner failed before test setup with `password authentication failed for user "postgres"`; both PostgreSQL behavioral cases were skipped. Those cases encode returned-ID assertions for the hidden name and fragment in project, phase, task, and comment index entries (including an identifier-shaped metadata copy), visible project number and child text, denied projects, and wholly redacted projects. Their action-level results remain unobserved locally.

## Live smoke

Live smoke was not performed. The product app server was stopped for this task and was not started or replaced. No fresh browser or live-action result is claimed. A downstream reviewer should run the two hidden-name searches and `PRJ-9163` against the running authorized MSP app using a project whose read decision redacts `project_name`, and confirm both returned IDs and displayed rows. The PostgreSQL suite above should also be rerun against an authorized workspace test database.

## First review target

Inspect `packages/projects/src/actions/projectActions.ts` at `searchProjectListIds`: authorization now precedes matching, project-name copies are removed from indexed text fields, and the search vector is rebuilt from the effective projection before FTS/prefix/trigram matching. Then inspect `packages/projects/src/actions/projectActions.searchRedaction.db.test.ts` for the action-level database assertions that could not execute in this environment.
