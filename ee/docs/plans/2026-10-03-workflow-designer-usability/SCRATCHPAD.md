# Scratchpad: Workflow Designer Usability

- Plan slug: `2026-10-03-workflow-designer-usability`
- Created: `2026-10-03`. Written after the implementation loop finished.
- Ticket: `alga-2026-0002481`. Card: `b123a873`. Commit: `72f3861c65`.

## What This Is

These are the working notes from the usability loop behind this card:

- how the loop ran
- what each round found
- the decisions that matter beyond this card
- the gotchas the next engineer on the designer will hit

## Method (usability loop)

- **Evaluator.** Each round, a fresh evaluator agent played an MSP admin new to the designer. It built one of five scenario workflows (see the PRD's Primary Flows) through the UI only, driving a browser pane with `alga-dev`.
  - Not allowed: reading source, querying the database, calling APIs, or using `browser-eval` to change state.
  - Required: save, publish, try a test run, and pause.
- **Grading.** Scores ran from 1 to 10: 1–3 very poor, 4 sub-par, 5–6 usable but problematic, 7 good, 8+ pro grade.
- **Fixer.** Between rounds, one long-lived fixer agent worked the ranked friction list. It fixed root causes generally and never for the scenario. It added focused tests, type-checked, and confirmed the dev server recompiled.
- **Stop rule.** Three consecutive scores of 8 or more on different scenarios, with no code change between them. The code was frozen from round 9 on. Friction found during the freeze was queued; see the PRD's Follow-ups.

| Round | Scenario | Score | What held it back |
|---|---|---|---|
| 1 | Ticket escalation | 4 | Conditions needed UUIDs from URLs; step insertion unpredictable; first click on selects missed; no recipient picker; Run dialog ticket search always empty. |
| 2 | Customer reply triage | 6 | New Assign-to picker didn't commit; arrays needed hand-written `[...]`; latest comment buried. |
| 3 | Contract-end date trigger | 6 | Pausing from settings failed; Fill defaulted to Reference; text built by `&` concatenation; no contract picker in the Run dialog. |
| 4 | Onboarding loop | 7 | Loop variable missing from Text mode; sample values survived a record pick. |
| 5 | Try/Catch fallback | 6 | Semantically wrong suggestions; the captured error name was never offered; references took about 5 dropdowns. |
| 6 | Ticket escalation | 7 | Back after first save showed an empty form; If branches leaked outputs; three stacked controls per input. |
| 7 | Customer reply triage | 7 | Opaque payload validation; no truncate function; invalid defaults; comment visibility defaulted to public. |
| 8 | Contract-end date trigger | 7 | Email body had no Text mode (regression); date-trigger payload fields not derived. |
| 9 | Onboarding loop | 8 | Frozen from here. |
| 10 | Try/Catch fallback | 8 | |
| 11 | Ticket escalation | 8 | Loop complete. |

## Decisions

- **The expression stays the source of truth for conditions.** The condition builder parses the stored expression into a model and writes it back. Anything it can't represent stays in Expression mode, so no condition is ever rewritten without the author knowing.
- **Text mode compiles to the joined expression the runtime already runs** (`"a" & vars.x & "b"`). There was no runtime change. Only workflow roots inside `{{…}}` count as fields. Other `{{name}}` placeholders stay literal, because Send Email's `template_data` relies on them.
- **One "Value from" control replaces the mode dropdown.** Choosing a source is choosing the mode. Rounds 3 and 5 disagreed about the default mode (pickers versus references). The fix was a chooser that offers both, not flipping the default again.
- **Reachability lives in one place,** the `buildDataContext` walk. Reference options, Insert field, the chooser, condition fields and suggestions all read from it. Before this, each had its own walk, and they disagreed.
- **The comment visibility runtime default stays `public`** because existing workflows rely on it. The designer instead requires an explicit choice through `x-workflow-explicit-choice`.
- **Paused workflows can't be test-run.** The runtime refuses them with a 409, so the Run button explains why instead. A safe test path for drafts and paused workflows is a follow-up.
- **The date-trigger offset is signed: the run fires on `occursOn + offsetDays`.** The scheduler (`dateTriggerLauncher`) and the Run dialog share `dateTriggerOccurrence.ts`, so the two can't drift apart.
- **Ticket search in the Run dialog uses the bounded `optimizedTicketActions` search.** The old picker read `.tickets` from an action that returns a plain array, which is why it was always empty.

## Discoveries / Constraints

- **Radix Select scroll buttons caused the missed first clicks.** The buttons appear and disappear between mouse-down and mouse-up, shifting every option by 24px. Radix only selects when both events land on the same option. Removing the buttons from `CustomSelect` fixed this app-wide.
- **Fixed pickers worked out their dependencies by object identity.** Callers that passed a new `{}` on every render triggered option reloads that unmounted the open list before the click landed.
- **`history.replaceState(window.history.state, …)` after the first save** carried Next 16's `__NA` flag. Next treated the call as its own and never updated its router URL, so Back restored `/new`.
- **Errors thrown from server actions lose their custom fields on the way to the browser.** Structured payload issues therefore have to be returned, not thrown, through the opt-in `reportPayloadIssues` flag.
- **Inside Catch, the runtime binds the normalized error twice:** as `error`, and as `vars.<captureErrorAs>`. Fields: `category`, `message`, `nodePath`, `at`, plus `code` and `details` when present. `stack` and `name` are never set.
- **The runtime binds the loop index as the bare local `index`** (also `local.index`), never `$index`.
- **A large-text dialog used to exclude a field from Text mode.** That is why the email body regressed in round 8. `workflowTextInput.ts` now makes the free-text and multi-line decision in one place, and editor metadata never removes Text mode.

## Commands / Runbooks

- Designer tests: `cd ee/server && npx vitest run src/components/workflow-designer src/components/workflow-run-studio src/components/workflow-graph`
- Runtime tests: `npx vitest run shared/workflow/runtime` (the `*.db.test` files need Postgres)
- Package tests: `cd ee/packages/workflows && npx vitest run`, and `packages/ui` likewise.
- Full `ee/server` type-check runs out of memory. Use a focused `tsconfig` that includes only the touched files.

## Gotchas

- **`WorkflowWaitEditors.test.tsx` fails at import** on a stale `packages/portal-shared/dist`. This happened before the branch and fails the same way on main. As a result, the Wait for Time default change (F050) has no UI test.
- **Running `next dev` with hot reload for a long time can run out of heap** after about 1.8 hours of edits. The server ran with `NODE_OPTIONS=--max-old-space-size=12288`. Restart it after changing shared runtime modules, because registered action and node metadata may not refresh through HMR.
- **Browser panes on the same host share one session cookie** (`authjs.session-token.<port>`). A sign-in or sign-out in one pane changes the session in every other pane on that host. Give a test pane its own hostname (e.g. `<name>.localhost:<port>`). `NEXTAUTH_URL` still redirects to plain `localhost` after sign-in, so navigate back afterwards.
- **Test runs on this dev stack never reach the engine,** because `TEMPORAL_ADDRESS` points at a cluster host. Runs fail with "engine could not be reached", which is expected here.
- **No database-backed tests cover the new `tickets.find` joins.** The runtime tests use a mocked query builder. Before relying on the new name joins in production, add a DB-backed check of `tickets.find` against a migrated schema, covering both missing related rows and present ones.
- **Features with no dedicated test:** F045 (timezone select), F050 (Wait defaults, see above), F059 (panel resize grip) and F072 (dev-only hot-reload replacement).

## Links / References

- Card plan summary: `docs/plans/2026-10-03-workflow-designer-usability-plan.md`
- Designer: `ee/server/src/components/workflow-designer/`
- Shared designer models: `shared/workflow/runtime/designer/`
- Expression function catalog: `shared/workflow/runtime/expressionFunctions.ts`
- Schema metadata: `shared/workflow/runtime/jsonSchemaMetadata.ts`
- Date-trigger occurrence rule: `shared/workflow/runtime/dateTriggerOccurrence.ts`

## Open Questions

- Should test runs of drafts or paused workflows use the existing simulate action (a dry run with no writes), or a real run that bypasses the pause? This is follow-up 2 in the PRD.
