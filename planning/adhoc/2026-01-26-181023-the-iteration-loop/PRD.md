the iteration loop)

  - I treat this as a deterministic “one fixture at a
    time” pipeline: import → isolate → trigger → wait
    → assert → cleanup → record artifacts → commit.
  - I proceed alphabetically through ee/test-data/
    workflow-harness/ so we always know exactly where
    we are and what’s next, and so failures are
    reproducible and easy to bisect (fixture ordering
    is stable in ls | sort).

  Step-by-step: what happens on every single run

  1. Select fixture folder

  - Each fixture is a directory under ee/test-data/
    workflow-harness/ containing:
      - bundle.json (Workflow Bundle V1 with a
        deterministic workflow.key like
        fixture.<folderName>)
      - test.cjs (CommonJS script that triggers and
        asserts)
  - Conventions are documented in ee/test-data/
    workflow-harness/README.md:1.

  2. Run the harness (CLI entrypoint)

  - The harness entrypoint is tools/workflow-harness/
    run.cjs:1.
  - The harness parses args, validates paths, and
    loads bundle.json + test.cjs (see usage + flag
    docs at tools/workflow-harness/run.cjs:17 and
    tools/workflow-harness/README.md:1).

  3. Import workflow definition into the running
     server

  - The harness posts bundle.json to the server
    import endpoint via tools/workflow-harness/lib/
    workflow.cjs:1.
  - We almost always pass --force so the same fixture
    can be rerun repeatedly without manual cleanup
    (documented at tools/workflow-harness/
    README.md:12 and reinforced in the plan’s
    decisions at ee/docs/plans/2026-01-26-workflow-
    harness-fixture-suite/SCRATCHPAD.md:1).

  4. Isolate the fixture (avoid cross-fixture fanout)

  - To keep results deterministic, the harness “turns
    off” other fixtures:
      - It sets is_paused=true for all
        workflow_definitions whose key matches
        fixture.%, except the current workflow key.
      - This behavior is implemented in tools/
        workflow-harness/run.cjs:150.
  - Then it sets the current fixture’s pause state to
    match the bundle’s metadata.isPaused:
      - This is critical for fixtures like runtime-
        paused-no-run that must remain paused.
      - This behavior is implemented in tools/
        workflow-harness/run.cjs:175 (and was fixed
        recently to respect isPaused).

  5. Create a test context (shared utilities for
     fixtures)

  - The harness builds ctx via tools/workflow-
    harness/lib/context.cjs:14.
  - The context includes:
      - ctx.http (HTTP wrapper)
      - ctx.db (read-only DB client)
      - ctx.dbWrite (write-capable DB client used
        only for cleanup)
      - ctx.onCleanup(fn) hooks and ctx.runCleanup()
        (reverse-order, always runs, even on failure)

  6. HTTP behavior is standardized

  - ctx.http is created by tools/workflow-harness/
    lib/http.cjs:22 and automatically injects:
      - Cookie (session) if provided
      - x-tenant-id (tenant scoping) if provided
      - x-api-key if WORKFLOW_HARNESS_API_KEY (or
        ALGA_API_KEY) is set and the request didn’t
        explicitly override it
  - This means fixtures can safely do
    ctx.http.request('/api/workflow/events', ...)
    without each fixture needing to hand-roll auth
    headers.

  7. DB behavior is standardized

  - ctx.db and ctx.dbWrite are created by tools/
    workflow-harness/lib/db.cjs:12.
  - ctx.db is intentionally read-only and will refuse
    obvious write queries (guardrails in tools/
    workflow-harness/lib/db.cjs:5).
  - ctx.dbWrite is used only for cleanup when HTTP
    deletion endpoints fail due to FK constraints (a
    recurring real-world issue).

  8. Trigger the workflow

  - Most fixtures trigger runtime V2 by posting to /
    api/workflow/events.
  - The fixture is responsible for sending a payload
    that matches the workflow trigger (eventName +
    payloadSchemaRef + required payload fields).
  - Important practical rule we learned during
    iteration: if a fixture creates a domain object
    via /api/v1/..., that does not automatically mean
    the corresponding workflow event is emitted in
    the harness context. If the workflow trigger is
    an event (like PROJECT_CREATED), the fixture must
    POST the event explicitly unless we know the API
    emits it.

  9. Wait for the run

  - The harness exposes ctx.waitForRun(...) which
    polls workflow_runs for the imported workflowId
    and started_at >= triggerStartedAt.
  - The polling logic is in tools/workflow-harness/
    lib/runs.cjs:120.
  - On timeout, it throws with diagnostics (recent
    runs + last seen) for fast debugging (tools/
    workflow-harness/lib/runs.cjs:150).

  10. Assert outcomes

  - Assertions are “business outcomes”, usually by
    querying the DB:
      - project tasks created, notifications
        inserted, interactions/notes written, ticket
        comments created, etc.
  - Assertions use either:
      - ctx.expect helpers (tools/workflow-harness/
        lib/expect.cjs:17)
      - or explicit checks with detailed error
        messages (common in fixture test.cjs)

  11. Cleanup always runs

  - Whether pass or fail, ctx.runCleanup() runs all
    registered cleanup hooks in reverse order (tools/
    workflow-harness/lib/context.cjs:34).
  - If the test fails and cleanup fails, the harness
    throws a combined error so we don’t miss cleanup
    regressions (this behavior is in tools/workflow-
    harness/run.cjs:219).

  12. Artifacts are written on failure

  - Failures generate a timestamped folder under
    $TMPDIR/workflow-harness/<testId>/... via tools/
    workflow-harness/lib/artifacts.cjs:15.
  - The harness writes:
      - failure.context.json (includes importSummary,
        workflowId/key, run/steps/logs if available,
        plus exported workflow bundle and a step
        summary)
      - failure.error.txt (stack trace + cleanup
        error section if applicable)
  - This logic is in tools/workflow-harness/
    run.cjs:262.

  13. Fix scope decision: fixture bug vs harness bug
     vs product bug
     When something fails, I triage it into exactly
     one of these buckets:

  - Fixture bug (most common): wrong event/payload,
    wrong assumption about transforms, brittle query,
    bad cleanup
      - Fix in ee/test-data/workflow-harness/
        <fixture>/bundle.json or test.cjs
  - Harness bug: incorrect harness behavior (e.g., it
    unpaused workflows that must stay paused)
      - Fix in tools/workflow-harness/*
  - Product bug: the server/runtime/API is wrong
    relative to its contract (e.g., /api/v1/projects
    missing required DB fields)
      - Fix in server/*, shared/*, etc.

  14. Re-run the same fixture until it is green

  - I always re-run the same fixture immediately
    after the fix with --debug if it was non-obvious,
    so we confirm the root cause is resolved (not
    masked).

  15. Commit + push in small, reviewable chunks

  - Once a cluster of related fixes is proven by
    reruns, I commit and push so the branch stays
    usable and we don’t accumulate an unreviewable
    pile.
  - This also helps testers pull at any time and
    reproduce the same state.

  How we measure iteration time

  - We time runs using /usr/bin/time -p wrapped
    around node tools/workflow-harness/run.cjs ....
  - Interpreting timing:
      - Fast runs (~0.25–1s) are typically: import +
        event + DB poll + assertions.
      - Slower runs (several seconds) usually mean:
        the fixture is designed to wait for delayed
        behavior, or it’s doing heavier domain setup.
      - 60s runs are almost always a logic issue:
        “workflow never triggered” or “waiting for a
        run that can’t exist”.

  Where testers should look for “source of truth”
  docs

  - PRD / scope / decisions / usage examples:
      - ee/docs/plans/2026-01-26-workflow-harness-
        fixture-suite/PRD.md:1
      - ee/docs/plans/2026-01-26-workflow-harness-
        fixture-suite/SCRATCHPAD.md:1
      - ee/docs/plans/2026-01-26-workflow-harness-
        fixture-suite/features.json:1
      - ee/docs/plans/2026-01-26-workflow-harness-
        fixture-suite/tests.json:1
  - Harness usage + flags:
      - tools/workflow-harness/README.md:1
      - tools/workflow-harness/run.cjs:17
  - Fixture conventions:
      - ee/test-data/workflow-harness/README.md:1
  - Harness architecture code map:
      - CLI entry: tools/workflow-harness/run.cjs:1
      - Context + cleanup: tools/workflow-harness/
        lib/context.cjs:14
      - HTTP wrapper + auth injection: tools/
        workflow-harness/lib/http.cjs:22
      - DB client + read-only guard: tools/workflow-
        harness/lib/db.cjs:12
      - Import/export wrapper: tools/workflow-
        harness/lib/workflow.cjs:1
      - Run polling + steps/logs: tools/workflow-
        harness/lib/runs.cjs:120
      - Assertions helper: tools/workflow-harness/
        lib/expect.cjs:17
      - Cookie file helper: tools/workflow-harness/
        lib/cookie.cjs:3
      - Failure artifact writing: tools/workflow-
        harness/lib/artifacts.cjs:15
  - Fixture scaffolding tool (for adding more
    fixtures consistently):
      - tools/workflow-harness/scaffold.cjs:1

  Where testers should look when a fixture fails

  - The harness prints the artifacts directory on
    failure (example shape):
      - $TMPDIR/workflow-harness/<testId>/
        <timestamp>/
  - Key files inside that folder:
      - failure.error.txt (exception + stack +
        cleanup error if any) written by tools/
        workflow-harness/run.cjs:331
      - failure.context.json (full structured
        diagnostics) written by tools/workflow-
        harness/run.cjs:319
  - Server-side logs (when needed):
      - docker logs -f prep_1_0_server_ee
      - If a run appears “stuck” or missing, check
        workflow-run ingestion endpoints and runtime
        logs in prep_1_0_server_ee.

  How testers can run exactly what I run

  - The canonical CLI form is documented in tools/
    workflow-harness/README.md:14.
  - In our dockerized dev setup, the reliable pattern
    is to run inside the server container so Postgres
    is reachable and cookie/API key files are
    accessible:
      - node tools/workflow-harness/run.cjs --test
        ee/test-data/workflow-harness/<fixture>
        --base-url http://localhost:<port> --tenant
        <uuid> --cookie-file <path> --pg-url
        <postgres-url> --force --debug
  - If you want to validate the harness itself
    without a running server/DB, there are stubbed
    tests under:
      - tools/workflow-harness/tests/runner-
        stubbed.test.cjs:1
      - (plus other harness tests in tools/workflow-
        harness/tests/)

  Why we sometimes fix “product code” while iterating
  fixtures

  - The fixture suite is intentionally “business-
    valid”: it’s supposed to exercise real API paths
    and real DB constraints.
  - When a fixture exposes a real contract mismatch
    (example: project creation missing required
    fields), the correct fix is to fix the product
    API/service, not to weaken the fixture. The
    fixture suite is acting as an integration-level
    regression net.

When all tests are run and work, ONLY THEN, output <promise>DONE</promise>.
