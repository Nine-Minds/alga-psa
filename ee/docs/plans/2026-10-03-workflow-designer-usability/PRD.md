# PRD: Workflow Designer Usability

- Slug: `2026-10-03-workflow-designer-usability`
- Date: `2026-10-03`
- Status: Implemented. This plan was written after the work: Draft Implementation and Implement are both complete on the branch.
- Ticket: `alga-2026-0002481`
- Card: `b123a873`
- Branch: `feature/workflow-designer-ui-improvements-discoverabilit`
- Implementation commit: `72f3861c65`

## Summary

An MSP admin opening the EE workflow designer for the first time can now build a common workflow without help:
- trigger
- lookups
- conditions on named records
- branches
- loops
- waits
- error handling
- email and in-app notifications
- data-store counters

They can then publish it, test-run it against a real record, and pause it.

A usability loop drove the work. In each round, a fresh evaluator agent built one of five realistic workflows using only the designer UI. It then graded the experience from 1 to 10 and listed what got in the way. An engineer fixed the root causes of that friction before the next round.

Scores by round: 4, 6, 6, 7, 6, 7, 7, 7, 8, 8, 8. The loop ended after three consecutive 8s, on three different scenarios, with the code frozen.

## Problem

Before this work, a first-time admin could place a trigger and then didn't know what to do next.

**Conditions and data**
- Conditions were plain text. Ticket lookups returned only ids, so "priority is P1" meant digging UUIDs out of another page's URL.
- Event payloads carry ids only. Nothing suggested loading the record first.
- Mapping an input to an earlier step's output meant moving through mode, scope, step and field dropdowns, then hand-writing JSONata for anything beyond a direct copy: text concatenation, lists, the first item of a list.
- Suggestions were name-fuzzy and type-blind. "Apply all" could email the wrong person or send an id into a number field.

**Placing steps**
- Where a new step landed was unpredictable. Insertion points only appeared on hover.
- The first click on long selects often failed to register.

**Silent failures.** Several designer affordances resolved to nothing at run time:
- the loop `$index`
- the caught error's `stack` and `name`
- the Try/Catch "capture as" name, which was never offered

**Testing, publishing and pausing**
- Test-running meant pasting UUIDs into JSON. Errors came back as "Payload failed validation" or "Failed to connect before the deadline".
- Publishing gave no feedback.
- Pausing from Workflow Settings failed with raw validation JSON.

## Goals

1. **Discoverable building blocks.** Triggers, lookups and actions can be found by intent, and the designer says what a trigger's payload carries.
2. **Records chosen by name.** Conditions and inputs compare against and pick named records (priority, board, user, contract…), never raw ids.
3. **Fill inputs without syntax.** Fill any input from earlier data, fixed values or text with fields, with no JSONata required for common cases.
4. **Predictable structure.** Step placement, branches, loops and Try/Catch behave predictably. Each step only offers data that will actually exist when it runs.
5. **Designer matches runtime.** Everything the designer offers resolves at run time. The two share one function catalog and one caught-error definition.
6. **Safe and clear lifecycle.** Test, publish and pause with real-record test payloads, plain-language errors, and visible state.

## Non-goals

- Starter templates for common MSP workflows. Sibling cards add a status-age trigger and an internal-user email action. Templates belong after those land.
- A dry-run or draft test mode that does not write data. Listed as a follow-up.
- Changing runtime defaults that existing workflows rely on. One example is the comment visibility default, which stays `public` at run time.
- A parallel or new editor. All changes extend the existing designer components.

## Users and Primary Flows

Persona: an MSP operations admin, comfortable with PSA concepts, new to this designer, not a developer.

Primary flows, each exercised end to end by the loop:

1. **Ticket escalation.** Ticket Created → load ticket → If priority is a named priority OR board is a named board → assign, internal note, in-app notification. Else, a public acknowledgement comment.
2. **Customer reply triage.** Customer Replied → load ticket with its latest customer comment → branch on whether there is an assignee → notify the assignee with a truncated reply, or assign the ticket and add a note → set priority.
3. **Contract-end heads-up.** Date trigger N days before contract end, at a local time → find client → create an assigned ticket → templated email that includes the new ticket number.
4. **New-client onboarding.** Client Created → create ticket → For Each over a fixed checklist adding comments → wait N days → re-check → notify if still open.
5. **Assignment notice with fallback.** Ticket Assigned → Try {find ticket, find contact, email the requester} Catch {internal note with the error message} → increment a data-store counter.

Across all five flows, the admin also publishes the workflow (with confirmation), test-runs it against a real record, reads the run outcome, and pauses it.

## UX / UI Notes

**Trigger panel**
- Lists the fields the event payload already carries.
- Offers a one-click lookup step (e.g. "Add 'Find Ticket'"), with the id already wired.
- Gives event-specific tips, such as where the reply text lives.

**Palette**
- Search is ranked: exact, then prefix, then phrase, then words, then synonyms, then nested fields. Business actions rank above generic transforms.
- When searching, results show as a list with full names.
- An empty search result shows a "No matches" state.
- A header says where the next step goes ("Adds to: End of If › Else").

**Pipeline**
- "+" insertion points are always visible, and empty branches can be clicked.
- New steps go after the selected step or into the selected branch.
- If cards show a plain-English summary using record names.

**If step**
- A condition builder: match all/any, then field / operator / value.
- The value uses the entity picker for the field's kind, or a select for enums and booleans.
- Expression mode is still available for conditions the builder can't represent.

**Inputs**
- Each input has one "Value from" control: a field from earlier steps or the trigger, a specific record, text, a fixed value, or an expression.
- Every input uses one searchable, grouped field picker. Groups are the trigger, each step, the loop item, the caught error, and the workflow run. Labels are friendly and the path is shown.
- Free-text inputs use Text mode:
  - `{{field}}` placeholders, inserted at a deliberately placed caret or appended at the end
  - chips for the fields used
  - an Expand dialog
  - a preview with sample data, using the first loop item inside a For Each
- Purpose-built editors for:
  - ticket assignment ("Assign to")
  - in-app recipients (users / roles)
  - email recipients (address chips)
- Comment visibility is an explicit choice: "Internal: only your team can see it" or "Public: the customer can see it".
- Inside a Try, steps with not-found options offer "Fail so Catch can handle it".

**Header**
- Valid / Invalid badge.
- "Saved · N min ago".
- Published vN, plus a "Next version to publish" explanation.
- Active/Paused switch. The first publish asks for confirmation and says what will trigger the workflow.

**Run dialog**
- Form Builder by default.
- A picker for every entity id in the payload; date and date-time pickers.
- "Fill from a real record", which replaces untouched sample values.
- Date-trigger occurrence fields are derived from the trigger.
- Validation issues appear inline under each field, in plain language.
- The draft payload is kept per workflow.
- Engine-unreachable failures are explained in plain language, with a "View failed run" link.

**Run Studio**
- Step names instead of action ids.
- Then/else edges no longer cross.
- "Run source: Manual test".
- A "Back to workflow" link.

**Workflow list**
- A row menu: Open, Run…, Pause/Resume, View Runs, Delete.
- An "Unpublished changes" badge that only shows when the draft differs from the published version.

**Lost session.** A "Your session ended" dialog keeps the in-memory draft. A local draft backup is offered on reload.

## Data Model / API / Integrations

There are no schema migrations. Changes are in runtime metadata, action outputs and server actions.

**Schema metadata** (`shared/workflow/runtime/jsonSchemaMetadata.ts`)
- One picker-kind registry, which gains the role, contract and asset kinds.
- Entity-kind annotations on action outputs and on event / date-trigger payload ids.
- Option labels and a failing-value marker for not-found choices.
- Explicit-choice inputs.
- Custom editor kinds: assignment, notification recipients, email recipients.

**`tickets.find` outputs**
- New name fields: client, board, contact, status, priority, category, subcategory, assignee.
- `latest_comment` and `latest_customer_comment`. Customer comments use the same rule as response-state tracking (`ticketComments.ts`).
- Include limits declare their real default (50).

**Expression engine**
- One function catalog, `expressionFunctions.ts`, read by the runtime validator, designer diagnostics, hover, signature help, syntax help and the authoring guide.
- Adds `contains`, `startsWith`, `endsWith`, `lower`, `upper`, `truncate` and `substring`. All are bounded under the 25 ms evaluation budget.

**Shared designer models** (`shared/workflow/runtime/designer/`)
- `conditionModel` parses an expression into a model and serializes it back.
- `entityLookups` maps an id field to its lookup action.
- `caughtError` holds the error fields bound inside Catch: `category`, `message`, `nodePath`, `at`, `code` and `details`. They are bound as both `error` and `vars.<captureErrorAs>`.

**Date triggers.** `dateTriggerOccurrence.ts` is shared by `dateTriggerLauncher` and the Run dialog. An occurrence fires on `occursOn + offsetDays`, so "30 days before" is −30.

**Server actions**
- `startWorkflowRunAction` takes `reportPayloadIssues` and then returns structured issues. Other callers still get a 400.
- New picker and record actions for contracts, assets and the ticket reply summary.
- The launcher returns the run id and a failure reason. Manual starts use a 3 s engine-connect deadline.
- The workflow list action computes `has_unpublished_changes`.
- Settings use clearable number schemas: `null` means unlimited, `undefined` keeps the current value.

**Shared UI** (`packages/ui`)
- `CustomSelect` drops the Radix scroll buttons.
- `SearchableSelect` gains ranking, keywords, groups, `triggerLabel`, `defaultOpen` and `dropdownMinWidth`.
- The multi-user pickers show a search box when the list is longer than 8.

**Dev only.** Re-registering a node or action on hot reload replaces it instead of throwing.

## Risks / Rollout Notes

These are behaviour changes visible to existing workflows or to other screens.

**Visible in existing workflows**
- An If-branch step can no longer reference the other branch's outputs. Existing references show as unavailable.
- Add Comment steps that never set visibility now show "1 required missing" in the designer. Runtime behaviour is unchanged.
- References to `$index` were always null at run time. The designer now offers `index`.

**Other screens**
- `SearchableSelect` ordering and any-order word matching change app-wide. The set of options that match is unchanged.
- The multi-user picker search appears on long lists app-wide.
- `CustomSelect` long lists use a native scrollbar.

**Designer and runtime behaviour**
- "Apply suggestions" fills far fewer inputs, by design. Free-text inputs get no automatic suggestions.
- Manual runs omit empty optional fields instead of sending `""`.
- `tickets.find` runs two extra small queries per call.
- `endDate` and `warrantyEndDate` in date-trigger payloads must be `YYYY-MM-DD`.
- `truncate` and `substring` throw on a non-number length or start.

**Scaling**
- The contract and asset picker lists are not paged.

**Process**
- Playwright specs were updated for the publish confirmation and the "Value from" control, but have not been run.

## Follow-ups

Friction found after the code froze (rounds 9–11) is queued for the normal process. Ranked:

1. **Remove scenario-specific example copy. Done before Smoke Test.** Product copy must not quote the evaluation scenarios.
   - The Data Store descriptions and help no longer use the scenario's namespace/key example.
   - The Text mode placeholder now reads "e.g. Ticket {{example}} was updated".
   - Code comments and test fixtures that quoted scenario text use neutral wording.
   - Fixture names that were already common on main (e.g. the seed users and boards) are unchanged.
2. **Test runs on drafts and paused workflows.** Today you must publish (go live) to test, and Run is disabled while paused. Add a clearly labelled manual test path, ideally a dry run that doesn't write data. `simulateWorkflowDefinitionDraftAction` already exists and is API-only.
3. **Email recipients from a single string.** Picking a contact's email string, or a contact or user record, for an email recipients list should wrap it as a recipient automatically.
4. **Catch-branch suggestions.** Inside Catch, suggestions should prefer trigger data over the outputs of Try steps, which may be the step that failed. Show one group for the caught error, not both `error` and `vars.<captureAs>`.
5. **One pause control.** Remove the duplicate pause control: the Workflow Settings switch needs Save Settings, while the header switch applies at once.
6. **Panel structure.** Move Workflow Settings and Audit out of the step panel. Show trigger hints only on the trigger.
7. **Database-backed check for `tickets.find`.** Add a test that runs `tickets.find`'s new name and latest-comment joins against a migrated schema, with related rows both present and missing. The current coverage uses a mocked query builder.
8. **Smaller items:**
   - a For Each "fixed list" mode
   - a "Runs" link in the header
   - an entity-link picker for notification links
   - plain-language action descriptions
   - the Text-mode Insert field in a required notification body turning the field into a reference
   - closing the multi-select on Escape
   - Run dialog fields that don't apply to the trigger
   - the step-panel scroll position jumping after edits

## Acceptance Criteria (Definition of Done)

All met as of `72f3861c65`:

- [x] Three consecutive usability-loop rounds score 8/10 or higher, on three different scenarios, with no code change between them.
- [x] Each of the five primary flows can be built, published, test-run against a real record, and paused using only the UI. No ids are typed, and no JSONata is needed beyond a list literal.
- [x] Everything the designer offers in Reference, Text and Expression modes resolves at run time. This is covered by `inputModeScopeParity`.
- [x] Every free-text action input in the registered catalog gets Text mode. This is covered by `workflowTextInputCoverage`.
- [x] The designer and the runtime share one expression function catalog and one caught-error definition.
- [x] The designer, Run Studio and graph test suites pass, apart from the pre-existing `WorkflowWaitEditors` import failure. The `ee/packages/workflows`, `packages/ui` and `shared/workflow/runtime` suites pass, apart from the Postgres-backed `*.db.test` files. Focused type-checks are clean.
