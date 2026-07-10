# Workflow Authoring via MCP — Implementation Plan

**Date:** 2026-07-10
**Branch:** `feature/alga-workflow-creation-mcp`

## Goal

An MCP agent (Claude Desktop via the CE connector, or the EE remote server) can create and
update Alga automation workflows from natural language. North-star request:

> "I want a workflow such that whenever a ticket is created, if it is from bob@customer.com,
> the ticket is created with high priority, and it is moved into my user activities list,
> under the important group."

The agent composes the workflow, verifies it works, and leaves a **draft** for the user to
review and publish in the workflow editor.

## Settled design decisions

- **No new MCP tools.** The 3-meta-tool architecture (`search_api_registry`,
  `search_business_data`, `call_api_endpoint`) stays. Everything ships as REST surface +
  OpenAPI documentation + registry curation, so both delivery forms get it for free.
- **The calling model authors the full `WorkflowDefinition` JSON** — the same document the
  designer edits (`shared/workflow/runtime/types.ts`). No server-side copilot LLM, no
  simplified DSL/compile layer. Full editor parity by construction; we make the format
  tractable rather than hiding it.
- **Draft-first.** The MCP never publishes. It creates/updates drafts and hands back an
  editor deep link (`/msp/workflow-editor/{workflowId}`). Publishing stays a human action.
- **Verification loop = validate + simulated dry-run.** A validate endpoint returns
  structured, actionable errors; a simulate endpoint executes the draft against a sample
  payload with `action.call` steps stubbed — zero side effects, step-by-step trace out.
- **Simulator is a new shared lightweight in-process engine** in `shared/workflow` reusing
  the existing Zod types and `expressionEngine` — not the Temporal interpreter under a test
  environment. Drift risk is mitigated with contract tests comparing both on fixture
  workflows.
- **Updates are full-document replace** with optimistic concurrency (new
  `expectedDraftVersion` check), not step-level patch operations.
- **Registry hygiene:** the generator excludes ALL "route inventory only" placeholder
  entries (not just workflow ones) — entries with no real schema/description are pure noise
  to an agent.
- **New `activities.*` workflow actions (minimal trio):** `activities.add_to_group`,
  `activities.remove_from_group`, `activities.find_group` — required for the north star;
  user-activity groups have REST APIs (`/api/v1/activities/groups*`) but no workflow actions
  today.
- **Scope:** design supports full editor parity; testing targets trigger → conditions →
  actions shapes (no loops/waits/human-tasks in the test matrix; they still validate and
  simulate).

## The target agent loop

1. `search_api_registry("create a workflow")` → curated entry whose **playbook** walks the
   model through this loop.
2. **Discover** via `call_api_endpoint`:
   - `GET /api/workflow/registry/authoring-guide` — machine-readable authoring manual (new)
   - `GET /api/workflow/registry/events` — trigger event catalog + payload schema refs (new)
   - `GET /api/workflow/registry/designer-catalog` / `actions` — action IDs + input/output
     schemas (existing)
   - `GET /api/workflow/registry/schemas/{schemaRef}` — event payload schemas (existing)
3. **Resolve** tenant-specific names → IDs via existing v1 endpoints (priorities, users,
   activity groups, boards…), directed by the playbook.
4. **Compose** the definition JSON.
5. **Verify**: `POST /api/workflow-definitions/validate` until clean, then
   `POST /api/workflow-definitions/simulate` with a sample payload; read the trace.
6. **Save**: `POST /api/workflow-definitions` (create draft) or
   `PUT /api/workflow-definitions/{id}/{version}` (replace draft, with
   `expectedDraftVersion`). Reply to the user with the editor link.

---

## Workstream 1 — Registry hygiene + curation

**1a. Exclude placeholder entries from the generated registry.**
- `ee/scripts/generate-chat-registry.mjs` marks route-inventory-derived entries with a known
  placeholder description (line ~34). Skip these entries entirely when emitting
  `server/src/lib/mcp/registry.generated.ts` and
  `ee/server/src/chat/registry/apiRegistry.generated.ts`.
- Regenerate both registries; note the entry-count delta in the PR description.
- The scorer's placeholder penalty (`packages/agent-tooling/src/registry/search.ts`) becomes
  dead weight for these; leave it (other placeholder sources may exist) but confirm nothing
  else depends on placeholder entries being present.

**1b. Curated override file for workflows.**
- New `ee/docs/api-registry/workflows.json` (follow the format of `tickets.json` /
  `activities.json`): sharp `displayName`/`description`/`examples` for the
  workflow-definitions family, plus **playbooks**:
  - *Create a workflow from natural language* — the full loop above, including "resolve
    names to IDs before composing" and "always validate + simulate before saving".
  - *Update an existing workflow* — `GET` definition → edit → validate → simulate → `PUT`
    with `expectedDraftVersion`.
  - *Resolve tenant references* — which endpoints resolve priorities, users, statuses,
    boards, activity groups.
- Verify ranking: `searchRegistryEntries("create a workflow")` must surface
  `post-_api_workflowdefinitions` first (add a unit test in `packages/agent-tooling`).

## Workstream 2 — Validate endpoint

- New route `server/src/app/api/workflow-definitions/validate/route.ts`:
  `POST { definition, payloadSchemaMode?, pinnedPayloadSchemaRef? }` → runs the same
  validation pipeline the draft save uses (`computeValidation` /
  `validateWorkflowDefinition` — see
  `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts:1624` and
  `shared/workflow/runtime/validation/publishValidation.ts`), plus publish-level checks
  (trigger mapping requirements, unknown event names), **without persisting anything**.
  New server action `validateWorkflowDefinitionDraftAction` in
  `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`.
- **Structured error shape**: every error/warning carries
  `{ code, path (step id + JSON pointer), message, suggestion? }`.
- **Did-you-mean suggestions**: for unknown `actionId` (nearest match from the action
  registry), unknown trigger `eventName` (nearest from event catalog), and unknown
  expression function names (nearest from the expression-function registry). Small
  edit-distance helper in `shared/workflow/runtime/validation/`.
- Audit the existing validator output for vague messages while wiring this up; sharpen any
  message a model couldn't act on (acceptance: each error names the offending step and what
  a correct value would look like).

## Workstream 3 — Simulated dry-run

**3a. Simulator engine** — new `shared/workflow/runtime/simulation/simulator.ts` (+ types):
- Input: `{ definition, payload, fixtures?, options? }`. `fixtures` maps step id (or
  `actionId`) → fake action output; `options` caps loop iterations and total steps.
- Walks the step tree with the same semantics as the Temporal interpreter
  (`ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts`): trigger
  `payloadMapping`, `transform.*` (execute for real — they're pure), `control.if` /
  `control.forEach` / `control.tryCatch` / `control.return`, `state.set`, expression
  evaluation via `shared/workflow/runtime/expressionEngine.ts`.
- `action.call` steps are **stubbed**: evaluate and record the real input mapping, then
  return (in order of precedence) a caller-supplied fixture, else a schema-shaped
  placeholder derived from the action's output schema
  (`shared/workflow/runtime/actions/actionOutputSchemaResolver.ts`), else `{}` with a
  warning in the trace.
- `event.wait` / `time.wait` / `human.task` / `control.callWorkflow`: recorded as
  "would wait/call" and short-circuited (resume with fixture if provided, otherwise end that
  branch with status `paused-at-wait`).
- Output: `{ status, trace, finalVars, invocations, errors, warnings }` where `trace` is
  per-step `{ stepId, type, outcome: executed|stubbed|skipped|error|would-wait,
  evaluatedInput?, branchTaken?, savedAs? }` and `invocations` lists every action that
  *would* have been called with its evaluated inputs.
- Hard guards: max steps, max `forEach` iterations, wall-clock timeout, payload size.

**3b. Endpoint** — `server/src/app/api/workflow-definitions/simulate/route.ts`:
`POST { definition, payload?, eventType?, fixtures? }`. Accepts **inline** definitions (no
save required — this is the iterate-before-save loop). If `payload` is omitted but the
trigger's payload schema is known, synthesize a sample payload from the JSON schema
(new small util; schema registry already emits JSON schema via `toJsonSchema`). Requires
the same `workflow manage` permission as draft writes. Rate-limit like
`startWorkflowRunAction`.

**3c. Anti-drift contract tests** — fixture workflows (reuse/extend existing interpreter
test fixtures in `ee/temporal-workflows`) run through both the Temporal interpreter (test
env, real transforms + stubbed activities) and the simulator; assert identical branch
decisions, step ordering, and vars. Run in CI with the existing temporal-workflows test
suite.

## Workstream 4 — Authoring knowledge surface

**4a. Authoring guide endpoint** — `GET /api/workflow/registry/authoring-guide`
(`server/src/app/api/workflow/registry/authoring-guide/route.ts`):
- Returns a single JSON document assembled at request time from live sources so it cannot
  drift: definition/step JSON schema (from the Zod types in
  `shared/workflow/runtime/types.ts`), step-type semantics (from
  `shared/workflow/runtime/registries/nodeTypeRegistry.ts`), the expression-function
  catalog with signatures (export a listing from
  `shared/workflow/runtime/expressionEngine.ts` — functions are registered via
  `registerFunction`, so add a registry that records name/arity/description at registration).
- Plus hand-authored content co-located in
  `shared/workflow/runtime/designer/authoringGuide.ts`: `$expr` grammar notes,
  `payload`/`vars`/`saveAs` data-flow idioms, condition patterns, a complete worked example
  (the north-star workflow), and common pitfalls (e.g. `saveAs` targets must be `vars.*`,
  step ids unique, `control.if` needs `$expr` condition objects).

**4b. Trigger event catalog endpoint** — `GET /api/workflow/registry/events`
(`server/src/app/api/workflow/registry/events/route.ts`): thin wrapper over the existing
event-catalog server actions (`ee/packages/workflows/src/actions/
workflow-event-catalog-v2-actions.ts`, `EventCatalogModel.getAll`) returning
`{ eventType, name, description, payloadSchemaRef }` per event. Today this catalog is
reachable only via server actions — this is a genuine API gap, not just an MCP need.

**4c. OpenAPI documentation.** Add canonical OpenAPI metadata for everything the loop
touches: workflow-definitions CRUD + publish + versions, registry
actions/nodes/designer-catalog/schemas, and the new validate / simulate / events /
authoring-guide endpoints. Follow the existing pattern in
`server/src/lib/api/openapi/routes/` (see `workflowsV1.ts`), regenerate
`sdk/docs/openapi/alga-openapi.{ce,ee}.json`, then regenerate the chat registry. This is
what actually makes the loop discoverable through `search_api_registry`.

## Workstream 5 — `activities.*` workflow actions

- New `shared/workflow/runtime/actions/businessOperations/activities.ts` implementing the
  trio against the same underlying service logic used by
  `server/src/app/api/v1/activities/groups/route.ts` and `.../groups/items/route.ts`
  (add/remove an entity to/from a user's activity group; find a group by name/owner for
  name→ID resolution inside workflows):
  - `activities.add_to_group` — input: group id (or name + owner user id), entity type +
    id (ticket, task, …); idempotent on duplicate adds.
  - `activities.remove_from_group` — symmetric.
  - `activities.find_group` — resolve by name/owner; returns group id + metadata.
- Zod input/output schemas, registration in
  `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`, palette seed
  (new "Activities" group) in `shared/workflow/runtime/designer/actionCatalog.ts`, designer
  picker support if group selection warrants a fixed picker
  (`ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx` follows
  existing patterns).
- These actions are ordinary catalog citizens: usable from the designer UI, not MCP-only.

## Workstream 6 — Draft lifecycle hardening

- Add optional `expectedDraftVersion` to `UpdateWorkflowDefinitionInput`
  (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts:1603`); return 409
  with the current draft version on mismatch. The PUT route passes it through; document in
  OpenAPI. (Today the draft PUT is last-write-wins.)
- Ensure create/update responses include enough for the agent to hand back a review link
  (`workflowId`, `draftVersion`); the editor URL pattern lives in the playbook, not the API.

## Workstream 7 — Tests & verification

- **Unit/integration**
  - Simulator: branching (`control.if` both arms), `forEach` with iteration cap,
    `tryCatch` catch path, transform execution, action stubbing precedence
    (fixture > schema-shaped > `{}`+warning), wait short-circuiting, guard limits.
  - Validate endpoint: each error class incl. did-you-mean suggestions for actionId /
    eventName / expression function.
  - Contract tests simulator ↔ Temporal interpreter (Workstream 3c).
  - `activities.*` actions against seeded groups.
  - Registry: placeholder exclusion; `searchRegistryEntries("create a workflow")` ranking;
    override file loads.
- **End-to-end north star** (integration test + manual smoke on the running dev stack,
  port 3232):
  1. Script the agent loop with real HTTP calls (as the MCP connector would make them):
     discover → resolve priority + activity group → compose north-star definition →
     validate (assert clean) → simulate (assert trace shows priority update + group add
     stubbed with correct inputs) → save draft.
  2. Open the draft in the workflow editor; confirm it renders and publishes cleanly.
  3. Fire a synthetic `TICKET_CREATED` event (Redis stream, as
     `WorkflowRuntimeV2EventStreamWorker` consumes it) for a ticket from
     `bob@customer.com`; assert the ticket ends at high priority and appears in the target
     activity group. Fire one from another sender; assert no changes.
  4. Update flow: NL-style edit ("also add a comment") → GET → modify → validate →
     simulate → PUT with `expectedDraftVersion`; assert 409 on stale version.
- **Manual MCP smoke**: run the real `alga-mcp-connector` against the dev stack with Claude
  and the north-star prompt; confirm the playbook-driven loop completes without hand-holding.

## Suggested sequencing

1. W1 (hygiene + curation groundwork) and W4b (events endpoint) — cheap, unblock discovery.
2. W2 (validate) — the core iteration loop.
3. W3 (simulator + endpoint + contract tests) — the deep piece.
4. W4a/4c (authoring guide, OpenAPI, registry regen).
5. W5 (activities actions) — parallelizable with W3.
6. W6 (concurrency) — small.
7. W7 (E2E + manual smoke) — last.

## Out of scope (deliberately)

- Publishing/activation via MCP; EE approval-gate integration (future phase).
- Step-level patch operations for updates (revisit if full-replace mangling shows up).
- Designer-UI adoption of the simulator (the engine is shared and reusable, but wiring a
  "simulate draft" button into `WorkflowRunDialog` is a separate effort).
- Simulation of `control.callWorkflow` sub-workflow bodies (recorded as "would call").
- New actions beyond the `activities.*` trio.

## Risks

- **Simulator drift** from the Temporal interpreter — held down by contract tests (3c) and
  by reusing the exact expression engine and Zod types.
- **Schema-shaped fake outputs** may mislead downstream expressions (e.g. a branch on a
  faked field). The trace marks every stubbed value; the playbook tells the model to supply
  realistic fixtures for outputs its conditions depend on.
- **Registry regeneration blast radius** — the generated files are huge (~59k lines);
  placeholder exclusion changes both CE and EE registries. Verify EE chat features that
  share the registry still pass their tests.
- **Expression-function listing** requires a small refactor of `registerFunction` call
  sites to carry descriptions; keep it additive.
