# Workflow v2 Gaps Remediation Plan

**Date:** 2026-07-16
**Sources:** Production tickets alga0002101–alga0002108 (filed 2026-07-13) and alga0001876 (2026-04-26), all open, all Nine Minds LLC tenant. Every claim was re-verified against the current codebase on 2026-07-16; file:line references below reflect current `main`-lineage code, not the (already stale) references in the tickets.

All eight issues were discovered while building the "stale ticket chaser" workflow in the demo tenant. Together they describe one systemic problem: **the workflow v2 authoring loop (discover → compose → validate → simulate → publish) passes green for workflows that cannot run, and the runtime fails silently instead of loudly.**

Excluded: alga0002094 "Test workflows" (empty ticket, nothing actionable).

---

## Workstream 1 — Event contract integrity (alga0002101, High)

**Problem.** Every emitter of `TICKET_RESPONSE_STATE_CHANGED` publishes `{ tenantId, ticketId, userId, previousState, newState, trigger }`, while the registered schema `payload.TicketResponseStateChanged.v1` requires `occurredAt` and names the state fields `previousResponseState`/`newResponseState`. The worker safe-parses the payload before launching a run and, on failure, increments a debug-only skip counter and continues — event-triggered workflows silently never run.

**Verified reality (differs slightly from ticket).** The schema is *not* strict — unknown keys are stripped, not rejected. The hard failure is the missing required `occurredAt`; the field-name drift then means even a "fixed" emitter payload would carry no state values.

**Known drift beyond this one event** (sampled; assume more exists):
- `TICKET_COMMENT_ADDED`: product emitters use bare `publishEvent`, nested `comment.id`, no `occurredAt` — `packages/tickets/src/actions/comment-actions/commentActions.ts:313`, `packages/tickets/src/actions/optimizedTicketActions.ts:3283`; schema expects flat `commentId` + `occurredAt` (`shared/workflow/runtime/schemas/ticketEventSchemas.ts:300`).
- Client-portal non-closing `TICKET_UPDATED`: bare `publishEvent`, no `occurredAt` — `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:903`.
- `INVOICE_FINALIZED`: uses `timestamp` instead of `occurredAt` — `server/src/lib/api/services/InvoiceService.ts:979`.
- `TICKET_CREATED` / most `TICKET_UPDATED` / `TICKET_CLOSED` are OK because they go through `publishWorkflowEvent`, which injects `tenantId`/`occurredAt` (`packages/event-bus/src/workflow/workflowEventPublishHelpers.ts:20`).

### Tasks

1.1 **Align the `TICKET_RESPONSE_STATE_CHANGED` emitters with the v1 schema.** Move the four emitters to `publishWorkflowEvent` (or add `occurredAt` + `previousResponseState`/`newResponseState` explicitly; keep the legacy field names alongside for one release so the SLA subscriber's tolerance shim at `server/src/lib/eventBus/subscribers/slaSubscriber.ts:406` and any other consumers keep working).
    - Emitters: `packages/tickets/src/actions/comment-actions/commentActions.ts:145`, `packages/tickets/src/actions/optimizedTicketActions.ts:377` and `:2968`, `packages/tickets/src/actions/ticketActions.ts:288`.
    - Keep both schema copies in sync: `shared/workflow/runtime/schemas/ticketEventSchemas.ts:84` AND `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts` (duplicate definitions — fixing only one reintroduces drift).

1.2 **Fix the other known drifting emitters** (`TICKET_COMMENT_ADDED` ×2, client-portal `TICKET_UPDATED`, `INVOICE_FINALIZED`) the same way.

1.3 **CI contract test: every product emission validates against its registered payload schema.** Host it next to the existing schema convention tests (`ee/packages/workflows/src/runtime/__tests__/payloadSchemaConventions.test.ts`, `payloadSchemaExamples.test.ts` — today these validate examples, not real emitter shapes). Approach: for each event type, build the emitter payload via a fixture/factory that mirrors the real call sites, `safeParse` against the registered `payloadSchemaRef`, fail on mismatch. This is the regression net for the whole class of bug.

1.4 **Make `payloadValidationFailed` loud.** In `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts:365` (safeParse skip) and `:414` (debug-only stats): log at `warn`/`error` with event type + workflow key + Zod issues, and emit a metric/counter usable for alerting. Note the worker now writes a `workflow_runtime_events` row before validation (`:192`) — record the validation failure on that row (`match/error` tracking columns exist via migration `20251221190000_add_workflow_runtime_event_tracking.cjs`) so "my workflow never ran" is diagnosable from Run Studio, not just logs.

**Risks:** switching emitters to `publishWorkflowEvent` changes after-commit timing/metadata for the notification stream; keep legacy field names during transition. Coordinate with WS2 (same publish helper is where `correlationKey` will land).

**Acceptance:** a workflow triggered on `TICKET_RESPONSE_STATE_CHANGED` with default `payloadSchemaRef` launches when a response state actually changes; contract test red if any emitter drifts; a validation-failed skip is visible on the event row and in logs/metrics.

---

## Workstream 2 — `event.wait` correlation (alga0002102, High)

**Problem.** Incoming product events never carry a correlation key: `resolveWorkflowEventCorrelation()` (`ee/packages/workflows/src/lib/workflowEventCorrelation.ts:13`) reads only `event.workflow_correlation_key` (populated solely from `hooks?.correlationKey` in `packages/event-schemas/src/schemas/eventBusSchema.ts:1528` — no product emitter passes hooks; `publishWorkflowEvent` maps `ctx.correlationId` to `executionId`, not `correlationKey` — `packages/event-bus/src/publishers/index.ts:105`) or env `WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON` (set nowhere in helm/compose/env templates). The worker skips wait routing on unresolved keys with only a `logger.warn` (`WorkflowRuntimeV2EventStreamWorker.ts:269`); triggering still works (`:281`), so the asymmetry is invisible until a wait times out. Every `event.wait` runs to `timeoutMs` and then **throws** `TimeoutError` (`shared/workflow/runtime/nodes/registerDefaultNodes.ts:121`).

**Why this is the most dangerous ticket:** the natural "wait for client reply, else nudge and close" workflow closes every ticket, including ones where the client replied — and it passes simulation (simulate resumes waits from fixtures).

### Tasks

2.1 **Ship default correlation derivation paths.** Two layers:
    - Code-level default in `resolveWorkflowEventCorrelation()` so behavior doesn't depend on deploy config: fall back to a built-in path map when the env var is unset.
    - Deployment defaults for explicitness: `docker-compose.ee.yaml:200` area, `compose.env`, `ee/helm/workflow-worker/values.yaml:143`, `ee/helm/workflow-worker/templates/deployment.yaml:92`.
    - Starting config (from investigation):
      ```json
      { "*": ["ticketId", "clientId", "invoiceId", "projectId", "paymentId"],
        "TICKET_CREATED": ["ticketId"], "TICKET_UPDATED": ["ticketId"],
        "TICKET_CLOSED": ["ticketId"], "TICKET_COMMENT_ADDED": ["ticketId"],
        "INVOICE_SENT": ["invoiceId", "clientId"], "INVOICE_STATUS_CHANGED": ["invoiceId", "clientId"] }
      ```
    - `listEventWaitCandidates` matches exact `event_name` + exact `key` (`shared/workflow/persistence/workflowRunWaitModelV2.ts:81`), so the wait-side key expression must produce the same value the derivation paths produce — document the pairing in the authoring guide (WS7).

2.2 **Publish-time validation: reject un-resumable waits.** `publishWorkflowDefinitionAction()` → `computeValidation()` (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts:2153` → `:598`) → `validateWorkflowDefinition()`. Current `event.wait` validation only checks assignment paths (`shared/workflow/runtime/validation/publishValidation.ts:309`). Add: if a definition contains `event.wait` on an event whose correlation key cannot be derived (no explicit hook usage, no derivation path for that event type), fail validation at publish time with an actionable message — not a timeout N days later in production.

2.3 **Observability.** Promote the "correlation key unresolved; skipping wait routing" warn to a metric/alert; include event type and how many waits were candidates.

2.4 *(Optional, coordinate with WS7)* **Timeout ergonomics.** Consider `event.wait` resolving with `{ timedOut: true }` instead of throwing `TimeoutError`, or an opt-in `onTimeout: 'resume'` config. This is a behavior change for existing definitions that rely on `control.tryCatch`; if deferred, document the try/catch idiom prominently (ticket alga0002107 item 2).

**Risks:** correlation resolver is EE (`ee/packages/workflows`) but consumed by the worker service — respect the CE/EE boundary. Adding defaults can route previously-unmatched events to waits in existing tenants: audit `workflow_run_waits` rows in prod before enabling, and consider gating the default map behind a config flag for one release.

**Acceptance:** an `event.wait` keyed on `ticketId` resumes when the matching product event arrives (integration test through the worker); publishing a definition with an uncorrelatable `event.wait` fails validation; unresolved-correlation skips are alertable.

---

## Workstream 3 — `tickets.close` writes a dropped column (alga0002108, High)

**Problem.** `tickets.close` requires `resolution.code` (`shared/workflow/runtime/actions/businessOperations/tickets.ts:1167`) and unconditionally writes `resolution_code` in its UPDATE (`:1248`), a column dropped by migration `20260219000004_add_sla_tracking_to_tickets.cjs:56`. 100% failure, and it fails **after** side effects (comments/emails) are committed — customer sees "we're closing this", ticket stays open.

**Decision (evidence-based):** store resolution in `tickets.attributes` JSONB, do **not** re-add the column. Rationale: the migration deliberately removed it as "never used"; product close semantics already use resolution comments (`comments.is_resolution` / `metadata.closes_ticket` — `packages/tickets/src/lib/validateTicketClosure.ts:97`, `packages/tickets/src/actions/optimizedTicketActions.ts:3171`); reporting computes resolution time from `closed_at - entered_at`, not a code (`packages/reporting/src/actions/helpdeskReportActions.ts:384`); workflow create/update actions already merge custom fields into `attributes` (`tickets.ts:534`, `:881`).

### Tasks

3.1 **Fix the UPDATE.** Remove `resolution_code` from the ticket UPDATE; persist `attributes.resolution_code` / `attributes.resolution_text` (merge, don't clobber existing attributes). Keep the action's input contract and output fields (`:1182`, `:1334`) intact so existing definitions don't break. Also post/flag the resolution comment consistently with product close semantics (`is_resolution` marker) so closure validation rules treat workflow closes like UI closes.

3.2 **Check the other five dropped columns.** Verified: only `resolution_code` has an active writer; `root_cause`/`workaround`/`related_problem_id`/`sla_target`/`sla_breach` appear only in migrations. No action needed beyond the contract test in 1.3 catching future cases.

3.3 **DB-backed test.** The existing unit test uses an in-memory fake query builder that accepts arbitrary columns (`shared/workflow/runtime/actions/__tests__/ticketWorkflowBoardStatusRuntime.test.ts:111`) — it structurally cannot catch this bug class. Add a migrated-schema integration test that executes `tickets.close` end-to-end (there is existing DB-backed test infra under `server/src/test/`; if none fits the shared workflow actions, a minimal harness that runs migrations into a test DB is in scope here).

3.4 **Ordering hardening (cheap win).** Within `tickets.close`, perform the ticket UPDATE before emitting customer-visible side effects where feasible, so a failing terminal step doesn't leave the "closing this" message on an open ticket.

**Acceptance:** `tickets.close` closes a ticket against a fully-migrated schema in a test; resolution is readable from `tickets.attributes`; no remaining repo references write dropped ticket columns.

---

## Workstream 4 — Action data surface (alga0002103 + alga0002104, High)

### 4A. Expose `response_state` (alga0002103)

`response_state` is a real enum column (`awaiting_client` / `awaiting_internal` / null, migration `server/migrations/20260104120000_add_response_state_to_tickets.cjs`) and is board-agnostic — exactly what automations should key on. But `ticketSummarySchema` (`shared/workflow/runtime/actions/businessOperations/tickets.ts:1540-1557`) omits it, the result rebuild (`:1632-1649`) doesn't copy it, and none of the 205 registered actions expose it. Workflows can *trigger* on it and even *change* it indirectly (comment creation updates it — `shared/models/ticketModel.ts:1277-1292`) but never read it.

Tasks:
- 4A.1 Add `response_state` to `ticketSummarySchema` + the row→result mapping in `tickets.find`. Type it as the enum + null (`packages/types/src/interfaces/ticket.interfaces.ts:15`).
- 4A.2 Add a `response_state` filter to the ticket search/find action inputs (`tickets.ts:1584-1597` accepts only id/number/external_ref today) so "all tickets awaiting client" is expressible. Preserve tenant scoping via `tenantDb`.
- 4A.3 Sync `shared/models/ticketModel.ts` `ticketSchema` (`:55-88`, currently omits the field; the packages copy `packages/tickets/src/schemas/ticket.schema.ts:67` already has it) — same duplicate-schema hazard as WS1.
- 4A.4 Regenerate/refresh the action registry docs consumed by the designer/chat registry (`ee/server/src/chat/registry/apiRegistry.generated.ts`).

### 4B. Comments: order, truncation signal, since-filter (alga0002104)

`include.comments` orders `created_at asc` with `limit` (default 50, cap 200) — `tickets.ts:1653-1657` — returning the *oldest* N with no truncation indicator (output is a bare `z.array(ticketCommentSchema)`, `:1598-1601`). Workflows silently reason over stale data on exactly the busiest tickets.

Tasks (backward-compatible — keep `comments` as an array, add a sibling meta object rather than an envelope):
- 4B.1 Add `include.comments_order: 'asc' | 'desc'` — **default `desc`** (newest first). Note: default flip is technically a behavior change for existing definitions; it is the correct default per the ticket, and simulate warnings + release notes cover it. If we find real definitions relying on asc order, make it explicit-only.
- 4B.2 Add `comments_meta: { total_count, truncated, returned_count }` alongside the array (precedent: time actions already return `total_count` — `shared/workflow/runtime/actions/businessOperations/time.ts:933`, `:1200`).
- 4B.3 Add `include.comments_created_after` (ISO timestamp) so "anything new since T?" doesn't require paging.
- 4B.4 Same treatment for `include.attachments` — identical silent truncation via `rows.slice(0, limit ?? 50)` at `tickets.ts:1671-1686`.

**Acceptance:** a workflow can read `response_state`, select tickets by it, ask for newest-N comments, detect truncation, and filter comments since a timestamp; existing definitions keep parsing (array shape unchanged).

---

## Workstream 5 — Expression validator: AST instead of regex (alga0002105, Medium)

**Problem.** `extractFunctionCalls()` uses `/([A-Za-z_$][A-Za-z0-9_]*)\s*\(/g` (`shared/workflow/runtime/expressionEngine.ts:100-107`), so JSONata keywords `and (`, `or (`, `in (` are read as function calls and rejected by the allowlist — `a = 1 and (b or c)` fails with "Expression uses disallowed function: and" while the reordered equivalent passes. The error message actively misleads.

**Fix.** `jsonata(normalizedSource).ast()` is already called in `validateExpressionSource` (`expressionEngine.ts:42-44`). Walk that AST and collect real function nodes instead of regex-scraping:
- JSONata 2.2.1 (installed; `package-lock.json:31880`): function calls are `type: 'function'` nodes with `procedure` (`{type:'variable', value:'count'}` for `$count(...)`); `and`/`or`/`in` parse as `type: 'binary'` and never appear as functions.
- Keep rejecting unauthorized bare/custom functions; decide explicitly whether `$`-prefixed JSONata built-ins beyond the 5 allowlisted helpers stay rejected (current allowlist: `nowIso, coalesce, len, toString, append` — `shared/workflow/runtime/expressionFunctions.ts:15-73`). Recommendation: keep the allowlist as-is in this workstream (behavior-preserving fix), revisit expanding it (e.g. `$count`, `$toMillis`) as a follow-up with WS7's doc work — `$count` would eliminate the singleton-collapse footgun entirely.

Tasks:
- 5.1 Replace regex extraction with an AST walk in `expressionEngine.ts`; delete or quarantine `extractFunctionCalls`.
- 5.2 Tests: `shared/workflow/runtime/__tests__/expressionEngine.test.ts` currently only covers allowlisted helpers + `$sum` rejection (`:9-16`). Add cases: `and (`/`or (`/`in (` accepted; nested parenthesised booleans; bare `not(...)` (parses function-like; correct JSONata is `$not(...)` — guide already says so at `authoringGuide.ts:172`); disallowed `$count` still rejected (until allowlist revisited); `didYouMean` suggestions still fire (`shared/workflow/runtime/validation/__tests__/didYouMean.test.ts`).
- 5.3 Align authoring-guide wording if the allowlist semantics are clarified (overlaps WS7).

**Acceptance:** the ticket's exact repro (`vars.x = 0 and (vars.y = 1 or vars.z = 2)`) validates; equivalent reorderings agree; no previously-rejected genuinely-disallowed function becomes allowed.

---

## Workstream 6 — Simulate against real events (alga0002106, Medium)

**Problem.** `POST /api/workflow-definitions/simulate` synthesizes a schema-shaped payload when none is supplied (route `server/src/app/api/workflow-definitions/simulate/route.ts` → `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts:1675-1729`; synthesis at `:1708-1725` via `shared/workflow/runtime/simulation/samplePayload.ts`). Since real emissions don't match registered schemas (WS1), simulate is structurally incapable of catching "this workflow can never trigger" — the single most damaging workflow bug. The response already returns `simulatedPayload`/`payloadSource`/`triggerMappingApplied` (`:1742-1747`) but no warning.

Real events are available for replay: `workflow_runtime_events` (created `server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs:121`), written by the worker (`WorkflowRuntimeV2EventStreamWorker.ts:192-200`) and by manual submits (`workflow-runtime-v2-actions.ts:3542-3551`), with `getById`/list helpers in `shared/workflow/persistence/workflowRuntimeEventModelV2.ts:55-105`.

Tasks:
- 6.1 **Replay a real event.** Extend simulate input schema (`ee/packages/workflows/src/actions/workflow-runtime-v2-schemas.ts:36-50`) with `eventId` and `useLatestEvent: true` (latest event of the trigger's type for the tenant). Resolve via `workflowRuntimeEventModelV2`; run the definition's `payloadSchemaRef` + `payloadMapping` against the *actual stored payload*. Include the chosen event's id + timestamp in the response (determinism/traceability). Enforce tenant isolation; check payload redaction before echoing payloads back.
- 6.2 **Warn on synthesized payloads.** When synthesis is used, append to the existing `warnings` array (`shared/workflow/runtime/simulation/simulator.ts:68-76`): "payload synthesized from schema; no real event of this type has been validated against this definition."
- 6.3 **Publish-time trigger-compatibility check (stretch, pairs with 2.2).** At validate/publish, run the last N real events of the trigger type through `payloadSchemaRef` + `payloadMapping` and report the match rate; a definition matching 0 of the last 100 real events requires an explicit override to publish. Ship after 6.1 lands the replay plumbing.
- 6.4 CE/EE: the action logic is EE-owned; verify CE route stubs/import boundaries (ce-ee-stub pattern) still build.

**Acceptance:** simulating with `useLatestEvent` on the stale-ticket-chaser definition (pre-WS1-fix) fails visibly — reproducing the exact false-green the ticket describes; synthesized-payload simulations carry a warning.

---

## Workstream 7 — Authoring guide + structured errors (alga0002107 + alga0001876, Medium)

### 7A. Authoring guide (alga0002107)

The guide is generated at request time from `shared/workflow/runtime/designer/authoringGuide.ts` (route `server/src/app/api/workflow/registry/authoring-guide/route.ts`); `commonPitfalls` at `:297-305`; misleading allowlist wording ("plus JSONata built-ins that they wrap") at `:170-175`.

Tasks:
- 7A.1 Add three `commonPitfalls` entries with correct idioms:
  1. **JSONata singleton collapse**: `len(x[filter])` returns 0 when exactly one item matches (sequence collapses to scalar); idiom: force an array — `len([x[filter]])`.
  2. **`event.wait` timeout throws** `{category:'TimeoutError'}` — it does not fall through; idiom: wrap in `control.tryCatch` and treat catch as the timeout path. (If 2.4 changes semantics, update accordingly.)
  3. **The function allowlist is exactly 5**: `nowIso, coalesce, len, toString, append`; `$count`/`$filter`/`$map`/`$toMillis`/`$sum`/`$substring` all fail validation; ISO-8601 timestamps compare as strings.
- 7A.2 Replace the "plus JSONata built-ins" phrasing with the explicit, exhaustive list (keep in lockstep with WS5's outcome).
- 7A.3 Document the `event.wait` correlation-key pairing rules from 2.1.
- 7A.4 Update guide tests; refresh generated registry docs.

### 7B. Structured action errors (alga0001876)

Approach A from the ticket, confirmed feasible: `workflow_action_invocations` has `error_message` only (`server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs:88-107`); Temporal activities already **build a normalized structured error payload and discard it** (`ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts:898-904` stores `error_message`; `:918-947` builds the structured payload).

Tasks:
- 7B.1 Migration: add `error_json` JSONB to `workflow_action_invocations`. Citus: tenant-distributed table — follow existing EE distribution migration patterns; include `tenant` in any new index.
- 7B.2 Persist the already-built normalized payload: `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts` + `shared/workflow/persistence/workflowActionInvocationModelV2.ts:4-23`. Keep `error_message` for compatibility. Redact sensitive details/stack before storing (mirror whatever redaction exists for run payloads).
- 7B.3 Surface in UI: `listWorkflowRunStepsAction` (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts:3008-3046`) → Run Studio (`ee/server/src/components/workflow-run-studio/RunStudioShell.tsx`, `WorkflowRunDetailsPanel.tsx:1494-1517`, `workflowRunDisplayError.ts:21-25`): render an error-code badge (e.g. `CONFLICT`) above the message. i18n keys per project convention (no hardcoded text); kebab-case `id`s on new interactive elements.

**Acceptance:** guide renders the three pitfalls and the exact allowlist; a failed action invocation shows a structured error code in Run Studio while `error_message` continues to populate.

---

## Workstream 8 — Client-location phone lookup action (feature request, no ticket yet)

**Problem.** The action library supports contact-level phone lookup only: `contacts.find` accepts a `phone` input and matches on normalized digits (`shared/workflow/runtime/actions/businessOperations/contacts.ts:687`, match at `:721-732` via `regexp_replace(coalesce(phone,''), '\D', '', 'g') = <digits>`). There is no equivalent for client locations, even though `client_locations` stores a `phone` column (schema from `server/migrations/20250522200645_refactor_company_locations_for_tenant_support.cjs:54`, renamed to `client_locations` in `20251003000001_company_to_client_migration.cjs:219`, with `is_default`, `is_active`, `client_id`, `tenant`).

**Use case.** Inbound tickets from voicemail/call systems identify the caller only by a phone number in subject/body. Contacts often lack phone numbers on file, but the client's primary location almost always has one — so "which client called?" is currently unresolvable from workflows.

### Tasks

8.1 **Add a `phone` input to `clients.find`** (preferred over a new `locations.find_by_phone` action — it returns the client, which is what the automation needs, and keeps the action count down). Current inputs are `client_id`/`name`/`external_ref` (`shared/workflow/runtime/actions/businessOperations/clients.ts:949-961`); add `phone` to the input schema, the `.refine` requiring at least one selector, and the `matchedBy` union.
    - Match logic: join/subquery `client_locations` on `(tenant, client_id)` filtered `is_active = true`, reusing the exact normalized-digits SQL from `contacts.find`. Prefer `is_default = true` location on multi-match; return deterministic first match otherwise.
    - Output: extend `clients.find` output with an optional `matched_location` (location summary: id, name, phone) alongside the existing `client`/`primary_contact`, so the workflow can see *which* location matched. Additive, backward-compatible.

8.2 **Last-N-digits match mode.** Optional `phone_match: 'exact' | 'last7' | 'last10'` (default `exact`) to tolerate area-code/data-entry drift: compare `right(<normalized>, N)`. Guard against short inputs (require at least N digits) and document that looser modes can multi-match — in which case prefer default locations, and surface a `matched_count` so authors can branch on ambiguity instead of silently taking the first hit.

8.3 **Parity check for `contacts.find`.** While touching the pattern, consider offering the same `phone_match` mode there — same voicemail use case, same drift problem. Cheap if 8.2's normalization helper is shared (put it in `businessOperations/shared.ts`).

8.4 **Tests + registry refresh.** Action tests covering exact/lastN match, multi-location clients, inactive-location exclusion, tenant scoping; regenerate designer/chat registry docs (same step as 4A.4).

**Risks:** phone-digit matching across tenants must stay inside `tenantScopedTable`/`tenant` joins (Citus). A raw `regexp_replace` comparison can't use an index — fine for single-lookup workflow calls, but note it; if it ever needs to be hot, a generated normalized-digits column is the upgrade path.

**Acceptance:** a workflow given only a phone string resolves the owning client via location phone with normalized-digit matching; `last7` mode tolerates area-code mismatch; ambiguous matches are detectable by the author.

**Note:** unlike WS1–WS7 this has no production ticket — file one for tracking before starting work.

---

## Sequencing & packaging

Recommended order (dependencies → PR-sized chunks):

| # | PR | Workstream | Why this order |
|---|----|-----------|----------------|
| 1 | tickets.close fix + DB-backed test | WS3 | Total, destructive-ordering failure; zero deps; smallest surface |
| 2 | Validator AST fix | WS5 | Self-contained; unblocks authors immediately |
| 3 | Emitter alignment + contract test + loud skips | WS1 | Foundation: makes triggers real; contract test protects everything after |
| 4 | response_state + comments meta/order/since | WS4 | Pure additive action surface; independent of 1–3 |
| 5 | Correlation defaults + publish-time wait validation | WS2 | Benefits from WS1's publish-helper touch; highest behavioral risk, wants the contract test in place |
| 6 | Simulate real-event replay + warnings | WS6 | Depends on WS1 (real events now validate) for its acceptance demo |
| 7 | Authoring guide + error_json | WS7 | Docs must reflect WS2/WS5 outcomes; error_json independent but lowest urgency |
| 8 | Client-location phone lookup | WS8 | Independent additive feature; can run in parallel with any of 4–7; file a tracking ticket first |

Verification gates per PR: existing suites (`npm run test:unit` in touched packages), the new contract test (PR 3 onward), and for WS2/WS6 an end-to-end check in a dev stack (trigger a real ticket event, watch the wait resume / simulate replay).

**Cross-cutting cautions**
- Duplicate schema definitions (`shared/workflow/runtime/schemas` vs `packages/event-schemas`) must be changed in pairs — twice-bitten in WS1 and WS4.
- EE/CE boundary: correlation resolver, simulate logic, Run Studio are EE; emitters, shared runtime, worker are CE/shared. Check `ce-ee-stub` build after WS2/WS6/WS7.
- Citus: every new query/index keeps `tenant` in WHERE/JOIN/PK.
- Prod behavior changes to stage first: WS2 defaults (may start routing events to existing waits), WS4B comment-order default flip.

## Implementation complexity routing (model-offload)

For execution, per the offload strategy: WS5 (mechanical AST swap + tests), 7A (doc content), 4B (additive schema fields), and WS8 (additive action input reusing an existing SQL pattern) are complexity ≤5 → cursor-agent/composer. WS1 emitters + contract test, WS3, WS6 replay are 5–7 → codex/GPT-5.5 with tight briefs. WS2 (correlation semantics, prod behavior risk) and 7B's Citus migration + Run Studio UI (UI never offloaded to codex/cursor) stay with Claude or an Opus subagent for the UI piece.
