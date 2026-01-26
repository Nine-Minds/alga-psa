# Workflow Fixture Harness (Import + Trigger + Assert) — PRD

**Plan date:** 2026-01-26  
**Owner:** TBD  
**Status:** Draft (decisions recorded; remaining Open Questions below)

## 1) Problem Statement
We want a **repeatable, version-controlled** way to validate Workflow Runtime V2 behavior end-to-end without manually building workflows in the UI every time.

We already have workflow import/export (bundle V1). What’s missing is a **harness + catalog of workflow fixtures** that lets us:

1. Import a workflow fixture (bundle JSON) into a running environment.
2. Trigger a real domain event via an API action (e.g. create ticket).
3. Assert the workflow run and side effects are correct.

The end result should support a **large cross section** (~150–200) of workflow fixtures that exercise the runtime, event ingestion, schema validation, node types, actions, and expected side effects.

## 2) Goals
### 2.1 Harness goals
1. Provide a **CLI harness** that runs exactly **one test at a time** and reports pass/fail.
2. Tests are stored as **pairs**:
   - `bundle.json` (workflow bundle V1 with one or more workflows; typically one workflow)
   - `test.cjs` (trigger + assertions script)
3. Harness supports:
   - selecting a test by id/path
   - importing the workflow bundle (create-only or `--force`)
   - running the trigger script
   - waiting/polling for the expected workflow run(s)
   - running assertions (DB reads)
   - producing a clear summary and non-zero exit code on failure
4. Harness produces **debug artifacts** on failure (run id, steps, errors, relevant logs, etc.).

### 2.2 Fixture suite goals
1. Curate ~150–200 fixtures that cover:
   - major event triggers (tickets, projects, billing, email, scheduling, etc.)
   - representative node types (transform, state, control flow, action calls, waits)
   - schema validation + trigger mapping behaviors
   - runtime behaviors (pause/visibility, concurrency, retries/timeouts if supported)
   - permissions / forbidden scenarios (where applicable)
2. Fixtures are stable and deterministic: assertions do not depend on timing-sensitive UI behavior.

## 3) Non-Goals
1. Replacing Playwright UI integration tests. (This suite targets runtime + APIs + DB effects, not UI workflows.)
2. Running all 150–200 tests in one command (V1). The harness runs one at a time; batch-running can come later.
3. A public end-user feature. This is a developer/QA fixture + validation tool.
4. Perfect isolation via auto-resetting the entire database between tests (initially).

## 4) Users / Personas
- **Developers:** want fast repros and high-signal regression checks while iterating on workflow runtime and event publishing.
- **QA / Support / PM:** want reliable “known good” workflows to validate system behavior across upgrades.

## 5) Test Case Structure (Proposed)
Create a new fixture root:

```
ee/test-data/workflow-harness/
  README.md
  ticket-created-hello/
    bundle.json
    test.cjs
  ticket-created-assign-tech/
    bundle.json
    test.cjs
  ...
```

### 5.1 `bundle.json`
- Must conform to `alga-psa.workflow-bundle` formatVersion `1`.
- Should include a stable `workflow.key` per fixture (e.g. `fixture.ticket-created-hello`).
- Import should be run with `--force` by default (so repeated runs overwrite prior state).

### 5.2 `test.cjs`
- CommonJS to make dynamic loading simple (`require()`).
- Exports a single async function, for example:

```js
module.exports = async function run(ctx) {
  // 1) Trigger: call API to create ticket or invoke a server action route, etc.
  // 2) Wait/Locate run: use ctx.waitForRun(...)
  // 3) Assert: query run steps + any domain side effects (DB/HTTP)
};
```

Where `ctx` includes:
- environment config (baseUrl, tenantId, auth cookie, timeouts)
- HTTP helper (fetch wrapper that sets cookie/headers)
- DB helper (required; read-only queries)
- workflow helpers (import/export, waitForRun, fetchRunSteps)
- artifact writer (store a JSON blob on failure for debugging)

## 6) Harness CLI (Proposed)
`node tools/workflow-harness/run.cjs --test ee/test-data/workflow-harness/ticket-created-hello --base-url http://localhost:3010 --tenant <uuid> --cookie <cookie>`

### 6.1 CLI flags
- `--test`: path (or id) of test case folder
- `--base-url`: server base URL
- `--tenant`: tenant UUID
- `--cookie`: AuthJS cookie for session auth (or `--cookie-file`)
- `--force`: overwrite workflow(s) on import
- `--timeout-ms`: global timeout for the test
- `--debug`: verbose logs
- `--artifacts-dir`: where to write failure artifacts

### 6.2 Success/failure contract
- Exit code `0` on pass.
- Non-zero exit code on failure.
- Print a single-line summary suitable for scripting:
  - `PASS <testId> <durationMs>`
  - `FAIL <testId> <durationMs> <reason>`

## 7) How Assertions Work (Proposed)
We should validate both:
1. **Workflow ran**: there is a `workflow_runs` row for the imported workflow id/key with expected status.
2. **Workflow did the right thing**: assertions depend on the fixture and are validated by:
   - querying `workflow_run_steps` for expected step success/failure
   - querying domain tables for expected side effects
   - verifying emitted events (optional; later)

**Decision:** assertions are **DB-reading** (direct Postgres reads). HTTP may still be used for triggers and/or for convenience reads, but DB is the source of truth for fixture verification.

Preferred run correlation:
- Trigger script returns a stable correlation key (e.g., created record id) and/or the harness derives a `started_after` time.
- Harness locates the newest run for `(workflow_id, tenant_id)` after trigger time.
- Optionally, use `workflow_runtime_events` linkage if available.

## 8) Risks & Mitigations
- **Flaky timing** (async worker): mitigate with polling windows, stable correlation keys, and generous timeouts.
- **Cross-test contamination** (leftover workflows/runs): mitigate with `--force` import, fixture-specific workflow keys, and test cleanup hooks executed at the end of each run.
- **Auth complexity**: mitigate by supporting `--cookie-file` and documenting how to capture the cookie.
- **Runtime registry drift** (node types/actions removed): mitigate by keeping fixture suite updated and providing clear “missing dependency” failures on import.

## 9) Decisions & Open Questions
### 9.1 Decisions (locked)
1. **Assertions:** DB-reading (direct Postgres), read-only.
2. **Execution model:** one test at a time only (no `--all` / batch runner in v1).
3. **Fixture root:** `ee/test-data/workflow-harness/` (separate from workflow bundles).
4. **Cleanup model:** each test must register cleanup actions; harness runs cleanup after the test (on pass or fail) to reduce cross-test contamination.
5. **Artifacts default:** write artifacts under `$TMPDIR` by default (override via `--artifacts-dir`).

### 9.2 Open Questions (need answers)
1. None currently (update as scope evolves).

## 10) Definition of Done
- A harness exists (`tools/workflow-harness/`) that can run a single fixture end-to-end and report pass/fail.
- Fixture root exists (`ee/test-data/workflow-harness/`) with documentation.
- At least one “golden path” fixture is implemented end-to-end (import → trigger → run → assert).
- The fixture suite grows to ~150–200 fixtures covering the agreed categories.
- The plan’s `tests.json` items are executable via the harness (explicitly, not via `vitest` directly).
