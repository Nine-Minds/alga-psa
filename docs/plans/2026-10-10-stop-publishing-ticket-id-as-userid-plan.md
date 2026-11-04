# Plan: Stop publishing the ticket id as `userId` in ticket and comment events

- **Date:** 2026-10-10
- **Card:** d4c90e85, "Stop publishing ticket id as userId in ticket/comment workflow events"
- **Branch:** `feature/stop-publishing-ticket-id-as-userid-in-ticket-co` (base `main` @ `b0d0b4dacf`)
- **Status:** design. Nothing is implemented yet.
- **Related:** PR #3641 (raw-UUID notification titles) is already merged into this base (`1ae4edae06`), so this work goes straight onto `main` and does not need to stack on it.

## 1. Problem

Ticket and comment events carry `payload.userId`, which consumers read as "the user who did this". When no user acted (inbound email, a portal action with no user, a scheduled or system job), several publishers put the **ticket id** in that field so the payload passes schema validation. Every consumer that trusts `userId` then sees a user that does not exist.

The publishers that do this:

| File | Line(s) | Expression |
|---|---|---|
| `shared/workflow/adapters/workflowEventPublisher.ts` | 89, 106, 123, 140 (created, updated, closed, comment) | `userId: data.userId \|\| data.ticketId` |
| `shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts` | 86, 110, 153, 173 (same four) | `userId: data.userId \|\| data.ticketId` |
| `shared/models/ticketModel.ts` | 1611 (comment event, both the outbox path and `persistCommentPublication`) | `userId \|\| validatedData.author_id \|\| validatedData.ticket_id` |
| `shared/lib/ticketCommentAttachments.ts` | 73 (`dispatchCommentPublication` replay) | `payload.userId ?? comment.user_id ?? comment.ticket_id` |
| `server/src/lib/jobs/handlers/publishScheduledCommentHandler.ts` | 33 (scheduled comment) | `comment.user_id ?? comment.ticket_id` |

The ticket id is not only in `payload.userId`. `convertToWorkflowEvent` (`packages/event-schemas/src/schemas/eventBusSchema.ts:1723`) copies `actorUserId ?? userId` into the workflow stream envelope's `user_id`, so it reaches the workflow stream too.

### 1.1 Why the fallback exists

`TicketEventPayloadSchema` (`packages/event-schemas/src/schemas/eventBusSchema.ts:561-575`) declares `userId: z.string().uuid()` as **required**. That schema is used as follows:

- It is the **only** schema for `TICKET_COMMENT_ADDED` (`:1232`) and `TICKET_DELETED` (`:1229`).
- `TICKET_COMMENT_UPDATED` (`:746`) extends it.
- It is the legacy branch of the `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_CLOSED`, `TICKET_ASSIGNED` and `TICKET_AUTO_CLOSE_WARNING` unions (`:1190-1199`).

`EventBus.publish` validates every event (`packages/event-bus/src/eventBus.ts:845`). `strict` only decides whether a failure throws or is logged and dropped. So a comment event without a `userId` is rejected.

The union events can fall through to the domain branch, but that does not help. The domain branch:

- strips every key it does not declare (`comment`, metadata, and the `old` value inside `changes`);
- requires `changes` entries shaped `{previous, new}`, while `TicketModel.update` publishes flat `changes`, so an update event with no `userId` fails **both** branches.

The schema comment on `userId` reads "The user being assigned to the ticket". The field is overloaded:

- On `TICKET_ASSIGNED` it is the **assignee**, the notification recipient.
- On every other ticket event it is the **actor**.

### 1.2 Harm the ticket id causes today

The consumer sweep found these concrete defects. Each one goes away once `userId` is honest.

1. **SLA FK violation.** `slaSubscriber` passes `userId` through to `pauseSla`/`resumeSla`, which write `sla_audit_log.triggered_by` (`packages/sla/src/services/slaPauseService.ts:101,217,614`). That column has FK `sla_audit_log_user_fkey (tenant, triggered_by) → users` (`server/migrations/20260219000005_create_sla_audit_log.cjs:90-100`). An inbound-email, Teams, webhook or service-request ticket that lands in a pausing status aborts the SLA transaction.
2. **Raw ticket UUID in emails.** `ticketEmailSubscriber.ts:1851-1858` renders `changeSet.userId` as the updater name when no user row matches. `:2077` (`idToName.get(id) || id`) does the same for the "Updated By" row.
3. **Survey actor misattribution.** `surveySubscriber.ts:110-118` → `surveyService.ts:331` emits `SURVEY_SENT` with `actorType: 'USER'` and the ticket id as `actorUserId`.
4. **Tenant workflow titles.** Tenant workflows that build titles from `payload.userId` got a raw ticket UUID. That is the origin of #3641. The `send_in_app` title guard added there masks the symptom, but the payload is still wrong.
5. Ticket ids stored as `performedById` / `commentAuthorId` / `authorId` in notification metadata (`internalNotificationSubscriber.ts:938, 1858, 1909, 1961`). Nothing reads these, but the stored data is wrong.

## 2. Design

### 2.1 Decision: an explicit actor, with `userId` kept only as a real-user alias

An actor representation already exists, and this plan uses it rather than inventing a new one:

- `BaseDomainEventPayloadSchema` declares `actorType: 'USER' | 'CONTACT' | 'SYSTEM'`, `actorUserId` and `actorContactId` (`packages/event-schemas/src/schemas/domain/commonEventPayloadSchemas.ts:24-36`; mirrored in `shared/workflow/runtime/schemas/commonEventPayloadSchemas.ts:29-41`).
- `WorkflowActor` and `buildWorkflowPayload` stamp those fields (`packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts`; copy in `packages/event-bus/src/workflow/`).
- `TicketModelEventPublisher`, `ServerEventPublisher` and `createTicketWithSideEffects` already publish through `publishWorkflowEvent`. They use `{actorType:'SYSTEM'}` when no user is known.
- `TICKET_STATUS_CHANGED` in the inbound outbox already does the honest thing (`inboundEmailOutboxEventPublisher.ts:128`): it sets `userId`/`actorUserId`/`actorType:'USER'` only when a user exists, and omits them otherwise.

Rules for every ticket and comment event except `TICKET_ASSIGNED`:

| Who acted | `actorType` | `actorUserId` | `actorContactId` | `userId` |
|---|---|---|---|---|
| An internal or client-portal user | `USER` | user id | — | user id (legacy alias, equal to `actorUserId`) |
| A contact with no user account (inbound email from a matched contact) | `CONTACT` | — | contact id | **absent** |
| Nobody identifiable (unmatched sender, system job, scheduled publish of a user-less comment) | `SYSTEM` | — | — | **absent** |

`userId` stays in the payload so existing consumers and tenant workflows keep working when a user did act. It is never filled with anything other than a real user id. When there is no user it is **omitted**, not set to `null`. That matches the inbound `TICKET_STATUS_CHANGED` precedent and every domain schema, where `*ByUserId` fields are optional rather than nullable.

`TICKET_ASSIGNED` is not changed. Its `userId` is the assignee (a real user, required). The internal-notification subscriber reads it as the recipient (`internalNotificationSubscriber.ts:440, 498`), and `serverEventPublisher.ts:80-88` documents why it must stay.

Rejected alternatives:

- **Make `userId` nullable and send `null`.** This keeps the overloaded field as the only identity and tells consumers nothing about *who* acted. Contact-authored comments would still look the same as system activity.
- **Rename `userId` to `actorUserId` everywhere and drop `userId`.** This would break published tenant workflows that read `payload.userId` for genuine user actions. Those workflows are stored as data, so nothing would catch the break at compile time. Keeping the alias costs nothing.

### 2.2 One helper owns the actor-to-payload mapping

The same shape is written in 5+ publishers. This plan adds it once, next to `buildWorkflowPayload` in `packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts`, and mirrors it in the `packages/event-bus` copy the same way the file already is:

```ts
/** The workflow actor for a ticket/comment event. Never invents a user. */
export function resolveTicketEventActor(input: { userId?: string | null; contactId?: string | null }): WorkflowActor;

/** actorType/actorUserId/actorContactId plus the legacy `userId` alias (USER actors only). */
export function ticketEventActorFields(actor: WorkflowActor): {
  actorType: 'USER' | 'CONTACT' | 'SYSTEM';
  actorUserId?: string;
  actorContactId?: string;
  userId?: string;
};
```

`buildWorkflowPayload` is refactored to use the same internal `workflowActorFields(actor)`, so there is one mapping.

The `IEventPublisher` contract (`packages/types/src/index.ts:167-195`) gains an optional `actor?: WorkflowActor` on `publishTicketCreated`, `publishTicketUpdated`, `publishTicketClosed` and `publishCommentCreated`.

- Its doc comment states that `userId` is a real user id or undefined, never a substitute.
- When `actor` is absent, implementations derive it with `resolveTicketEventActor({ userId })`.
- Callers that know a contact (comment author contact, inbound sender contact) pass it explicitly.

`TicketModel` does **not** infer a CONTACT actor from the ticket's `contact_name_id`. On update or close, the ticket's contact is not the actor.

### 2.3 Schema changes

**Event bus** (`packages/event-schemas/src/schemas/eventBusSchema.ts`):

1. `TicketEventPayloadSchema`:
   - `userId` becomes `z.string().uuid().optional()`. Its comment becomes "Acting user. Present only when a user acted; see actorType."
   - Declare `actorType` (reuse the existing `actorTypeSchema` from the domain module), `actorUserId`, `actorContactId`, `occurredAt` and `commentId` as optional.
   - The consumer re-parses events and hands handlers the **parsed** object (`eventBus.ts:539`). Without these declarations the legacy branch strips the actor fields before subscribers see them.
2. Add `TicketAssignedLegacyPayloadSchema = TicketEventPayloadSchema.extend({ userId: z.string().uuid() })` (the assignee, required). Use it as the legacy branch of `TicketAssignedPayloadSchema` (`:1199`).
3. Leave `TICKET_COMMENT_ADDED` on the legacy schema. Making `userId` optional is enough for it, and switching it to a union would change what consumers receive.

**Workflow runtime and domain schemas** (`shared/workflow/runtime/schemas/ticketEventSchemas.ts` and `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts`): no `userId` is added. These schemas already declare the actor fields through the base. The worker validates trigger payloads against them, but it passes the **raw** payload to runs (`services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts:401,428,479`). So:

- Tenant workflows that read `payload.userId` get the real user id when a user acted, and `undefined` otherwise.
- The designer schema has never advertised `userId`, so nothing new is exposed.
- Change the help example `ee/server/src/components/workflow-designer/expression-editor/ExpressionSyntaxHelp.tsx:63` from `payload.userId` to `payload.actorUserId`.

**Designer and legacy JSON catalog:**

- `ee/packages/workflows/src/models/eventCatalog.ts:250-311` lists `userId` as `required` for `TICKET_CREATED`, `TICKET_UPDATED` and `TICKET_CLOSED` (`:263, :282, :311`). Remove it from `required`, describe it as "acting user, absent when no user acted", and add `actorType`, `actorUserId` and `actorContactId`.
- `initializeSystemEvents` only runs on an empty catalog, so existing rows need a migration. Add `server/migrations/2026101000000x_ticket_event_catalog_optional_user_id.cjs`. For `system_event_catalog` (and `event_catalog` if those rows carry the same JSON) rows with `event_type IN ('TICKET_CREATED','TICKET_UPDATED','TICKET_CLOSED')`:
  - remove `"userId"` from `payload_schema->'required'`;
  - patch the property description.
- The migration must be idempotent and Citus-safe: literal timestamps, no volatile functions in the UPDATE, and it must check `hasTable`/`hasColumn` first. Check it against the `citus-migration-gotchas` skill.
- This is display-only (runtime validation uses `payload_schema_ref`), but the run dialog builds sample payloads from it (`WorkflowRunDialog.tsx:909-928`). Leaving it would keep presenting `userId` as mandatory.

### 2.4 Publisher changes

| File | Change |
|---|---|
| `shared/workflow/adapters/workflowEventPublisher.ts` | Remove the four `\|\| data.ticketId` fallbacks. Spread `ticketEventActorFields(data.actor ?? resolveTicketEventActor({ userId: data.userId }))` into each payload. Stamp `occurredAt` through `buildWorkflowPayload` so these events validate on the domain branch too and stop relying on the `convertToWorkflowEvent` backstop (which removes one `LEVERAGE: friction workflow-payload-occurred-at` caller). `publishTicketAssigned` is unchanged. |
| `shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts` | Same for `:86, :110, :153, :173`. Fold `publishTicketStatusChanged`'s inline actor spread (`:128`) into the helper. |
| `shared/models/ticketModel.ts` | **Comment (`:1609-1631`):** delete the sentinel comment. Set `actor = resolveTicketEventActor({ userId: userId \|\| validatedData.author_id, contactId: validatedData.contact_id })`. Pass `actor` to `publishCommentCreated` and spread `ticketEventActorFields(actor)` into the `persistCommentPublication` payload instead of `userId: eventUserId`. **Ticket created (`:1032`) and update (`:1275`):** pass `userId` through unchanged (already honest). The inbound-email caller supplies a CONTACT `actor` when the sender matched a contact (see next row). |
| `shared/workflow/actions/emailWorkflowActions.ts` (`createTicketFromEmail`, `:1266-1330`) | The ticket is created through `TicketModel.createTicket(..., eventPublisher, analyticsTracker, userId, 3)`. When `ticketData.contact_id` is set and there is no `userId`, pass a CONTACT actor through to the `TICKET_CREATED` publish. Add an optional `actor` field to the existing creation-time wrapper that already carries `payloadExtras` (`isTicketCreationWithPayloadExtras`, `ticketModel.ts:1023-1026`), so it does not become another positional argument. `TicketModel` forwards it to `publishTicketCreated`. Comments from the same path already get the contact through `validatedData.contact_id`. |
| `shared/lib/ticketCommentAttachments.ts:73` | Replay derives identity from the comment row: `ticketEventActorFields(resolveTicketEventActor({ userId: comment.user_id, contactId: comment.contact_id }))`. The persisted `payload.userId` is used only if it survives the legacy-sentinel scrub (§2.5). No `comment.ticket_id` fallback. |
| `server/src/lib/jobs/handlers/publishScheduledCommentHandler.ts:33` | Same derivation from the comment row (add `contact_id` to the `returning`/`first` column lists at `:93` and `:104`). Remove the sentinel comment at `:29-30`. |
| `shared/services/tickets/ticketModelEventPublisher.ts:85-99` and `packages/event-bus/src/adapters/serverEventPublisher.ts` | Accept the new optional `actor` and use it when present. Otherwise keep today's USER-or-SYSTEM derivation. No ticket-id fallback exists in these two files. |

### 2.5 Durable rows written before this change

Two stores hold payloads that were built with the sentinel and are replayed later:

- `comments.comment_publication_payload` (replayed by `dispatchCommentPublication`)
- `inbound_email_event_outbox.payload` (replayed by `shared/services/email/inboundEmailOutboxDispatcher.ts:91-101`)

Add `scrubLegacyTicketIdActor(payload)` next to the actor helper. When `payload.userId === payload.ticketId` it deletes `userId`, and it deletes `actorUserId` under the same condition. Call it at those two replay points before `publishEvent`.

It is a narrow, explicit data heal. It is not a schema rule. Adding a `userId !== ticketId` refinement to the bus schema would make the consumer drop as poison any event already in a Redis stream at deploy time, losing notifications.

No backfill of historical notification metadata (`performedById` etc.) or workflow run history: nothing reads those fields.

### 2.6 Consumer changes (tolerate an absent `userId`)

| Consumer | Line(s) | Change |
|---|---|---|
| `internalNotificationSubscriber.ts` `TICKET_UPDATED` | 926-929 | `.where('user_id', userId)` throws on `undefined` and loses every update notification. Guard: look the user up only when `userId` is set. Otherwise the performer is "System". |
| same, `TICKET_COMMENT_ADDED` | 1776-1779 | Same guard. Fall back to `comment.author` (already the `:1783` fallback). On the inbound path an unguarded throw retries until dead-lettered. |
| same, `TICKET_COMMENT_UPDATED` | 2013-2016 | Same guard (today the handler's own catch silently drops it). |
| same, metadata | 938, 1858, 1909, 1961 | Write `performedById` / `commentAuthorId` / `authorId` only when present. |
| same, self-exclusion sets | 1038, 1153 | `new Set(userId ? [userId] : [])` so the types stay honest once `userId` is optional. |
| `ticketEmailSubscriber.ts` | 1851-1858 | The updater label never falls back to the raw id: `updater ? name : 'System'`. |
| same | 2077 | `idToName.get(id) ?? 'System'` (dedupe the result) instead of `\|\| id`. A real user id that has since been deleted also stops rendering as a UUID. |
| same | 1179, 1403, 1504, 2665, 3284 | Already `domainField \|\| actorUserId \|\| userId` and guarded. No change; covered by tests. |
| `slaSubscriber.ts` | 151, 257, 373, 443 | Parameters are already optional. Type-only fallout; the FK violation is fixed by the payload change. |
| `surveySubscriber.ts` | 110-118 | No change; with `userId` absent the survey actor becomes SYSTEM. |
| `convertToWorkflowEvent` | `eventBusSchema.ts:1723` | No change; `user_id` becomes `undefined`, which the envelope allows. |

Confirmed not to depend on `payload.userId`:

- `webhookSubscriber` / `webhookTicketPayload`
- `searchIndexSubscriber`
- `rmmAlertTicketClosedSubscriber`, `slaNotificationSubscriber`, `ticketAutoCloseWarningSubscriber`
- watcher recipients
- `workflowSelfTriggerGuard`
- PostHog analytics (`distinct_id` comes from TicketModel's own argument)
- `writeTicketActivity` (called inline, not from events)

`ticketEmailSubscriber.ts:2272/2638` (`assignedByUserId || actorUserId || userId` on `TICKET_ASSIGNED`) is a separate bug. There `userId` is the assignee, so "assigned by" can show the assignee. It is out of scope for this card: record it as a follow-up and add a `// LEVERAGE: friction ticket-assigned-userid-overload` marker.

### 2.7 Guardrail

Add a unit test that drives each `IEventPublisher` implementation (`WorkflowEventPublisher`, `InboundEmailOutboxEventPublisher`, `TicketModelEventPublisher`, `ServerEventPublisher`) with no `userId`. It asserts that the emitted payload has no `userId`, has `actorType` set to `SYSTEM` (or `CONTACT` when a contact actor is given), and parses against `EventSchemas[eventType]`. The test is table-driven over the four methods. Any future `|| ticketId` fallback fails it.

## 3. Files to change

**Schemas and helpers**

- `packages/event-schemas/src/schemas/eventBusSchema.ts`: `TicketEventPayloadSchema` (optional `userId`, declared actor fields) and `TicketAssignedLegacyPayloadSchema`.
- `packages/event-schemas/src/schemas/workflowEventPublishHelpers.ts` and `packages/event-bus/src/workflow/workflowEventPublishHelpers.ts`: `resolveTicketEventActor`, `ticketEventActorFields`, `scrubLegacyTicketIdActor`, and `buildWorkflowPayload` refactored onto the shared mapping.
- `packages/types/src/index.ts`: `IEventPublisher` gains optional `actor`, plus the doc contract.
- `ee/packages/workflows/src/models/eventCatalog.ts`
- `server/migrations/20261010…_ticket_event_catalog_optional_user_id.cjs` (new)
- `ee/server/src/components/workflow-designer/expression-editor/ExpressionSyntaxHelp.tsx`

**Publishers**

- `shared/workflow/adapters/workflowEventPublisher.ts`
- `shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts`
- `shared/models/ticketModel.ts` (comment event)
- `shared/workflow/actions/emailWorkflowActions.ts` (CONTACT actor for inbound tickets) and the `ticketModel.ts` creation wrapper that carries it
- `shared/lib/ticketCommentAttachments.ts`
- `server/src/lib/jobs/handlers/publishScheduledCommentHandler.ts`
- `shared/services/email/inboundEmailOutboxDispatcher.ts` (scrub on replay)
- `shared/services/tickets/ticketModelEventPublisher.ts`
- `packages/event-bus/src/adapters/serverEventPublisher.ts`

**Consumers**

- `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts`
- `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
- `server/src/lib/eventBus/subscribers/slaSubscriber.ts` (types only, if needed)

## 4. Tests

**Update** (these currently assert the ticket id as `userId`):

- `shared/models/__tests__/ticketModel.createComment.publicationPayload.test.ts:84, :119-120`: payload has no `userId`. `actorType` is `SYSTEM`, or `CONTACT` with `actorContactId` when the comment has a contact. It still parses as `TICKET_COMMENT_ADDED`.
- `shared/lib/__tests__/ticketCommentAttachments.commentAuthor.test.ts:88`: the healed replay has no `userId`. Add a case where the persisted payload carries `userId === ticketId` and is scrubbed.
- `server/src/test/integration/ticketCommentAttachmentsIntegration.test.ts:369, :390`: same assertions for the replay path and the scheduled-comment handler (rename the "sentinel actor" test).
- `server/src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.titles.test.ts:54, 67, 83, 89`: fixtures stop using the ticket id as `userId`.

**Add:**

- Publisher guardrail (§2.7), table-driven across the four publishers and four methods.
- `eventBusSchema`:
  - `TICKET_COMMENT_ADDED` / `TICKET_DELETED` / `TICKET_COMMENT_UPDATED` accept a payload without `userId`;
  - `TICKET_UPDATED` with flat `changes` and no `userId` validates on the legacy branch and keeps `changes`, `comment` and the actor fields after parse;
  - `TICKET_ASSIGNED` without `userId` is still rejected on the legacy branch.
- `resolveTicketEventActor` / `ticketEventActorFields` / `scrubLegacyTicketIdActor` unit tests.
- `internalNotificationSubscriber`: `TICKET_UPDATED`, `TICKET_COMMENT_ADDED` and `TICKET_COMMENT_UPDATED` with no `userId` create the expected notifications without throwing, with the author falling back to `comment.author` / "System".
- `ticketEmailSubscriber`: the accumulated-update email with no `userId` renders "System". An updater id with no user row never renders as a UUID.
- `inboundEmailOutboxDispatcher`: an outbox row with `userId === ticketId` publishes without `userId`.
- Integration (`slaSubscriber`): an inbound-email ticket created in a pausing status records the pause with `triggered_by` NULL and no FK error.
- Migration test: catalog rows lose `userId` from `required`, and re-running the migration changes nothing.

**Manual smoke** (inbound email, use `alga-inbound-email-testing`):

1. Send mail from an unmatched sender.
2. Confirm the `TICKET_CREATED` and `TICKET_COMMENT_ADDED` payloads (outbox row and workflow run input) have `actorType: 'SYSTEM'` and no `userId`.
3. Confirm in-app and email notifications still arrive with sensible author text.
4. Repeat from a known contact: expect `actorType: 'CONTACT'` and `actorContactId`.
5. A ticket created by an MSP user still carries `userId === actorUserId`.

## 5. Risks and open points

- **Tenant workflows reading `payload.userId`** now get `undefined` for user-less events instead of a ticket UUID. That is the intended result. Titles built from it are already guarded by #3641's `send_in_app` title guard. Expressions like `payload.userId.length` would error in the run (they would have produced junk before). Release note: use `payload.actorType` / `payload.actorUserId` / `payload.actorContactId`.
- **Events already in Redis streams at deploy** still carry the ticket id. Consumers handle them as today (lookups find no user). They are not rejected, which is why the scrub is not a schema refinement.
- **`reconcileCommentAttachments(trx, tenant, commentId, userId || author_id || '')`** (`ticketModel.ts:1568`) passes `''` as an actor id. This is not an event payload, so it is out of scope for this card. Note it during implementation and check what `actorId` is written to.
- **Duplicated helper files** (`packages/event-schemas` vs `packages/event-bus` `workflowEventPublishHelpers.ts`, and the mirrored ticket schemas) must change in lockstep. The existing `LEVERAGE: pattern ticket-event-schema-dup` marker already records this.
