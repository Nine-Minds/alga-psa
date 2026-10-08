# Plan: Show who last updated a ticket

- **Date:** 2026-10-07
- **Card:** 592de458, "Ticket has last update but not by whom"
- **Branch:** `feature/ticket-has-last-update-but-not-by-whom` (base `main` @ `6e3fe1190a`)
- **Status:** design. Nothing is implemented yet.

## 1. Problem

The MSP ticket screens show *when* a ticket last changed but never *who* changed it.

- **Ticket detail header** shows `Created <time>` and `Updated <time>` from `tickets.entered_at` / `tickets.updated_at`. See `packages/tickets/src/components/ticket/TicketDetails.tsx:3843-3861`, with the relative-time strings built at `:1507-1521`. Both the classic and Bento layouts render this header, because it sits above the layout switch at `:4262`.
- **Ticket list** has an optional **Last Activity** column (`packages/tickets/src/lib/ticket-columns.tsx:658-672`, catalog entry `packages/tickets/src/lib/ticketColumnCatalog.ts:56`, off by default). It renders `latest_activity_at`, which is `GREATEST(t.updated_at, t.entered_at, newest published comment.created_at)`. That expression is `TICKET_LATEST_ACTIVITY_SQL` in `packages/tickets/src/actions/ticketListSortSql.ts:23-46` and is selected at `packages/tickets/src/actions/optimizedTicketActions.ts:1929`.

## 2. What the code and data already have

### 2.1 `tickets.updated_by` already exists, but most writers don't maintain it

- The column has been in the schema since the initial migration: `server/migrations/202409071803_initial_schema.cjs:261` (`uuid`, nullable, no FK, no trigger on `tickets`).
- It is already typed (`packages/types/src/interfaces/ticket.interfaces.ts:55`), selected by the list query (`optimizedTicketActions.ts:1893`), part of the REST schema (`server/src/lib/api/schemas/ticket.ts:266`), and exported as **Updated By** in CSV (`packages/tickets/src/actions/ticketExportActions.ts:116-148`).

The two main MSP write paths set **neither** `updated_by` **nor** `updated_at` on the server:

| Path | Where the row is written | What it stamps |
|---|---|---|
| Detail-page field edits and the Save bar: `TicketDetailsContainer.tsx:197,237` → `updateTicketWithCache` → `updateTicketInTransaction` | `optimizedTicketActions.ts:2840-2843` and `:2856-2859`, `.update(updateData)` | nothing |
| Server action `updateTicket` (description edit, quick-add, suppressed-notification saves) | `packages/tickets/src/actions/ticketActions.ts:1171-1174`, `.update(updateData)` | only what the client sends |
| `TicketModel.updateTicket` (workflows, inbound webhooks) | `shared/models/ticketModel.ts:1222-1227` | `updated_at: new Date()`. `updated_by` only if the caller puts it in `input`; the `userId` parameter at `:1130` is used only for the event. |

`updated_at` is also **accepted from the client**. `ticketUpdateSchema` (`packages/tickets/src/schemas/ticket.schema.ts:76-83`) omits neither `updated_at` nor `updated_by`. The browser supplies its own clock in `TicketDetails.tsx:2528-2531`, `ticket/ticketDescriptionUpdate.ts:47-50` and `QuickAddTicket.tsx:897-903`.

The local `alga-psa-local-test` database shows the effect:

- 778 tickets in total. 288 were modified after creation; 209 of those have `updated_by IS NULL`.
- 79 tickets have UI-sourced field changes in `ticket_audit_logs`. For 25 of them, `tickets.updated_at` is more than 5 s *older* than the newest such change. The **Updated** timestamp on screen is already wrong, not just missing its actor.

The writers below already do it right, and they are the pattern to follow:

- REST `TicketService.update`: `server/src/lib/api/services/TicketService.ts:2014-2018` (`updated_by: context.userId, updated_at: knex.raw('now()')`)
- inbound-email reopen: `shared/services/email/processInboundEmailInApp.ts:561-570`
- client portal: `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:1022-1023`
- bundles: `ticketBundleUtils.ts`, `ticketBundleActions.ts`
- team and resource assignment: `teamAssignmentCore.ts:92,164`, `ticketResourceCore.ts:77`
- assets: `assetActions.ts:2681`
- time entries: `timeEntryCrudActions.ts:726-729`
- workflow time-domain and ticket ops: `timeDomain.ts:855-858`, `businessOperations/tickets.ts:950,1096,1270`

### 2.2 The activity log has richer actors, but it is not a substitute

`ticket_audit_logs` (`server/migrations/20260525231145_create_ticket_audit_logs.cjs`, helpers in `shared/lib/ticketActivity/`) records `actor_type` (user, contact, system, api, email_sender, workflow), `actor_user_id`, `actor_contact_id`, `actor_display_name` and `source`. It is written in the same transaction as most mutations.

This plan does **not** derive "last updated by" from it, for three reasons:

1. **It doesn't record every edit.** It logs only `CURATED_TICKET_FIELDS` (`shared/lib/ticketActivity/types.ts:110-126`), so an edit to the description or other attributes writes no row. Its newest actor would then disagree with `updated_at`.
2. **Its rows don't line up with the header timestamp.** The header pairs a time with a name. Both must come from the same write, and only the `tickets` row guarantees that.
3. **The column bug has other victims.** `updated_by` and `updated_at` are already served by REST, by CSV export, and by the `updated_at` sort. Reading the actor from the log would leave all three wrong.

The activity log stays the per-event history. This plan fixes the existing `tickets` columns and reads from them.

### 2.3 Comments carry their own author

`comments` has `user_id`, `contact_id`, `author_type` (`internal|client|unknown`), `is_system_generated` and `metadata.email` (sender of unmatched inbound mail). Adding a comment does **not** touch `tickets.updated_at`; it changes only `response_state` (`comment-actions/commentActions.ts:165-167`). That is why the list's Last Activity takes the max of the ticket timestamps and the newest comment. `CommentItem.getAuthorName` (`ticket/CommentItem.tsx:79-113, 229-239`) already resolves a display name for each of those author shapes.

## 3. Design

### 3.1 Rule

Any write that bumps `tickets.updated_at` **also sets** `tickets.updated_by`, in the same `UPDATE`. The value is the acting user's id, or `NULL` when no user acted (system job, RMM or Huntress integration, inbound webhook, or inbound email without a matched user). Writing `NULL` explicitly matters: it prevents a system edit from leaving the previous human's id in place.

Bookkeeping writes don't bump either column: `response_state`, `sla_*`, `escalated*`, `email_metadata`, `is_closed`/`closed_*` follow-ups inside an already-stamped transaction, and `sla_policy_id` cleanup. This keeps an SLA tick from replacing the human who last edited the ticket.

Both columns are server-owned. Clients can no longer send them.

### 3.2 Write side

1. **Add one stamp helper** in `shared/lib/tickets/ticketUpdateStamp.ts` (the directory already exists):
   ```ts
   export function ticketUpdateStamp(knex: Knex | Knex.Transaction, actorUserId: string | null) {
     return { updated_at: knex.fn.now(), updated_by: actorUserId };
   }
   ```
   `actorUserId` is required, with no default, so every call site has to state its actor. It uses DB `now()`, matching `TicketService.ts:2017`.

2. **Make the columns server-owned.** Add `updated_at: true, updated_by: true` to the `.omit` in `ticketUpdateSchema` (`packages/tickets/src/schemas/ticket.schema.ts:76-83`). Zod strips unknown keys, so an old client that still sends them is silently ignored. Remove the client-sent `updated_at` at `TicketDetails.tsx:2530`, `ticketDescriptionUpdate.ts:49` and `QuickAddTicket.tsx:902`.

3. **Stamp the two main MSP paths.**
   - `updateTicketInTransaction` (`optimizedTicketActions.ts:2840-2859`): spread `ticketUpdateStamp(trx, isSystemActor ? null : user.user_id)` into `updateData` before both `.update(...)` calls. `isSystemActor` is computed at `:2729`. The auto-close job passes `SYSTEM_ACTOR_USER` with `user_id: null` (`packages/jobs/src/lib/handlers/autoCloseTicketsHandler.ts:54-60, 377-393`). This one change covers detail-page edits, the Save bar, and auto-close.
   - `ticketActions.updateTicket` (`ticketActions.ts:1171-1174`): spread `ticketUpdateStamp(trx, user.user_id)`.

4. **Fix `TicketModel.updateTicket`** (`shared/models/ticketModel.ts:1222-1227`). Replace `updated_at: new Date()` with `...ticketUpdateStamp(trx, input.updated_by ?? userId ?? null)`. Workflow callers already pass `updated_by: tx.actorUserId` in `input` (`businessOperations/tickets.ts:950,1096`). Inbound webhooks (`packages/tickets/src/actions/inboundActions.ts:222,353`) pass nothing, which correctly yields `NULL`. Drop `updated_by` from the model's update-input exclusion note at `:517` only if it blocks this; it describes create, not update.

5. **Sweep the raw writers that bump `updated_at` without `updated_by`.** Each one switches to the helper:

   | Site | Actor |
   |---|---|
   | `shared/workflow/runtime/actions/businessOperations/contacts.ts:1470` | `tx.actorUserId` |
   | `shared/workflow/runtime/actions/businessOperations/clients.ts:1933-1946` | `tx.actorUserId` |
   | `shared/rmm/alerts/processRmmAlertEvent.ts:371` | `null` |
   | `ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts:216` | `null` |
   | `shared/services/email/inboundEmbeddedImageUrlRewrite.ts:224` | `null` |

   Then re-run this grep and confirm every hit either uses the helper or falls under the bookkeeping rule in §3.1:
   ```
   grep -rn -A4 -E "('tickets'|table\('tickets'\))" packages shared server/src ee/server/src | grep "\.update("
   ```
   `-A4` is too short for multi-line `.update({ ... })` payloads and the hit often does not show `updated_at` (it missed the `email_metadata` write in `sendEventEmail.ts`). Also run this wider check, which lists every non-test `tickets` write whose payload sets `updated_at` without `updated_by` or `ticketUpdateStamp`; each hit must be fixed or be a non-ticket table (false positive):
   ```
   grep -rn -A14 -E "['\"]tickets(\s+as\s+\w+)?['\"]" packages shared server/src ee/server/src --include=*.ts --include=*.tsx | grep -v -E "test|spec|migrations" | grep -E "updated_at"
   ```
   Then confirm each remaining hit also has `updated_by`/`ticketUpdateStamp` within its `.update({...})` payload. `server/src/lib/notifications/sendEventEmail.ts` (`email_metadata`) must not write `updated_at`.
   Re-check `huntress/incidentProcessor.ts:277` and `processRmmAlertEvent.ts:330,412` in particular; they may write to other tables.

6. **Leave a marker.** Put a `// LEVERAGE: pattern ticket-update-stamp — <note>` comment on the helper. Around 30 raw `tickets` writers each decide stamping by hand. A single `updateTicketRow(trx, tenant, id, patch, actor)` writer is the missing layer, but building it is a separate change.

### 3.3 Read side: ticket detail

1. **Load the updater.** In `getConsolidatedTicketData` (`optimizedTicketActions.ts:451`), load `updatedByUser` next to `createdByUser` (`:744-750`): a `users` lookup on `ticket.updated_by`, null-safe. Return it beside `createdByUser` at `:1131`.
2. **Pass it down.** In `TicketDetailsContainer.tsx`, add `updatedByUser` to the `ticketData` type (`:50`) and pass `initialUpdatedByUser` (`:331`). Store it in state in `TicketDetails.tsx`, next to `createdByUser` (`:592`).
3. **Render it.** In the header (`TicketDetails.tsx:3853-3860`), render `Updated <time> by <First Last>` when `updatedByUser` is set. Otherwise keep `Updated <time>`. Use a new i18n key `fields.updatedAtBy` = `"Updated {{time}} by {{name}}"` in `server/public/locales/en/features/tickets.json`, then add the other locales (`de es fr it nl pl pt sv`, plus the `xx`/`yy` pseudo-locales) through the repo's usual translation flow.
4. **Keep it fresh after saves.** Every place `TicketDetails` sets `updated_at: new Date().toISOString()` locally after a successful save (`:2508, 2540, 2685, 2890, 3062`, and the `:3079/3111/3135` paths) must also set `updatedByUser` to `currentUser` (`:198/320/395`). If the live-update stream patches `updated_at` from another user's save (`optimizedTicketActions.liveUpdates.test.ts`, event payload at `optimizedTicketActions.ts:3127`), add `updatedBy` to that payload and apply it the same way.

### 3.4 Read side: ticket list

The **Last Activity** cell gets a muted second line, `by <name>`, attributing whichever source won the `GREATEST`.

1. **Load the inputs in the enrichment step, not in the list SQL.** `enrichTicketListItems` (`optimizedTicketActions.ts:2019`) already batches avatars, logos and tags for the page's authorized rows, and both list paths go through it (`:2198`, `:2334`). Add two batched lookups keyed on the page's `ticket_ids`:
   - newest published comment per ticket:
     ```sql
     SELECT DISTINCT ON (ticket_id) ticket_id, created_at, user_id, contact_id,
            author_type, is_system_generated, metadata->'email'
     FROM comments
     WHERE tenant = ? AND ticket_id = ANY(?)
       AND deleted_at IS NULL AND publish_state = 'published'
     ORDER BY ticket_id, created_at DESC
     ```
     The partial index `comments_tenant_ticket_created_idx` serves it. The filter matches `TICKET_LATEST_ACTIVITY_SQL`.
   - display names for the collected `updated_by`, comment `user_id`s and `contact_id`s (`users`, `contacts`).

   This leaves `TICKET_LATEST_ACTIVITY_SQL`, the sort, the count query, and adjacent-ticket windows untouched. The cost is bounded by page size rather than by the filtered set.

2. **Resolve the actor in a pure function.** Add `resolveLatestActivityActor(row, latestComment, names)` → `{ kind: 'user' | 'client_user' | 'contact' | 'email_sender' | 'system', name: string | null } | null` in `packages/tickets/src/lib/latestActivityActor.ts`:
   - The comment wins if its `created_at` equals `latest_activity_at`. Then:
     - `is_system_generated` gives `system`.
     - A `user_id` gives `user` or `client_user`.
     - A `contact_id` gives `contact`.
     - Otherwise `metadata.email` `fromName`/`fromAddress` gives `email_sender`. This mirrors `CommentItem.getInboundSenderIdentity`.
   - Otherwise, if `updated_at` won and is more than 1 s after `entered_at`, use `updated_by`'s user. A `NULL` `updated_by` gives `null`; see §4.
   - Otherwise, creation won, so use `entered_by_name`.

   Add `// LEVERAGE: pattern comment-author-label` here and at `CommentItem.tsx:229`. The author-label rules now exist in two places.

3. **Carry it on the list item.** Add `latest_activity_actor?: { kind; name } | null` to `ITicketListItem` in `packages/types/src/interfaces/ticket.interfaces.ts:120`, the mirror at `server/src/interfaces/ticket.interfaces.tsx:56`, and `ticketListItemSchema` (`packages/tickets/src/schemas/ticket.schema.ts:137`).

4. **Render it.** In the `last_activity` column (`ticket-columns.tsx:658-672`), add a second `text-[11px]` muted line using the due-date cell's two-line pattern (`:620-623`). Use `t('fields.byName', 'by {{name}}')`, or `t('conversation.systemAuthor', 'System')` for `kind: 'system'`. When the actor is `null`, render only the timestamp.

## 4. System and workflow actors

| Actor | `updated_by` written | Detail header | List "by" line |
|---|---|---|---|
| MSP user (UI or REST) | user id | `by <name>` | `by <name>` |
| Client-portal user | client user id (`client-tickets.ts:1023`) | `by <name>` | `by <name>` |
| Workflow (runtime ops) | `tx.actorUserId`, the workflow's run-as user | `by <run-as user>` | `by <run-as user>` |
| Auto-close job, RMM/Huntress, inbound webhook, inbound email with no matched user | `NULL` | `Updated <time>`, no name | ticket edit: no name. Comment-driven activity: `System` or the email sender. |
| Rows written before this change | whatever is there today | `by <name>` if non-null, otherwise no name | same rule |

When `updated_by` is `NULL`, the screen shows no name rather than "System". `NULL` can't distinguish "automation" from "older row of unknown origin", and naming the wrong actor is worse than naming none. The ticket's activity log (`ticket_audit_logs`, rendered in the activity timeline) keeps the precise system or workflow actor for every curated change.

## 5. Order of work

1. Add `ticketUpdateStamp` and its unit test.
2. Make the columns server-owned in `ticketUpdateSchema`, and remove the three client-sent `updated_at`s.
3. Stamp `updateTicketInTransaction`, `ticketActions.updateTicket`, and `TicketModel.updateTicket`.
4. Sweep the raw writers (§3.2 step 5), and leave the LEVERAGE marker.
5. Detail: `updatedByUser` load, prop, header render, local-state refresh, live-update payload.
6. List: enrichment lookups, `resolveLatestActivityActor`, type and schema fields, column render.
7. Add i18n keys to `en`, then the other locales.

Steps 1-4 ship value on their own: export, REST, and the `updated_at` sort become correct. Steps 5-6 depend on them.

## 6. Tests

- **Unit: `ticketUpdateStamp`.** Returns `fn.now()` and the given actor, and passes `null` through.
- **Unit: `ticketUpdateSchema`.** Drops `updated_at` and `updated_by` from input. Extend `packages/tickets/src/schemas/`.
- **Unit: `resolveLatestActivityActor`.** Table-driven cases:
  - comment wins: internal user, client user, contact, unmatched email sender with and without `fromName`, system-generated
  - `updated_at` wins, with and without `updated_by`
  - creation wins, with `updated_at` within 1 s of `entered_at`
  - a tie between comment and update goes to the comment
- **Integration** (`server/src/test/integration/`, alongside `ticketActivityLog.integration.test.ts`; uses the DB):
  - User A creates a ticket, user B changes its status via `updateTicketWithCache`. `updated_by = B` and `updated_at` advances to DB time.
  - `ticketActions.updateTicket` called with a forged `updated_by`/`updated_at` stores the caller and the server time instead.
  - Auto-close of a ticket last edited by user B leaves `updated_by` `NULL`. Extend `autoCloseTickets.integration.test.ts`.
  - A workflow `TicketModel.updateTicket` with `updated_by: actor` stores the actor. An inbound webhook update stores `NULL`.
  - The list enrichment returns `latest_activity_actor` for the comment-won, update-won and created-only cases on one page, with one comment query and one names query.
- **Component/contract:**
  - The `TicketDetails` header renders `Updated … by <name>` when `updatedByUser` is set and falls back otherwise. Follow the style of `TicketDetails.originBadge.contract.test.ts`.
  - The Last Activity column renders the "by" line and omits it for `null`.
- **Manual smoke:** edit a field as user A, then reload as user B. The header reads "by A". Enable the Last Activity column, add a comment as B, and the cell reads "by B".

## 7. Risks

- **Older rows can name the wrong person.** Before this change, some edits bumped `updated_at` (description edits through `ticketActions.updateTicket`) without updating `updated_by`, so an older `updated_by` can name an earlier editor. Each ticket corrects itself on its next edit. A backfill from `ticket_audit_logs` is possible: set `updated_by` from the newest ticket-entity row whose `occurred_at` is within a few seconds of `updated_at`. It is excluded from this plan because the match is heuristic. Decide during review whether the window before tickets correct themselves is acceptable.
- **Some code may rely on clients sending `updated_at`.** Search for anything else that does. Optimistic-concurrency checks are the main concern; a grep for `updated_at` comparisons in `packages/tickets/src` found no comparisons against the ticket's `updated_at`.
- **Some writers may still be missed.** There are about 30 raw `tickets` writers. The grep in §3.2 step 5 is the acceptance check; the LEVERAGE marker records the structural fix.
- **The workflow run-as user is shown as a person.** Workflow edits name a human, which matches today's `tickets.updated_by` semantics and the existing writers.
- **Bento layout.** The header is shared and needs no Bento-specific change. `BentoHero.tsx:1254-1258` ("Opened by …") is unaffected.

## 8. Not included

- A new audit, history, or per-field change log. `ticket_audit_logs` already serves that role and is unchanged.
- An "updated by" for non-user actors (an `updated_by_type` column or a "System" label driven by `NULL`). See §4.
- Comments bumping `tickets.updated_at`. The header **Updated** keeps meaning "last edit to the ticket record"; comment activity appears in the list's Last Activity and in the conversation.
- Changes to the client portal ticket views, the `TICKET_LATEST_ACTIVITY_PUBLIC_SQL` portal variant, or the REST list's `fields` allowlist.
- A new sortable "Last Activity By" or "Updated By" list column, and an export "Last Activity By" field. Export's existing **Updated By** becomes correct as a side effect.
- Backfilling `updated_by` (see §7).
- Building the general `updateTicketRow` writer layer (recorded as a LEVERAGE marker).
