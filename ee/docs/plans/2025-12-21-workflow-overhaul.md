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

*(Section reserved for terminology definitions)*

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
4. **At runtime:** Validate node configs (once, using published compiled config), validate action inputs/outputs on every `action.call`.
5. **Before persisting snapshots:** Apply redaction rules to payload and action invocation logs.

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
| Runs start | Start workflow run |
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
| `POST` | `/workflow-runs` | Start new run |
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
