## 0) Prereqs (do this once per environment)

  ### 0.1 Confirm you have the three required “channels”

  Business-valid fixtures typically need all of these:

  1. Workflow runtime ingest (session-auth / tenant context)

  - Requires Cookie header + x-tenant-id.
  - Provided by harness flags --cookie/--cookie-file and --tenant.
  - Implemented in tools/workflow-harness/lib/http.cjs:22.

  2. Optional REST API triggers (domain setup via /api/v1/*)

  - Requires x-api-key (set via WORKFLOW_HARNESS_API_KEY or
    ALGA_API_KEY).
  - Harness will auto-inject this header if env var is set (tools/
    workflow-harness/lib/http.cjs:32).

  3. DB read assertions + DB write cleanup

  - Assertions read via ctx.db (read-only guard at tools/workflow-
    harness/lib/db.cjs:5).
  - Cleanup writes via ctx.dbWrite (explicitly not read-only, still
    goes through pg).

  ### 0.2 Know where artifacts go (so you never “wonder what
  happened”)

  On failure, the harness prints:

  - Artifacts: /tmp/workflow-harness/<fixture>/<timestamp>/...

  Artifacts are created by:

  - tools/workflow-harness/lib/artifacts.cjs:15
    and written in:
  - tools/workflow-harness/run.cjs:262

  Inspect:

  - failure.error.txt (stack + cleanup error)
  - failure.context.json (import summary, workflow id/key, run/steps/
    logs, exported workflow bundle, step summary)

  ———

  ## 1) Inventory: identify which fixtures are “scaffolded” (so you
  can target them)

  A fixture is “scaffolded/smoke” if any of the following is true:

  - Its bundle.json description says “Scaffolded catalog fixture…”
  - dependencies.actions is empty and steps are basically state.set/
    transform.assign/control.return.
  - Its test.cjs just calls the scaffold helper ee/test-data/
    workflow-harness/_lib/scaffolded-fixture.cjs:1.

  Where to read the fixture conventions:

  - ee/test-data/workflow-harness/README.md:1
  - Harness conventions:
      - tools/workflow-harness/README.md:1
  - Plan expectations (why scaffolds exist / how they evolve):
      - ee/docs/plans/2026-01-26-workflow-harness-fixture-suite/
        PRD.md:1
      - ee/docs/plans/2026-01-26-workflow-harness-fixture-suite/
        SCRATCHPAD.md:1

  ———

  ## 2) Conversion loop (repeat this for each scaffolded fixture, one
  at a time)

  ### Step 2.1 Pick ONE fixture and freeze its intent

  For ee/test-data/workflow-harness/<name>/ decide (write this down
  in the fixture or PRD scratchpad):

  - “What real business behavior is being tested?”
  - “What observable side-effects prove it worked?”
  - “What control-flow aspect does this fixture cover?” (if/else,
    forEach, tryCatch, callWorkflow, idempotency, etc.)

  This is important because otherwise you’ll end up with “random
  actions” that don’t prove anything.

  Rule: every business-valid fixture must have:

  - at least 1 action that writes real state (ticket comment, project
    task, notification, etc.)
  - at least 1 control-flow construct beyond “linear”
  - at least 1 deterministic assertion (DB query that would fail if
    behavior regresses)
  - cleanup that leaves the environment usable for the next run

  ### Step 2.2 Fix the trigger schema first (or you’ll build on sand)

  Many scaffolded fixtures have mismatched payload schema refs (e.g.
  “invoice overdue” but schema ref is payload.TicketCreated.v1).

  Do this in bundle.json before anything else:

  - Set metadata.payloadSchemaRef to the correct schema for the
    trigger.eventName.
  - Keep payloadSchemaMode: "pinned" and set pinnedPayloadSchemaRef
    consistently.
  - Update both:
      - draft.definition.payloadSchemaRef
      - publishedVersions[].definition.payloadSchemaRef

  How to verify the “right” schema ref:

  - Query the event catalog in DB (best source of truth):
      - Tables exist per migrations like server/
        migrations/20250308171000_create_event_catalog.cjs:1.
      - Look at model usage in server/src/models/eventCatalog.ts:1.
  - Or grep existing fixtures that already use that event correctly.

  If you don’t fix schema refs early, you’ll get runtime validation
  failures or “event not in catalog” / “unknown schema ref” issues
  later.

  ### Step 2.3 Design the workflow graph (bundle.json) with real
  actions + control flow

  #### 2.3.1 Start from a known-good business fixture in the same
  domain

  Don’t invent patterns; copy from the suite.
  Examples of “real” patterns already in the repo:

  - control.if: see ee/test-data/workflow-harness/ticket-created-
    auto-assign-by-priority/bundle.json
  - control.forEach: see ee/test-data/workflow-harness/appointment-
    created-assign-notify/bundle.json
  - control.tryCatch: see ee/test-data/workflow-harness/ticket-
    created-assign-trycatch/bundle.json
  - notifications: many fixtures (e.g. payment-recorded-notify)
  - project task creation: project-created-kickoff-tasks (now
    business-valid)
  - CRM note patterns: contract-created-onboarding-task etc.

  #### 2.3.2 Choose your action(s)

  Find available action IDs by searching existing bundles:

  - rg '"actionId":' ee/test-data/workflow-harness -S

  Common “business effect” actions:

  - notifications.send_in_app
  - tickets.add_comment / similar (depends on what exists in your
    action registry)
  - projects.create_task
  - CRM actions (notes/interaction creation)

  Important: when you add an action, update dependencies.actions in
  the bundle to include { actionId, version }.

  #### 2.3.3 Add control flow deliberately

  Pick one or more of these patterns:

  1. Branching (control.if)

  - Branch on a payload field (e.g., payload.priority == 'high')
  - “then” path does the important action; “else” path does a
    different action or returns.

  2. Fan-out (control.forEach)

  - Build an array in vars (vars.recipients) and iterate to send
    multiple notifications or create multiple tasks.

  3. Try/Catch (control.tryCatch)

  - Wrap an action call that might fail (or that you can force to
    fail via payload).
  - Assert the workflow still ends in SUCCEEDED and that the “catch
    path” behavior occurred (e.g., wrote a fallback internal note).

  4. Idempotency

  - Use action dedupe/idempotency keys if the action supports them.
  - For notifications, always set dedupe_key to include the
    correlation key.
  - Then re-trigger the same correlation key in test.cjs and assert
    you did NOT create duplicates.

  5. Call Workflow (control.callWorkflow) — special case, see §6

  - Requires additional harness/test steps because it needs workflow
    IDs.

  #### 2.3.4 Always embed a marker in final persisted output

  Every business-valid fixture must write a marker like:

  - [fixture <name>]

  Critical gotcha (we hit this repeatedly):

  - transform.assign evaluates expressions against the pre-step
    environment, so referencing vars.marker in the same assign map
    can omit it.
  - This is why we switched titles to literals like:
      - "[fixture xyz] Something happened"
        instead of:
      - vars.marker & ' Something happened'

  So:

  - Don’t build vars.title from vars.marker inside the same
    transform.assign map.
  - Either:
      - make the title literal, OR
      - split into 2 assign steps (marker first, title second)

  This exact failure mode showed up in multiple notification
  fixtures.

  #### 2.3.5 Update BOTH draft and published versions

  Every time you edit steps, you must update:

  - draft.definition.steps
  - publishedVersions[].definition.steps

  Otherwise you’ll “fix” the draft but runtime keeps running the
  published definition.

  ### Step 2.4 Rewrite test.cjs to be truly “business-valid”

  A business-valid test.cjs has this structure:

  1. Acquire prerequisites

  - Use DB reads to pick existing tenant resources:
      - “pick a user”, “pick a client”, etc.
  - Pattern exists in many fixtures:
      - a small pickOne(ctx, {label, sql, params})

  2. Create required domain data

  - Prefer /api/v1/* for creating domain entities when you want to
    exercise the API contract.
  - For some fixtures, you can skip entity creation and just post the
    event with IDs, but then your workflow actions must not require
    those entities to exist.
  - If you do create entities, capture IDs immediately.

  3. Register cleanup immediately after each create

  - Always call ctx.onCleanup(...) right after creating an entity.
  - Cleanup runs even if the test fails (tools/workflow-harness/lib/
    context.cjs:34).

  4. Trigger the workflow

  - Post to /api/workflow/events.
  - Use a unique correlationKey per run.
  - Include real entity IDs in payload (ticketId/projectId/etc).

  5. Wait for the run

  - ctx.waitForRun({ startedAfter: ctx.triggerStartedAt })
  - Polling details are in tools/workflow-harness/lib/runs.cjs:120.

  6. Assert side effects

  - Query the DB for rows containing:
      - the marker [fixture <name>]
      - AND the correlation key (or entity ID)
  - Always assert on something persisted (task row, interaction row,
    notification row, ticket message row, etc.)

  7. (Optional but recommended) Assert control-flow branches

  - For branching fixtures: run the event twice with different
    payload flags (or different data) and assert different outcomes.
  - For idempotency fixtures: run the same correlationKey twice and
    assert “no duplicate rows”.

  8. Cleanup

  - Many API delete endpoints will return HTTP 400 due to FK
    constraints.
  - When that happens, you must do DB cleanup in FK order using
    ctx.dbWrite.
  - Copy known-good cleanup sequences from fixtures that already do
    it:
      - ee/test-data/workflow-harness/contract-created-onboarding-
        task/test.cjs:1
      - ee/test-data/workflow-harness/project-created-kickoff-tasks/
        test.cjs:1
      - ee/test-data/workflow-harness/invoice-generated-review-task/
        test.cjs:1
      - ee/test-data/workflow-harness/schedule-block-created/
        test.cjs:1

  ### Step 2.5 Run it in debug mode and fix until green

  Use:

  - node tools/workflow-harness/run.cjs --test ee/test-data/workflow-
    harness/<fixture> ... --force --debug

  If it fails:

  1. Read artifact failure.error.txt
  2. Read artifact failure.context.json
  3. If there’s a run:
      - inspect stepSummary and logs (already included in context)
  4. Decide if it’s:
      - bundle bug,
      - test bug,
      - harness bug,
      - product bug

  Then patch, rerun, repeat.

  ### Step 2.6 Commit in small increments

  Once the fixture is green:

  - commit that fixture’s bundle/test changes (and any required
    shared fixes)
  - push
  - move to the next fixture alphabetically

  This keeps the branch always usable and bisectable.

  ———

  ## 3) A concrete checklist for “upgrade completeness” (use this per
  fixture)

  For a scaffolded fixture to be “fully upgraded”:

  - [ ] bundle.json schema ref matches trigger event
  - [ ] dependencies.actions includes every used actionId+version
  - [ ] dependencies.nodeTypes includes every used node type
    (control.if/forEach/tryCatch/etc.)
  - [ ] draft and publishedVersions are updated identically (or
    intentionally different, if testing publish mechanics)
  - [ ] At least 1 real action writes state
  - [ ] At least 1 control flow construct exists (if/forEach/
    tryCatch/callWorkflow/idempotency)
  - [ ] Marker [fixture <name>] is in persisted output (and not
    fragile to assign semantics)
  - [ ] test.cjs asserts persisted side effects via DB reads
  - [ ] test.cjs cleanup removes only what it created (usually via
    marker + correlation key)
  - [ ] Re-run works with --force without leaving junk behind

  ———

  ## 4) How to keep the suite deterministic while iterating on many
  fixtures

  ### 4.1 Prevent cross-fixture fanout

  Harness behavior:

  - Pauses all workflows matching fixture.% except the one being
    tested:
      - tools/workflow-harness/run.cjs:150

  This is why “one test at a time” stays deterministic even when the
  DB has many fixtures imported.

  ### 4.2 Preserve paused fixtures correctly

  The harness now respects metadata.isPaused in the imported bundle
  (important for tests like runtime-paused-no-run):

  - tools/workflow-harness/run.cjs:175

  ### 4.3 Don’t rely on implicit events from domain APIs unless you
  confirm they exist

  We had a real failure where a fixture created a project via /api/
  v1/projects but never triggered PROJECT_CREATED, so it waited until
  timeout.
  Fix pattern:

  - If workflow trigger is an event, the fixture must explicitly
    POST /api/workflow/events with the real entity ID unless you have
    confirmed the API emits the runtime V2 event.

  ———

  ## 5) Where testers / contributors should look for more info

  Start here:

  - ee/docs/plans/2026-01-26-workflow-harness-fixture-suite/PRD.md:1
  - ee/docs/plans/2026-01-26-workflow-harness-fixture-suite/
    SCRATCHPAD.md:1
  - tools/workflow-harness/README.md:1
  - ee/test-data/workflow-harness/README.md:1

  Implementation reference map:

  - CLI entrypoint: tools/workflow-harness/run.cjs:1
  - HTTP auth injection: tools/workflow-harness/lib/http.cjs:22
  - DB clients + RO guard: tools/workflow-harness/lib/db.cjs:12
  - Run polling: tools/workflow-harness/lib/runs.cjs:120
  - Cleanup semantics: tools/workflow-harness/lib/context.cjs:34
  - Failure artifacts: tools/workflow-harness/run.cjs:262 and tools/
    workflow-harness/lib/artifacts.cjs:15
  - Fixture scaffolding tool: tools/workflow-harness/scaffold.cjs:1
  - Harness unit/stub tests: tools/workflow-harness/tests/runner-
    stubbed.test.cjs:1

  ———

  ## 6) Special case: converting “call subworkflow” scaffolds into
  real control.callWorkflow tests

  control.callWorkflow exists and works (runtime implementation at
  shared/workflow/runtime/runtime/workflowRuntimeV2.ts:629), but it
  requires:

  - workflowId and workflowVersion (not a workflow key)

  Because workflow IDs are created at import time, you must do one of
  these approaches:

  ### Approach A (recommended): patch + publish inside test.cjs

  1. Keep your fixture bundle importing both parent and child
     workflow definitions.
  2. In test.cjs, after harness import:
      - read the imported workflow IDs from
        ctx.workflow.importSummary.createdWorkflows by key
  3. Export the parent workflow, modify its definition JSON to set:
      - callWorkflowStep.workflowId = <child workflowId>
      - callWorkflowStep.workflowVersion = 1 (or whichever version
        you published)
  4. PUT the updated draft definition:
      - Endpoint exists: PUT /api/workflow-definitions/{workflowId}/
        {version}
      - Route code: server/src/app/api/workflow-definitions/
        [workflowId]/[version]/route.ts:1
  5. Publish it:
      - Endpoint exists: POST /api/workflow-definitions/{workflowId}/
        {version}/publish
      - Route code: server/src/app/api/workflow-definitions/
        [workflowId]/[version]/publish/route.ts:1
  6. Trigger parent event and assert both parent + child effects
     (child runs inline; failure propagates unless caught per runtime
     behavior).

  This gives you a real callWorkflow test without needing to redesign
  the harness import sequence.

  ———

  ## 7) The practical “factory” strategy to convert all scaffolds
  efficiently

  Do it in batches by domain, but still commit per fixture:

  1. Make a list of all fixtures whose bundles are scaffolded.
  2. For each domain (ticket/project/invoice/payment/schedule/etc):
      - Pick 1 “reference” business-valid fixture that already uses
        good patterns.
      - Convert the scaffolds in that domain by copying its patterns
        and swapping:
          - trigger event + schema ref
          - action calls + IDs
          - assertions
  3. Ensure the suite as a whole covers control-flow diversity:
      - you don’t want 50 fixtures that all do the same if/else +
        notification
