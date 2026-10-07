# Plan: Workflow and renewal tickets publish TICKET_CREATED

## 1. Problem

`TicketModel.createTicket` (`shared/models/ticketModel.ts:872`) publishes `TICKET_CREATED` only when the caller passes an `eventPublisher` (`:997-1016`). Four creators pass none:

| Creator | Location | Today |
|---|---|---|
| Workflow action `tickets.create` | `shared/workflow/runtime/actions/businessOperations/tickets.ts:574-695` | `TicketModel.createTicket(..., undefined, undefined, tx.actorUserId)` (`:611-635`). Writes tags and `ticket_resources` by hand. Writes no activity row. Publishes nothing. |
| Renewal job, workflow-action path | `packages/jobs/src/lib/handlers/processRenewalQueueHandler.ts:104-152`, called at `:523-554` | Borrows the tenant's most recently updated `workflow_runs.run_id` (`:331-345`) and calls `tickets.create` with it. `entered_by` becomes that unrelated run's actor. |
| Renewal job, direct fallback | same file `:154-188`, called at `:555-581` | `TicketModel.createTicketWithRetry` with no publisher, no `entered_by`, inside a raw `knex.transaction`. |
| Renewal queue "retry ticket" action | `packages/billing/src/actions/renewalsQueueActions.ts:990-1174` (create at `:1128-1149`) | Same as the fallback. A billing user clicks it, but `entered_by` stays null. |

The UI action `addTicket` (`packages/tickets/src/actions/ticketActions.ts:618-660`) and the REST service (`server/src/lib/api/services/TicketService.ts:1733`) do pass a publisher.

`TICKET_CREATED` drives these consumers, so tickets from the four creators above miss all of them:

- SLA start: `server/src/lib/eventBus/subscribers/slaSubscriber.ts:120`
- In-app notifications: `internalNotificationSubscriber.ts:80`
- Created email: `ticketEmailSubscriber.ts:935`
- Webhooks: `webhook/webhookEventMap.ts:20`
- Search indexing: `packages/search/src/indexers/ticket.ts:60`
- Event-triggered workflows: every default-channel publish also goes to `workflow:events:global` (`packages/event-bus/src/eventBus.ts:840-876`)

`TICKET_ASSIGNED` and `TICKET_ADDITIONAL_AGENT_ASSIGNED` are missing for the same reason.

## 2. Decisions

| Topic | Decision |
|---|---|
| Convergence target | All four creators call `createTicketWithSideEffects`. The service moves from `packages/tickets` down to `shared/services/tickets/` so every creator can reach it (§4.1). |
| After-commit publishing | All events go through `registerAfterCommit`. The workflow `withTenantTransaction` and both renewal transactions become owning `withTransaction` frames, so the hooks flush. |
| Actor: workflow runs | A new `{ type: 'workflow', userId, runId, workflowId, lineage }` actor. `entered_by` is the run actor (unchanged). The activity row uses `TICKET_ACTIVITY_ACTOR.WORKFLOW` / `TICKET_ACTIVITY_SOURCE.WORKFLOW`, matching `tickets.close` (`tickets.ts:1256`) and `tickets.apply_checklist` (`:1907`). Bus events use `actorType: 'USER'` with the run actor and carry `workflowRunId` and `workflowLineage`. This follows the existing convention for events from workflow actions (`clients.ts:897`). |
| Actor: scheduled renewals | `{ type: 'system' }`. `entered_by` stays **null**. The activity row and events carry a SYSTEM actor. |
| Actor: renewal retry action | `{ type: 'user', userId: user.user_id }`. `entered_by` is the billing user who clicked Retry. |
| `entered_by` for renewal tickets | See §4.7. A scheduled renewal has no human creator, so no user id is recorded. This keeps the rule in `createTicketWithSideEffects` ("no stand-in user id is ever invented") and the recurring-tickets decision (`docs/plans/2026-10-02-recurring-tickets-plan.md` §2). Inbound-email and recurring tickets already have null `entered_by`, and every reader left-joins it (`ticketEmailSubscriber.ts:294`). The workflow-action path that writes a borrowed `entered_by` is deleted. A user-initiated retry records the real user. |
| Renewal ticket audience | Renewal tickets are internal MSP work. They publish with `suppressContactNotifications: true`. Otherwise the client's primary email (`ticketEmailSubscriber.ts:972`) would receive "Renewal Decision Due…". Internal notifications stay on. |
| Workflow notification dedupe | `tickets.create` gains an optional `notify: { internal, contact }` input. These map to the existing `suppressInternalNotifications` / `suppressContactNotifications` payload flags. A migration sets `notify.internal = false` on existing steps in workflows that already send their own notifications (§4.5). SLA, search, webhooks and workflow triggers always fire. |
| Trigger loops | Workflow-created tickets can now trigger workflows. A lineage guard in the event-stream worker refuses to launch a workflow that is already in the event's ancestry (§4.6). |

## 3. Grounding: constraints found in the code

- **`shared` cannot import `@alga-psa/tickets`.** `tickets` depends on `shared`, so the import would create a cycle. `shared/rmm/alerts/ticketCreatedEvent.ts:12-18` already works around this, and `shared/rmm/alerts/__tests__/ticketCreatedEventUsage.contract.test.ts:12-16` pins the rule.
- **`billing` cannot import `tickets`.** Both are vertical packages, and `eslint-plugin-custom-rules/no-feature-to-feature-imports.js:1-15` reports the import as an error.
- **`jobs` can import `tickets`**, for example `autoCloseTicketsHandler.ts:5`. After the move, though, it imports from `shared` like the other creators.
- **`shared` cannot import `@alga-psa/tags`.** `tags` depends on `shared`. The service currently uses `TagDefinition`/`TagMapping` from `@alga-psa/tags`. The shared equivalent is `TagModel.getOrCreateTagDefinition` / `createTagMapping` (`shared/models/tagModel.ts:193-277`).
- **Workflow actions run inside a raw `knex.transaction`.** That happens in `withTenantTransaction` (`shared/workflow/runtime/actions/businessOperations/shared.ts:228-249`). `registerAfterCommit` hooks only flush from an owning `withTransaction` frame (`packages/db/src/lib/tenant.ts:216-235`, `afterCommit.ts:46-70`), so a hook registered there today is silently dropped. In production, `ctx.knex` is a root connection, not a transaction (`ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts:952-963`). An owning frame is therefore safe.
- **The event-bus actor enum is `USER | CONTACT | SYSTEM`** (`packages/event-schemas/src/schemas/domain/commonEventPayloadSchemas.ts:24`). It has no WORKFLOW value. The WORKFLOW actor exists only in the ticket-activity vocabulary (`shared/lib/ticketActivity/types.ts:78-101`).
- **Suppression is honoured only in part on `TICKET_CREATED`:**
  - In-app `handleTicketCreated` (`internalNotificationSubscriber.ts:80-224`) ignores both flags. It notifies the assignee or the dispatch team, plus the contact's portal user.
  - Email `handleTicketCreated` honours the contact flag (`:942`, `:972`) and the watcher flags (`:1213`). It ignores the internal flag for the assignee email (`:1195`).
  - The `TICKET_ASSIGNED` handlers honour both flags (`internalNotificationSubscriber.ts:301`).
  - The flags are already in the schemas (`ticketEventSchemas.ts:24-29`, `eventBusSchema.ts:545-548`).
- **The service has a latent conflict bug.** `assignTeamToTicketCore` inserts team members as `team_member` resources (`packages/tickets/src/lib/teamAssignmentCore.ts:95-121`). `addTicketResourceCore` then throws `conflict` for an agent who already has a resource (`ticketResourceCore.ts:106-117`). The recurring generator hits this today when an additional agent is also a member of the team. The workflow resolver avoids it by deduping (`tickets.ts:306-330`).
- **Event payloads reach the workflow worker unparsed.** `eventBus.ts:836` validates, then writes `fullEvent` as is. An added payload field therefore survives to `WorkflowRuntimeV2EventStreamWorker`.
- **Bus events launch workflows from one place:** `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts:310-430`. A run stores its trigger metadata in `workflow_runs.trigger_metadata_json` (`ee/packages/workflows/src/lib/workflowRunLauncher.ts:165-171`).
- **The two renewal sites duplicate the same builders.** `buildRenewalTicketIdempotencyKey`, `buildRenewalTicketTitle`, `buildRenewalTicketDescription` and the routing resolution are byte-identical in `processRenewalQueueHandler.ts:59-102, 466-469` and `renewalsQueueActions.ts:101-140, 1076-1079`.
- **No built-in workflow uses `tickets.create`.** No seed or template references it, so only tenant-authored workflows are affected.

## 4. Design

### 4.1 Layering: move the composition to `shared`

```
UI addTicket · REST · workflow tickets.create · renewal job · renewal retry · recurring generator   (creators)
shared/services/tickets/createTicketWithSideEffects                                               (domain service)
TicketModel · ticketActivity · ticketChecklists · assetTicketAssociation · TagModel                (shared model layer)
```

`TicketModel` already lives in `shared`, and the composition belongs beside it. A runtime registry for the workflow (like `workflowEmailRegistry.ts`) would fix only the workflow caller. It would not fix the billing caller, and it would add a global seam that both processes have to wire up. Moving the service fixes every caller.

These move into `shared/services/tickets/`. Update every importer and `vi.mock` path, and delete the old files: no re-export shims. `grep` for the old paths must return nothing.

| From (`packages/tickets/src/lib/`) | To (`shared/services/tickets/`) | Importers to update |
|---|---|---|
| `createTicketWithSideEffects.ts` | `createTicketWithSideEffects.ts` | `recurring/generateRecurringTicketsForTenant.ts:9`; the recurring integration test comment |
| `adapters/TicketModelEventPublisher.ts` | `ticketModelEventPublisher.ts` | 6 sites (`grep -rn "adapters/TicketModelEventPublisher"`) |
| `ticketResourceCore.ts` | `ticketResourceCore.ts` | 4 sites |
| `teamAssignmentCore.ts` | `teamAssignmentCore.ts` | 4 sites |
| `workflowTicketSlaStageEvents.ts` | `ticketSlaStageEvents.ts` | 10 sites |

`TicketModelAnalyticsTracker` is a no-op (`adapters/TicketModelAnalyticsTracker.ts:3-25`). The shared service passes no tracker and the adapter stays where it is.

`ticketSlaStageEvents.ts` needs `getSlaTarget` (`itilUtils.ts:125`) and the `ItilPriority` enum (`:28`). Move both into `shared/lib/itil/slaTargets.ts`. `itilUtils.ts` imports them from there and re-exports them, because it is a broad utility module whose public surface stays put.

Tags: replace `TagDefinition.getOrCreate` / `TagMapping.insert` with `TagModel.getOrCreateTagDefinition` / `createTagMapping`. Make `getOrCreateTagDefinition` race-safe with `insert … onConflict(['tenant','tag_text','tagged_type']).ignore()` followed by a re-read. Before relying on it, verify that unique index in the migrations. Do **not** copy the catch-23505-and-re-read pattern from `tagDefinition.ts:150-165`: in Postgres a failed insert aborts the enclosing transaction, so the re-read cannot run.

### 4.2 Actor model

```ts
export type CreateTicketActor =
  | { type: 'system' }
  | { type: 'user'; userId: string }
  | { type: 'workflow'; userId: string; runId: string; workflowId: string; lineage: string[] };
```

| | `system` | `user` | `workflow` |
|---|---|---|---|
| `tickets.entered_by` | null | `userId` | `userId` (run actor) |
| `actorUserId` passed to cores, tags, `updated_by` | null | `userId` | `userId` |
| Activity `actorType` / `source` | SYSTEM / SYSTEM | USER / UI | WORKFLOW (`userId`) / WORKFLOW |
| Bus actor | SYSTEM | USER `userId` | USER `userId` |
| Extra payload on **every** published event | none | none | `workflowRunId`, `workflowLineage: [...lineage, workflowId]` |

The service stops deriving the activity source from "is this a user". It builds actor, source, `entered_by` and provenance from the table above in one helper, `resolveActorEffects(actor)`.

### 4.3 `createTicketWithSideEffects` changes

In `shared/services/tickets/createTicketWithSideEffects.ts`:

1. Widen `notificationSuppression` to `{ suppressContactNotifications?: boolean; suppressInternalNotifications?: boolean }`. Spread both flags into `TICKET_CREATED` (through `TicketModelEventPublisher`'s `ticketCreatedPayload`), `TICKET_ASSIGNED`, and the agent events.
2. Merge the provenance payload (§4.2) into `TICKET_CREATED`, `TICKET_ASSIGNED`, every agent event, and the `TICKET_SLA_STAGE_ENTERED` payload.
3. Skip additional agents who already hold a `ticket_resources` row after the team step. Pre-filter against the rows `assignTeamToTicketCore` wrote rather than catching `conflict`. This fixes the latent bug in §3 for the recurring generator too.
4. Accept an optional `ticket.source`, and keep passing `ticket_origin` through unchanged.

The return value is unchanged.

### 4.4 Workflow action `tickets.create`

In `shared/workflow/runtime/actions/businessOperations/shared.ts`:

- `withTenantTransaction` (`:228`) opens the transaction with `withTransaction(knex, …)` from `@alga-psa/db` instead of `knex.transaction`. This makes the action frame own the commit and flush after-commit hooks. It applies to every workflow action. Today no action registers hooks on this `trx`, so behaviour changes only for code that registers hooks, and such hooks were being dropped.
- Extend `resolveRunActorUserId` (`:131`) into `resolveRunContext(trx, tenantId, runId)`. It returns `{ actorUserId, workflowId, lineage }`, where `lineage = trigger_metadata_json.workflowLineage ?? []`. Add `workflowId` and `lineage` to `TenantTxContext`.

In `tickets.ts`:

- Input schema: add the following.
  ```ts
  notify: z.object({
    internal: z.boolean().default(true),
    contact: withWorkflowExplicitChoice(z.boolean().default(false), …),
  }).optional()
  ```
  `contact` uses the comment-visibility precedent (`tickets.ts:35-46`). The runtime keeps the old behaviour when the field is absent (no customer email). The designer makes a new author choose explicitly.
- Handler (`:574-695`):
  1. Keep the permission check, attribute merge (`attributes.tags` mirror, `custom_fields`), status validation and `resolveWorkflowTicketAssignment`.
  2. Replace `TicketModel.createTicket` + `ensureTicketTagMappings` + `reconcileWorkflowTicketAdditionalUsers` (`:609-648`) with one call:
     ```ts
     createTicketWithSideEffects(tx.trx, tx.tenantId, {
       actor: { type: 'workflow', userId: tx.actorUserId, runId: ctx.runId, workflowId: tx.workflowId, lineage: tx.lineage },
       ticket: { ...fields, assigned_to: resolved.assignedTo, source: 'workflow', attributes: mergedAttributes },
       teamId: resolved.assignedTeamId,
       additionalAgentIds: resolved.additionalUsers.filter(u => u.role === 'support').map(u => u.userId),
       tags: normalizedTags,
       notificationSuppression: {
         suppressInternalNotifications: input.notify?.internal === false,
         suppressContactNotifications: input.notify?.contact !== true,
       },
     })
     ```
     The service adds team members through `assignTeamToTicketCore`. The workflow passes only explicit `support` agents, which keeps today's resolved set.
  3. Keep `initial_comment`, `attachments` and `writeRunAudit` as they are, now keyed on the returned `ticketId`.
  4. Map the output from the reloaded row. Keep `url`, `created_at` (`entered_at`), `status_id` and `priority_id` identical to today.
- Delete `ensureTicketTagMappings`, `generateTagColors` and `normalizeTicketTags` if nothing else uses them. `reconcileWorkflowTicketAdditionalUsers` stays: `tickets.assign` uses it.
- Remove the `LEVERAGE: pattern ticket-create-composition` marker at `:610`.

### 4.5 Duplicate-notification dedupe

**What duplicates.** Until now a workflow-created ticket fired no notification. Authors who wanted one added a `notifications.send_in_app`, `email.send` or (EE) `teams.notify_user` / `teams.send_dm` / `teams.post_to_channel` step. Once `TICKET_CREATED` fires, those assignees would get both. Nothing on a workflow-created ticket duplicates a system notification: `tickets.create` sends none itself, and the inbound-email action `createTicketFromEmail` is a separate path that is not touched.

**Detection** is static and runs once, in a migration over stored definitions. Name it `server/migrations/<ts>_stamp_workflow_ticket_create_notify.cjs` and follow `20260314130000_remap_workflow_ticket_status_references.cjs`, which walks `then/else/body/try/catch` and rewrites `step.config.inputMapping`:

- Apply it to both `workflow_definitions.draft_definition` and `workflow_definition_versions.definition_json`.
- For each definition, decide whether it contains an `action.call` step whose `actionId` is `notifications.send_in_app`, `email.send`, `teams.notify_user`, `teams.send_dm` or `teams.post_to_channel`, at any depth. (`slack.send_message` is not registered anywhere in the codebase, so it is not in the list.)
- For every `action.call` step with `actionId: 'tickets.create'` that has no `notify` key in `inputMapping`:
  - If the workflow sends its own notifications, set `inputMapping.notify = { internal: false, contact: false }`.
  - Otherwise, set `inputMapping.notify = { internal: true, contact: false }`.
- `down` removes `notify` only where the value is one of those two stamped literals.

**Dedupe** happens at delivery. The step's `notify` becomes `suppressInternalNotifications` / `suppressContactNotifications` on every event the service publishes. Subscribers skip the suppressed audiences (§4.8). The events themselves are always published, so SLA, search, webhooks and workflow triggers are unaffected.

A stamped `internal: false` keeps today's behaviour exactly, and it shows in the designer. Authors can turn it on and delete their hand-made step. A workflow that notifies about something unrelated keeps today's silence on the ticket. That is the conservative outcome.

Contact-facing mail stays off for every existing step. Customers do not start receiving "ticket created" emails because of a platform change.

Before writing the literal object, the implementer confirms the literal-value shape that `resolveMappingValue` (`shared/workflow/runtime/utils/mappingResolver.ts`) accepts.

### 4.6 Trigger-loop guard

Without a guard, "on `TICKET_CREATED` → `tickets.create`" re-triggers itself forever. The same happens for A→B→A chains, and for `TICKET_ASSIGNED`-triggered workflows that create assigned tickets.

- **Schema.** Add `workflowLineage: z.array(uuid).optional()` and `workflowRunId: uuid.optional()` to `BaseDomainEventPayloadSchema` (`packages/event-schemas/src/schemas/domain/commonEventPayloadSchemas.ts:26`). Mirror them in the runtime copy `shared/workflow/runtime/schemas/commonEventPayloadSchemas.ts`, which is pinned to zod 3.22.4.
- **Worker** (`WorkflowRuntimeV2EventStreamWorker.ts:311-430`):
  - Read `lineage = payload.workflowLineage ?? []` from the raw event payload.
  - Skip any matching workflow whose `workflow_id` is in `lineage`. Log it, and add `skipStats.workflowCycle`.
  - When launching, add `workflowLineage: lineage` to `triggerMetadata`.
- **Action.** `resolveRunContext` reads that lineage back. The service stamps `[...lineage, workflowId]` on what it publishes.

The workflow set is finite, so ancestry membership bounds every chain and no depth constant is needed. Non-cyclic chains (A→B) still run.

### 4.7 Renewal creators

**Shared composer** (`shared/billingClients/renewalTicket.ts`, new):

- Move `buildRenewalTicketIdempotencyKey`, `buildRenewalTicketTitle`, `buildRenewalTicketDescription`, `RENEWAL_TICKET_SOURCE` and a `resolveRenewalTicketRouting(row, useTenantDefaults)` here from both sites.
- Add the following.
  ```ts
  createRenewalTicket(trx, tenant, { row, normalized, decisionDueDate, cycleKey, routing, actor })
  ```
  It calls `createTicketWithSideEffects` with:
  - `ticket.source: 'renewal_due_date_automation'`
  - `assigned_to: routing.assignedTo`
  - the attributes `renewal_cycle_key`, `decision_due_date`, `source_client_contract_id` and `idempotency_key`
  - `notificationSuppression: { suppressContactNotifications: true }`

**Job** (`processRenewalQueueHandler.ts`):

- Delete `tryCreateRenewalTicketViaWorkflowAction` (`:104-152`), the `workflow_runs` lookup (`:331-345`), the `hasWorkflowRunsTable` check (`:234, :265`), the workflow counters, and the imports of `@alga-psa/workflows/runtime` and `TicketModel`.
- Delete `createRenewalTicketDirectly` (`:154-188`).
- At `:555-581`, call `withTransaction(knex, trx => createRenewalTicket(trx, tenantId, { …, actor: { type: 'system' } }))`.
- Keep the idempotency lookup (`:504-522`) and the `client_contracts` update as they are.

**Retry action** (`renewalsQueueActions.ts:990-1174`):

- Replace `knex.transaction` (`:1004`) with `withTransaction(knex, …)`.
- Replace `TicketModel.createTicketWithRetry` (`:1128-1149`) with `createRenewalTicket(trx, tenant, { …, actor: { type: 'user', userId: user.user_id } })`.
- Use the shared builders.
- Remove both `LEVERAGE` markers.

**`entered_by`.** Scheduled renewals stay null. Record the SYSTEM attribution in the activity row (`actor_type = 'system'`, `source = 'system'`) and in the events. The retry path records the clicking user.

If the captain wants a non-null creator on scheduled renewals as well, there is no truthful user to record. The renewal assignee is not the creator, and settings authorship is not tracked. That change would also reverse the rule the recurring-tickets plan settled. Keep it a separate, explicit decision.

### 4.8 Subscribers honour suppression on `TICKET_CREATED`

- **`internalNotificationSubscriber.ts:80`.** Resolve `resolveTicketNotificationSuppression(payload)`. Gate the assignee/dispatch-team notifications (`:144-183`) on `shouldCreateStaffTicketNotification`, and the contact portal notification (`:185-214`) on `shouldCreateContactPortalTicketNotification`.
- **`ticketEmailSubscriber.ts:935`.** Gate the assignee email (`:1195-1206`) on `shouldSendInternalTicketEmail(suppression)`. Update the early-return recipient check (`:977-986`) so a fully suppressed event returns quietly.

This is a general fix. Today no creator sets the internal flag on create, so no current behaviour changes.

## 5. Order of work

1. `shared/lib/itil/slaTargets.ts`: move `ItilPriority` and `getSlaTarget`, and re-export them from `itilUtils.ts`.
2. Move the five modules (§4.1) to `shared/services/tickets/`, update importers and mocks, and delete the originals. Swap tags to `TagModel` and make `getOrCreateTagDefinition` race-safe. Build `shared` and `tickets`, then run the recurring tests (§6) before you change any behaviour.
3. Service changes (§4.2, §4.3): the actor union, `resolveActorEffects`, both suppression flags, provenance stamping, and the agent pre-filter.
4. Event schemas: `workflowLineage` and `workflowRunId` in both `commonEventPayloadSchemas.ts` copies.
5. Subscribers (§4.8).
6. Workflow runtime: `withTenantTransaction` → `withTransaction`, `resolveRunContext`, `TenantTxContext`.
7. `tickets.create` (§4.4): the `notify` input and the handler rewrite.
8. Worker lineage guard (§4.6).
9. The `stamp_workflow_ticket_create_notify` migration (§4.5).
10. `shared/billingClients/renewalTicket.ts`, then the renewal job, then the retry action (§4.7).
11. Update the tests that pin the old wiring (§6), then add the new ones.

## 6. Tests

**Update** (they pin removed code):

- `server/src/lib/jobs/tests/renewalQueueScheduling.wiring.test.ts:103-111`: the workflow-action path. Assert `createRenewalTicket` with a system actor instead.
- `packages/jobs/src/lib/handlers/processRenewalQueueHandlerTenantScoped.contract.test.ts:16`: the `workflow_runs` root.
- `server/src/test/unit/jobs/processRenewalQueueHandler.test.ts`: mocks `@alga-psa/workflows/runtime` and `TicketModel` (`:38-60`). Mock `createRenewalTicket` instead. Drop the `workflowRun` fixture.
- `packages/billing/tests/renewalsQueueActions.retryTicket.wiring.test.ts:11,18`.
- `server/src/test/unit/workflowTicketAssignmentModelRuntime.test.ts` T002 (`:398`): resources now come from the service.
- `shared/workflow/runtime/actions/__tests__/ticketWorkflowBoardStatusRuntime.test.ts`, if it asserts `TicketModel.createTicket`.

**New unit tests** (vitest):

- `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts`:
  - An event whose `workflowLineage` contains workflow W does not launch W, but does launch an unrelated matching workflow V.
  - V's `triggerMetadata.workflowLineage` equals the event lineage.
- `server/src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.suppression.test.ts`: `TICKET_CREATED` with `suppressInternalNotifications` creates no assignee or dispatch notification. With `suppressContactNotifications`, it creates no portal notification.
- `server/src/lib/eventBus/subscribers/__tests__/ticketEmailSubscriber.suppression.test.ts`: `TICKET_CREATED` with `suppressInternalNotifications` sends no assignee email.
- `server/src/test/unit/migrations/stampWorkflowTicketCreateNotify.test.ts`: exercise the pure visitor exported from the migration. Cover nested `tickets.create` under `try`/`then`, a workflow with `notifications.send_in_app` versus one without, an existing `notify` left alone, and a `down` round-trip.
- `shared/billingClients/__tests__/renewalTicket.test.ts`:
  - The builders return today's exact strings.
  - The routing precedence is tenant defaults versus contract override.

**New integration tests** (real DB). Use the `integration-testing` skill and copy the event capture from `server/src/test/integration/recurringTicketGenerator.integration.test.ts:14-30`.

- `server/src/test/integration/workflowTicketCreateEvents.integration.test.ts`. Seed a workflow run with an actor and `trigger_metadata_json.workflowLineage = [A]`, then call the registered `tickets.create` handler. Check that:
  - **User primary:** `entered_by` is the run actor, `source` is `workflow`, and the activity row has `actor_type = 'workflow'`, `source = 'workflow'`. `TICKET_CREATED` and `TICKET_ASSIGNED` are captured after commit, each with `workflowRunId` and `workflowLineage = [A, W]`.
  - **Team primary plus an explicit agent who is also a team member:** there is no conflict. Team members are `team_member`, and the explicit non-member is `support` with one `TICKET_ADDITIONAL_AGENT_ASSIGNED`.
  - **`notify` mapping:** `notify` absent gives `suppressContactNotifications: true` and `suppressInternalNotifications: false`. `{ internal: false }` sets the internal flag. `{ contact: true }` clears the contact flag.
  - **Rollback:** an attachment that fails after the ticket insert rolls back the transaction, and nothing is captured.
  - **Tags:** they land in `tag_mappings` and in `attributes.tags`.
- `server/src/test/integration/renewalTicketEvents.integration.test.ts`:
  - **Job:** seed a due contract with tenant routing that includes an assignee, plus an unrelated `workflow_runs` row. Run `processRenewalQueueHandler`. The ticket has `entered_by` null and `source` `renewal_due_date_automation`, the activity row is SYSTEM/SYSTEM, and `client_contracts.created_ticket_id` is linked. One `TICKET_CREATED` is captured with a SYSTEM actor and `suppressContactNotifications: true`, plus one `TICKET_ASSIGNED`. Running the job again creates no ticket and captures no event.
  - **Retry action:** a failed work item retried as a billing user gets `entered_by` set to that user and USER-actor events.
- Re-run `recurringTicketGenerator.integration.test.ts` unchanged. Add a case where the definition's additional agent is a team member: the ticket is created, and the occurrence does not fail.

**How to run.** Start the test DB (`docker-compose.test-citus.yaml`, or the worktree's `alga-psa-local-test` stack).

```bash
# unit
cd server && npx vitest run src/test/unit/jobs/processRenewalQueueHandler.test.ts src/test/unit/workflowTicketAssignmentModelRuntime.test.ts src/lib/eventBus/subscribers/__tests__ src/test/unit/migrations/stampWorkflowTicketCreateNotify.test.ts src/lib/jobs/tests/renewalQueueScheduling.wiring.test.ts
cd services/workflow-worker && npx vitest run src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts
cd shared && npx vitest run billingClients rmm/alerts workflow/runtime/actions/__tests__/ticketWorkflowBoardStatusRuntime.test.ts
cd packages/jobs && npx vitest run && cd ../billing && npx vitest run tests/renewalsQueueActions.retryTicket.wiring.test.ts
# integration
cd server && npx vitest run src/test/integration/workflowTicketCreateEvents.integration.test.ts src/test/integration/renewalTicketEvents.integration.test.ts src/test/integration/recurringTicketGenerator.integration.test.ts --coverage.enabled=false
```

**Build gates:**

- `npm run build`, CE and EE
- lint for `shared`, `packages/tickets`, `packages/billing`, `packages/jobs` and `services/workflow-worker` (this includes `no-feature-to-feature-imports`)
- the migration up and down on the Citus test DB

## 7. Risks

| Risk | Mitigation |
|---|---|
| A tenant workflow loops on its own `TICKET_CREATED`. | Lineage guard (§4.6), with a worker unit test. |
| Assignees get duplicate notifications from workflows with hand-made notification steps. | The migration stamps `notify.internal = false` on those workflows (§4.5). |
| Customers start receiving "ticket created" emails from workflow or renewal tickets. | Contact flag off for all existing workflow steps and for every renewal ticket. New workflow steps must choose explicitly. |
| A workflow-created ticket now produces both a "ticket-created" and a "ticket-assigned" notification for the assignee. | This matches the UI `addTicket` today (`ticketActions.ts:618-660`). It is intended parity, not duplication. |
| Moving modules breaks `vi.mock` paths in existing tests. | Step 2 lands first with no behaviour change and a full test run. `grep` for the old paths returns nothing. |
| `withTenantTransaction` now owns its frame for every workflow action. | `ctx.knex` is a root connection in both the Temporal and workflow-worker executors. Behaviour differs only by flushing hooks, which were being dropped. |
| After a commit, a Temporal activity crash before the invocation ledger is marked `SUCCEEDED` re-runs the action. That creates a second ticket and a second event. | This already happens today (the duplicate ticket). It is unchanged here and listed in §8. |
| The renewal job's ticket and `client_contracts` link commit separately. | Unchanged. The idempotency-key lookup links the existing ticket on the next run, and no second event fires because no ticket is created. |
| Admins see many definitions change at once in the migration. | Only steps that lack `notify` are touched. Each change keeps today's delivery exactly. |

## 8. Out of scope

- **Converging UI `addTicket` and REST `TicketService.createTicket` onto the service.** Their `LEVERAGE` marker at `ticketActions.ts:622` stays.
- **Events from other workflow ticket actions.** `tickets.update_fields`, `assign`, `close` and `add_comment` publish nothing today. The `tickets.create` initial comment also stays event-free, because the created email covers it.
- **A WORKFLOW actor type on the event bus.** It changes three zod copies and every consumer's actor handling. Provenance travels in `workflowRunId`/`workflowLineage` and in the activity row.
- **Lineage stamping for other workflow actions that publish** (`clients.ts`, `contacts.ts`, `crm.ts`, `scheduling.ts`, `opportunities.ts`).
- **Merging `shared/workflow/adapters/workflowEventPublisher.ts` with `TicketModelEventPublisher`.** Mark it with `// LEVERAGE: pattern ticket-event-publisher`.
- **The `tickets.create` idempotency gap on activity retry**, and the deadlock retry inside one transaction (`TicketModel.createTicketWithRetry` retries on an aborted transaction).
- **A dedicated `renewal` ticket origin or badge.**
- **Showing "System" as the creator in ticket lists when `entered_by` is null.**
