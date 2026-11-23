# Plan: portal and email client replies emit `ticket.response_state_changed`

Card 378dfcbb · PSA ticket alga-2026-0002682 · stacked on c219d6bf (PR #3679)

## Goal

Every path that changes `tickets.response_state` because a comment was added
goes through one engine, `applyCommentResponseState` in
`shared/lib/tickets/responseState.ts`. That engine:

- checks the per-tenant `responseStateTrackingEnabled` setting,
- writes the new state in the caller's transaction,
- announces `TICKET_RESPONSE_STATE_CHANGED` only after commit, and only when the state actually changed.

The webhook payload then comes from a single builder, so it is the same whatever the source.

## Current state (as found in code)

| Path | File | What it does today |
|---|---|---|
| MSP UI comment | `packages/tickets/src/actions/comment-actions/commentActions.ts:278` | Uses `applyCommentResponseState`. Correct. |
| REST comment | `server/src/lib/api/services/TicketService.ts:2688` | Uses `applyCommentResponseState`. Correct. |
| Scheduled comment publish | `server/src/lib/jobs/handlers/publishScheduledCommentHandler.ts:46` | Publishes its own event. Out of scope. |
| Optimized MSP comment | `packages/tickets/src/actions/optimizedTicketActions.ts:377` `updateTicketResponseStateFromComment` | Local copy of the engine with **no tracking check**. Emits the event. |
| Client portal reply | `packages/client-portal/.../client-tickets.ts:682` | Writes `awaiting_internal` unconditionally. **No tracking check, no event.** |
| Model comment (`TicketModel.createComment`) | `shared/models/ticketModel.ts:1587` | Tracking check reads the column only, ignoring the nested `settings.ticketing.display` fallback. Writes `awaiting_internal` for `author_type: 'contact'`. **No event.** |
| Inbound email reply | `shared/workflow/actions/emailWorkflowActions.ts:1650-1667` (`createCommentFromEmail`) | **Unmarked fourth site.** After calling the model it writes `response_state` *again*: `awaiting_internal` for client authors and `awaiting_client` for internal authors (staff replying by email). It has its own column-only tracking check. **No event.** |

Callers of `TicketModel.createComment` that can reach the client branch:
- `createCommentFromEmail`, both durable and legacy inbound paths
- `packages/tickets/src/actions/inboundActions.ts:311` (inbound webhooks; owns its transaction via `withTransaction`)
- workflow runtime `businessOperations/tickets.ts`
- `server/src/lib/migrations/appliers/entityAppliers.ts`

The other callers create internal or system comments and never move the state.

### Transaction and publication mechanics that shape the design

- `registerAfterCommit` (`packages/db/src/lib/afterCommit.ts`) flushes only from the owning `withTransaction` / `withAdminTransaction` → `runOwnedTransaction` frame. Both the durable inbound commit (`inboundEmailCoreProcessor.ts:213`, `withAdminTransaction`) and the legacy path own their transaction, so hooks *would* flush.
- The **durable** inbound pipeline deliberately does not publish from hooks. It writes every event as an `inbound_email_outbox` row in the commit transaction, through `InboundEmailOutboxEventPublisher` (`shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts`). The row is unique on `(tenant, inbox_id, event_key)`, and `inboundEmailOutboxDispatcher.ts` dispatches it at-least-once with `outbox_id` as a stable event id. A fire-and-forget after-commit hook would be lost on a crash after commit and would break replay idempotency. In the durable path, the response-state event has to go through the outbox like `TICKET_COMMENT_ADDED` and `TICKET_STATUS_CHANGED` already do.
- `persistCommentPublication` (`shared/lib/ticketCommentAttachments.ts:46`), which the brief suggests, is not a fit. It stores one intent per **comment row** (`scheduled_publish_event_id`, `comment_publication_payload`), and `dispatchCommentPublication` hard-codes `eventType: 'TICKET_COMMENT_ADDED'`. Adding a second event per comment would need a second set of columns or a generic intent table. The inbound outbox already gives us durability where it matters.

### Payload today (REST/UI, `publishResponseStateChange`)

```
{ tenantId, occurredAt, ticketId, userId, previousResponseState, newResponseState,
  previousState, newState, trigger: 'comment' }
```

Schema `TicketResponseStateChangedPayloadSchema` (`packages/event-schemas/.../eventBusSchema.ts:1074`) has `userId: uuid | null`. It has **no contact or actor field**. The webhook builder (`webhookTicketPayload.ts:206`) maps only previous/new state. "Parity" therefore means the same builder and the same `userId` semantics. See Open question 1.

## Design

### A. Engine: separate the decision from the announcement (`shared/lib/tickets/responseState.ts`)

1. Extract `buildResponseStateChangedPayload(params)`. It is the one place that shapes the payload above. `publishResponseStateChange` uses it.
2. Add an optional `announce` sink to `applyCommentResponseState`:
   ```ts
   type ResponseStateAnnouncer =
     (trx: Knex.Transaction, payload: ResponseStateChangedPayload) => void | Promise<void>;
   applyCommentResponseState(trx, { ..., announce?: ResponseStateAnnouncer })
   ```
   - The default is the existing after-commit publish (`registerAfterCommit` + `publishEvent`), so the UI and REST paths stay unchanged.
   - An outbox sink calls `announce` *inside* the transaction to insert an outbox row. That row is not published until the dispatcher claims it after commit, so nothing is published from an uncommitted transaction.
   - The sink is called only when `newState !== previousState`, and never when tracking is disabled.
3. `userId` stays `string | null`. Email authors with no user get `null`, **not** the ticket-id sentinel used by `TICKET_COMMENT_ADDED`. The schema allows `null`, and a ticket id posing as a user would mislead webhook consumers.

### B. Client portal (`packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:681-690`)

- Replace the direct `update({ response_state: 'awaiting_internal' })` with:
  ```ts
  const { previousState, newState } = await applyCommentResponseState(trx, {
    tenant, ticketId, authorType: 'client', isInternal: false, userId });
  ```
  `authorType` is hard-coded to `'client'` because the portal comment row is always inserted with `author_type: 'client'`. This matches what is stored.
- Keep `maybeReopenBundleMasterFromChildReply(trx, tenant, ticketId, userId)` exactly where it is: under `!isInternal`, after the state call, and independent of the tracking setting (today it is not gated by tracking, and must stay that way).
- Change `publishTicketUpdate.updatedFields` to include `'response_state'` only when `newState !== previousState`. Today it always claims the field changed.
- Remove the LEVERAGE marker.
- Add the import from `@alga-psa/shared/lib/tickets/responseState`. `client-portal` already depends on `shared`; check the package.json/tsconfig path used by `@alga-psa/shared/lib/ticketCommentAttachments`, which this file already imports via `persistCommentPublication`.

### C. Model path (`shared/models/ticketModel.ts:1576-1596`)

- Replace the column-only setting read and the direct write with `applyCommentResponseState(trx, { tenant, ticketId, authorType: 'client', isInternal: commentIsInternal, userId: validatedData.author_id ?? userId ?? null, announce })`.
  - Keep the guard: run only when `!validatedData.is_internal && validatedData.author_type === 'contact'`. The model keeps its current scope and does **not** start moving state for internal/system authors. Workflow, auto-close and transcript comments would otherwise suddenly set `awaiting_client`.
  - Use `commentIsInternal` (thread-inherited visibility), not `validatedData.is_internal`. A contact reply into an internal thread must not move state. This also fixes a latent bug: today the check uses the raw input flag.
- Choose `announce` from the injected publisher:
  - If `eventPublisher.__inboundOutboxPublisher === true`, call a new `eventPublisher.publishResponseStateChanged(payload)`, which writes an outbox row in-transaction.
  - Otherwise use the default after-commit hook. This also covers callers that pass no publisher (inbound webhooks, migrations, workflow runtime); all of them own their transaction through `withTransaction` / `withAdminTransaction`.
- Remove the LEVERAGE marker. Model code may now emit after-commit events: the engine already registers the hook on the caller's `trx`.

### D. Outbox publisher (`shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts`)

- Add `publishResponseStateChanged(payload)`. It enqueues `eventKey: 'response-state-changed'`, `eventType: 'TICKET_RESPONSE_STATE_CHANGED'`, with the payload from `buildResponseStateChangedPayload` (the engine's `occurredAt` wins over the enqueue stamp).
- The key is unique per inbox message. One inbound message produces at most one reply comment, so one key is correct. A replay hits `onConflict` and creates no duplicate.
- Add the optional method `publishResponseStateChanged?` to `IEventPublisher` (`packages/types/src/index.ts:166`) so the model can call it with types. `WorkflowEventPublisher` does not need it, because the default sink handles that case.
- Confirm that `inboundEmailOutboxDispatcher` passes `event_type` through generically and that `EventSchemas.TICKET_RESPONSE_STATE_CHANGED` accepts the payload. Both should already hold.

### E. `createCommentFromEmail` (`shared/workflow/actions/emailWorkflowActions.ts:1650-1667`)

- Delete the duplicate tenant-settings read and both direct writes.
  - Client author: the model (C) now handles it. Removing this write also removes the double-write.
  - Internal author (staff replying by email): call `applyCommentResponseState(trx, { authorType: 'internal', isInternal: false, userId: commentData.author_id ?? userId ?? null, announce })`, choosing the same publisher-based `announce` as C. It keeps today's `awaiting_client` behaviour and now also emits the event.
- To avoid duplicating the publisher → sink selection between C and E, export one helper from `responseState.ts`: `announcerFor(eventPublisher?: IEventPublisher)`.

### F. Fold the optimized duplicate (`packages/tickets/src/actions/optimizedTicketActions.ts:377-427, 3553`)

- Delete `updateTicketResponseStateFromComment`. At line 3553 call:
  ```ts
  applyCommentResponseState(trx, { tenant, ticketId, authorType,
    isInternal: authorType === 'internal' ? isInternal : false, userId: user.user_id ?? null })
  ```
  This keeps the existing `isInternal` coercion for non-internal authors.
- Behaviour change, intended: this path now respects `responseStateTrackingEnabled`.
- Tests to update:
  - `optimizedTicketActions.tenantScopedAuth.contract.test.ts:24-47`: drop the `responseStart/responseSection` assertions for the deleted function. Replace them with an assertion that the source imports and calls `applyCommentResponseState` and contains no `update({ response_state` outside close handling. The engine's tenant scoping is already structural (`tenantDb`).
  - `optimizedTicketActions.liveUpdates.test.ts`: the `@alga-psa/db` mock's `tenantDb` (line 38) must answer `tenant_settings` (return `undefined` → tracking on by default). Check that the `addTicketCommentWithCache` test (line ~789) still sees `TICKET_RESPONSE_STATE_CHANGED`. Add one case with tracking disabled and assert no state write and no event.
- Remove the LEVERAGE marker. Afterwards `grep -rn "LEVERAGE: pattern response-state-from-comment"` returns nothing.

## Tests

Use DB-backed integration tests under `server/src/test/integration/`, reusing the in-process bus and signed-webhook sink harness from `restCommentResponseState.integration.test.ts`. That harness mocks `publishEvent`, runs `EventSchemas[...].parse`, and feeds the real webhook subscriber. Lift the shared harness bits into a `test-utils` helper rather than copying them. Copying would be the third instance of the pattern, so mark it with a LEVERAGE marker if it is not extracted.

New file `clientReplyResponseState.integration.test.ts`:

1. **Portal, state changes.** Ticket `awaiting_client`; `addClientTicketComment` as a client user. DB shows `awaiting_internal`. Exactly one signed `ticket.response_state_changed` delivery: verify the HMAC; check `previous_response_state=awaiting_client`, `new_response_state=awaiting_internal`, `ticket_id`, and event `userId` = the portal user.
2. **Portal, no change.** Ticket already `awaiting_internal`. No `TICKET_RESPONSE_STATE_CHANGED` and no delivery. `TICKET_COMMENT_ADDED` still fires.
3. **Portal, tracking disabled.** Set `ticket_display_settings.responseStateTrackingEnabled=false`. State unchanged, no event. Run a second variant with the setting only at the nested `settings.ticketing.display` path.
4. **Portal, bundle reopen preserved.** Closed bundle master with `reopen_on_child_reply`; portal reply on the child. The master reopens with tracking both on and off.
5. **Email, durable path.** Run `processInboundInbox` on a reply to an `awaiting_client` ticket. Before dispatch, an outbox row `response-state-changed` exists. After `processInboundOutboxJob`, there is one signed delivery `awaiting_client → awaiting_internal`, and `userId` is null for a sender that matches only a contact. Re-running the same inbox (replay) creates no second outbox row.
6. **Email, legacy path.** Call `createCommentFromEmail` with no durable execution. One delivery after commit. A forced rollback emits nothing.
7. **Email, no change and tracking disabled.** Same assertions as cases 2 and 3.
8. **Email, staff reply.** An internal author moves the ticket `awaiting_internal → awaiting_client` and emits the event.
9. **Payload parity.** For one transition each through portal, email, REST and UI, compare the event payload key sets after schema parse and the webhook body field sets, ignoring values. They must match.

Unit and contract tests:
- `ee/packages/workflows/src/runtime/__tests__/payloadSchemaEmitterContracts.test.ts:113`: add portal and outbox emitter payload cases.
- Update existing `client-tickets.*.test.ts` mocks for the new import if they mock `@alga-psa/db` narrowly.

## Order of work

1. Engine changes (A) with unit tests for `announce`, the payload builder, and `announcerFor`.
2. Outbox method (D) and the `IEventPublisher` type.
3. Model (C), email action (E), portal (B).
4. Fold the optimized duplicate (F) and update its tests.
5. Integration tests; check the marker grep is empty.

## Risks

- **A caller of `TicketModel.createComment` that runs inside a raw `knex.transaction`** (not `withTransaction`) would never flush the after-commit hook. The event would be silently dropped, which is no worse than today. Audit the client-author callers listed above during C. All the ones found so far own their transaction properly.
- **Tracking now applies on the optimized path.** Tenants that disabled tracking stop getting state changes from that path. This is the intended fix, but call it out in the PR.
- **Model guard switches to `commentIsInternal`.** A contact reply into an internal thread stops moving state. This is a correctness fix; mention it in the PR.

## Open questions

1. **Actor/contact fields.** The brief asks for "the same actor/contact fields the REST/UI paths send". REST and UI send only `userId`; the schema and webhook carry no contact field. The plan gives parity by construction: one builder, with `userId` nullable for email. Should we also add `contactId` (and maybe `actorType`) to the event schema and the webhook body on **all** paths? Biz Buddy could then attribute email replies from contacts that have no user. That would extend the c219d6bf contract, so it needs the captain's call.
2. **Staff-by-email `awaiting_client`.** `createCommentFromEmail` already moves the ticket to `awaiting_client` for internal authors. The plan keeps that and adds the event. Confirm this is wanted and not to be dropped.
