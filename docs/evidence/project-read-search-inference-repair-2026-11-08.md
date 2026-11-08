# Project search redaction repair evidence

**Tested repair revision:** `f9c2736f0486a13ad72c893aa4458d8d7ff854a3`

The primary specification is [the project read field redaction plan](../plans/2026-11-03-project-read-field-redaction.md). This repair makes the search path follow its child-read denial and field-projection rules.

## Action-level PostgreSQL results

The production `searchProjectListIds` SQL ran against a dedicated, disposable `pgvector/pgvector:0.8.7-pg15-bookworm` container on `127.0.0.1:55842`, database `project_search_test`. It did not connect to `.env.localtest`'s shared `server` database. Test setup used `SECRET_READ_CHAIN=env` and credentials scoped to that disposable container; credential values are intentionally omitted here.

Command:

```sh
node scripts/run-workspace-db-tests.mjs ../packages/projects/src/actions/projectActions.searchRedaction.db.test.ts
```

Connection environment for that command: `DB_HOST=127.0.0.1`, `DB_PORT=55842`, `TEST_DB_NAME=project_search_test`, `DB_NAME_SERVER=project_search_test`, and disposable-container credentials for the admin and app connections.

Observed on `f9c2736f0486a13ad72c893aa4458d8d7ff854a3`: **1 file, 3 tests passed**.

| Search term / fixture | Expected | Observed action result |
| --- | --- | --- |
| `Project Nacre-9162 Lantern` on the project with redacted current name, with cached copies in project/phase/task/comment index rows | No project ID | No matching ID |
| `Nacre-9162` on that same fixture | No project ID | No matching ID |
| `PRJ-9162` on that same name-redacted project | Authorized project ID; number remains visible | Project ID returned |
| `Needlewood` in a visible task description under the name-redacted project | Authorized project ID | Project ID returned |
| Old cached name `Project Nacre-9162 Lantern` and fragment `Nacre-9162` after the source project was renamed to `Current Alder Portfolio` | No project ID | No matching ID |
| `Alder` from the current name after project-name redaction | No project ID | No matching ID |
| `HarborVault` in the body of a project index entry whose current `projects.description` is redacted | No project ID | No matching ID |
| `CommentVault` in a comment entry whose parent has a project-name redaction | No project ID because comment read is denied on any parent redaction | No matching ID |
| `PRJ-9163` and visible child description `Needlewood` | Authorized project ID | Both returned the authorized project ID |
| `PRJ-9164` for a denied project and `PRJ-9165` for a wholly redacted project | No project IDs | Neither ID returned |

These assertions execute the SQL action against real PostgreSQL, including the rebuilt effective search vector. The renamed fixture uses stale cached titles/subtitles while source phase/task names remain current, so stale index metadata cannot satisfy the hidden-name query.

## Focused checks on the same revision

- `npx vitest run --config vitest.config.ts src/components/Projects.redaction.render.test.tsx src/lib/projectReadProjection.test.ts src/actions/projectActions.projectRedaction.test.ts` from `packages/projects` — passed, 3 files / 12 tests.
- `npm run typecheck` from `packages/projects` — passed.
- `npm run build` from `packages/projects` — passed.
- `git diff --check` — passed before commit.

The component test covers the displayed-row path with a mocked action result: hidden-name/fragment searches display no row, while a visible-number result displays the authorized row with the hidden-name fallback. This remains an offline component check; it is not live smoke and does not replace the PostgreSQL action results above.

## Live smoke

Live smoke remains **unperformed**. The app server was stopped, and no app server or production review app was started. A downstream reviewer should use an already-running authorized app, search `Project Nacre-9162 Lantern`, `Nacre-9162`, and `PRJ-9162` for a project whose read decision redacts its name, and verify both the returned project selection and displayed row behavior. The full name and fragment should return no project ID or row; the visible number should return the authorized project with the hidden-name fallback label.

## First review target

Inspect `searchProjectListIds` in `packages/projects/src/actions/projectActions.ts`: the indexed fields are projected from their current source rows before the search vector is built in a second CTE, redacted project descriptions are nulled, and comment entries are excluded whenever their parent decision has any redaction. Then review the action-level PostgreSQL fixtures in `packages/projects/src/actions/projectActions.searchRedaction.db.test.ts`.
