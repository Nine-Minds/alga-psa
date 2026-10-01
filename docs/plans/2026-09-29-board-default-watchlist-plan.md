# Board default watchlist

Work order: alga-2026-0002379 (Feature C). Author: implementation draft; no earlier design-session plan exists for this work.

## 1. What it does

Each board has an opt-in "Default watchlist". It holds recipients: internal users, free-form email addresses, or both. Every new ticket on that board gets those recipients as watchers, whichever way the ticket is created.

Watchers are not assignees. The feature never writes `assigned_to`, `assigned_team_id` or `ticket_resources`.

It reuses the existing watcher mechanism. A ticket's watchers are the `tickets.attributes.watch_list` entries (`shared/lib/tickets/watchList.ts`). Notification fan-out, the Watch list card and the inbound-sender policy already read that list, so nothing on the notification side changes.

## 2. Storage

Two columns on `boards`, added by `server/migrations/20260929110000_add_board_default_watchlist.cjs`:

| Column | Type | Meaning |
| --- | --- | --- |
| `default_watchlist_enabled` | boolean, not null, default `false` | The opt-in switch. Existing boards stay off. |
| `default_watchlist` | jsonb, nullable | `{ "user_ids": [uuid], "emails": [text] }` |

- `boards` is already distributed by tenant, so a plain `ADD COLUMN` needs no new distribution or table metadata. Each `ALTER` carries one subcommand, as Citus requires.
- The migration is idempotent and reversible.
- The switch is separate from the list, so an admin can turn the watchlist off without losing the recipients.
- Users are stored by id and resolved to their current address when a ticket is created. A changed address is honoured. Inactive, non-internal, address-less and other-tenant users are skipped.
- Addresses are stored trimmed and lower-cased, and de-duplicated.
- A board holds at most 50 recipients.

A separate table was rejected. The recipients are a small document that belongs to the board and is only read and written whole, like `list_view_settings` on the same table. A join table would add a distributed relation, foreign-key handling on user deletion and a second read per ticket, and no query needs it.

## 3. Where it hooks into ticket creation

`TicketModel.createTicket` (`shared/models/ticketModel.ts`) is the shared creation path. Before building the insert row it calls `resolveBoardDefaultWatchers` and `withBoardDefaultWatchers` (`shared/lib/tickets/boardDefaultWatchlist.ts`). The watchers are written in the same insert as the ticket, so a ticket never exists without them and a failed insert leaves nothing behind.

Callers that go through the model are covered without change: the MSP UI, the client portal, the REST API, workflow actions, inbound email, telephony and the renewal queue.

Two creators insert into `tickets` directly. They call the same helper:

- `shared/rmm/alerts/ticketCreator.ts`
- `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts`

Both carry `// LEVERAGE: pattern direct-ticket-insert-watchlist`. Two legacy insert sites carry the same marker without the hook, because nothing calls them: `shared/services/emailService.ts` and `packages/tickets/src/models/ticket.ts`. They should move onto `TicketModel` instead of gaining the hook.

Inbound email composes with the feature. The sender, To and Cc watchers are merged into the list afterwards by `upsertTicketWatchListRecipients`, which merges into existing entries.

Resolution reads the board with `tenantDb(trx, tenant)`, so every query is tenant-scoped.

## 4. De-duplication

- Addresses are compared case-insensitively.
- Entries already on the list win. A watcher the requester or a caller supplied at creation is never duplicated, and an inactive one is not re-activated.
- A user listed by id and the same address typed as an email produce one watcher. The user entry comes first, so it keeps its id and name.
- A malformed stored document never blocks ticket creation. The read side drops bad entries and does not throw.

## 5. Settings UI

The board editor has a "Default watchlist" section (`packages/tickets/src/components/settings/BoardsSettings.tsx`):

- a switch to enable or disable the list
- a multi-select for internal users
- an address input with the shared validation (`normalizeWatchlistEmail`), duplicate and limit checks, Enter to add, and a remove button on each address
- server rejections shown in the editor, using the localized `features/tickets:errors.board.watchlist*` messages

All copy is in the locale files (`msp/settings` `ticketing.boards.*`, `features/tickets` `errors.board.*`) for every real locale. The pseudo locales are generated.

`updateBoard` and `createBoard` validate strictly on write. A bad address is rejected with a readable error and nothing is stored. Changing the watchlist needs the ticket settings update permission, the same as the other board view settings.

## 6. Out of scope

- **Moving a ticket to another board.** The watchlist applies when a ticket is created. Moving a ticket later neither adds the new board's watchers nor removes the old board's. Watchers stay, so a move never silently drops a person from a ticket. Applying the destination board's list on move is a possible follow-up. It needs a decision on whether the old board's watchers should be removed.
- **Existing tickets.** Enabling or editing the list changes only tickets created afterwards. There is no backfill.
- **Removing watchers when the list changes.** Editing the list never touches tickets that already exist.
- **Client-portal users and contacts as recipients.** The picker offers internal users. Outside people are added as addresses.
- **Per-client or per-category lists.** The list is per board.
- **Routing or assignment.** See the next section.

## 7. Why a watchlist and not routing to a Team

The request was to notify a distribution list about new tickets. A Team is an assignment target, so routing there changes who owns the ticket:

- Assigning to a Team sets `assigned_team_id`, and the ticket appears in the members' assigned queues, workload and SLA views. A person who only needs to know about new tickets does not own them.
- The board already has `default_assigned_to` and `default_assigned_team_id` for real ownership. Reusing them for notification would overload one setting with two meanings.
- A Team holds internal users only. A distribution list is an email address.
- A Team's members must be maintained separately, and Team membership grants access. A watchlist only sends notifications.

A watchlist expresses "tell these people" and leaves ownership to the existing assignment settings. It also uses the watcher mechanism that notifications already understand.

## 8. Verification

- `server/src/test/integration/boards/boardDefaultWatchlist.integration.test.ts` covers storage (defaults, save, disable keeps the list, invalid rejection, `createBoard`), application through `TicketModel` and through the RMM direct insert, composition with inbound-email watchers, de-duplication, the disabled state, board scoping, and skipping inactive, portal and other-tenant users. It asserts that assignment and `ticket_resources` are untouched.
- `shared/lib/tickets/__tests__/boardDefaultWatchlist.test.ts` covers the validation and merge helpers.
- `server/migrations/__tests__/boardDefaultWatchlistMigration.integration.test.ts` covers up, down and re-running.
- `packages/tickets/src/components/settings/BoardsSettings.copyStatuses.test.tsx` covers the editor section.
