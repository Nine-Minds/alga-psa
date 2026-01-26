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
6. **Dynamic feature discovery:** During implementation, if new harness features, helpers, or fixture patterns are discovered to be **necessary to implement the PRD's scope**, they should be added to `features.json` and `tests.json` and iterated on. The `features.json` and `tests.json` files are **living documents** that evolve as the work progresses. This allows for discovering unanticipated infrastructure needs without narrowing or shortcutting the scope. Only add features that directly enable delivery of the PRD's requirements (harness + ~150–200 fixtures); do not add gold-plating, speculative features, or convenience enhancements.

7. **Missing workflow actions:** If during fixture implementation a **business-relevant workflow action is identified as clearly necessary** but does not exist in the runtime, it should be implemented as a new action in the workflow registry. These new actions:
   - Must be clearly documented in `features.json` and added to the fixture's implementation notes
   - Should follow the **V2 Modern Action Registry pattern** (`shared/workflow/runtime/actions/businessOperations/`)
   - Must include strict Zod input/output schemas, permission checks, and audit logging per existing patterns
   - Must be properly registered in `registerBusinessOperationsActionsV2()`
   - Are considered necessary infrastructure (not scope creep) if they enable multiple fixtures to test business workflows
   - Should be clearly justified in the implementation notes: why the action is necessary, which fixtures depend on it, what business workflow it enables

See section 8 below for guidance on identifying and implementing missing actions.

### 9.2 Open Questions (need answers)
1. None currently (update as scope evolves).

## 8) Workflow Actions: Architecture & Implementation Guide

### 8.1 What Are Workflow Actions?

Workflow actions are **discrete business operations** that workflows invoke asynchronously. They are:
- **The implementation layer** between workflow logic and application services (tickets, projects, billing, etc.)
- **Versioned** to allow evolution without breaking existing workflows
- **Idempotent** to support safe retry semantics
- **Strongly typed** using Zod schemas for input/output validation
- **Database-aware** with transaction support to prevent cross-shard FK timing issues
- **Auditable** with complete tracking of execution, parameters, results, and errors
- **Permission-checked** to enforce MSP portal access control

### 8.2 Action Registry Architecture

Alga-PSA uses **two action registries**:

1. **Legacy V1 Registry** (`shared/workflow/core/actionRegistry.ts`): Simple actions with loose typing
   - Used for utilities, email processing, role/user lookups
   - Parameters: simple type definitions (string, object, boolean)
   - Execution context lacks request tracing

2. **Modern V2 Registry** (`shared/workflow/runtime/registries/actionRegistry.ts`): Modern business operations (recommended)
   - Used for core business operations (tickets, projects, contacts, etc.)
   - Parameters: strict Zod schemas with validation
   - Execution context includes run tracing, step paths, and logging
   - **New actions should use V2 registry**

### 8.3 Existing Action Categories

The following action namespaces are already implemented and available for fixtures to use:

**Tickets** (`tickets.create`, `tickets.find`, `tickets.assign`, `tickets.update_fields`, `tickets.add_comment`, `tickets.close`, `tickets.link_entities`, `tickets.add_attachment`)

**Projects** (`projects.create`, `projects.find`, `projects.update_fields`, `projects.add_comment`)

**Contacts** (`contacts.create`, `contacts.find`, `contacts.update`)

**Clients** (`clients.create`, `clients.find`, `clients.update`)

**Scheduling** (`scheduling.assign_user`, `scheduling.create_schedule_block`)

**Notifications** (`notifications.send`, `notifications.find`)

**CRM** (`crm.add_note`, `crm.link_entity`)

**Email** (`email.send`)

**And more** — see `shared/workflow/runtime/actions/businessOperations/` for the complete list.

### 8.4 Identifying Missing Actions

When implementing a fixture, check if the required action exists:

1. **Search the action registry:**
   ```bash
   grep -r "registry.register({.*id:.*'domain\\.operation'" \
     shared/workflow/runtime/actions/businessOperations/
   ```

2. **Check if similar action exists:**
   - Is there a `tickets.create`? Can it be extended or does a new variant exist?
   - Is there a `projects.find`? Can it be used as-is?

3. **Look at the existing fixture suite:**
   - Which actions are already referenced in existing fixtures?
   - Are there patterns or utilities you can reuse?

If an action doesn't exist and is necessary, document it in `features.json` and implement it per section 8.5.

### 8.5 Implementing Missing Actions (V2 Registry Pattern)

If you identify a missing action that's necessary for business-relevant fixtures:

**Step 1: Create or extend the action module**
```
shared/workflow/runtime/actions/businessOperations/<domain>.ts
```

**Step 2: Define the action with strict schemas**
```typescript
registry.register({
  id: 'domain.operation',              // e.g., 'invoices.approve'
  version: 1,                           // Semantic version for evolution

  inputSchema: z.object({               // Strict input validation
    required_param: z.string().describe('Description'),
    optional_param: z.number().optional(),
    nested: z.object({ /* ... */ })
  }),

  outputSchema: z.object({              // What the caller receives
    result_id: uuidSchema,
    created_at: isoDateTimeSchema,
    status: z.enum(['CREATED', 'PENDING'])
  }),

  sideEffectful: true,                  // Does it modify state?
  idempotency: { mode: 'engineProvided' },  // How deduplication works

  ui: {
    label: 'User-friendly action name',
    category: 'Business Operations',
    description: 'What this action does and why it exists'
  },

  handler: async (input, ctx) =>
    withTenantTransaction(ctx, async (tx) => {
      // 1. Permission check (if write operation)
      await requirePermission(ctx, tx, { resource: 'domain', action: 'operation' });

      // 2. Business logic
      const result = await SomeModel.performOperation(input, tx.trx);

      // 3. Audit logging
      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:domain.operation',
        changedData: { /* what changed */ },
        details: { action_id: 'domain.operation', action_version: 1, /* ... */ }
      });

      // 4. Return validated result
      return { result_id: result.id, created_at: result.created_at, status: 'CREATED' };
    })
});
```

**Step 3: Register the action module**
```typescript
// In shared/workflow/runtime/actions/businessOperations/<domain>.ts
export function register<Domain>Actions(): void {
  const registry = getActionRegistryV2();
  registry.register({ id: 'domain.operation', /* ... */ });
  // Register other domain actions...
}
```

**Step 4: Call registration on startup**
```typescript
// In shared/workflow/runtime/actions/registerBusinessOperationsActions.ts
import { register<Domain>Actions } from './businessOperations/<domain>';

export function registerBusinessOperationsActionsV2(): void {
  registerTicketActions();
  register<Domain>Actions();     // Add new module
  // ... other registrations
}
```

**Step 5: Document in features.json**
```json
{
  "id": "F999",
  "description": "Implement domain.operation action for [business purpose]",
  "implemented": true,
  "prdRefs": ["8.5"]
}
```

### 8.6 Key Implementation Patterns

**Always use transaction-wrapped handlers:**
```typescript
handler: async (input, ctx) =>
  withTenantTransaction(ctx, async (tx) => {
    // tx = { tenantId, actorUserId, trx (Knex transaction) }
    // Use tx.trx for all database access
  })
```

**Always check permissions for write operations:**
```typescript
await requirePermission(ctx, tx, {
  resource: 'tickets',
  action: 'create'
});
```

**Always audit state changes:**
```typescript
await writeRunAudit(ctx, tx, {
  operation: 'workflow_action:tickets.create',
  changedData: { ticket_id, ticket_number },
  details: { action_id: 'tickets.create', action_version: 1 }
});
```

**Always use proper error handling:**
```typescript
import { throwActionError } from './shared';

throwActionError(ctx, {
  category: 'ActionError',
  code: 'NOT_FOUND',
  message: 'Ticket not found',
  details: { ticket_id: input.ticket_id }
});
```

**All actions are idempotent:** The same action called twice with the same `idempotencyKey` returns the cached result instead of executing again. This is handled automatically by the framework.

### 8.7 Gotchas & Important Notes

- **Database connections:** Always use `context.knex` or `tx.trx` to prevent Citus cross-shard FK timing issues
- **Transaction scope:** Never nest transactions; the framework handles wrapping
- **Permissions:** Different resources/actions have different permission requirements; check existing patterns
- **Error categories:** Use `throwActionError()` not `throw new Error()` for proper error classification
- **Action discovery:** Actions are only discovered from the registry at runtime; must be registered before workflow execution
- **Side-effect safety:** All side-effectful actions must be idempotent; no external state assumptions

## 10) Definition of Done
- A harness exists (`tools/workflow-harness/`) that can run a single fixture end-to-end and report pass/fail.
- Fixture root exists (`ee/test-data/workflow-harness/`) with documentation.
- At least one “golden path” fixture is implemented end-to-end (import → trigger → run → assert).
- The fixture suite grows to ~150–200 fixtures covering the agreed categories.
- The plan’s `tests.json` items are executable via the harness (explicitly, not via `vitest` directly).
