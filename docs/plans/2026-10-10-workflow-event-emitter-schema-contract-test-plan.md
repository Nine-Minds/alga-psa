# Workflow event emitter ↔ schema contract test — implementation plan

**Card:** alga0002106 follow-up (CI contract test: workflow event emitters must validate against registered schemas)
**Branch:** `feature/alga0002106-ci-contract-test-workflow-event-emit`
**Date:** 2026-10-10
**Grounded in:** `main` at `b0d0b4dacf`. Every file:line reference below was checked against that commit.

---

## 1. Current state

### 1.1 How the worker decides whether an event payload is valid

1. A product emitter calls `publishEvent` or `publishWorkflowEvent`. Both live in `packages/event-bus/src/publishers/index.ts:78` and `:136`.
2. `EventBus.publish` (`packages/event-bus/src/eventBus.ts:793`) parses the event against the **event-bus transport schema** `EventSchemas[eventType]` (`:845`). That schema is not the workflow schema. Next, `convertToWorkflowEvent` (`packages/event-schemas/src/schemas/eventBusSchema.ts:1700`) fills in `occurredAt` from `event.timestamp` when the payload lacks it. The result is written to `workflow:events:global`.
3. The worker (`services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`) looks up the event's `payload_schema_ref`: first in the tenant `event_catalog`, then in `system_event_catalog` (`:566-579`). It then runs `schemaRegistry.get(ref).safeParse(payload)` (`:428`). On failure it logs a warning and skips the launch.
4. `schemaRegistry` is populated by `initializeWorkflowRuntimeV2()` (`shared/workflow/runtime/init.ts:27`) from **`shared/workflow/runtime/schemas/workflowEventPayloadSchemas.ts`**. That file holds 161 `payload.*.v1` refs.

**The contract is therefore:** the payload *after* `convertToWorkflowEvent` must satisfy `shared/workflow/runtime/schemas/*`, under the ref the DB catalog assigns to the event type.

### 1.2 What is already in place

- **WS1 emitter fixes have landed.** Commit `3f82dd96d3` fixed the emitters for `TICKET_RESPONSE_STATE_CHANGED`, `TICKET_COMMENT_ADDED`, client-portal `TICKET_UPDATED` and `INVOICE_FINALIZED`. The worker now logs validation failures at warn.
- **`ee/packages/workflows/src/runtime/__tests__/payloadSchemaEmitterContracts.test.ts`** exists, but it validates **hand-copied payload literals** annotated with `file:line`. It drifts as soon as an emitter changes, which is the failure mode this card has to remove. It also lives in an Nx project whose `test` target runs only under `nx affected`. That project has no Nx dependency edge to `packages/tickets` or `packages/client-portal`, so an emitter-only change does not run it.
- **Builder unit tests** exist and `safeParse` builder output against a specific schema:
  - `shared/workflow/streams/domainEventBuilders/__tests__/` (21 files)
  - `ee/packages/workflows/src/runtime/schemas/__tests__/` (6 files)
  - `server/src/test/unit/*WorkflowEvents.test.ts`

  None of them proves that a call site uses the builder. None proves that every catalogued event has an emitter covered. None uses the catalog's ref.

### 1.3 Gaps

| Gap | Evidence |
|---|---|
| The publish helpers are untyped | `publishWorkflowEvent` payload is `Record<string, unknown>`, cast `as any` (`publishers/index.ts:136-158`). `EventSchemas` is typed `Record<EventType, z.ZodType>`, so the per-event `z.infer` types collapse. |
| Many catalogued events are emitted with inline literals through raw `publishEvent` | About 172 literal `publishEvent` sites, against about 199 `publishWorkflowEvent` sites, plus 68 dynamic or wrapper sites. Examples: tickets (`commentActions.ts`, `optimizedTicketActions.ts`, `ticketActions.ts`), `SCHEDULE_ENTRY_*`, `TIME_ENTRY_*`, `INVOICE_FINALIZED`, `TAG_DEFINITION_DELETED`, `DOCUMENT_UPDATED`, `PROJECT_CREATED`/`PROJECT_ASSIGNED`/`PROJECT_CLOSED`. |
| Dynamic event types escape any type check | Wrappers pass `eventType as any`: `TicketModelEventPublisher.safePublishEvent`, `ServerEventPublisher`, `TicketService.safePublishEvent:3306`, `ticketLifecycleEvents.ts:370`, and others (18 product `eventType … as any` sites). |
| The event type → schema ref mapping exists only in the database | It is spread across about 10 migrations (`20251227200000_…`, `20251228192000_…`, `20260123150000_upsert_domain_workflow_event_catalog_v2.cjs:245-268` which derives the ref by convention, `20260104120001_…`, plus inventory, opportunity, project-billing and client-anniversary seeds). No code-level source exists for a test to read. |
| There are two diverging schema trees | `shared/workflow/runtime/schemas/*` (used by the worker) and `packages/event-schemas/src/schemas/domain/*`. Every file differs. For example, the ticket schemas differ by 165 diff lines: structured `externalLinks` against `record`, `uuid` against picker-annotated `user-or-team` assignee ids, and different suppression-flag shapes. The package copy is missing the appointment-request, schedule-entry and project-assigned/closed schemas. The event-bus **transport** schemas (`EventPayloadSchemas`, `eventBusSchema.ts:1221`) import the *package* copy for many types, so publish-time parsing and worker validation disagree today. |
| `buildWorkflowPayload` is duplicated | `packages/event-bus/src/workflow/workflowEventPublishHelpers.ts` and `packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts`; `server/src/lib/eventBus/publishers/index.ts` duplicates the publish helpers as well. |
| A legacy raw-stream publisher bypasses the event bus | `shared/events/publisher.ts:27` and `packages/core/src/lib/events/publisher.ts:33` write straight to Redis with no transport parse and no `occurredAt` default. The only product user is `ee/server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts`, for `RMM_*` events. Today those events have no `payload_schema_ref` (`20260612090100_…`), so they are not catalogued workflow triggers. The structural guard must still cover this path. |

Unrelated finding from the inventory, to be filed separately and kept out of this card: `server/src/lib/api/services/TeamService.ts:404-1089` calls `publishEvent({ eventType: 'PLACEHOLDER', payload: {} })` 13 times. `EventBus.publish` throws "Unknown event type" on each of these calls.

---

## 2. Design

The contract is enforced in layers. Each layer catches what the one before it cannot.

| Layer | Catches | Runs in |
|---|---|---|
| **A. Code-level catalog** | A ref the worker would use that has no registered schema, and drift between DB and code | Server unit lane (always); integration lane (DB parity) |
| **B. One canonical schema tree** | The worker and event bus disagreeing about the same event | n/a (structural) |
| **C. Typed emit helper** | Missing or renamed required fields, and wrong field types, at compile time for every emit site | `typecheck` |
| **D. Emitter contract registry and test** | Refinements types cannot express (uuid, datetime, min length, `.refine`) on the payload the **real builder** produces after `convertToWorkflowEvent`; and completeness: every catalogued event is covered or carries a ticketed exclusion | Server unit lane (always) |
| **E. Emit-site inventory guard** | Call sites that bypass C or D (`as any`, string-typed event types, raw stream publishers, inline payloads for catalogued events) | Always-run CI step |
| **F. Emit-time validation in test and dev** | Drift on paths that only integration tests or a developer's local run exercise | Any test or dev process that publishes for real |

### A. Code-level workflow event catalog (single source of truth)

- New module: `packages/event-schemas/src/workflowEventCatalog.ts`. It exports:
  - `WORKFLOW_EVENT_CATALOG`: an `as const` map from event type to `{ schemaRef }`, covering every event the DB catalog gives a `payload_schema_ref`.
  - `type WorkflowCatalogEventType = keyof typeof WORKFLOW_EVENT_CATALOG`.
  - `getWorkflowEventSchemaRef(eventType)`.

  The refs follow the migration convention (`payload.<PascalCase>.v1`). Any exception is written out explicitly rather than computed, so the map is greppable and reviewable.
- **Unit test** (`packages/event-schemas/src/workflowEventCatalog.test.ts`):
  - every `schemaRef` is a key of the canonical `workflowEventPayloadSchemas`;
  - every catalogued type is in `EVENT_TYPES`.
- **DB parity test** (integration lane, `server/src/test/infrastructure/workflowEventCatalogParity.test.ts`): after migrations, `system_event_catalog` rows with a non-null `payload_schema_ref` must equal `WORKFLOW_EVENT_CATALOG` exactly. A missing entry or a mismatch on either side fails the test.
  - Decision: the migrations remain the writer, because tenant databases are seeded by them. The code map is the reviewed contract, and parity ties the two together.
  - Follow-up, not in this card: future catalog seed migrations should import the map instead of restating refs.

### B. Collapse the duplicate schema trees into `packages/event-schemas`

Decision: **collapse; do not just assert equivalence.** The typed helper (C) lives in `@alga-psa/event-bus`. That package can depend on `@alga-psa/event-schemas` but not on `@alga-psa/shared`, so the canonical schemas must sit in `packages/event-schemas` for the helper to be typed against them. Asserting agreement between two trees keeps the duplication and only detects drift after it happens.

- **Canonical content is the worker's tree** (`shared/workflow/runtime/schemas/*`), because that is what workflows validate against and what the designer's picker metadata describes. Move those files to `packages/event-schemas/src/schemas/domain/`, replacing the current package copies.
- **Move the picker-annotation helpers down a layer.** Split `shared/workflow/runtime/jsonSchemaMetadata.ts`:
  - The zod-only annotation helpers move to `packages/event-schemas/src/schemas/workflowSchemaMetadata.ts`: `withWorkflowJsonSchemaMetadata`, `withWorkflowPicker`, `entityIdSchema`, the picker-kind types, and `WORKFLOW_PICKER_KIND_HINTS`.
  - The `zod-to-json-schema` conversion stays in shared and re-imports them.
  - Check that the annotation helpers carry no `zod-to-json-schema` runtime dependency. If one remains, add the dependency to `packages/event-schemas`; do not keep the helpers in shared.
- `shared/workflow/runtime/schemas/*Event*Schemas.ts` and `workflowEventPayloadSchemas.ts` become one-line re-exports from `@alga-psa/event-schemas`, so existing import paths keep working. `ee/packages/workflows/src/runtime/schemas/workflowEventPayloadSchemas.ts` already re-exports shared and needs no change. Update direct importers where it is cheap. Add `// LEVERAGE: friction schema-reexport-shim` on the shim files.
- **Reconciling semantic differences.** For every schema where the two copies differ, keep the worker's definition. The exception is a case where the package copy is *stricter in a way the emitters already satisfy*: there, adopt the stricter rule (for example, the structured `externalLinks` item shape) **only if** the contract test (D) shows every emitter passes it. Record each such case in the PR description. Never loosen a schema to make an emitter pass.
- **Effect on the transport schemas:** `EventPayloadSchemas` entries that import domain schemas will resolve to the canonical (worker) definitions. `EventBus.publish` uses `.parse`, so a stricter transport schema could throw at publish time and fail a user action. Sequencing therefore matters: the collapse lands **after** D is green, so every catalogued emitter is proven to satisfy the canonical schema before the transport parse tightens. Transport entries that use legacy loose schemas (for example `TICKET_COMMENT_ADDED: TicketEventPayloadSchema`) stay as they are in this card, with `// LEVERAGE: friction transport-vs-workflow-schema` added. A later card can decide whether transport validation of catalogued types should be the workflow schema plus the legacy notification fields.
- Delete the duplicate `packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts`. Keep the event-bus copy, re-exported from event-schemas if a type is needed there.
- Add a guard test (`packages/event-schemas/src/schemas/domain/singleSchemaTree.test.ts`) that fails if `shared/workflow/runtime/schemas/` contains a `z.object(` definition for a `payload.*.v1` schema, so a second tree cannot reappear.

### C. Typed emit helper (compile-time contract)

In `packages/event-bus/src/publishers/index.ts`:

```ts
type InjectedKeys = 'tenantId' | 'occurredAt' | 'actorType' | 'actorUserId' | 'actorContactId' | 'idempotencyKey';
export type WorkflowEventPayloadInput<T extends WorkflowCatalogEventType> =
  Omit<z.input<WorkflowEventSchemaFor<T>>, InjectedKeys> & { [extra: string]: unknown }; // extras: legacy notification fields (e.g. previousState)

export async function publishWorkflowEvent<T extends WorkflowCatalogEventType>(params: {
  eventType: T;
  payload: WorkflowEventPayloadInput<T>;
  ctx: WorkflowEventPublishContext;
  /* idempotencyKey, eventName, fromState, toState unchanged */
}, options?): Promise<void>;
```

- `WorkflowEventSchemaFor<T>` is derived from a typed `as const` schema map exported by event-schemas. The map must keep per-key types, unlike today's `Record<string, ZodTypeAny>`. Retype `workflowEventPayloadSchemas` as `satisfies Record<string, ZodTypeAny>` so the literal key types survive.
- Extra keys are allowed so that legacy fields read by the notification subscribers can travel alongside the payload. The workflow schemas are non-strict and strip them. Required canonical fields are still type-checked.
- **Narrow `publishEvent`.** Its `eventType` parameter becomes `Exclude<EventType, WorkflowCatalogEventType>`, so a catalogued event *cannot* be published raw. Every current raw `publishEvent` site for a catalogued type moves to `publishWorkflowEvent`, which also removes the reliance on the `convertToWorkflowEvent` `occurredAt` backstop for those sites. Keep the backstop for non-catalogued types and leave its existing LEVERAGE marker in place.
  - Timing risk, per WS1: switching from `publishEvent` to `publishWorkflowEvent` changes no channel fan-out, because `publishWorkflowEvent` delegates to `publishEvent` internally through a non-narrowed internal function. It only adds `buildWorkflowPayload` fields.
- **Typed wrappers.** Give the generic wrappers a type parameter so they stop needing `as any`:
  - `TicketModelEventPublisher.safePublishEvent`
  - `ServerEventPublisher.safePublishWorkflowEvent`
  - `TicketService.safePublishEvent`
  - `publishTicketTransitionsAfterCommit`
  - `publishTicketResourceEvent`
  - `emitDateDomainEventOnce`
  - opportunity and inventory `publish*Event`
  - the `businessOperations` publishers
  - `inboundEmailOutboxDispatcher`. This one replays a stored `event_type` and must validate at runtime via F.
- **Remove the server duplicates.** `server/src/lib/eventBus/publishers/index.ts` re-exports `@alga-psa/event-bus/publishers` instead of carrying its own copies.
- **Legacy raw-stream publishers** (`shared/events/publisher.ts`, `packages/core/src/lib/events/publisher.ts`): narrow `eventType` to non-catalogued types in the same way, so they can never carry a workflow trigger without going through the event bus.

### D. Emitter contract registry and contract test

**Builders are the unit of coverage.** For every catalogued event, each emit site's payload is produced by a pure, exported `build<Event>Payload(input)` function. The site calls `publishWorkflowEvent({ eventType, payload: build<Event>Payload(...), ctx })`.
- Where a builder already exists, keep it. Examples: `shared/workflow/streams/domainEventBuilders/*`, `invoiceWorkflowEvents`, `paymentWorkflowEvents`, `timeEntryWorkflowEvents`, `storage/workflowEventPayloads`, `buildTicketTransitionEvents`.
- Where the site builds the payload inline, extract a builder. Put it in the domain package's `lib/` when it needs domain types; otherwise put it in `shared/workflow/streams/domainEventBuilders/`.
- The builder takes the domain values the site already has (the DB row, the before/after state) and returns the payload. The contract test then exercises the same function the product runs.

**Registry:** `server/src/test/unit/workflow-event-contracts/emitterContracts.ts`:

```ts
type EmitterCase = { site: string; build: () => Record<string, unknown>; ctx?: Partial<WorkflowEventPublishContext> };
type Entry =
  | { status: 'covered'; cases: [EmitterCase, ...EmitterCase[]] }
  | { status: 'known-drift'; ticket: `alga${string}`; reason: string; cases: [EmitterCase, ...EmitterCase[]] }
  | { status: 'no-product-emitter'; ticket: `alga${string}`; reason: string };
export const emitterContracts: { [K in WorkflowCatalogEventType]: Entry } = { … };
```

- The mapped type makes the registry **exhaustive at compile time**. Adding an event to `WORKFLOW_EVENT_CATALOG` without an entry fails `typecheck`.
- Each `case.build` calls the **real exported builder** with realistic domain inputs, meaning row shapes typed with the domain interfaces (`ITicket`, `IComment`, and so on). Use several cases where the builder branches. Examples: response state `null` → value, value → `null`; comment internal/external/reply; invoice with and without a due date.
- `site` is a `path:symbol` string, for example `packages/tickets/src/actions/comment-actions/commentActions.ts#addTicketComment`. Line numbers rot, so they are not used. The inventory guard (E) checks that each `site` symbol exists and calls the builder.

**Contract test:** `server/src/test/unit/workflow-event-contracts/workflowEventEmitterContracts.test.ts`. For each catalogued type and each case:
1. `payload = buildWorkflowPayload(case.build(), { tenantId, occurredAt: undefined, actor, ...case.ctx })`. This is the same function `publishWorkflowEvent` runs.
2. `wire = convertToWorkflowEvent({ id, eventType, timestamp, payload }).payload`. This is exactly what the worker reads from the stream.
3. `initializeWorkflowRuntimeV2()`, then `getSchemaRegistry().get(getWorkflowEventSchemaRef(type)).safeParse(wire)`. These are the worker's own registry and the catalog ref.
4. `covered` entries must succeed, and the failure message includes the Zod issues and `site`. `known-drift` entries run under `it.fails`, so fixing the drift turns the test red until the exclusion is removed. `no-product-emitter` entries are listed in the summary output; they are not silently skipped.

**Why the server unit lane:** `server/vitest.config.ts` includes `../packages/**` and `../shared/**`, and the server unit shards run the **full** suite on every PR, not `nx affected` (`unit-tests.yml`, `server-unit` job). Server code may import any package's builders without violating package layering, which a test under `shared/` could not.

**Retire `ee/packages/workflows/src/runtime/__tests__/payloadSchemaEmitterContracts.test.ts`.** Fold its cases into registry entries backed by real builders, then delete it. Its hand-copied literals are the anti-pattern being replaced.

**Proof that CI fails on drift** (`workflowEventEmitterContracts.selftest.test.ts`):
- **Runtime:** run the harness function, the same one the main test uses, against a deliberately drifted builder that reproduces alga0002101 (`{ previousState, newState }` with no `occurredAt` and no `previousResponseState`/`newResponseState`), with `convertToWorkflowEvent`'s backstop bypassed through a test seam. Then run it against a builder that renames `commentId` → `comment.id`. Assert that the harness returns failure with the expected Zod issue paths. A harness that silently passes everything fails this test.
- **Compile time:** a `.test-d.ts`/`expectTypeOf` file, picked up by `typecheck`, holding `// @ts-expect-error` calls of `publishWorkflowEvent({ eventType: 'TICKET_RESPONSE_STATE_CHANGED', payload: { ticketId, previousState, newState } })` and `publishEvent({ eventType: 'TICKET_COMMENT_ADDED', … })`. If the types ever stop rejecting these, the unused `@ts-expect-error` fails typecheck.
- **Exhaustiveness:** the same `.test-d.ts` holds `// @ts-expect-error` on a registry object missing one key.

### E. Emit-site inventory guard (structural; not grep)

`scripts/check-workflow-event-emit-sites.mjs` uses `ts-morph`, which is already in `node_modules`. It loads the product tsconfig projects (`server`, `packages/*`, `ee/server`, `ee/packages/*`, `shared`, `services/workflow-worker`, `ee/temporal-workflows`). It resolves, through the type checker and not by text, every call whose callee symbol is one of the publish functions:
- `publishEvent` / `publishWorkflowEvent` from event-bus and its re-exports
- `EventBus.publish`
- the calendar `publishEvent`
- the legacy `shared/events` and `core/events` publishers

It fails when any of the following holds:
- The `eventType` argument's checker type is not a string-literal union, meaning `any`, `string` or `EventType` widened through `as`. Typed wrappers (C) are allowed only when the wrapper's *own* parameter is a `WorkflowCatalogEventType` type parameter. The guard follows into the wrapper's call sites.
- The event type is catalogued and the `payload` argument is not a call to a function that some `emitterContracts` entry's cases call. The registry is imported and its `build` bodies are analysed for called builder symbols.
- A `site` in the registry does not resolve to a function that calls that builder.

Runs as an always-on step: add it to the `skip-budget` job in `.github/workflows/unit-tests.yml`, after `npm ci`. Do not use an `nx affected` target, because an emitter change anywhere must trigger it. It also runs locally with `npm run check:workflow-event-emit-sites`.

A self-test (`scripts/tests/check-workflow-event-emit-sites.test.mjs`, added to that job's `node --test` list) runs the checker over a fixture directory containing one drifted inline emitter and one `as any` site, and asserts a non-zero exit.

### F. Emit-time validation in test and dev

In `EventBus.publish`, on the default (workflow) channel, after `convertToWorkflowEvent`: if the event type is catalogued, `safeParse` the wire payload against the canonical schema. The behavior depends on `WORKFLOW_EVENT_CONTRACT_MODE`:

| Mode | Default when | Behavior |
|---|---|---|
| `enforce` | `NODE_ENV=test` | Throw |
| `warn` | `NODE_ENV=development` | Log at warn with issues and stack |
| `off` | Production | No-op; the worker already records failures |

This catches the dynamic-replay paths (`inboundEmailOutboxDispatcher`) and anything integration or Playwright suites exercise. It needs the catalog map and the canonical schemas in event-schemas, which B provides; the worker's `schemaRegistry` is not needed.

---

## 3. Drift handling

The plan predicts no specific drift beyond WS1. The registry is built event by event, and the first full run of D and E is the audit. For each failure:
1. Fix the builder or emitter so it produces the canonical fields. Keep legacy fields alongside when a subscriber reads them, and add a LEVERAGE marker if the duplication is structural.
2. If the fix is out of scope (for example an EE integration owned elsewhere, or a schema whose semantics are disputed), file a ticket and mark the entry `known-drift` with that ticket reference.
3. Never edit a schema in a way that accepts the drifted shape. A schema change is acceptable only when the schema itself is wrong, and then it needs its own justification in the PR.

`no-product-emitter` entries mean the catalog advertises a trigger that nothing fires, which is a defect in its own right. Open **one umbrella ticket** listing them all; each entry cites it.

---

## 4. Sequencing (commits on this branch)

1. **Catalog (A).** Add `workflowEventCatalog.ts`, its unit test and the DB parity test.
2. **Harness, registry skeleton and self-test (D, runtime proof).** The registry is exhaustive from the start. Entries not yet migrated are temporarily `known-drift` against a tracking ticket, so the suite is green and every gap is visible.
3. **Builder extraction and call-site migration, one domain per commit.** Order: tickets (highest risk) → projects → scheduling and time → billing → CRM and tags → documents and storage → email, surveys, integrations and assets → remaining. Each commit flips its entries to `covered`. Retire the ee fixture test once the ticket entries are covered.
4. **Typed helper and `publishEvent` narrowing (C), plus the compile-time proof file.** This lands after step 3, so every catalogued site already uses `publishWorkflowEvent` with a builder.
5. **Inventory guard and CI wiring (E).**
6. **Schema-tree collapse (B).** This lands after D is fully green, because the transport parse tightening depends on it. Include the single-tree guard.
7. **Emit-time validation (F).**
8. **Cleanup.** Remove the server publisher duplicates and the `workflowEventPublishHelpers` duplicate. Run `grep -rn "LEVERAGE:"` and refresh the ledger entries this card touched.

Verification gate for each commit:
- `npx vitest run` on touched tests, using the server config for D.
- `npm run typecheck` on touched projects.
- After step 5, the guard script.

Before handoff, one dev-stack check: on `http://feature-alga0002106-ci-contract-test-workflow-event-emit.localhost:3909`, change a ticket's response state and add a comment. Confirm that a workflow triggered on each event launches, and that `workflow_runtime_events` shows no validation error.

---

## 5. Files to change

**New**
- `packages/event-schemas/src/workflowEventCatalog.ts` and `.test.ts`
- `packages/event-schemas/src/schemas/workflowSchemaMetadata.ts` (annotation helpers moved down from shared)
- `packages/event-schemas/src/schemas/domain/singleSchemaTree.test.ts`
- `server/src/test/infrastructure/workflowEventCatalogParity.test.ts`
- `server/src/test/unit/workflow-event-contracts/{emitterContracts.ts, harness.ts, workflowEventEmitterContracts.test.ts, workflowEventEmitterContracts.selftest.test.ts, publishTypes.test-d.ts}`
- `scripts/check-workflow-event-emit-sites.mjs`, `scripts/tests/check-workflow-event-emit-sites.test.mjs` and fixtures
- Extracted builders: new `build*Payload` modules beside the domain code for every inline catalogued emitter (tickets, projects, scheduling, time, billing, tags, documents, assets, users and email at minimum; the final list comes out of step 3)

**Modified**
- `packages/event-bus/src/publishers/index.ts`: typed `publishWorkflowEvent`, narrowed `publishEvent`
- `packages/event-bus/src/eventBus.ts`: emit-time validation (F)
- `packages/event-schemas/src/schemas/domain/*` (replaced by the canonical tree), `domain/workflowEventPayloadSchemas.ts` (typed `satisfies` map), `schemas/eventBusSchema.ts` (LEVERAGE markers; no transport loosening), `package.json` (if `zod-to-json-schema` is needed)
- `shared/workflow/runtime/schemas/*` (become re-exports), `shared/workflow/runtime/jsonSchemaMetadata.ts` (split)
- Wrappers: `shared/services/tickets/{ticketModelEventPublisher,createTicketWithSideEffects,ticketResourceCore}.ts`, `shared/lib/tickets/ticketLifecycleEvents.ts`, `packages/event-bus/src/adapters/serverEventPublisher.ts`, `server/src/lib/api/services/TicketService.ts`, `packages/event-bus/src/workflow/dateDomainEvents.ts`, `packages/{opportunities,inventory}/src/lib/*Events.ts`, `shared/workflow/runtime/actions/businessOperations/{clients,contacts,crm,scheduling}.ts`, `shared/services/email/inboundEmailOutboxDispatcher.ts`
- Raw catalogued emit sites listed in the inventory. Main files:
  - Tickets: `packages/tickets/src/actions/{ticketActions,optimizedTicketActions,comment-actions/commentActions,ticketBundleActions}.ts`, `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
  - Projects: `packages/projects/src/actions/{projectActions,projectTaskActions}.ts`
  - Scheduling: `packages/scheduling/src/actions/{scheduleActions,appointmentRequestManagementActions}.ts`
  - Server services: `server/src/lib/api/services/{InvoiceService,TimeEntryService,TimeSheetService,TagService,AssetService,ProjectService,BoardService}.ts`
  - Other packages: `packages/documents/src/actions/documentActions.ts`, `packages/tags/src/actions/tagActions.ts`, `packages/users/src/actions/user-actions/userActions.ts`, `packages/email/src/BaseEmailService.ts`
- `server/src/lib/eventBus/publishers/index.ts` (re-export only), `shared/events/publisher.ts`, `packages/core/src/lib/events/publisher.ts` (narrowed types)
- `.github/workflows/unit-tests.yml`: guard step and self-test, in the always-run job
- `package.json`: `check:workflow-event-emit-sites` script

**Deleted**
- `ee/packages/workflows/src/runtime/__tests__/payloadSchemaEmitterContracts.test.ts` (superseded)
- `packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts` (duplicate)

---

## 6. Risks

- **Transport parse tightening (B)** can throw at publish time in production. Mitigation: the collapse is ordered last, after D proves every catalogued emitter. The transport schemas for legacy-typed events are left unchanged.
- **`publishEvent` narrowing touches many files.** It is a mechanical change that the type checker drives, but it crosses CE/EE boundaries. Run the `ee-import-counterpart-guard` and `workflows-ee-build-guard` checks.
- **Builder inputs in tests must be realistic.** A builder fed a hand-shaped "row" can still hide drift. Mitigation: type builder inputs with the domain row interfaces, so test inputs are checked against real shapes.
- **Guard runtime.** Loading the full TS program may be slow. If it exceeds about 5 minutes in CI, scope it to source files that import a publish module, resolved through ts-morph's reference graph, before loosening anything else.
- **Catalog parity test** needs the migrated DB, so it belongs in the integration lane; the unit-lane checks do not cover it.
