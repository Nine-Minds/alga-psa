# Workflow Runtime + GUI Designer PRD

**Data-defined workflows with `Envelope<TIn>` → `Envelope<TOut>` transforms**

| | |
|---|---|
| **Version** | 1.0 |
| **Date** | 2025-12-21 |
| **Status** | Ready to Implement |

---

## 1. Summary

This PRD specifies a new workflow system where workflows are stored as data and executed by a deterministic runtime. The unit of execution is an **Envelope** that flows through a pipeline of nodes, each implementing an `Envelope<TIn>` → `Envelope<TOut>` transformation.

It also specifies a **GUI designer** that renders workflows in a node-in-pipe style (a top-to-bottom pipe with nested blocks) and provides schema-backed mapping and validation.

The system-managed inbound email workflow (threading + ticket creation + comments + attachments) is the reference use-case that drives the MVP feature set and correctness constraints.

### 1.1 Goals

- Workflows are stored as JSON (data), validated on publish, and executed by an interpreter runtime (no runtime code generation).
- Graphical authoring via node-in-pipe designer (linear pipe + structured blocks for If / ForEach / Try-Catch).
- Strong runtime validation and best-effort design-time type safety using Zod schemas + JSON Schema reflection.
- Deterministic execution with persistence, resume (wait/event/timer/human), retries, error policies, idempotency, and audit logs.
- MVP includes the minimum node/action set needed to reproduce the email processing workflow.

### 1.2 Non-Goals (MVP)

- Arbitrary DAG graphs (MVP uses structured pipelines only).
- User-defined code execution inside workflows (no eval, no custom JS snippets).
- Fuzzy email matching or advanced threading beyond explicit token/header matching.
- A full notification system beyond a stub action call with non-fatal failure handling.

### 1.3 Success Criteria

- Email workflow expressed purely as workflow JSON runs end-to-end with equivalent external behavior to the current JS workflow.
- GUI can render, edit, validate, and publish workflows without manual JSON editing.
- Runtime can crash/restart at any step without duplicating side effects (given idempotency keys on side-effect actions).
- Run history provides step-by-step provenance (inputs/outputs, errors, attempts) with redaction.

---

## 2. Key Concepts and Terminology

- **Workflow definition** — The JSON document that declares a workflow pipeline, triggers, and node configs. Stored as draft + immutable published versions.
- **Step** — A single executable unit in the pipeline. Can be a NodeStep (action/node) or a control block (if/forEach/tryCatch/callWorkflow/return).
- **Node type** — A registered handler in `NodeTypeRegistry` with a Zod config schema and optional UI metadata.
- **Action** — A side-effectful or pure operation registered in `ActionRegistry`, invoked via `action.call`.
- **Publish** — Server-side validation + immutable version creation. Invalid workflows are rejected (errors) or accepted with warnings.
- **Run** — A specific execution instance of a published workflow version with its own envelope, steps, waits, and snapshots.
- **Resume** — Continuing a WAITING run after an event, human task completion, timeout, retry, or admin override.
- **Trigger** — A definition-level event binding (`eventName`) that starts runs without an explicit start step.

---

## 3. Data Model

### 3.1 Envelope (Canonical Runtime Object)

```typescript
type Envelope<TPayload> = {
  v: 1;
  
  run: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    startedAt: string; // ISO
  };
  
  payload: TPayload;
  
  meta: {
    state?: string;                  // mirrors setState in legacy workflow
    traceId?: string;
    tags?: Record<string, string>;
    redactions?: string[];           // JSON pointers redacted in persisted logs
  };
  
  vars: Record<string, unknown>;
  
  error?: {
    name?: string;
    message: string;
    stack?: string;
    nodePath?: string;               // e.g. "root/steps[3]/try/steps[2]"
    at: string;                      // ISO
    data?: unknown;                  // optional, sanitized
  };
};
```

### 3.2 Workflow Definition JSON (Structured Pipeline Format)

MVP workflow definitions use structured pipelines instead of arbitrary graphs. Control-flow is represented with nested blocks, enabling predictable execution and a simple node-in-pipe UI.

```typescript
type WorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  description?: string;
  
  payloadSchemaRef: string;          // SchemaRegistry key for payload Zod schema
  trigger?: { type: "event"; eventName: string };
  
  steps: Step[];
};

type Step =
  | NodeStep
  | IfBlock
  | ForEachBlock
  | TryCatchBlock
  | CallWorkflowBlock
  | ReturnStep;

type NodeStep = {
  id: string;
  type: string;                      // NodeType ID, e.g. "action.call"
  name?: string;
  config?: unknown;                  // validated via NodeType.configSchema
  retry?: RetryPolicy;               // optional override
  onError?: OnErrorPolicy;
};

type IfBlock = {
  id: string;
  type: "control.if";
  condition: Expr;                   // boolean
  then: Step[];
  else?: Step[];
};

type ForEachBlock = {
  id: string;
  type: "control.forEach";
  items: Expr;                       // array
  itemVar: string;
  concurrency?: number;              // default 1
  body: Step[];
  onItemError?: "continue" | "fail";
};

type TryCatchBlock = {
  id: string;
  type: "control.tryCatch";
  try: Step[];
  catch: Step[];
  captureErrorAs?: string;
};

type CallWorkflowBlock = {
  id: string;
  type: "control.callWorkflow";
  workflowId: string;
  workflowVersion: number;
  inputMapping?: Record<string, Expr>;
  outputMapping?: Record<string, Expr>;
};

type ReturnStep = {
  id: string;
  type: "control.return";
};

type RetryPolicy = {
  maxAttempts: number;               // includes first attempt
  backoffMs: number;
  backoffMultiplier?: number;        // default 2
  jitter?: boolean;                  // default true
  retryOn?: string[];                // categories (see §6.4.1)
};

type OnErrorPolicy = {
  policy: "fail" | "continue";
};

type Expr = {
  "$expr": string;
};
```

### 3.3 Structured Pipeline Constraints (MVP)

1. Steps execute strictly top-to-bottom within a pipe.
2. Only these control blocks are allowed: `control.if`, `control.forEach`, `control.tryCatch`, `control.callWorkflow`, `control.return`.
3. No cycles (except implicit iteration inside forEach).
4. All step IDs must be unique within the workflow definition.

---

## 4. Type Safety and Schema Reflection (Zod-Based)

### 4.1 Source-of-Truth Schemas

- **Zod** is the canonical schema system for payloads, node configs, action I/O, and human task forms.
- TypeScript types are derived via `z.infer<typeof schema>` in code.

### 4.2 Reflection and Validation Pipeline

1. **At service startup:** Register Zod schemas in SchemaRegistry; register Node Types and Actions in their registries.
2. **At publish time:** Load `payloadSchemaRef` Zod schema; convert it to JSON Schema (`zod-to-json-schema`) and store alongside the published plan.
3. **At publish time:** Validate workflow JSON (shape, step uniqueness, registry references, config schemas, expression compilation).
4. **At run start / event trigger:** Validate initial payload against the registered payload schema; reject invalid payloads before creating a run.
5. **At runtime:** Validate node configs (once, using published compiled config), validate action inputs/outputs on every `action.call`.
6. **Before persisting snapshots:** Apply redaction rules to payload and action invocation logs.

### 4.3 Type Safety Rules (MVP)

1. `WorkflowDefinition` JSON must validate against `WorkflowDefinition` Zod schema.
2. Every `NodeStep.type` must exist in `NodeTypeRegistry`.
3. Every `action.call` must reference a known `ActionRegistry` entry (id + version).
4. `NodeStep.config` must validate against `NodeType.configSchema`.
5. Expressions must compile and be syntactically valid at publish time.
6. Runtime must validate action input/output via `ActionDef` input/output Zod schemas.
7. Redaction must be applied before storing or rendering run snapshots.

---

## 5. Expression Language

### 5.1 Requirements

- **Safe:** No arbitrary code execution.
- **Deterministic** for identical inputs.
- **Supports:** Property access, boolean logic, ternary/if, nullish coalesce, basic array ops, and a small helper allowlist.
- JSON-serializable return values only.

### 5.2 Implementation: JSONata (MVP)

Use the [JSONata](https://jsonata.org/) NPM library as the expression engine. The runtime must restrict function registration to a small allowlist and enforce time and output limits.

### 5.3 Evaluation Context and Limits

**Expression context:**

| Variable | Description |
|----------|-------------|
| `payload` | `env.payload` |
| `vars` | `env.vars` |
| `meta` | `env.meta` |
| `error` | `env.error` |

**Helper functions:**

- `nowIso()` — Current ISO timestamp
- `coalesce(...)` — Return first non-null value
- `len(x)` — Length of array/string
- `toString(x)` — Convert to string

**Limits:**

| Limit | Value |
|-------|-------|
| Evaluation timeout | 25ms |
| Max output size | 256KB (after JSON stringify) |
| User-defined functions | Disallowed |

### 5.4 Best Practices (MVP)

- Use `coalesce(...)` to guard optional fields (`coalesce(payload.foo, 'default')`).
- Prefer explicit boolean checks (`payload.value = true`) to avoid truthy ambiguity.
- Normalize arrays with `coalesce(payload.items, [])` before iteration or concatenation.
- Keep expressions small; move complex logic into a dedicated action or node.

---

## 6. Runtime Architecture

### 6.1 Components

- **Workflow server actions (first-class)** — CRUD, publish, runs, registry discovery, event submission (used by UI and internal services)
- **Workflow API routes (thin external layer)** — REST entrypoints that delegate to server actions for external automation
- **Worker service** — Executes runs
- **Event ingestion + routing component** — Wakes waiting runs
- **Scheduler** — Timeouts, delayed retries, stale lease recovery
- **Registries** — SchemaRegistry, NodeTypeRegistry, ActionRegistry

### 6.2 Execution Model (Deterministic Interpreter)

#### 6.2.1 High-Level Algorithm

```
while true:
  run = acquireRunnableRunLease()
  if no run: sleep(pollInterval); continue
  
  plan = loadPublishedPlan(run.workflowId, run.workflowVersion)
  env  = loadLastEnvelopeSnapshot(run.runId)
  
  stepPath = run.nodePath
  try:
    env2, nextStepPath = executeFrom(stepPath, env, plan)
    persistCheckpoint(runId, nextStepPath, env2, status=RUNNING or SUCCEEDED)
  except err:
    persistFailure(runId, stepPath, err)
```

#### 6.2.2 nodePath Pointer Format

`nodePath` is a string path into the nested step tree. It is persisted after each completed step.

**Examples:**

- `"root.steps[0]"`
- `"root.steps[3].try.steps[2]"`
- `"root.steps[5].then.steps[1]"`
- `"root.steps[7].body.steps[0]"`

#### 6.2.3 Checkpoint Persistence Rules

1. **Before executing a step:** Insert `workflow_run_steps` row with `status=STARTED` and attempt counter.
2. **After a step succeeds:** Update `workflow_run_steps` to `SUCCEEDED`, persist envelope snapshot, and set `workflow_runs.node_path` to the next stepPath.
3. **If a step fails and is retryable:** Update `workflow_run_steps` to `RETRY_SCHEDULED` and set `workflow_runs.status` to `WAITING` with a retry timer wait.
4. **If a step fails and is not retryable:** Bubble to nearest enclosing `tryCatch`; if none exists, mark run `FAILED`.

### 6.3 Storage Schema (Reference Implementation)

Reference implementation uses PostgreSQL. Keep the same logical entities if you use another store.

### 6.4 Errors, Retries, and Idempotency

#### 6.4.1 Error Categories (String Codes)

| Code | Retryable | Description |
|------|-----------|-------------|
| `ValidationError` | No | Schema validation failure |
| `ExpressionError` | No | Expression evaluation failure |
| `TransientError` | Yes | Infra/network/timeouts/429 |
| `ActionError` | Depends | Domain error; retryability decided by action |
| `TimeoutError` | — | Wait timed out |

#### 6.4.2 Retry Scheduling

```
backoff(attempt) = backoffMs * (backoffMultiplier ^ (attempt - 1))

if jitter:
  backoff = backoff * random(0.8..1.2)
```

**Implementation:**

- Do not sleep inside worker.
- Instead: create/update `workflow_run_waits` row with `wait_type="retry"` and `timeout_at = now + backoff`.
- Mark run `WAITING`; scheduler wakes it when due.

#### 6.4.3 Idempotency Contract

1. Every side-effect action must have an idempotency key (engine-computed or action-computed).
2. `workflow_action_invocations` must have a unique constraint on `(action_id, action_version, idempotency_key)`.
3. If an invocation exists with `status=SUCCEEDED`, the engine returns the stored output without calling the handler.
4. If an invocation exists with `status=STARTED` and lease is stale, treat as retryable `TransientError`.

### 6.5 Waits and Resume

1. `event.wait` registers `workflow_run_waits` (`wait_type='event'`, `key=correlationKey`) and parks the run `WAITING`.
2. A matching `POST /workflow/events` inserts `workflow_events` and resumes exactly one waiting run atomically.
3. `timeoutMs` on `event.wait` sets `timeout_at`; scheduler triggers a `TimeoutError` resume when exceeded.
4. `human.task` creates a task record and parks the run until completion event; output is validated by form schema.

### 6.6 Observability + Redaction

- Every log line includes `run_id`, `step_path`, `workflow_id`, `workflow_version`, `tenant_id` (if available).
- Persist sanitized envelope snapshots for run viewer; cap size and retention (defaults: 256KB snapshot, 30 days).
- Redaction rules are configured as JSON pointers; `secretRef` fields are always masked.

---

## 7. Registries

### 7.1 SchemaRegistry

- `register(ref: string, schema: ZodSchema)` at startup.
- `get(ref)` returns ZodSchema; `toJsonSchema(ref)` returns JSON Schema using `zod-to-json-schema`.
- Schemas are versioned by ref naming convention (e.g., `payload.EmailWorkflowPayload.v1`).

### 7.2 ActionRegistry

- Actions are keyed by `(id, version)`.
- Each Action has Zod `inputSchema` + `outputSchema` and a `handler(input, ctx) -> output`.
- Each Action includes metadata: `sideEffectful`, `retryHint`, idempotency strategy, UI metadata.

### 7.3 NodeTypeRegistry

- Node Types are keyed by `id` (string).
- Each Node Type has a Zod `configSchema` and a `handler(env, config, ctx) -> env'`.
- Node Types include structural controls and domain transforms.
- Node Types include UI metadata for palette/config.

---

## 8. MVP Node/Action Set (Email Workflow Driven)

### 8.1 Required Node Types

| Node Type | Description |
|-----------|-------------|
| `state.set` | Set workflow state |
| `event.wait` | Wait for external event |
| `transform.assign` | Assign variables |
| `action.call` | Call registered action |
| `control.if` | Conditional branching |
| `control.forEach` | Iterate over collection |
| `control.tryCatch` | Error handling |
| `control.return` | Exit workflow |
| `email.parseBody` | Parse email body |
| `email.renderCommentBlocks` | Render comment blocks |

### 8.2 Required Actions (Capabilities)

| Action | Description |
|--------|-------------|
| `parse_email_reply` | Parse reply content from email |
| `find_ticket_by_reply_token` | Find ticket using reply token |
| `find_ticket_by_email_thread` | Find ticket using email threading headers |
| `convert_html_to_blocks` | Convert HTML to block format |
| `create_comment_from_email` | Create ticket comment from email |
| `process_email_attachment` | Process and store attachment |
| `find_contact_by_email` | Find contact by email address |
| `resolve_inbound_ticket_defaults` | Resolve default ticket values |
| `create_ticket_from_email` | Create new ticket from email |
| `create_human_task_for_email_processing_failure` | Create manual review task |
| `send_ticket_acknowledgement_email` | Send ack email (stub, non-fatal) |

---

## 9. Email Processing Workflow Mapping (Behavioral Parity)

### 9.1 Required States

| State | Description |
|-------|-------------|
| `PROCESSING_INBOUND_EMAIL` | Initial processing |
| `CHECKING_EMAIL_THREADING` | Checking for existing thread |
| `MATCHING_EMAIL_CLIENT` | Matching sender to contact |
| `RESOLVING_TICKET_DEFAULTS` | Resolving default values |
| `CREATING_TICKET` | Creating new ticket |
| `PROCESSING_ATTACHMENTS` | Processing email attachments |
| `EMAIL_PROCESSED` | Successfully completed |
| `ERROR_NO_TICKET_DEFAULTS` | Missing required defaults |
| `ERROR_PROCESSING_EMAIL` | General processing error |
| `AWAITING_MANUAL_RESOLUTION` | Waiting for human review |

### 9.2 Canonical Step Structure (Pipe + Nested Blocks)

1. Wait for `INBOUND_EMAIL_RECEIVED` (10s timeout), store event payload into `payload.*`.
2. Parse body (reply stripping) with fallback, store `parsedEmail` (text/html/confidence/metadata).
3. Try: resolve existing ticket via reply token else via threading headers.
4. If existing ticket: add comment (author=contact), process attachments (per-item continue), return.
5. Else: exact contact match, resolve ticket defaults, create ticket, process attachments, create initial comment, set `EMAIL_PROCESSED`, optional ack (non-fatal).
6. Catch: set `ERROR_PROCESSING_EMAIL`, create human task, set `AWAITING_MANUAL_RESOLUTION`, return.

---

## 10. GUI Designer (Node-in-Pipe)

### 10.1 Visual Model

- The designer edits the structured pipeline AST described in §3.2.
- The primary canvas renders a vertical pipe of step cards; nested blocks render nested pipes.
- Wiring is done by selecting payload fields and generating expressions (`$expr`) rather than drawing arbitrary DAG wires.

### 10.2 Core Interactions

1. **Palette:** Search and insert node types and control blocks.
2. **Drag/drop:** Reorder steps within a pipe; move steps between pipes (then/else/try/catch/body).
3. **Select:** Open config panel; edit fields via schema-generated forms.
4. **Field picker:** Choose payload/vars fields and insert into expressions.
5. **Validate:** Run local (syntax) validation on change; run server publish validation on publish.

### 10.3 Run Viewer

- List runs by status, time, and workflow version.
- Step timeline shows attempts, durations, and errors.
- Per-step view shows sanitized envelope snapshot and action invocation logs.

---

## 11. Server Actions + API Surface (Minimum)

**Principle:** server actions are the first-class implementation. API routes are a thin external automation layer and must delegate to the server actions without re-implementing business logic.

### 11.0 Server Actions (First-Class)

| Capability | Server Action |
|------------|---------------|
| Definitions list | List workflow definitions |
| Definitions get | Get workflow definition version |
| Definitions create | Create workflow definition draft |
| Definitions update | Update workflow definition draft |
| Publish | Publish workflow definition |
| Runs start | Start workflow run (workflowVersion optional; defaults to latest published) |
| Runs status | Get workflow run |
| Runs steps | List workflow run steps + snapshots |
| Runs cancel | Cancel workflow run |
| Runs resume | Resume workflow run (admin) |
| Registry nodes | List node registry entries |
| Registry actions | List action registry entries |
| Registry schema | Get schema by ref |
| Events submit | Submit workflow event + resume waits + trigger runs |
| Events list | List workflow runtime events (admin) |

### 11.1 Workflow Definitions (API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workflow-definitions` | List definitions |
| `GET` | `/workflow-definitions/{id}/{version}` | Get specific version |
| `POST` | `/workflow-definitions` | Create new definition |
| `PUT` | `/workflow-definitions/{id}/{version}` | Update definition |
| `POST` | `/workflow-definitions/{id}/{version}/publish` | Publish version |

### 11.2 Runs (API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workflow-runs` | Start new run (if version omitted, use latest published) |
| `GET` | `/workflow-runs/{runId}` | Get run status |
| `GET` | `/workflow-runs/{runId}/steps` | Get run steps |
| `POST` | `/workflow-runs/{runId}/cancel` | Cancel run |
| `POST` | `/workflow-runs/{runId}/resume` | Resume run (admin) |

### 11.3 Registry Discovery (API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workflow/registry/nodes` | List node types |
| `GET` | `/workflow/registry/actions` | List actions |
| `GET` | `/workflow/registry/schemas/{schemaRef}` | Get schema |

### 11.4 Events (API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workflow/events` | Publish event |
| `GET` | `/workflow/events` | List events (admin) |

---

## 12. Migration Plan (from TS Workflows)

1. Register existing implementations as Actions with Zod schemas.
2. Recreate the email workflow as data using the node set in §8.
3. Run canary tenant in parallel; compare side effects and run logs.
4. Switch routing once parity and idempotency are verified.

---

## 13. Testing Plan

| Category | Tests |
|----------|-------|
| **Unit** | Expression engine sandbox + helper allowlist |
| **Unit** | Node config validation (Zod) and action I/O validation |
| **Integration** | `event.wait` + resume + timeout |
| **Integration** | `tryCatch` semantics and `forEach` per-item continue |
| **Integration** | Idempotency caching behavior for side-effect actions |
| **E2E** | New email → ticket; reply email → comment; attachments for both paths |
| **Chaos** | Worker crash mid-run; resume without duplicate side effects |

---

## 14. Operational Support, Observability, and Governance

The MVP runtime and designer must be production‑ready for operators and tenant admins. This section defines the operational surfaces needed to observe, debug, and safely control workflows in production.

### 14.1 Run List (Operational Index)

**Purpose:** Provide a tenant‑scoped list of workflow runs with filterable status, time windows, and workflow versions.

**Required UI capabilities**
- Filter by status, workflow ID, workflow version, and date range.
- Search by run ID, correlation key, or payload fields (limited to indexed fields).
- Bulk actions (cancel, resume) when permitted.
- Saved views (optional) for common filters (e.g., “Failed in last 24h”).

**Required API surface**
- `GET /workflow-runs` with filters: `status[]`, `workflowId`, `version`, `from`, `to`, `cursor`, `limit`, `sort`.
- `GET /workflow-runs/summary` with aggregate counts by status/time bucket.

### 14.2 Run Details (Timeline + Debug)

**Purpose:** Provide step‑level provenance, attempts, error context, and redacted payload history.

**Required UI capabilities**
- Timeline view of steps with attempt count, duration, and status.
- Step detail panel showing:
  - Redacted envelope snapshot for the step.
  - Action invocation inputs/outputs (sanitized).
  - Retry schedule and failure category.
- Event wait/resume details (correlation key, event name, timeout).

**Required API surface**
- `GET /workflow-runs/{runId}/timeline` (steps, attempts, durations, statuses).
- `GET /workflow-runs/{runId}/snapshots` (redacted snapshots with pagination).
- `GET /workflow-runs/{runId}/invocations` (action call logs with redaction).
- `GET /workflow-runs/{runId}/waits` (wait history: event/human/retry/timeout).

### 14.3 Tenant‑Visible Logs and History

**Purpose:** Allow tenant admins to review historical workflow behavior without exposing secrets.

**Design principles**
- All logs must be redacted per `env.meta.redactions` and `secretRef` rules.
- Payload field visibility is role‑based; sensitive fields masked by default.
- Log entries are immutable and append‑only.

**Required API surface**
- `GET /workflow-runs/{runId}/logs` (structured log entries).
- `GET /workflow-runs/{runId}/events` (runtime events correlated to waits/resumes).

### 14.4 Audit Trail and Governance

**Purpose:** Provide compliance‑grade history for publish, resume, cancel, and manual interventions.

**Audit requirements**
- Record actor, action, timestamp, target run/definition, and diff summary.
- Capture publish metadata: who published, from which draft hash.
- Capture manual resume/cancel and reason fields.

### 14.5 RBAC and Permissions

**Purpose:** Ensure operational tools are available only to permitted roles.

**Required policy controls**
- Separate permissions for view, manage, publish, and admin actions.
- Field‑level redaction based on role.
- Support “view only” for read‑only roles.

### 14.6 Retention, Export, and Compliance

**Purpose:** Support data retention and legal/compliance obligations.

**Requirements**
- Retention policy per tenant for runs, snapshots, and invocation logs.
- Export run history to CSV/JSON with redactions applied.
- Purge jobs with audit logging.

### 14.7 Metrics, Health, and Alerting

**Purpose:** Provide operational telemetry for reliability and on‑call support.

**Metrics**
- Run success/failure rate by workflow and version.
- Step latency distribution and retry rates.
- Backlog size (WAITING + RUNNING) and lease utilization.

**Alerting**
- Threshold alerts for failure rate, backlog growth, and repeated retries.
- Optional webhooks for workflow failure notifications.

### 14.8 Operational Controls (Safe Recovery)

**Purpose:** Enable safe human intervention in exceptional cases.

**Controls**
- Admin resume for WAITING runs (audited).
- Cancel run with cleanup of waits/leases.
- Retry or replay from a selected step (controlled re‑execution).
- Dead‑letter queue for repeatedly failing runs.

### 14.9 Event Observability and Correlation

**Purpose:** Trace external events through waits/resumes to runs.

**Requirements**
- Event stream view with correlation keys and matched run IDs.
- Show unmatched events and TTL for retention.
- Link from event to run timeline and vice‑versa.

### 14.10 Performance and Reliability Targets

**Targets**
- UI queries must be paginated and bounded.
- Snapshot storage capped per run and per tenant.
- Deterministic execution with idempotency enforcement.

---

## 15. Workflow List Screen

The Workflow List provides a central hub for discovering, managing, and navigating to workflow definitions.

### 15.1 List Display and Filtering

- Sortable table with columns: name, description, status, version, last modified, trigger type.
- Text search/filter by workflow name and description.
- Status filter (active, draft, paused, archived).
- Trigger type filter (event-based, scheduled, manual).
- Cursor-based pagination for large lists.
- Summary counts (total, active, draft, paused).

### 15.2 Status and Metadata Display

- Status badge with color coding (active/draft/paused/archived).
- Published version number with draft indicator for unpublished changes.
- Last modified timestamp with relative time display.
- Trigger type icon/badge for quick identification.

### 15.3 Actions and Navigation

- Create New Workflow button with type selection.
- Row click to open workflow in designer.
- Quick-action menu: Edit, Duplicate, Pause/Resume, Archive, Delete.
- Bulk selection with bulk actions (pause, resume, archive, delete).
- Confirmation dialogs for destructive actions.
- View Runs action to navigate to filtered run list.

### 15.4 Navigation and URL State

- Tab navigation between Workflows, Runs, and Events views.
- URL-based filtering for shareable filtered views.

### 15.5 Empty and Loading States

- Empty state with illustration and "Create your first workflow" CTA.
- Skeleton loading state while fetching.
- "No results" state with suggestions when filters return empty.

---

## 16. Designer Schema Exposure

Users need visibility into action input/output schemas to understand data flow, author expressions correctly, and debug workflows. This section specifies how schemas are surfaced in the GUI designer.

### 16.1 Step Configuration Panel Schema Reference

**Purpose:** Show input and output schemas directly in the step configuration panel so users understand what data a step expects and produces.

**Required UI capabilities:**
- Collapsible "Input Schema" section listing all input fields with name, type, required/optional indicator, description, and default value.
- Collapsible "Output Schema" section listing all output fields with name, type, nullable indicator, and hierarchical nested structure display.
- "Copy path" button for each output field that copies the expression syntax (e.g., `${vars.stepName.ticket_id}`).
- When `saveAs` is configured, show preview text: "Output will be available at `${vars.myStep.*}`".
- Validate `saveAs` does not conflict with existing variable names; show warning if it does.

### 16.2 Expression Authoring

**Purpose:** Provide intelligent autocomplete and validation for expression fields so users can discover and reference available data without guessing.

**Required UI capabilities:**
- Context-aware autocomplete when typing `${vars.` that shows all previous steps with their `saveAs` names.
- Drill-down autocomplete into output schemas (e.g., `${vars.createTicket.` shows `ticket_id`, `ticket_number`).
- Support nested path autocomplete for complex structures (e.g., `${vars.parseEmail.parsed.headers.subject}`).
- Enhanced field picker showing:
  - Payload schema fields (current behavior).
  - Previous step outputs organized by step name.
  - Global variables (`env`, `secrets`) with appropriate access patterns.
  - Visual tree browser for navigating complex nested structures.
- Real-time expression validation:
  - Check that referenced paths exist in available schemas.
  - Warn when referencing a step that executes after the current step (order dependency).
  - Warn on type mismatches (e.g., passing string where number expected).

### 16.3 Visual Data Flow

**Purpose:** Help users understand data flow through the workflow at a glance.

**Required UI capabilities:**
- Optional edge labels/annotations showing data shape between nodes (toggle-able; collapsed shows "3 fields").
- Step output preview badge on each node showing output availability with hover for quick schema summary.
- Data Flow sidebar/panel showing available data context at any selected step:
  - Payload fields.
  - Variables by source step.
  - Environment variables.
  - Available secrets.

### 16.4 Documentation and Help

**Purpose:** Provide contextual help so users can understand actions without leaving the designer.

**Required UI capabilities:**
- Action documentation panel when selecting an action type showing description, examples, and common use cases.
- Schema tooltips on hover for any field in config forms showing type, constraints, description, and examples.
- "What can I access here?" helper button in expression fields that opens contextual field picker with explanation.

### 16.5 Validation and Error Handling

**Purpose:** Catch schema-related errors early and provide actionable feedback.

**Required capabilities:**
- Pre-publish validation:
  - Check all expressions reference valid paths in available schemas.
  - Verify required inputs are provided or have valid expressions.
  - Check type compatibility where determinable at publish time.
- Runtime error context:
  - Show which input field caused validation failure.
  - Display expected type vs actual value received.
- Missing mapping warnings:
  - Warn when action has required inputs that are not mapped.
  - Suggest fields from available context that match the expected type.

### 16.6 Schema Discovery and Registry

**Purpose:** Help users find the right action for their needs and understand its contract.

**Required UI capabilities:**
- Action browser/palette with input/output schema preview when browsing available actions.
- Filterable by category, searchable by field name (e.g., find actions that return `ticket_id`).
- Summary text: "This action returns: ticket_id, ticket_number, ..." in action browser entries.
- Document node type schemas for non-action nodes (conditions, loops) including special behaviors (e.g., `forEach` exposes `item` and `index` variables).

### 16.7 Developer Experience

**Purpose:** Support power users and debugging scenarios.

**Required UI capabilities:**
- JSON Schema view toggle to see raw schema definition.
- Copy schema as JSON for external use or documentation.
- Test step feature to enter sample input data and preview output schema/structure.
- Schema diff when action version changes highlighting added/removed/changed fields.

### 16.8 Implementation Notes

**Data sources for schema information:**
- `ActionRegistry` provides `inputSchema` and `outputSchema` (Zod schemas convertible to JSON Schema).
- `NodeTypeRegistry` provides `configSchema` for node configuration.
- Published workflow versions store `payload_schema_json` for payload field discovery.
- Step `saveAs` configuration determines where outputs are stored in `vars`.

**Schema resolution at design time:**
1. Load action registry to get all available actions with their schemas.
2. For the current workflow, build a "data context" map that tracks what's available at each step:
   - Start with `payload` (from `payloadSchemaRef`).
   - After each step with `saveAs`, add `vars.{saveAs}` with the action's output schema.
   - Track `env` and `secrets` as global scopes.
3. Use this context map to power autocomplete, validation, and the data flow panel.

**Priority order for implementation:**
1. P0 (Essential): Input/Output schema reference sections, context-aware autocomplete, field picker enhancement.
2. P1 (Important): SaveAs preview, expression validation, pre-publish schema checks, missing mapping warnings.
3. P2 (Valuable): Data flow panel, action documentation, schema tooltips, action browser enhancements.
4. P3 (Nice to have): Edge labels, JSON schema toggle, test step feature, schema diff.

---

## 17. Type-Safe Input Mapping System

Actions require specific input shapes, and workflows produce typed outputs. This section specifies a formal input mapping system that enforces type safety from design time through runtime.

### 17.1 Problem Statement

The current system allows loose coupling between step outputs and action inputs:
- Config values are stored directly without explicit mapping
- No design-time validation of type compatibility
- No completeness checking for required inputs
- Runtime errors when shapes don't match

The `control.callWorkflow` block already has `inputMapping` and `outputMapping` fields. Regular action steps need the same rigor.

### 17.2 Data Model

#### 17.2.1 InputMapping on Action Steps

Extend the `action.call` node config to include explicit input mapping:

```typescript
type ActionCallConfig = {
  actionId: string;
  version: number;
  inputMapping: Record<string, Expr>;  // target input field → source expression
  saveAs?: string;
  onError?: OnErrorPolicy;
  idempotencyKey?: Expr;
};
```

**Example:**
```json
{
  "type": "action.call",
  "config": {
    "actionId": "create_ticket_from_email",
    "version": 1,
    "inputMapping": {
      "tenantId": { "$expr": "payload.tenantId" },
      "emailData": { "$expr": "payload.emailData" },
      "clientId": { "$expr": "vars.matchedClient.client_id" },
      "ticketDefaults": { "$expr": "vars.ticketDefaults" }
    },
    "saveAs": "createdTicket"
  }
}
```

#### 17.2.2 Mapping Metadata

Each mapping entry tracks:
- **targetField**: The action input field name (from inputSchema)
- **sourceExpr**: Expression referencing available data
- **sourceType**: Inferred type from source schema (design-time)
- **targetType**: Expected type from action inputSchema
- **compatibility**: `compatible` | `warning` | `error` | `unknown`

#### 17.2.3 Available Data Context

At each step, the available data context includes:
- `payload.*` — Trigger/event payload (from payloadSchemaRef)
- `vars.*` — Outputs from previous steps (keyed by saveAs)
- `meta.*` — Workflow metadata (state, tags, traceId)
- `error.*` — Current error if in catch block
- `item` / `index` — Loop variables if inside forEach

### 17.3 Mapping UI

#### 17.3.1 Input Mapping Editor

A dedicated panel for configuring action inputs with:
- **Left column**: Available data tree (payload, vars by step, meta)
- **Right column**: Required inputs from action inputSchema
- **Mapping lines**: Visual connection between source → target
- **Type indicators**: Color-coded compatibility status

#### 17.3.2 Field Selection

For each target input field:
- Dropdown/picker showing compatible fields from available data
- Expression editor for complex mappings
- Type badge showing expected type
- Required indicator (asterisk or badge)

#### 17.3.3 Auto-Mapping Suggestions

When action is first added:
- Suggest mappings for fields with matching names and compatible types
- Highlight unmapped required fields
- Offer "Auto-map matching fields" button

#### 17.3.4 Nested Object Mapping

For complex input schemas with nested objects:
- Collapsible sections for object properties
- Option to map entire object or individual fields
- Visual tree representation matching input schema structure

### 17.4 Design Surface Affordances

#### 17.4.1 Step Validation Status

Each step card on the canvas shows:
- **Green checkmark**: All required inputs mapped with compatible types
- **Yellow warning**: All required inputs mapped but type warnings exist
- **Red error**: Missing required mappings or type errors
- **Gray incomplete**: Action selected but mapping not configured

#### 17.4.2 Validation Badge Details

On hover or click, show:
- Count of mapped vs required fields
- List of missing required fields
- List of type compatibility warnings
- Quick link to open mapping editor

#### 17.4.3 Step List Indicators

In the step list sidebar:
- Same status icons as canvas
- Filter by validation status
- Batch view of all mapping issues

#### 17.4.4 Breadcrumb Trail

When a validation error references a nested mapping:
- Show full path: "Create Ticket → inputMapping → ticketDefaults.priority"
- Click to navigate directly to the field

### 17.5 Publish Validation

#### 17.5.1 Mapping Completeness Rules

| Rule | Severity | Code |
|------|----------|------|
| Required input field not mapped | Error | `REQUIRED_INPUT_UNMAPPED` |
| Optional input field not mapped | — | (allowed) |
| Mapping expression invalid syntax | Error | `INVALID_MAPPING_EXPR` |
| Mapping references undefined path | Error | `UNDEFINED_MAPPING_SOURCE` |
| Mapping references future step | Error | `FORWARD_REFERENCE` |

#### 17.5.2 Type Compatibility Rules

| Rule | Severity | Code |
|------|----------|------|
| Types match exactly | — | (pass) |
| Nullable source → non-null target | Warning | `NULLABLE_TO_REQUIRED` |
| String → Number (parseable) | Warning | `TYPE_COERCION` |
| Incompatible types (object → string) | Error | `TYPE_MISMATCH` |
| Array element type mismatch | Warning | `ARRAY_ELEMENT_MISMATCH` |
| Unknown source type | Warning | `UNKNOWN_SOURCE_TYPE` |

#### 17.5.3 Structural Compatibility

For object inputs:
- All required properties must be present in source or have defaults
- Extra properties in source are allowed (passed through or ignored per schema)
- Nested object compatibility checked recursively

#### 17.5.4 Validation Error Format

```typescript
type MappingValidationError = PublishError & {
  targetField?: string;       // The input field with the issue
  sourceExpr?: string;        // The expression that failed
  expectedType?: string;      // What the action expects
  actualType?: string;        // What the source provides
};
```

### 17.6 Runtime Integration

#### 17.6.1 Mapping Resolution

Before invoking an action handler:
1. Load the step's `inputMapping` configuration
2. For each target field, evaluate the source expression against current context
3. Build the resolved input object
4. Validate against action's inputSchema (Zod)
5. Pass validated input to handler

#### 17.6.2 Resolution Algorithm

```typescript
function resolveInputMapping(
  mapping: Record<string, Expr>,
  context: { payload, vars, meta, error, item?, index? },
  inputSchema: ZodSchema
): ResolvedInput {
  const resolved: Record<string, unknown> = {};

  for (const [targetField, sourceExpr] of Object.entries(mapping)) {
    resolved[targetField] = evaluateExpr(sourceExpr, context);
  }

  // Apply defaults from schema for unmapped optional fields
  const withDefaults = applySchemaDefaults(resolved, inputSchema);

  // Validate final shape
  return inputSchema.parse(withDefaults);
}
```

#### 17.6.3 Runtime Error Handling

When mapping resolution fails:
- Capture which field failed and why
- Include source expression and evaluated value
- Include expected vs actual type
- Classify as `ValidationError` (non-retryable)

#### 17.6.4 Coercion Rules

Limited automatic coercion at runtime:
- `null` / `undefined` → Use schema default if available
- String containing number → Parse to number if target expects number
- ISO date string → Parse to Date if target expects Date
- All other mismatches → Validation error

### 17.7 Migration and Backwards Compatibility

#### 17.7.1 Existing Workflows

Workflows created before input mapping:
- Continue to work with legacy `args` field
- Designer shows upgrade prompt to convert to `inputMapping`
- Auto-migration tool to convert `args` → `inputMapping`

#### 17.7.2 Schema Evolution

When action inputSchema changes:
- Designer highlights affected workflows
- Show diff of added/removed/changed fields
- Validation re-runs on next edit or publish

### 17.8 Implementation Priority

| Priority | Component | Description |
|----------|-----------|-------------|
| P0 | Data Model | Add inputMapping to action.call config schema |
| P0 | Runtime | Implement mapping resolution in action executor |
| P0 | Publish Validation | Completeness checking for required fields |
| P1 | Mapping UI | Basic field picker and mapping editor |
| P1 | Type Validation | Type compatibility checking at publish |
| P1 | Canvas Badges | Validation status indicators on steps |
| P2 | Auto-Suggestions | Smart mapping suggestions |
| P2 | Type Coercion | Runtime coercion for compatible types |
| P3 | Migration Tool | Auto-convert legacy args to inputMapping |
| P3 | Schema Diff | Highlight changes when action version updates |

---

## 18. Tenant Secrets Management

Workflows often need access to sensitive credentials (API keys, tokens, passwords). This section specifies a tenant-level secrets management system that integrates with workflow input mapping.

### 18.1 Overview

Secrets are:
- **Tenant-scoped**: Each tenant manages their own secrets
- **Encrypted at rest**: Values stored using envelope encryption
- **Never exposed**: Values never appear in logs, UI responses, or API outputs
- **Referenced by name**: Workflows use `{ $secret: "secretName" }` syntax
- **Audited**: All access and modifications are logged

### 18.2 Data Model

#### 18.2.1 Secret Entity

```typescript
type TenantSecret = {
  id: string;                    // UUID
  tenant_id: string;             // Owning tenant
  name: string;                  // Unique within tenant, e.g., "STRIPE_API_KEY"
  description?: string;          // Human-readable description
  encrypted_value: string;       // Encrypted secret value
  encryption_key_id: string;     // Reference to encryption key used
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
  created_by: string;            // User ID who created
  updated_by: string;            // User ID who last updated
  last_accessed_at?: string;     // Last time secret was read by a workflow
};
```

#### 18.2.2 Database Schema

```sql
CREATE TABLE tenant_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  encrypted_value TEXT NOT NULL,
  encryption_key_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  last_accessed_at TIMESTAMPTZ,
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_tenant_secrets_tenant_id ON tenant_secrets(tenant_id);
```

#### 18.2.3 Secret Reference Syntax

In workflow inputMapping:

```json
{
  "apiKey": { "$secret": "STRIPE_API_KEY" },
  "webhookToken": { "$secret": "WEBHOOK_SECRET" }
}
```

### 18.3 Secret Provider

#### 18.3.1 Encryption Strategy

- **Envelope encryption**: Each secret encrypted with a data encryption key (DEK)
- **DEK encrypted with master key**: Master key stored in secure key management
- **Key rotation support**: Ability to re-encrypt secrets with new keys

#### 18.3.2 Provider Interface

```typescript
interface SecretProvider {
  // Store a new secret (encrypts value)
  create(tenantId: string, name: string, value: string): Promise<void>;

  // Update secret value (re-encrypts)
  update(tenantId: string, name: string, value: string): Promise<void>;

  // Retrieve decrypted value (for runtime use only)
  get(tenantId: string, name: string): Promise<string>;

  // Check if secret exists (no decryption)
  exists(tenantId: string, name: string): Promise<boolean>;

  // Delete secret
  delete(tenantId: string, name: string): Promise<void>;

  // List secret names (no values)
  list(tenantId: string): Promise<SecretMetadata[]>;
}

type SecretMetadata = {
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
};
```

#### 18.3.3 Implementation Notes

- Use established encryption library (e.g., Node.js crypto with AES-256-GCM)
- Master key from environment variable or key management service
- Consider integration with external secret managers (Vault, AWS Secrets Manager) in future

### 18.4 Settings UI

#### 18.4.1 Secrets List View

Located at: **Settings → Secrets**

| Column | Description |
|--------|-------------|
| Name | Secret identifier (e.g., `STRIPE_API_KEY`) |
| Description | Human-readable description |
| Last Updated | Relative timestamp |
| Last Accessed | When a workflow last used this secret |
| Actions | Edit, Delete |

Features:
- Search/filter by name
- Sort by name, updated, accessed
- Pagination for large secret lists

#### 18.4.2 Create Secret Dialog

Fields:
- **Name** (required): Uppercase with underscores recommended (e.g., `API_KEY_NAME`)
- **Value** (required): Password input, never shown after save
- **Description** (optional): What this secret is used for

Validation:
- Name must be unique within tenant
- Name must match pattern: `^[A-Z][A-Z0-9_]{0,254}$`
- Value cannot be empty

#### 18.4.3 Edit Secret Dialog

Fields:
- **Description**: Editable
- **New Value**: Optional - only update if provided
- Shows "Value last updated: X days ago"

Note: Cannot view current value, only replace it.

#### 18.4.4 Delete Secret Confirmation

- Show warning if secret is referenced by any workflows
- List workflows that reference this secret
- Require typing secret name to confirm deletion

### 18.5 Workflow Integration

#### 18.5.1 Secret Reference in InputMapping

```typescript
type MappingValue = Expr | LiteralValue | SecretRef;

type SecretRef = {
  $secret: string;  // Secret name
};
```

#### 18.5.2 Secret Picker in Mapping UI

When mapping a field marked as sensitive:
- Show "Use Secret" option alongside Expression/Literal
- Display dropdown of available tenant secrets
- Show "Manage Secrets" link to settings
- Show placeholder text: `••••••••` for mapped secrets

#### 18.5.3 Publish-Time Validation

- Verify all referenced secrets exist
- Return `SECRET_NOT_FOUND` error if missing
- Warning if secret hasn't been accessed recently (may be stale)

#### 18.5.4 Runtime Resolution

```typescript
async function resolveSecretRef(
  ref: SecretRef,
  tenantId: string,
  secretProvider: SecretProvider
): Promise<string> {
  const value = await secretProvider.get(tenantId, ref.$secret);
  // Update last_accessed_at
  await updateSecretAccessTime(tenantId, ref.$secret);
  return value;
}
```

### 18.6 Security

#### 18.6.1 Access Control

| Permission | Description |
|------------|-------------|
| `secrets.view` | List secret names and metadata |
| `secrets.manage` | Create, update, delete secrets |
| `secrets.use` | Reference secrets in workflows |

Default role assignments:
- Admin: All permissions
- Editor: `secrets.view`, `secrets.use`
- Viewer: None

#### 18.6.2 Audit Logging

Log all secret operations:
- `secret.created` - Who, when, secret name (not value)
- `secret.updated` - Who, when, secret name
- `secret.deleted` - Who, when, secret name
- `secret.accessed` - Workflow run ID, secret name, timestamp

#### 18.6.3 Value Protection

**Never expose secret values in:**
- API responses (return metadata only)
- UI (show placeholder `••••••••`)
- Logs (redact before logging)
- Workflow snapshots (replace with `[REDACTED]`)
- Error messages (show secret name, not value)

#### 18.6.4 Input Validation

- Reject secrets with values exceeding 64KB
- Sanitize secret names to prevent injection
- Rate limit secret access to prevent enumeration

### 18.7 Server Actions + API Surface

**Principle:** Server actions are the first-class implementation. API routes are a thin external automation layer and must delegate to the server actions without re-implementing business logic.

#### 18.7.1 Server Actions (First-Class)

| Capability | Server Action |
|------------|---------------|
| List secrets | List tenant secrets (metadata only) |
| Get secret metadata | Get secret by name (no value) |
| Create secret | Create new secret (encrypts value) |
| Update secret | Update secret value/description |
| Delete secret | Delete secret by name |
| Check exists | Check if secret exists |
| Resolve for runtime | Get decrypted value (internal only) |

#### 18.7.2 API Routes (External Automation Shims)

These routes delegate to server actions for external automation use cases:

| Method | Route | Delegates To |
|--------|-------|--------------|
| GET | `/api/tenants/{tenantId}/secrets` | List secrets action |
| POST | `/api/tenants/{tenantId}/secrets` | Create secret action |
| PATCH | `/api/tenants/{tenantId}/secrets/{name}` | Update secret action |
| DELETE | `/api/tenants/{tenantId}/secrets/{name}` | Delete secret action |
| HEAD | `/api/tenants/{tenantId}/secrets/{name}` | Check exists action |

**Note:** There is no API route to retrieve decrypted secret values. Runtime resolution is internal only.

### 18.8 Implementation Priority

| Priority | Component | Description |
|----------|-----------|-------------|
| P0 | Data Model | Secret entity and database schema |
| P0 | Secret Provider | Basic encryption/decryption |
| P0 | Server Actions | CRUD operations (first-class) |
| P0 | Runtime Resolution | Resolve $secret in workflows |
| P1 | Settings UI | List, create, edit, delete secrets |
| P1 | Mapping Integration | Secret picker in mapping editor |
| P1 | Audit Logging | Log all secret operations |
| P2 | Usage Analysis | Show which workflows use each secret |
| P2 | Key Rotation | Re-encrypt secrets with new keys |
| P3 | External Providers | Vault, AWS Secrets Manager integration |

---

## Appendix A: Validation Error Format (Publish-Time)

```typescript
type PublishError = {
  severity: "error" | "warning";
  stepPath: string;            // e.g. "root.steps[3].try.steps[2]"
  stepId?: string;             // the Step.id at that location (if available)
  code: string;                // stable machine code, e.g. "UNKNOWN_NODE_TYPE"
  message: string;             // human readable
};
```

**Publish server action / endpoint response:**

```typescript
{
  ok: boolean;
  publishedVersion?: number;
  errors?: PublishError[];
}
```

---

## Appendix B: Node Type Specifications (Config + Semantics)

### B.1 Zod Config Schemas

#### state.set

```typescript
z.object({
  state: z.string().min(1)
})
```

#### event.wait

```typescript
z.object({
  eventName: z.string().min(1),
  correlationKey: exprSchema,
  timeoutMs: z.number().int().positive().optional(),
  assign: z.record(z.string(), exprSchema).optional()
})
```

#### transform.assign

```typescript
z.object({
  assign: z.record(z.string(), exprSchema)  // keys are JSON pointers or dot-paths
})
```

#### action.call

```typescript
z.object({
  actionId: z.string().min(1),
  version: z.number().int().positive(),
  args: z.record(z.any()),                  // values may contain Expr objects; engine resolves recursively
  saveAs: z.string().optional(),
  onError: z.object({
    policy: z.enum(["fail", "continue"])
  }).optional(),
  idempotencyKey: exprSchema.optional()
})
```

---

## Appendix C: Action Definition Template (Required Fields)

```typescript
type ActionDef<I, O> = {
  id: string;
  version: number;
  
  inputSchema: ZodSchema<I>;
  outputSchema: ZodSchema<O>;
  
  sideEffectful: boolean;
  retryHint?: RetryPolicy;
  
  // If sideEffectful, must define one of:
  // - engineProvided: engine computes idempotency key and passes to action ctx
  // - actionProvided: action provides deterministic key function
  idempotency:
    | { mode: "engineProvided" }
    | { mode: "actionProvided"; key: (input: I, ctx: ActionContext) => string };
  
  ui: {
    label: string;
    category?: string;
    description?: string;
    icon?: string;
  };
  
  handler: (input: I, ctx: ActionContext) => Promise<O>;
};
```

### C.1 Email Workflow Idempotency Keys (Recommended)

| Action | Idempotency Key |
|--------|-----------------|
| `create_ticket_from_email` | `tenantId + email.messageId` |
| `create_comment_from_email` | `tenantId + ticketId + email.messageId` |
| `process_email_attachment` | `tenantId + ticketId + attachmentId` |

---

## 19. Mapping Editor UX Enhancements

This section specifies enhancements to the InputMappingEditor to provide a polished, user-friendly, and visually appealing mapping experience.

### 19.1 Type Compatibility System

**Purpose:** Provide visual feedback about type compatibility between source and target fields.

#### 19.1.1 Compatibility Matrix

| Source Type | Target Type | Compatibility | Color |
|-------------|-------------|---------------|-------|
| string | string | EXACT | Green (#22c55e) |
| number | number | EXACT | Green (#22c55e) |
| boolean | boolean | EXACT | Green (#22c55e) |
| string | number | COERCIBLE | Yellow (#eab308) |
| number | string | COERCIBLE | Yellow (#eab308) |
| boolean | string | COERCIBLE | Yellow (#eab308) |
| object | string | INCOMPATIBLE | Red (#ef4444) |
| array | string | INCOMPATIBLE | Red (#ef4444) |
| unknown | any | UNKNOWN | Gray (#9ca3af) |

#### 19.1.2 Type Utilities Module

```typescript
// ee/server/src/components/workflow-designer/mapping/typeCompatibility.ts

enum TypeCompatibility {
  EXACT = 'exact',
  COERCIBLE = 'coercible',
  INCOMPATIBLE = 'incompatible',
  UNKNOWN = 'unknown'
}

function getTypeCompatibility(
  sourceType: string | undefined,
  targetType: string | undefined
): TypeCompatibility;

function getCompatibilityColor(compatibility: TypeCompatibility): string;

function getCompatibilityLabel(compatibility: TypeCompatibility): string;

function inferTypeFromJsonSchema(schema: JsonSchema): string | undefined;
```

#### 19.1.3 Visual Indicators

- **Source fields:** Type badge showing field type with color coding based on selected target
- **Target fields:** Compatibility indicator when mapping is configured
- **Connection lines:** Color-coded based on type compatibility

### 19.2 Drag-and-Drop Source to Target

**Purpose:** Enable intuitive mapping by dragging fields from the source tree to target fields.

#### 19.2.1 Draggable Source Fields

```typescript
// ee/server/src/components/workflow-designer/mapping/useMappingDnd.ts

interface MappingDndState {
  isDragging: boolean;
  draggedItem: { path: string; type?: string } | null;
  dropTarget: string | null;
}

interface MappingDndHandlers {
  handleDragStart: (path: string, type?: string) => void;
  handleDragOver: (targetField: string) => void;
  handleDrop: (targetField: string) => void;
  handleDragEnd: () => void;
}
```

#### 19.2.2 Drop Zones

- Unmapped target fields serve as drop zones
- Drop zone border color indicates type compatibility
- Visual feedback icons: + (compatible), ⚠ (coercible), ⊘ (incompatible)
- On successful drop, create `{ $expr: path }` mapping

#### 19.2.3 Visual Feedback During Drag

- Highlight all compatible target fields when drag starts
- Dim incompatible target fields
- Show connection preview line from source to cursor
- Animate drop zone expansion on hover

### 19.3 Visual Connection Lines (SVG Overlay)

**Purpose:** Draw bezier curves between mapped source and target fields for visual clarity.

#### 19.3.1 SVG Overlay Architecture

```typescript
// ee/server/src/components/workflow-designer/mapping/MappingConnectionsOverlay.tsx

interface MappingConnection {
  sourceField: string;
  targetField: string;
  sourceType?: string;
  targetType?: string;
  compatibility: TypeCompatibility;
}

// Positioned absolutely over the mapping editor container
// pointer-events: none to allow interaction with elements below
// z-index between source tree and target fields
```

#### 19.3.2 Position Tracking

```typescript
// ee/server/src/components/workflow-designer/mapping/useMappingPositions.ts

interface PositionTracker {
  sourceRefs: Map<string, RefObject<HTMLElement>>;
  targetRefs: Map<string, RefObject<HTMLElement>>;
  getFieldRect: (fieldId: string) => DOMRect | null;
}

// Handle scroll offset, window resize, container scroll
// Debounce position updates for performance
// Use ResizeObserver for element size changes
```

#### 19.3.3 Bezier Path Calculation

```typescript
function calculateBezierPath(
  sourceRect: DOMRect,
  targetRect: DOMRect
): string {
  // Calculate control points for smooth curves
  // Handle left-to-right direction
  // Adjust tension based on horizontal distance
  // Avoid overlap when connections are close
}
```

#### 19.3.4 Connection Interaction

- Hover: increase stroke width (2px → 3px), show tooltip
- Click: select connection, show delete button
- Click-to-delete with optional confirmation
- Animate connection removal with fade-out

### 19.4 Filter Dropdown by Type Compatibility

**Purpose:** Help users find compatible source fields quickly.

#### 19.4.1 Grouped Options

| Group | Order | Style |
|-------|-------|-------|
| Exact matches | 1st | Normal with ✓ icon |
| Coercible matches | 2nd | Normal with ⚠ icon |
| Incompatible | Last | Grayed out with ✗ icon |

#### 19.4.2 Search Behavior

- Prioritize compatible options in search results
- Sort by compatibility first, then by relevance
- Maintain grouping while filtering

### 19.5 Keyboard Navigation

**Purpose:** Provide full keyboard accessibility for the mapping editor.

#### 19.5.1 Navigation Keys

| Key | Action |
|-----|--------|
| Arrow Up/Down | Navigate between target fields |
| Arrow Left | Collapse tree node / move to parent |
| Arrow Right | Expand tree node / move to first child |
| Home | Focus first field |
| End | Focus last field |

#### 19.5.2 Panel Navigation

| Key | Action |
|-----|--------|
| Tab | Move focus between source and target panels |
| Shift+Tab | Reverse panel navigation |

#### 19.5.3 Action Keys

| Key | Action |
|-----|--------|
| Enter | Open field picker / confirm selection |
| Space | Toggle tree node expansion |
| Delete/Backspace | Remove mapping from focused field |
| Escape | Cancel operation / close dropdown |
| Ctrl+A | Select all mappings |

#### 19.5.4 Focus Indicators

- Visible focus ring meeting WCAG 2.1 contrast
- Auto-scroll focused element into view
- ARIA live regions for screen reader announcements

### 19.6 Loading and Error States

**Purpose:** Provide appropriate feedback when fetching action schemas.

#### 19.6.1 Loading Skeleton

```typescript
// ee/server/src/components/workflow-designer/mapping/MappingEditorSkeleton.tsx

// Skeleton layout matching actual editor structure:
// - Source tree panel skeleton
// - Target fields panel skeleton
// - Toolbar skeleton
// - Shimmer animation
```

#### 19.6.2 Error State

- Display error message explaining what went wrong
- Show retry button with exponential backoff
- Display retry count/limit
- Provide contact support link for persistent errors

#### 19.6.3 Client-Side Schema Caching

- Cache by `actionId:version` key
- TTL of 5 minutes
- Invalidate on action version change
- Cache-first fetching strategy
- Manual refresh option in UI

### 19.7 Accessibility Requirements

- All interactive elements have accessibility labels
- ARIA live regions for dynamic updates
- Colors meet WCAG contrast requirements
- Text alternatives for color-coded information
- Screen reader tested

### 19.8 Testing Requirements

| Test Type | Coverage |
|-----------|----------|
| Unit | typeCompatibility.ts, useMappingDnd.ts, useMappingPositions.ts, useMappingKeyboard.ts, calculateBezierPath |
| Integration | Drag-and-drop flow, keyboard navigation |
| Playwright | Visual connections, type indicators, loading/error states |

### 19.9 New File Structure

```
ee/server/src/components/workflow-designer/mapping/
├── typeCompatibility.ts          # Type checking utilities
├── useMappingDnd.ts              # Drag-drop state management
├── useMappingPositions.ts        # Position calculation for connections
├── useMappingKeyboard.ts         # Keyboard navigation hook
├── MappingConnectionsOverlay.tsx # SVG bezier curves
├── MappingEditorSkeleton.tsx     # Loading state component
└── index.ts                      # Updated exports
```

### 19.10 Implementation Priority

| Priority | Component | Description |
|----------|-----------|-------------|
| P0 | Type Compatibility | Core type checking utilities and color scheme |
| P0 | Visual Connections | SVG overlay with bezier paths |
| P0 | Drag-and-Drop | HTML5 drag API integration |
| P1 | Filter by Type | Dropdown grouping and compatibility icons |
| P1 | Keyboard Navigation | Arrow keys, Tab, Enter, Delete, Escape |
| P2 | Loading States | Skeleton and error components |
| P2 | Schema Caching | Client-side cache with TTL |
| P3 | Accessibility | ARIA labels, live regions, screen reader testing |
