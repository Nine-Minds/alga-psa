# Plan: email-address recipients for board notification rules

Base: `origin/main` @ 450070437d. The board notification code is unchanged from PR #3631 at that commit. Branch `feature/decision-board-notification-to-a-plain-email-dl`. Source request: alga-2026-0002379 (AJA Technologies). Paths are relative to the repo root.

## 1. Problem

Board notification rules (`docs/plans/2026-10-06-board-notification-rules-plan.md`, PR #3631) can only notify internal users and teams. A rule recipient row is `recipient_type IN ('user','team')`, and every send goes to a resolved Alga user (`shared/lib/tickets/boardNotificationRules.ts`, `expandRuleRecipients`). Nothing can notify a plain address such as a distribution list. AJA needs exactly that: an email to their DL for every new ticket on a board.

The captain chose to add a third recipient type, `email`. This plan covers that type. The type is a trust decision, not only a schema change. Every user recipient is checked at send time with `ticket:read` plus `authorizeTicketRecordAccess` (`server/src/lib/notifications/boardNotificationAudience.ts`). An address has no principal, so it cannot be checked. Whoever configures the rule decides, once, that the address may receive every matching ticket on the board.

## 2. What the code does today

| Area | Today | Where |
|---|---|---|
| Storage | `board_notification_rule_recipients`: `recipient_type`, `user_id`, `team_id`. Type CHECK, shape CHECK, and partial unique indexes on `(tenant, rule_id, user_id)` and `(tenant, rule_id, team_id)`. Distributed by tenant. | `server/migrations/20261006120000_create_board_notification_rules.cjs` |
| Domain | `loadMatchingRules` → `expandRuleRecipients` → `resolveBoardNotificationRecipients` returns `ResolvedRecipient { userId, email, displayName }[]`, keeping only active internal users. | `shared/lib/tickets/boardNotificationRules.ts` |
| Visibility | `filterRecipientsWhoCanReadTicket` drops users who cannot read the ticket. | `server/src/lib/notifications/boardNotificationAudience.ts` |
| Email, create | `handleTicketCreated` sends to the primary contact, then the assignee, then the rule recipients (`ticket-board-created`, subtype `Board Ticket Created`, per-user preference checked), then the watchers. One `sentEmails` set dedupes all of them. | `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` ~1179-1395 |
| Email, status | `handleTicketStatusChanged` sends `ticket-board-status-entered` immediately, bypassing the accumulator. | same file ~1401-1490 |
| In-app | Both triggers send in-app to the resolved users. | `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts` ~240-270, ~350-370 |
| Actions | `get/saveBoardNotificationSettings`: `ticket_settings` read/update. Each rule needs a trigger plus at least one user or team. | `packages/tickets/src/actions/board-actions/boardNotificationActions.ts` |
| UI | One card per rule, with `MultiUserAndTeamPicker` for recipients. | `packages/tickets/src/components/settings/BoardsSettings.tsx` ~2160+ |
| Email body | Both templates reuse the `ticket-created` body: title, client, priority, status, the full `{{{ticket.description}}}`, the requester's name, email and phone, and the internal ticket URL. | `server/migrations/utils/templates/email/tickets/ticketBoardCreated.cjs`, `ticketBoardStatusEntered.cjs`, `ticketCreated.cjs` |

Facts from the inbound side that shape the design:

- **Reply token.** A `replyContext` on an outbound email makes `sendEventEmail` mint a reply token. The token goes into the body (`applyReplyMarkers`) and into `email_reply_tokens`. The same context also adds `[Ticket #N]` and the thread headers (`server/src/lib/notifications/sendEventEmail.ts` :502-548; `packages/email/src/BaseEmailService.ts` :560-587).
- **Replies matched by reply token have no sender check.** An unknown sender's reply becomes a contact-authored comment, and the sender is added to the watch list as `inbound_from` (`shared/services/email/processInboundEmailInApp.ts` :1516-1522, :1616-1641, `buildUnmatchedSenderWatchListRecipients` :1176-1198).
- **Replies matched by thread headers do have a sender check.** The sender must be the ticket's contact, an internal user, an active watcher, or a one-off Cc/Bcc recipient. Anyone else is quarantined (:1301-1353).
- **Loop detection misses lists.** Tier 1 of `detectOutboundNotificationLoop` (`shared/services/email/notificationLoopDetection.ts`) requires the logged send's recipient list to contain the receiving mailbox. A DL that expands to a connected inbound mailbox fails that test: the log shows the DL's address, not the mailbox's.
- **Precedent.** The workflow action `email.send` (`shared/workflow/runtime/actions/businessOperations/email.ts`) can already send ticket data to arbitrary addresses. An address recipient is therefore not a new kind of capability. It does put that capability behind `ticket_settings:update` rather than the workflow permissions.

## 3. Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| D1 | Shape | Add `recipient_type = 'email'` and a nullable `email` column to `board_notification_rule_recipients`. Address recipients sit in the same rule as users and teams. A rule may have only addresses. | One rule model. The rule's triggers and enabled switch apply to every recipient. |
| D2 | Triggers | Address recipients fire on both triggers, created and status-entered, exactly like users. | A recipient type should not change trigger semantics. |
| D3 | Channel | Email only. Addresses get no in-app notification and no push. | There is no principal to notify. |
| D4 | Trust boundary | **The send-time read check is skipped only for addresses that are not Alga principals.** At send time, an address that matches an active internal user's email is turned into that user. It then gets the visibility filter, the per-user preference and in-app delivery. An address that matches a client contact or a client location email at send time is dropped and logged. | The bypass then only reaches addresses outside Alga's identity model. A person who is an Alga user keeps every check that applies to them. A contact created later with the DL's address cannot start receiving every client's tickets. |
| D5 | Save-time guards | `saveBoardNotificationSettings` rejects an address when any of these holds. Each check has its own error message. (a) The address is not a valid email once normalized. (b) It is the email of an active internal user ("choose the user instead"). (c) It is a client contact's email (`contacts.email` or `contact_additional_email_addresses`) or a client location's email. (d) Its domain is in `client_inbound_email_domains`. (e) It is a connected inbound mailbox (`email_providers.mailbox`). Addresses already stored on the board are re-validated against (a) to (e) on every save. | (b) keeps people on the checked path. (c) and (d) stop cross-client leakage: a board serves many clients, so an address on a client's domain would receive other clients' tickets. (e) stops direct mail loops. |
| D6 | Domain allow-list | **No** tenant-domain allow-list. Any address that passes D5 is accepted, whether it belongs to the MSP's own DL or to a third-party paging or NOC service. | No single table holds "the MSP's own domains". `email_domains` holds sending domains and `msp_sso_tenant_login_domains` holds login domains, and either would wrongly block legitimate DLs on other domains. D5 already blocks the dangerous class, client domains. Revisit if a tenant asks for a stricter mode (§8). |
| D7 | Content | Address recipients get the **same** templates and subjects as user recipients, with the full description, requester details and internal URL. | A DL alert without the ticket body does not do its job, and AJA's request is the full new-ticket notice. The admin chooses the address explicitly. D4, D5 and the audit trail (D10) are the controls. The captain can override this; §8 describes a redacted variant. |
| D8 | Replies | Address sends carry `replyContext` with `issueReplyToken: false`. That flag is a new opt-out on `sendEventEmail`. They keep `[Ticket #N]` and the thread headers. They get no reply token and no reply banner. | Without a token, a reply comes back through the thread-header path, which checks the sender. A DL member who is an Alga user, contact or watcher is threaded normally. An unknown sender is quarantined, rather than becoming a client-visible comment plus an external watcher. |
| D9 | Loop guard | Two parts. The save-time guard D5(e) rejects the direct case. A runtime check covers a DL that expands to a connected mailbox: an inbound message matched by thread headers whose sender is the tenant's outbound From address, and that carries the RFC 3834 automated-message signal, is treated as `notification_loop` and skipped. The check runs before the sender check and before any change to the ticket. | Our notifications always carry `Auto-Submitted: auto-generated`. A message from our own From address that carries it, threaded to our ticket, is a redelivery and not a reply. This closes the DL gap without relying on the logged recipient list. |
| D10 | Audit | Every save that changes a board's set of addresses writes one `audit_logs` row through `auditLog` (`packages/db/src/lib/auditLog.ts`): `operation: 'board_notification_email_recipients_changed'`, `table_name: 'board_notification_rule_recipients'`, `record_id: board_id`, `changed_data: { added, removed }` per rule, plus the acting user. | The replace-on-save write pattern loses row history. Adding an address is the one setting that sends ticket data outside the permission model, so it needs a durable record of who did it. |
| D11 | Permission | Unchanged: `ticket_settings:update`. | Requiring a new permission would be a separate RBAC change, and the workflow `email.send` precedent already exists. Tightening is listed under §8. |
| D12 | Preferences and gates | The tenant gate (global, category, subtype) applies to address sends, using the existing subtypes `Board Ticket Created` and `Board Ticket Status Entered`. There is no per-recipient opt-out. Removing an address is an admin action. | This is how contact-facing sends work today (no `recipientUserId`). |
| D13 | Suppression | `suppressInternalNotifications` suppresses address sends. `suppressContactNotifications` does not. | Address recipients are an internal-facing audience, sent the internal template. |
| D14 | Deduplication and exclusion | Addresses are normalized (trim, lowercase, via `normalizeEmailAddress`) and are unique per rule. Across rules, an address is sent once per event. Address sends share each handler's `sentEmails` set with the user sends, so a user and an address with the same mailbox produce one email. **Create:** skip an address that is the primary contact or client email, the assignee's email, or **any** active watcher (internal or external). Those audiences already receive their standard email, and rule sends run before the watcher loop, so this exclusion must be explicit. **Status entered:** skip an address that is an active watcher, or the email of the actor or of any assignee from `getAllTicketAssignees`. | This matches the "no duplicates with standard notifications" rule in the #3631 plan. |
| D15 | Limit | At most 25 addresses per rule. Each address may be up to 254 characters. | Bounds the blast radius of a mistaken paste. A DL is one address, so real rules need very few. |

## 4. Schema and migration

New migration `server/migrations/20261013020000_add_board_notification_email_recipients.cjs`, with `exports.config = { transaction: false }` like its parent. The table is already distributed by tenant. Each `ALTER TABLE` carries one subcommand (Citus). Every step is guarded so that the migration can be re-run (`hasColumn`, a `pg_constraint` lookup, `CREATE UNIQUE INDEX IF NOT EXISTS`). Read the `citus-migration-gotchas` skill before writing it.

1. `ALTER TABLE board_notification_rule_recipients ADD COLUMN email text NULL`.
2. Drop `board_notification_rule_recipients_type_check`. Re-add it as `CHECK (recipient_type IN ('user','team','email'))`.
3. Drop `board_notification_rule_recipients_shape_check` and re-add it with three branches:
   ```
   (recipient_type = 'user'  AND user_id IS NOT NULL AND team_id IS NULL AND email IS NULL)
   OR (recipient_type = 'team'  AND team_id IS NOT NULL AND user_id IS NULL AND email IS NULL)
   OR (recipient_type = 'email' AND email IS NOT NULL AND user_id IS NULL AND team_id IS NULL)
   ```
4. `ADD CONSTRAINT board_notification_rule_recipients_email_normalized_check CHECK (email IS NULL OR (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1))`. This is a backstop: the action does the real validation.
5. `CREATE UNIQUE INDEX IF NOT EXISTS board_notification_rule_recipients_email_uq ON board_notification_rule_recipients (tenant, rule_id, email) WHERE email IS NOT NULL`. The column is new and empty, so no existing rows can violate the index and no dedupe is needed.

`down`: delete the `recipient_type = 'email'` rows, drop the index and the normalization check, restore the original two-branch shape check and the `('user','team')` type check, then drop the column.

No registration changes. `tenantTableMetadata.ts`, `tenantDb.cjs` and the tenant-deletion list already cover the table. There is no foreign key, so user, team and status deletion are unaffected. Board deletion still cascades through the rule.

## 5. Domain layer (`shared/lib/tickets/boardNotificationRules.ts`)

- `BoardNotificationRule` gains `email_addresses: string[]`. `hydrateRules` selects `email` and fills it from the `recipient_type = 'email'` rows.
- Replace `resolveBoardNotificationRecipients` with `resolveBoardNotificationAudience(conn, tenant, trigger, { excludeUserIds })`, which returns `{ users: ResolvedRecipient[]; addresses: AddressRecipient[] }`, where `AddressRecipient = { email: string }`. The in-app subscriber reads `.users` only. The email subscriber reads both. Because the result type has two named fields, a caller cannot treat an address as if it had passed the visibility filter.
- Address resolution, in one pass, after the rules are loaded:
  1. Union all `email_addresses` across the matching rules and normalize them.
  2. Look up active internal users whose `lower(email)` is in the set. Each match moves to `users` (D4) and is subject to `excludeUserIds` like any other user. It is deduped against users already present.
  3. Look up client contact emails (`contacts.email`, `contact_additional_email_addresses`) and client location emails in the set. Matches are dropped with a `logger.warn` naming the rule's board (D4). Doing this check at send time costs a single indexed lookup, and only when a matched rule has addresses.
  4. The rest become `addresses`.
- Export `normalizeBoardNotificationEmail(value): string | null`. It is `normalizeEmailAddress` from `shared/lib/email/addressUtils.ts` followed by a 254-character cap. Both the action and the resolver use it, so they cannot disagree.
- `// LEVERAGE: pattern principal-address-classification`: steps 2 and 3 classify an address as internal user, contact or unknown. Similar logic is spread across the inbound sender resolution in `processInboundEmailInApp.ts`. Mark both sites with this slug and do not extract them here.

`server/src/lib/notifications/boardNotificationAudience.ts` is unchanged. It still filters `ResolvedRecipient[]`, and only `.users` is passed to it.

## 6. Send path

### 6.1 `sendEventEmail` (`server/src/lib/notifications/sendEventEmail.ts`)

Add `issueReplyToken?: boolean` (default `true`) to the `replyContext` type. When it is `false`, skip the token mint, `applyReplyMarkers` and `persistReplyToken`. Keep the `[Ticket #N]` subject and pass `replyContext` through to `TenantEmailService` unchanged, so the thread headers, Message-ID and `email_sending_logs.thread_id` stay. Add unit tests for both values of the flag.

### 6.2 Email `handleTicketCreated`

- Call `resolveBoardNotificationAudience`. Run the visibility filter on `.users` exactly as today.
- Filter `.addresses` against the D14 create exclusions: the primary email, the assignee's email, and every active watcher address from `extractActiveWatcherEmails`.
- Include address recipients in the "nothing to send" early-return test, alongside `boardRuleRecipients`.
- After the user rule sends, send each address through `sendIfUnique({... template: 'ticket-board-created', context: buildContext(internalUrl), replyContext: { ...replyContext, issueReplyToken: false } }, 'Board Ticket Created')`, with no `recipientUserId`.
- Log `info` with `addressCount` and `boardId`. Never log the addresses themselves at `info` level.

### 6.3 Email `handleTicketStatusChanged`

- Same resolver call.
- Seed `sentEmails` with the emails of the actor and the assignees. Drop addresses that are active watchers (D14).
- Send `ticket-board-status-entered` through `sendNotificationIfEnabled(..., 'Board Ticket Status Entered')`, with no `recipientUserId`, immediately, and with `replyContext: { ticketId, threadId, issueReplyToken: false }`. The current status send passes no `replyContext`, and user sends keep that behaviour. Address sends get the thread headers so that D8 holds.
- An early return still happens when both `users` (after filtering) and `addresses` are empty.

### 6.4 In-app subscriber

Switch both call sites to `resolveBoardNotificationAudience(...).users`. Behaviour is unchanged, except that an address matching an internal user (D4) now reaches that user in-app as well.

### 6.5 Inbound loop guard (`shared/services/email/processInboundEmailInApp.ts`)

In `handleThreadedReply`, when `matchedBy === 'thread_headers'`, three things together mark a redelivery: the sender equals the tenant's outbound From address (the `from_address` resolved by `TenantEmailService` for the tenant), the ticket being threaded to has an `email_sending_logs` row from that address, and `detectAutomatedInboundMessage(emailData).isAutomated` is true. When all three hold, return `{ outcome: 'skipped', reason: 'notification_loop' }` before the sender check and before any change to the ticket. Record the evidence in `diagnostics.notificationLoop` with a new tier, `'thread_header_self_automated'`. Add that tier to `NotificationLoopTier` in `notificationLoopDetection.ts`, and keep the check in that module so all loop evidence lives in one place.

## 7. Server action, UI, i18n

**Action** (`boardNotificationActions.ts`):

- `BoardNotificationRuleSettings` and `BoardNotificationRuleInput` gain `email_addresses: string[]`, with `?` on the input.
- Normalize with `normalizeBoardNotificationEmail` and dedupe. Fail fast on: an invalid address, more than 25 addresses, a rule with no user, team or address (new message: "must notify at least one user, team or email address"), and the D5 guards (b) to (e). D5 is checked in one batched query per guard inside the transaction.
- Insert the `email` rows alongside the user and team rows.
- Compute the per-rule added and removed address sets against the pre-save rows, and write the D10 audit row in the same transaction. Verify that `app.current_tenant` is set on this path, because `auditLog` silently skips otherwise. If it is not set, set it or pass an explicit tenant. The integration test asserts that the row exists.
- Add the new messages' prefixes to `EXPECTED_BOARD_MESSAGES` in `boardActionErrors.ts`. Existing entries use the shared `'Notification rule'` prefix, so new messages can reuse it. Give each new message its own key under `features/tickets:errors.board.*` in every locale.

**UI** (`BoardsSettings.tsx`, the rule card):

- `EditableNotificationRule` gains `email_addresses: string[]`.
- Under the user and team picker, add `EmailRecipientsInput` (`@alga-psa/ui/components/EmailRecipientsInput`), with `id="board-notification-rule-{index}-emails"` and no `searchSuggestions`. Suggesting contacts would invite exactly the addresses D5 forbids. Track `invalidEntries` and block save while it is non-empty.
- Help text under the field, in the warning style: "These addresses receive the full ticket details for every matching ticket on this board, even though they are not Alga users and no permission check applies. Use for distribution lists you control. To notify a person who has an Alga account, choose them above instead."
- Update the client-side recipient-required check (~line 1138) and its message to include addresses.
- Include the field in `serializeSections().notifications` and in the payload of `persistNotificationSettings`. Carry the field through the new-board path (~1293-1345).
- Add the new keys under `ticketing.boards.editor.sections.notifications*` in `msp/settings` for every locale. Regenerate the pseudo-locales and run `scripts/validate-translations.cjs`.

**Templates:** unchanged (D7). The intro already says "You are receiving this because of a notification rule for this board", which is accurate for a DL.

## 8. Out of scope

- A redacted template for address recipients (title, board, priority and link only). D7 sends the full body. If the captain prefers redaction, add `ticket-board-created-minimal` and `ticket-board-status-entered-minimal` and select them for addresses. It is a contained follow-up.
- A dedicated permission for managing address recipients, and a per-tenant switch that disables address recipients or restricts them to an allow-list of domains.
- Client-facing DL notifications: sending the portal template to a client's own DL for that client's tickets. D5 deliberately blocks client addresses. That use case needs per-client scoping, not per-board.
- Address recipients as **default watchers**. The watch-list approach was tried in alga-2026-0002379 and superseded (`docs/plans/2026-09-29-board-default-watchlist-plan.md`). An address watcher would receive every update through the client-facing path.
- A per-address opt-out or unsubscribe link.
- Exposure through the REST API or mobile app (still out of scope from #3631).
- Contact or client deletion re-checking stored addresses. D4 re-checks at send time, so stale rows are harmless.

## 9. Risks

| Risk | Mitigation |
|---|---|
| An admin enters an address outside the organisation, and every ticket on the board, with its description and requester PII, goes there. | D5 blocks client-owned and loop addresses. D4 re-checks at send time. D10 records who added the address and when. The UI warning states the consequence. The residual risk is the trust decision the captain accepted. |
| A DL forwards into a connected inbound mailbox and creates a notification loop. | D5(e) rejects the direct case. D8 stops a token-path reply from becoming a comment. D9 skips automated redeliveries from our own From address on the thread-header path. An integration test covers the scenario end to end. |
| A DL member who is not an Alga user replies. | It is quarantined on the thread-header path, so it creates no client-visible comment and adds no watcher. A DL member who is an Alga user, contact or watcher replies normally. |
| A DL address later becomes an internal user's email (for example, a shared mailbox gets a login). | D4 turns it into that user at send time, so the user's permission check and preferences apply from then on. |
| An address matches a contact who is created after the rule. | D4 drops it at send time and logs a warning. A tenant reading the logs can see why the DL went quiet. |
| A shape-check change on a distributed table fails on Citus. | One subcommand per `ALTER`, guarded by `pg_constraint` lookups, and tested by the migration test (§10) against the Citus-shaped local stack. |
| `auditLog` silently skips because the tenant setting is missing. | The integration test asserts that the audit row is written (§7). |

## 10. Tests

**Unit** (`cd server && npx vitest run <path>`):

- `sendEventEmail` with `issueReplyToken: false`: no token row, no markers, thread headers still present, `[Ticket #N]` still added.
- `normalizeBoardNotificationEmail`: display names, `mailto:`, case, whitespace, the over-length cap, invalid input.
- `BoardsSettingsNotifications` component test: the address field renders with a unique id; an invalid chip blocks save; a rule with only addresses is accepted; the save payload carries `email_addresses`.

**Integration** (real database):

- `boardNotificationEmailRecipientsMigration.integration.test.ts`: up, down, re-run. The shape check rejects mixed rows. The normalization check rejects `' Foo@X.com'`.
- `boardNotificationActions.integration.test.ts` (extend):
  - round-trips addresses;
  - rejects each D5 case with its own message;
  - enforces the 25-address cap;
  - accepts a rule whose only recipients are addresses;
  - writes one `audit_logs` row with the correct `added` and `removed`, and none when addresses are unchanged.
- `boardNotificationRules.integration.test.ts` (extend):
  - an address matching an active internal user resolves to `users` and honours `excludeUserIds`;
  - an address matching a contact is dropped;
  - addresses are deduped across rules;
  - an address on a disabled rule is ignored.
- `boardNotificationCreateDelivery.integration.test.ts` (extend). Mock `sendEventEmail`:
  - an unassigned ticket on a board whose rule names a DL address sends exactly one `ticket-board-created` to the DL, with no `recipientUserId` and `issueReplyToken: false`;
  - no in-app notification is created for the address;
  - a DL that is also an active watcher gets only the watcher email;
  - `suppressInternalNotifications` silences the DL.
- `boardNotificationStatusDelivery.integration.test.ts` (extend):
  - entering a rule status emails the DL immediately, even when the accumulator is ready;
  - an assignee's address is not emailed twice.
- `inboundEmailBoardNotification.integration.test.ts` (extend), end to end through `processInboundEmailInApp` on the durable outbox path:
  - a new inbound ticket notifies the DL;
  - a reply to that notification from an unknown sender, matched by thread headers, is quarantined, with no comment and no watcher added;
  - a reply from a DL member who is an internal user is threaded as an internal comment;
  - a redelivery of the notification into a connected mailbox (sender is the tenant From address, `Auto-Submitted` header present) is skipped as `notification_loop`.

**Manual smoke** at `http://feature-decision-board-notification-to-a-plain-email-dl.localhost:3734` (stack `alga-psa-local-test`), using GreenMail as described in the `alga-inbound-email-testing` skill:

1. Edit a board, open Notifications, and add a rule with "created" and the address `queue-dl@msp.test`. Save and reload; the address persists.
2. Try to save a contact's address, then a client's domain, then the board's inbound mailbox. Each is refused with its own message.
3. Send an email into the board's mailbox. `queue-dl@msp.test` receives "New Ticket on <board>". The ticket is unassigned and its watch list is unchanged.
4. Reply to that email from `queue-dl@msp.test`. No comment appears; the quarantine is logged.

**Before handoff:** run `npm run lint`, `npx tsc --noEmit -p server`, and the existing board notification, `ticketCreatedSuppression` and `notificationLoopDetection` suites.

## 11. Implementation order

1. Migration (§4) and its test.
2. Domain resolver changes and `normalizeBoardNotificationEmail` (§5). Switch both subscribers to `resolveBoardNotificationAudience`, with no behaviour change yet.
3. `issueReplyToken` on `sendEventEmail` (§6.1).
4. The address send path in both email handlers (§6.2, §6.3).
5. Action validation, the audit row and error messages (§7).
6. UI, locales and pseudo-locales (§7).
7. The inbound loop guard (§6.5).
8. The full test pass and manual smoke.

## 12. Durable facts

1. `board_notification_rule_recipients.recipient_type` is `user`, `team` or `email`. Email rows store a normalized address in `email`, unique per rule.
2. Address recipients get email only, on both triggers, through the same templates and subtypes as user recipients.
3. The send-time read check is skipped only for addresses that are not Alga principals. An address matching an active internal user is treated as that user. An address matching a client contact or client location is dropped.
4. On save, an address is refused if it belongs to an internal user, a client contact or location, a client inbound domain, or a connected inbound mailbox. Every change to a board's addresses writes an `audit_logs` row.
5. Address sends carry thread headers but no reply token, so replies from unknown DL members are quarantined rather than threaded.
