# Plan: Board notification rules and board default watchers

Base: main @ 9e91b5e7e0, branch `feature/board-notification-rules-and-default-watchers`. All paths are relative to the worktree root.

## 1. Problem

Today, when a ticket arrives on a board (inbound email in particular), the MSP side hears about it only through assignment:

- The in-app `handleTicketCreated` (`server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts:80-226`) notifies the assignee. If the ticket is unassigned, it notifies the members of `assigned_team_id`, or failing that the board's `default_assigned_team_id`. If there is neither, it notifies nobody.
- The email `handleTicketCreated` (`server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts:935-1245`) emails the contact, the assignee and the active watchers. It never emails a team.

Boards that act as self-managed queues need two different things:

1. **A board notification rule (primary).** When a ticket is created on the board, or enters a given status on it, send a one-shot email and in-app notification to a set of internal users and teams. Nobody is assigned, and the recipients are not added to the watch list.
2. **Board default watchers (secondary).** When a ticket is created on the board, seed its watch list with chosen users. They then follow every update through the existing watcher path.

## 2. Answers to the open questions

| Question | Answer | Evidence |
|---|---|---|
| (a) Does Alga model board membership? | **No.** No table or column lists the techs who belong to a board. "Board members" therefore cannot be a recipient type. | The only user and team links on a board are four single-value columns: `default_assigned_to`, `default_assigned_team_id`, `manager_user_id` and `sla_policy_id`. Board-scoped tables are limited to `boards`, `standard_boards`, `board_close_rules`, `board_auto_close_rules` and `client_portal_visibility_group_boards`. Two mechanisms come close, and neither is a membership list. EE authorization bundles (`selected_boards` template, `packages/authorization/src/kernel/relationshipTemplates.ts:210-216`) restrict which tickets a role, team or user can see. Client portal visibility groups apply to contacts only. Teams are the closest thing to a group of techs, and they are a recipient type. |
| (b) Is there an existing per-board or rule-based notification mechanism to extend? | **No, so this is new storage.** Delivery reuses the existing ticket notification handlers. | The nearest relatives cover different needs. SLA escalation managers (`escalation_managers`) hold one user per board per escalation level and fire on SLA thresholds. `sla_notification_thresholds` holds boolean recipient flags, not lists. `rmm_alert_rules.actions.notifyUserIds` takes users only and fires on RMM alerts. The workflow `notifications.send_in_app` action bypasses templates and preferences. The per-board rule tables (`board_close_rules`, `board_auto_close_rules`, migration `20260610100000_create_ticket_close_rules_tables.cjs`) are the schema and UI precedent to follow. |
| (c) Expand teams when the rule is saved, or when a notification is sent? | **When it is sent.** The rule stores the `team_id`. Every send expands the team through `team_members`, joined to `users` with `is_inactive = false` and `user_type = 'internal'`. Membership changes therefore take effect immediately, and nothing is copied into the rule. | This is the same expansion as `TeamModel.getMembers` (`packages/teams/src/models/team.ts:114-131`). |
| Pickers | Rule recipients use `MultiUserAndTeamPicker` (`@alga-psa/ui/components/MultiUserAndTeamPicker`, with `values`/`teamValues`). Default watchers use `MultiUserPicker`. Status triggers use the existing `Checkbox`, one per board status, because `packages/ui` has no generic multi-select. | `MultiUserAndTeamPicker` already filters to active internal users and drops stale ids (lines 101-109). It is in use in `QuickAddTicket.tsx:1438`. |

## 3. Decisions

| Topic | Decision |
|---|---|
| Rule shape | A board has **zero or more rules**. Each rule has a trigger set and a recipient set. Triggers: `notify_on_create` (bool) plus zero or more statuses from that board. A rule must have at least one trigger and at least one recipient; the server action rejects anything else. |
| "Created on this board" | Fires on `TICKET_CREATED` when the created ticket's `board_id` matches. A ticket **moved** onto the board does not count as created. The status trigger covers that case, because a move always changes `status_id`; statuses are board-owned, per `20260314100000_add_board_ownership_to_ticket_statuses.cjs`. |
| "Entered status X" | Fires on `TICKET_STATUS_CHANGED` when `newStatusId` is one of the rule's statuses. Every status in a rule belongs to the rule's board, so the status alone identifies the board. Reopen, bounce-back, moves onto the board and inbound-reply reopen are all status transitions. **It does not fire at creation.** Creation is its own trigger, so a rule with both triggers sends exactly one notification for a ticket created straight into status X. |
| Recipients | Internal users and teams. Teams expand at send time (§2c). Inactive users, client users and the acting user are dropped. Across every rule that matches the same event, each recipient is notified at most once per channel. |
| Visibility filter | At send time, a recipient who cannot read the ticket is dropped. This uses RBAC `ticket:read` plus `authorizeTicketRecordAccess` (`packages/tickets/src/lib/ticketRecordAuthorization.ts:213`, which covers EE board-scoped bundles). A queue alert must not leak the title or client of a ticket the recipient cannot open. |
| Channels | Email and in-app, always both. A rule has no per-channel setting. Each user can mute either channel through the new notification subtypes (below), which follow the same preference model as every other ticket notification. |
| Watch list | Rule recipients are **never** written to `attributes.watch_list`. |
| No duplicates with standard notifications | A rule recipient who already gets the standard notification for the same change is skipped on that channel. On **create**: the assignee is skipped on both channels; members of the unassigned-team or board-default-team fallback are skipped in-app; active watchers are skipped on email. On **status entered**: the actor, the primary assignee and the additional agents (`getAllTicketAssignees`) are skipped on both channels, and active internal watchers are skipped on email. These people already receive `ticket-status-changed` or the ticket-updated email. |
| Templates | The rule uses new templates and subtypes, so a tech can mute queue alerts without muting their own assignment notifications. **In-app:** `ticket-board-created` and `ticket-board-status-entered`, category `tickets`. **Email:** templates `ticket-board-created` and `ticket-board-status-entered`, with subtypes `Board Ticket Created` and `Board Ticket Status Entered`, category `Tickets`. Every message names the board, and the status-entered message also names the status. |
| Suppression | `suppressInternalNotifications` on the event payload suppresses rule notifications on both channels. Contact suppression has no effect on them. |
| Delivery timing | Status-entered emails go out **immediately**, not through `NotificationAccumulator`. They are one-shot arrival alerts, not part of an update digest. |
| Default watchers | Internal users only, stored per board. When a ticket is created on the board, they are merged into `attributes.watch_list` with `entity_type: 'user'`, `entity_id`, `name` and `source: 'board_default'`. **No teams**, because the watch list stores individuals and expanding a team would freeze its membership at creation time. **No contacts**, because a board serves many clients, and a board-wide contact watcher would receive other clients' tickets. Moving a ticket onto the board does not seed watchers. |
| Permissions | Read and write use `ticket_settings` `read`/`update`, matching `updateBoard` (`packages/tickets/src/actions/board-actions/boardActions.ts:867`). |
| Event coverage | The rule applies to every ticket source. Several creation and status-change paths publish no event today (§4.3). They are fixed **as part of this card**, by moving them onto one after-commit publication helper rather than patching each call site separately. |

## 4. Grounding in existing code

### 4.1 Notification handlers

- In-app `handleTicketCreated` loads the ticket joined to `boards.default_assigned_team_id` (lines 91-109).
  - It notifies the assignee, or else the team members (lines 144-183).
  - It does not filter inactive team members (line 160) and ignores suppression flags.
- In-app `handleTicketUpdated` (769-966) maps `changes.status_id` to `ticket-status-changed` and notifies `getAllTicketAssignees` minus the actor. It never notifies watchers.
- Email `handleTicketCreated` uses a per-handler `sendIfUnique` closure that dedupes on normalized email (lines 1161-1178), then calls the module-private `sendNotificationIfEnabled(params, subtypeName, recipientUserId?)` (508-662). That function applies the tenant gate and, when a `recipientUserId` is given, the user's email preference. Watchers go through `sendOneEmailPerWatcher(..., { excludeEmails: sentEmails })` (`watcherRecipients.ts:42-66`).
- Email `handleTicketUpdated` routes through `NotificationAccumulator` when it is ready (lines 1263-1279).
- Both subscribers run inbound-outbox events through a Postgres consumer ledger:
  - email: `withInboundOutboxDelivery`, `ticketEmailSubscriber.ts:3349-3394`
  - in-app: `handleTransactionalOutboxDelivery`, `internalNotificationSubscriber.ts:3073-3180`
  - types listed in `INBOUND_OUTBOX_EVENT_TYPES`, `shared/services/email/inboundEmailConsumerDedupe.ts:59-65`

  Adding the create trigger to these existing handlers therefore inherits exactly-once (in-app) and bounded at-least-once (email) delivery for inbound-email tickets, which a new subscriber would otherwise have to rebuild.

### 4.2 Event plumbing

- `publishEvent` (`packages/event-bus/src/publishers/index.ts:76-132`) always publishes to the global channel.
  - It fans out to `internal-notifications` and the email channel only for the types in `INTERNAL_NOTIFICATION_EVENT_TYPES` and `EMAIL_EVENT_TYPES` (lines 29-74).
  - `TICKET_STATUS_CHANGED` is in neither list today; only the global webhook subscriber sees it.
- `TICKET_CREATED` and `TICKET_STATUS_CHANGED` payloads carry no `board_id` once parsed, because the zod schemas strip unknown keys.
  - Handlers reload the ticket.
  - The status handler derives the board from `statuses.board_id` of `newStatusId`.
  - `TICKET_STATUS_CHANGED`: `{ ticketId, previousStatusId, newStatusId, changedAt }` (`packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts:122`).
- `buildTicketTransitionWorkflowEvents` (`packages/tickets/src/lib/workflowTicketTransitionEvents.ts:40-156`) builds `TICKET_STATUS_CHANGED`, `TICKET_REOPENED`, `TICKET_QUEUE_CHANGED` and related events from before/after snapshots.
  - Only the MSP update paths call it.
  - Both of those publish the events **before commit**: `ticketActions.ts:1223` inside `db.transaction` (line 973), and `optimizedTicketActions.ts:2882`.
- Redis dedupe works per handler key, and a failed handler is re-run in full (`packages/event-bus/src/eventBus.ts:319-362, 540-579`). Every new subscription needs a unique `subscriberId`.

### 4.3 Coverage gaps (paths that publish nothing today)

**Creation without `TICKET_CREATED`**:
- workflow `tickets.create` (`shared/workflow/runtime/actions/businessOperations/tickets.ts:611`, passes an `undefined` publisher)
- Teams guest intake (`ee/packages/microsoft-teams/src/lib/teams/bot/teamsGuestIntake.ts:275`)
- inbound webhooks (`packages/tickets/src/actions/inboundActions.ts:130`)
- ticket-only service requests (`server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts:189`)
- telephony (`packages/integrations/src/actions/integrations/telephonyActions.ts:1297`, `packages/telephony/src/services/autoTicketFromCall.ts:63`)
- contract renewals (`packages/billing/src/actions/renewalsQueueActions.ts:1129`, `packages/jobs/src/lib/handlers/processRenewalQueueHandler.ts:170`)
- CSV import (`packages/tickets/src/actions/ticketImportActions.ts:788`)
- migration applier (`server/src/lib/migrations/appliers/entityAppliers.ts:292`)

**Status change without `TICKET_STATUS_CHANGED`**:
- inbound email reply reopen (`shared/services/email/processInboundEmailInApp.ts:536-595`, `applyInboundReplyReopenTransition`)
- bundle master reopen (`ticketBundleUtils.ts:244-296`)
- bundle attach reopen and child close (`ticketBundleUtils.ts:490-578`; publishes `TICKET_UPDATED` and `TICKET_REOPENED` only)
- client portal `updateTicketStatus` (`packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:896-1110`; publishes `TICKET_REOPENED` or `TICKET_UPDATED` only)
- REST `TicketService.update` (`server/src/lib/api/services/TicketService.ts:1843-2200`; publishes `TICKET_UPDATED` or `TICKET_CLOSED` only)
- workflow `tickets.update_fields`, `tickets.assign` and `tickets.close` (`tickets.ts:934, 1091, 1168-1260`)
- inbound webhook updates (`inboundActions.ts:222, 353`)

### 4.4 Ticket creation and watch list

- `TicketModel.createTicket` (`shared/models/ticketModel.ts:872-1063`) is the shared choke point for almost every creation path. It builds `attributes` at line 938, before `buildTicketCreateRow`.
- It publishes `TICKET_CREATED` only when an `eventPublisher` is passed (lines 997-1018).
- RMM (`shared/rmm/alerts/ticketCreator.ts:71`) and Huntress (`ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts:63`) insert rows directly and bypass it.
- Inbound email already seeds `attributes.watch_list` at creation (`processInboundEmailInApp.ts:1941-1945`), using `mergeTicketWatchListRecipients` and `setTicketWatchListOnAttributes` (`shared/lib/tickets/watchList.ts:192, 259`).

## 5. Design

### 5.1 Layering

```
Board editor "Notifications" section (rules + default watchers)            application
getBoardNotificationSettings / saveBoardNotificationSettings actions       orchestration
Ticket notification handlers (created / status-changed, email + in-app)    delivery
boardNotificationRules (match + expand + filter), boardDefaultWatchers     domain (new, shared)
ticket lifecycle publication (after-commit created / transition events)    engine (revised)
board_notification_rules*, board_default_watchers, watch_list              data
```

The revised engine layer is the important part. Event publication is currently opt-in at each call site:
- the `eventPublisher?` parameter on `createTicket` is optional;
- `buildTicketTransitionWorkflowEvents` is called by hand, before commit, on two paths only.

That is why so many paths are silent. This card turns it into a structural guarantee:

1. **`shared/lib/tickets/ticketLifecycleEvents.ts`** (new; the transition builder moves here from `packages/tickets`):
   - `buildTicketTransitionEvents(before, after, ctx)` is the existing builder, moved down a layer so that `shared/` callers (inbound email, bundles, workflow runtime) can use it. `packages/tickets/src/lib/workflowTicketTransitionEvents.ts` re-exports it, so its callers don't change.
   - `publishTicketTransitionsAfterCommit(trx, { tenant, before, after, actor, publisher })` builds the transition events and publishes them through `registerAfterCommit`. With an inbound-outbox publisher, it enqueues them on the outbox instead.
   - Every code path that writes `tickets.status_id` or `tickets.board_id` calls this helper. A contract test (§7) fails the build when a new write site skips it.
2. **`TicketModel.createTicket` stops treating event publication as optional.** The `eventPublisher` parameter becomes a required `TicketCreationEvents`, which is either an `IEventPublisher` or `silentTicketCreation(reason)`.
   - The silent option exists only for bulk historical data: CSV import and the migration applier.
   - Every other caller must pass a publisher, and the compiler enforces it.

### 5.2 Data model

One migration, `server/migrations/20261006120000_create_board_notification_rules.cjs`. It follows the `20260610100000_create_ticket_close_rules_tables.cjs` pattern:
- composite primary keys on `tenant`
- `ensureTenantDistribution` from `./utils/citusDistribution.cjs` before any foreign key
- tenant-composite foreign keys added through an `addForeignKeyIfMissing` guard
- `exports.config = { transaction: false }`

**`board_notification_rules`**, primary key `(tenant, rule_id)`:
- `board_id uuid not null`, foreign key to `boards(tenant, board_id)` `ON DELETE CASCADE`
- `notify_on_create boolean not null default false`
- `is_enabled boolean not null default true`
- `created_by uuid null`, `created_at`, `updated_at` (timestamptz)
- index `(tenant, board_id)`

**`board_notification_rule_statuses`**, primary key `(tenant, rule_id, status_id)`:
- `rule_id`, foreign key to the rule, `ON DELETE CASCADE`
- `status_id`, foreign key to `statuses(tenant, status_id)` with no cascade, so deleting a referenced status is blocked (§5.7)
- index `(tenant, status_id)`, used by the status-entered lookup

**`board_notification_rule_recipients`**, primary key `(tenant, recipient_id)`:
- `rule_id`, foreign key to the rule, `ON DELETE CASCADE`
- `recipient_type text not null`, `CHECK (recipient_type IN ('user','team'))`
- `user_id uuid null`, foreign key to `users`
- `team_id uuid null`, foreign key to `teams`
- `CHECK ((recipient_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL) OR (recipient_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL))`
- partial unique indexes on `(tenant, rule_id, user_id)` and `(tenant, rule_id, team_id)`

**`board_default_watchers`**, primary key `(tenant, board_id, user_id)`:
- foreign keys to `boards` (`ON DELETE CASCADE`) and to `users`
- `created_at`

Registration, in the same change:
- `packages/db/src/lib/tenantTableMetadata.ts`, next to `board_close_rules` (line 302)
- `server/migrations/utils/tenantDb.cjs` (line 285 area)
- the tenant-deletion table list in `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` (line 482 area), ordered children first

### 5.3 Domain layer (`shared/lib/tickets/`)

**`boardNotificationRules.ts`**:
- Types `BoardNotificationRule`, `BoardNotificationTrigger = { kind: 'created'; boardId } | { kind: 'status_entered'; statusId }` and `ResolvedRecipient = { userId, email, displayName }`.
- `loadMatchingRules(conn, tenant, trigger)`:
  - For `created`: enabled rules where `board_id = boardId` and `notify_on_create`.
  - For `status_entered`: enabled rules joined to `board_notification_rule_statuses` where `status_id = statusId`, and the rule's board equals `statuses.board_id`.
- `expandRuleRecipients(conn, tenant, rules)` unions the user recipients with the members of team recipients, read live from `team_members`. It keeps internal users with `is_inactive = false` and a valid email, and dedupes by `user_id`.
- `resolveBoardNotificationRecipients(conn, tenant, trigger, { excludeUserIds })` runs both steps above and applies the exclusions.
- All queries go through `tenantDb`. Unit-testable with a real database; there is no session dependency.

**`boardDefaultWatchers.ts`**:
- `loadBoardDefaultWatcherRecipients(conn, tenant, boardId)` returns `TicketWatchListRecipientInput[]` for active internal users, with `source: 'board_default'`.
- `applyBoardDefaultWatchers(conn, tenant, boardId, attributes)` returns the attributes with those recipients merged in through `mergeTicketWatchListRecipients`. Existing entries win, so an inbound To/Cc watcher keeps its source.

**`watchList.ts`**: add `'board_default'` to `TicketWatchListSource`.

**Server-side visibility filter**, in `server/src/lib/notifications/boardNotificationAudience.ts` (new):
- `filterRecipientsWhoCanReadTicket(db, tenant, ticketId, recipients)` loads each recipient with `getUserWithRoles` (`packages/db/src/lib/getUserWithRoles.ts:18`).
- It keeps those with `hasPermission(user, 'ticket', 'read')` who pass `authorizeTicketRecordAccess({ action: 'read' })`.
- It lives in `server/` because it depends on `@alga-psa/auth` and `@alga-psa/tickets`, which `shared/` must not import.

### 5.4 Delivery

**Create trigger.** Folded into the two existing `handleTicketCreated` handlers so that their dedupe and outbox-ledger semantics apply.

In-app (`internalNotificationSubscriber.ts` `handleTicketCreated`):
1. Collect the standard recipients into a `notifiedUserIds` set:
   - the assignee if there is one;
   - otherwise the team members, with `is_inactive = false` added to the query at line 160 as a fix in passing.
2. Unless `suppressInternalNotifications` is set:
   - resolve the rule recipients for `{ kind: 'created', boardId: ticket.board_id }`, excluding `notifiedUserIds` and the actor;
   - apply the visibility filter;
   - send `ticket-board-created` to each through `createNotificationFromTemplateInternal(db, …)`.
3. Use the handler's `opts.db`, so that the inbound-outbox transaction covers the rule sends.

Email (`ticketEmailSubscriber.ts` `handleTicketCreated`), after the assignee send and before the watcher loop:
- Resolve the same rule recipients, excluding the assignee and the actor.
- Apply the visibility filter.
- Send each through `sendIfUnique({...template: 'ticket-board-created', context: buildContext(internalUrl)}, 'Board Ticket Created', userId)`.
- Because `sentEmails` is shared, a rule recipient who is also a default watcher gets exactly one email.
- Suppression is checked with `shouldSendInternalTicketEmail`.

**Status-entered trigger.** There is no existing `TICKET_STATUS_CHANGED` handler, so the two new handlers below are the only consumers.

1. Add `TICKET_STATUS_CHANGED` to `INTERNAL_NOTIFICATION_EVENT_TYPES` and `EMAIL_EVENT_TYPES` (`packages/event-bus/src/publishers/index.ts:29-74`).
2. Add it to `INBOUND_OUTBOX_EVENT_TYPES`, so that inbound-reply reopens are recorded in the ledger.
3. Subscribe to it in both `registerInternalNotificationSubscriber` and `registerTicketEmailSubscriber`, and add a `case 'TICKET_STATUS_CHANGED'` to both dispatch switches.
4. Add `handleTicketStatusChanged(event, opts)` to the in-app subscriber, honouring `opts.db` and `opts.propagateErrors`, and `handleTicketStatusChanged(event)` to the email subscriber. Each handler:
   - Loads the ticket, the new status (name, `board_id`) and the board name. If the ticket's current `status_id` is no longer `newStatusId`, it **still sends**: the event records a real transition, and sending stays idempotent per event.
   - Resolves the rule recipients for `{ kind: 'status_entered', statusId: newStatusId }`. It excludes the actor and `getAllTicketAssignees`; the email handler also excludes the active internal watcher emails, through `resolveInternalWatcherEmails`.
   - Applies the visibility filter.
   - Sends `ticket-board-status-entered`: in-app through `createNotificationFromTemplateInternal`, email through `sendNotificationIfEnabled(..., 'Board Ticket Status Entered', userId)` directly, **bypassing the accumulator**.
5. Move the shared exclusion logic into a `getAllTicketAssignees` helper in `shared/lib/tickets/ticketAssignees.ts`. Both subscribers need it, and it is currently private to the in-app subscriber (lines 231-260).

**Templates.** One migration, `server/migrations/20261006120100_add_board_notification_templates.cjs`, modelled on `20260301120000_add_team_assignment_notification_templates.cjs`:

- In-app:
  - Add `ticket-board-created` and `ticket-board-status-entered` to `SUBTYPES` in `server/migrations/utils/templates/internal/categoriesAndSubtypes.cjs`, category `tickets`.
  - Add the templates to `server/migrations/utils/templates/internal/tickets.cjs`, with every locale (en, fr, es, de, nl, it, pl, pt, sv); `templateLocaleParity.test.ts` enforces this.
  - Data keys: `ticketId`, `ticketTitle`, `clientName`, `boardName`, and `statusName` for the status template.
- Email:
  - Add `Board Ticket Created` and `Board Ticket Status Entered` to `server/migrations/utils/templates/_shared/emailCategoriesAndSubtypes.cjs`.
  - Add template modules `server/migrations/utils/templates/email/tickets/ticketBoardCreated.cjs` and `ticketBoardStatusEntered.cjs`, built on `ticketCreated.cjs` and `wrapEmailLayout`, with every locale.
  - The status template adds `{{ticket.enteredStatus}}` and `{{ticket.previousStatus}}`.
- The migration calls `upsertCategoriesAndSubtypes`, `upsertInternalTemplates`, `upsertEmailCategoriesAndSubtypes` and `upsertEmailTemplate`.
- Seeds pick up the same modules: `server/seeds/dev/87_internal_notification_templates.cjs` and `server/seeds/dev/68_add_notification_templates.cjs`.
- Add both in-app templates to `TICKET_PUSH_TEMPLATES` (`server/src/lib/pushNotifications/pushNotificationDispatcher.ts:5-20`).
- Register the email template variables in `packages/notifications/src/lib/templateVariables/registry.ts` and `components/settings/emailTemplateSourceMap.ts`.

### 5.5 Default watchers on creation

- In `TicketModel.createTicket`, after `attributes` is built (line 938) and before `buildTicketCreateRow`, set `attributes = await applyBoardDefaultWatchers(trx, tenant, cleanedInput.board_id, attributes)`. This runs in the creating transaction, so the watch list exists before `TICKET_CREATED` is published.
- The existing email `handleTicketCreated` already emails internal watchers `ticket-created`, and every later update, comment and close email already includes them, so no delivery change is needed.
- The raw-insert creators (`shared/rmm/alerts/ticketCreator.ts:71`, `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts:63`) call `applyBoardDefaultWatchers` on the attributes they insert.
  - Mark both with `// LEVERAGE: pattern ticket-create-composition`, which is the existing slug, because they bypass `createTicket`.

### 5.6 Event coverage

**Status transitions.** Route each site in §4.3 through `publishTicketTransitionsAfterCommit`, using the publisher that matches its context:

- `applyInboundReplyReopenTransition`: inside the inbound transaction.
  - On the durable path, enqueue through `InboundEmailOutboxEventPublisher`, adding a `publishTicketStatusChanged` method next to `publishTicketUpdated` (`shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts:94`).
  - On the legacy path, publish after commit.
- `ticketBundleUtils.ts`: the master reopen (244-296) and the attach reopen / child close (490-578).
- Client portal `updateTicketStatus`.
- REST `TicketService.update`. Snapshot before and after inside the transaction and publish after it.
- Workflow `tickets.update_fields`, `tickets.assign` and `tickets.close`.
- `inboundActions.ts` updates.
- MSP `updateTicket` (`ticketActions.ts:1223`) and `updateTicketWithCache` (`optimizedTicketActions.ts:2882`): their existing inline, pre-commit transition publishing moves to after commit. This fixes phantom events from rolled-back transactions.

**Creation.** Pass a real publisher on every non-bulk path in §4.3: `TicketModelEventPublisher` where a transaction is available, otherwise `WorkflowEventPublisher`.
- CSV import and the migration applier pass `silentTicketCreation('bulk import of existing tickets')` and `silentTicketCreation('data migration')`.

**Workflow self-trigger guard.** Once workflow `tickets.create` publishes `TICKET_CREATED`, a workflow triggered by `TICKET_CREATED` that also creates a ticket would trigger itself.
- The publisher passes the run's `correlationId` as `options.workflow.executionId`, which reaches `execution_id` on the workflow stream (`packages/event-bus/src/eventBus.ts:853-870`).
- Workflow trigger matching (the consumer of `workflow:events:global`; `shared/workflow/persistence/workflowRuntimeEventModelV2.ts`) skips starting definition D for an event whose originating run belongs to D.
- It also refuses any event whose causation chain is deeper than 5.
- Both rules are covered by tests (§7).

### 5.7 Server actions, UI, lifecycle housekeeping

**Actions.** `packages/tickets/src/actions/board-actions/boardNotificationActions.ts`, all wrapped in `withAuth`:
- `getBoardNotificationSettings(boardId)` returns `{ rules: Array<{ rule_id, notify_on_create, status_ids, user_ids, team_ids, is_enabled }>, default_watcher_user_ids }`. Requires `ticket_settings:read`.
- `saveBoardNotificationSettings(boardId, input)` replaces the rules and default watchers in one transaction. Requires `ticket_settings:update`. It fails fast, with a descriptive error, when:
  - a rule has no trigger or no recipient;
  - a status is not a ticket status on this board;
  - a user is not an active internal user;
  - a team does not exist.
- Errors use `boardActionErrorFrom` (`boardActionErrors.ts`) for consistency with the other board actions.

**UI.** In `packages/tickets/src/components/settings/BoardsSettings.tsx`:
- Add a `notifications` section to the editor section list (line 380) and an `EditorAccordionSection` after `assignment`, titled "Notifications". Every interactive element gets a unique `id`.
  - **Notification rules:** each rule is a card with a "When a ticket is created on this board" `Checkbox`, a "When a ticket enters" group with one `Checkbox` per board status, a `MultiUserAndTeamPicker` for recipients (fed by the `users`, `teams` and avatar loaders the assignment section already uses), an enabled `Switch`, and a remove button. An "Add rule" button sits at the end.
  - A help line states that recipients get one notification per event and are not added as watchers.
  - **Default watchers:** a `MultiUserPicker` (internal users), with a help line saying they are added to the watch list of every new ticket on this board and receive every later update.
- Dirty tracking: add a `notifications` entry to `serializeSections()` (lines 1302-1307).
- Saving: `handleSaveBoard` calls `saveBoardNotificationSettings` after `updateBoard` and `createBoard`, the same way it calls the close-rule actions (lines 1068-1174). A new board saves its notification settings once it has a `board_id`.
- Strings: `t('ticketing.boards.editor.sections.notifications…')` in `msp/settings`, with keys added to `server/public/locales/<lang>/msp/settings.json` for every locale. Pseudo-locales are regenerated with `scripts/generate-pseudo-locales.cjs` and checked with `scripts/validate-translations.cjs`.

**Lifecycle**:
- **User deletion** removes the user's rows from `board_notification_rule_recipients` and `board_default_watchers`, alongside the existing reference cleanup in `packages/users/src/actions/user-actions/userActions.ts:762-773`.
- **Deactivated users** are filtered out at send time and when watchers are seeded; their rows stay.
- **Team deletion:** `packages/core/src/config/deletion/index.ts` gains a `board_notification_recipient` dependency on `board_notification_rule_recipients.team_id`, labelled "board notification rule". Deletion is blocked, as it already is for the board default team (line 390).
- **Status deletion:** the status dependencies (line 338) gain a `board_notification_rule_statuses.status_id` dependency, labelled "board notification rule", so deletion is blocked with a clear message rather than a foreign-key error.
- **Board deletion** cascades.

## 6. Implementation order

1. **Data:** migration §5.2, plus registration in `tenantTableMetadata.ts`, `tenantDb.cjs` and the tenant-deletion list.
2. **Domain:**
   - `shared/lib/tickets/boardNotificationRules.ts`, `boardDefaultWatchers.ts`, `ticketAssignees.ts`
   - add `'board_default'` to `watchList.ts`
   - `server/src/lib/notifications/boardNotificationAudience.ts`
3. **Templates:** migration §5.4, the template modules, seeds, push list and variable registry.
4. **Actions and UI:** `boardNotificationActions.ts`, the `BoardsSettings.tsx` section and locale keys.
5. **Default watcher seeding:** `TicketModel.createTicket`, plus the RMM and Huntress creators.
6. **Create trigger delivery:** both `handleTicketCreated` handlers.
7. **Lifecycle engine:**
   - Move the builder to `shared/lib/tickets/ticketLifecycleEvents.ts` and add `publishTicketTransitionsAfterCommit`.
   - Make the `createTicket` publisher argument required.
   - Fix the MSP pre-commit publishing.
8. **Status coverage:** the §5.6 status-transition sites, plus `TICKET_STATUS_CHANGED` fan-out and the outbox type.
9. **Status-entered delivery:** both `handleTicketStatusChanged` handlers and their registrations.
10. **Creation coverage:** the §5.6 creation sites and the workflow self-trigger guard.
11. **Housekeeping:** deletion dependencies and user-deletion cleanup (§5.7).

Steps 1-6 deliver the done-when criteria for inbound email and default watchers. Steps 7-10 extend the rule to every source.

## 7. Tests

**Unit**, run with `cd server && npx vitest run <path>`:

- `server/src/test/unit/tickets/boardDefaultWatchers.test.ts`
  - merge semantics: existing entries win
  - `source: 'board_default'`
  - inactive and client users dropped
- `shared/lib/tickets/__tests__/watchList.test.ts`: extend to accept the `board_default` source.
- `server/src/test/unit/tickets/ticketLifecycleEvents.test.ts`: the moved builder still emits the same events (port the existing cases), and `publishTicketTransitionsAfterCommit` publishes nothing when the transaction rolls back.
- `server/src/test/unit/tickets/ticketStatusWriteSites.contract.test.ts`:
  - scans `packages/`, `shared/`, `server/src/` and `ee/` (excluding tests) for updates to `tickets` that set `status_id` or `board_id`;
  - asserts that every such file is on an allowlist whose entries call `publishTicketTransitionsAfterCommit`;
  - so a new silent path fails CI.
- `server/src/test/unit/migrations/templateLocaleParity.test.ts`: already exists; it must pass with the new templates.
- `packages/tickets/src/components/settings/__tests__/BoardsSettingsNotifications.test.tsx` covers:
  - adding and removing a rule;
  - the trigger and recipient validation message;
  - the payload passed to `saveBoardNotificationSettings`;
  - unique element ids.

**Integration** (real database; requires the local test stack), run with `cd server && npx vitest run src/test/integration/<file>`:

- `boardNotificationRules.integration.test.ts`, for resolve plus expand:
  - The created trigger matches only its board.
  - The status trigger matches only its statuses.
  - Disabled rules are ignored.
  - A team is expanded at send time: add a member after saving the rule and that member is notified.
  - Inactive members are dropped.
  - A user named directly and through a team is notified once.
  - Each `excludeUserIds` entry is honoured.
- `boardNotificationActions.integration.test.ts`:
  - round-trips settings;
  - rejects a rule with no trigger or no recipient, a status from another board, a client user, and an unknown team;
  - enforces `ticket_settings` permissions;
  - deleting the board cascades.
- `boardNotificationCreateDelivery.integration.test.ts`. Call `handleTicketCreated` from both subscriber test harnesses, mocking `sendEventEmail` as `ticketCreatedSuppression.integration.test.ts` does, for an unassigned ticket on a board whose rule names users and a team:
  - Every listed tech gets one `ticket-board-created` email and one in-app notification.
  - `assigned_to` and `assigned_team_id` stay null.
  - `attributes.watch_list` is unchanged.
  - When a rule recipient is the assignee, they get only the standard `ticket-created`.
  - Board-default-team members are not notified twice in-app.
  - `suppressInternalNotifications` silences the rule.
  - A recipient denied by an EE board-scoped bundle is skipped.
- `boardNotificationStatusDelivery.integration.test.ts`:
  - `TICKET_STATUS_CHANGED` into a rule status notifies the recipients and skips the actor, the assignee and additional agents (and internal watchers on email).
  - Creation straight into that status does not fire the status trigger.
  - The email is sent immediately even when the accumulator is ready.
- `boardDefaultWatchers.integration.test.ts`:
  - Creating a ticket through `TicketModel.createTicket` on a board with default watchers stores them in the watch list.
  - A later `TICKET_UPDATED` is delivered to them through the accumulated update email.
  - An inbound-email ticket keeps both its To/Cc watchers and the defaults.
- `inboundEmailBoardNotification.integration.test.ts`. This is the done-when check, end to end through `processInboundEmailInApp`, on the durable outbox path:
  - A new email ticket on a board with a create rule notifies every listed tech by email and in-app, assigns nobody and leaves the watch list untouched.
  - Re-publishing the outbox event with `force` produces no duplicate in-app notifications.
  - A reply that reopens a closed ticket fires the status rule exactly once.
- `ticketStatusEventCoverage.integration.test.ts`: one case per §5.6 status site asserting that exactly one `TICKET_STATUS_CHANGED` is published after commit, and none on rollback. Sites: client portal status change, REST update, workflow `update_fields` and `close`, bundle reopen and inbound webhook update.
- `ticketCreatedEventCoverage.integration.test.ts`: one case per §5.6 creation site asserting that `TICKET_CREATED` is published, plus CSV import asserting that it is not.
- `workflowSelfTriggerGuard.integration.test.ts`:
  - A `TICKET_CREATED`-triggered definition whose step creates a ticket runs once, not recursively.
  - A chain deeper than 5 is refused.

**Manual smoke**, against the dev server at `http://feature-board-notification-rules-and-default-watchers.localhost:3085` (stack `alga-psa-local-test`), using the GreenMail flow from the `alga-inbound-email-testing` skill:
1. Settings › Ticketing › Boards › edit board › Notifications. Add a rule ("created") naming two techs and a team, and a second rule for status "New". Add an account manager as a default watcher. Save and reload; everything should persist.
2. Send an email into the board's mailbox. Each tech and team member gets the bell notification and a "New ticket on <board>" email. The ticket is unassigned. The watch list shows only the account manager (source `board_default`) and the inbound To/Cc addresses.
3. Close the ticket and reply from the client. Rule recipients get "entered New"; the account manager gets the standard update email.

**Before handoff:** `npm run lint` at the repo root, `npx tsc --noEmit -p server`, and the existing suites `ticketCreatedSuppression.integration.test.ts`, `internal-notifications/eventSubscribers.integration.test.ts`, `ticketEmailSubscriber.suppression.test.ts` and `ticketCloseRules.integration.test.ts`.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Making `createTicket` publish on more paths fires SLA start, webhooks and workflows for tickets that were silent before: workflow-, telephony-, renewal- and webhook-created tickets. | This is the intended correction: those tickets were missing SLA and search indexing. The workflow self-trigger guard and its test prevent recursion. Note the change in the release notes. |
| Moving the MSP transition publishing to after commit changes when workflow and webhook consumers see `TICKET_STATUS_CHANGED`. | It only removes phantom events from rolled-back transactions. Payloads are unchanged. Covered by `ticketLifecycleEvents.test.ts`. |
| Noise on busy boards. | One notification per recipient per event, and the subtypes can be muted per user. The rule never seeds watchers, so a ticket stops producing rule notifications once it leaves the trigger statuses. |
| Recipient expansion and authorization add queries per event. | Rules are looked up by indexed `(tenant, board_id)` and `(tenant, status_id)`. When no rule matches, the handlers return before running any authorization query. |
| Status-entered delivery on non-outbox paths is at-least-once; a handler that fails partway and is retried can duplicate in-app notifications. | This matches every other ticket notification today. Inbound-email events, the main use case, go through the exactly-once ledger. |
| `TICKET_STATUS_CHANGED` added to the notification channels reaches any handler subscribed to it there. | Only the two new handlers subscribe on those channels. The global webhook subscriber is unchanged. |
| A user is a rule recipient on one board and a default watcher on another. | Each is scoped to its own board, so there is no interaction. On the same board, the shared `sentEmails` set dedupes the email. |

## 9. Out of scope

- A "board members" recipient type. There is no membership model, and creating one is a separate feature.
- Per-rule channel selection (email only, or in-app only). Users mute channels through subtype preferences.
- Teams or client contacts as default watchers (see §3).
- Seeding default watchers when a ticket is moved onto a board, or removing them when it leaves.
- Exposing rules and default watchers in the REST API (`server/src/lib/api/schemas/board.ts`) or the mobile app.
- Copying rules when a board is duplicated.
- Rule triggers beyond "created" and "entered status": priority, category, SLA and time-in-status.
- The existing `createBoard` omission of `default_assigned_team_id` (`boardActions.ts:391-418`), and the duplicate `server/src/interfaces/board.interface.ts`. Both were noticed during research and are left for a separate fix.

## 10. Durable facts

1. Alga has no board membership model. Users and teams relate to a board only through `default_assigned_to`, `default_assigned_team_id`, `manager_user_id` and escalation managers. EE board-scoped authorization bundles restrict visibility; they are not membership.
2. No existing per-board notification-rule mechanism exists. The schema and UI precedent is `board_close_rules` and `board_auto_close_rules`.
3. Teams in board notification rules expand to active internal members **at send time**.
4. Rule storage:
   - `board_notification_rules`, with `notify_on_create`
   - `board_notification_rule_statuses`
   - `board_notification_rule_recipients`, with user or team rows
   - `board_default_watchers`, with users only, seeded into `attributes.watch_list` with `source: 'board_default'` inside `TicketModel.createTicket`
5. The create trigger is delivered inside the existing `handleTicketCreated` handlers (in-app and email), so it inherits their dedupe and the inbound-outbox ledger. The status trigger is delivered by new `TICKET_STATUS_CHANGED` handlers in both subscribers, which bypass the update accumulator.
6. The status trigger fires on `TICKET_STATUS_CHANGED`, never at creation. Statuses are board-owned, so `newStatusId` identifies the board.
7. New templates and subtypes:
   - in-app `ticket-board-created` and `ticket-board-status-entered`
   - email `Board Ticket Created` and `Board Ticket Status Entered`
8. Rule recipients who cannot read the ticket (RBAC plus `authorizeTicketRecordAccess`) are dropped at send time.
9. Ticket lifecycle publication becomes structural:
   - `createTicket` requires an explicit publisher or `silentTicketCreation(reason)`, used only by CSV import and migration;
   - every write to `status_id` or `board_id` goes through `publishTicketTransitionsAfterCommit`;
   - a contract test enforces the second rule.
