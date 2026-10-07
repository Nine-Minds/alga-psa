# Scratchpad — Per-comment CC / BCC

## Decisions (user, 2026-10-06)

- **Delivery:** real `Cc`/`Bcc` headers on the requester's comment email, not separate copies. If no requester email goes out, CC becomes `To`.
- **Internal notes:** public replies only. Enforced in the UI, server actions, the API and workflows.
- **Replies from CC'd people:** accepted as comments, but never added to the watch list. The same applies when the requester replies-all with them on Cc.
- **Workflow `tickets.add_comment`:** a non-empty cc/bcc makes it publish `TICKET_COMMENT_ADDED`, so the normal requester email goes out with Cc/Bcc. Without cc/bcc it stays silent, as today.

## Decisions (mine; revisit if wrong)

- **Storage:** `comments.metadata.email_recipients`, with no migration. The subscriber reads it from the row because:
  - `TicketEventPayloadSchema.parse` strips unknown payload keys;
  - `dispatchCommentPublication` and the scheduled-comment handler rebuild the payload from the row anyway.
- **Attachments:** CC/BCC recipients get the same message as `To`, attachments included. The per-recipient attachment gate (`recipientCanReceiveCommentFiles`) runs for `To` only. An ad-hoc address would fail that gate, and the MSP chose to CC them explicitly.
- **Bundles:** CC/BCC aren't mirrored to child tickets.
- **Client portal CC:** out of v1.
- **Limit:** 20 combined recipients.

## Key code locations (HEAD 8f357ee08d)

**Composer**

| What | Where |
|---|---|
| "Attach files" button | `packages/ui/src/editor/TextEditor.tsx:494-515` |
| Composer component | `packages/tickets/src/components/ticket/TicketConversation.tsx` (editor `:824`; `onAddNewComment` signature `:80-87`) |
| MSP handlers | `TicketDetails.tsx:2114` (`handleAddNewComment`), `:2297` (`handleAddReplyComment`); `TicketDetailsContainer.tsx:258` |

**Server actions**

- `optimizedTicketActions.ts:3292` (`addTicketCommentWithCache`; bundle mirror `3450-3480`)
- `commentActions.ts:229` (`createComment`)
- `ticketActions.ts:1793` (`addTicketComment`)

**REST API**

- `server/src/lib/api/schemas/ticket.ts:372`
- `ApiTicketController.ts:1511`
- `TicketService.ts:2440`
- OpenAPI: `workManagementV1.ts:207`

**Subscriber** (`server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`)

- `handleTicketCommentAdded` `:2418-2910`
- `sendIfUnique` `:2662`
- Requester send `:2702-2744`
- Watchers `:2808`
- Assigned user `:2846`
- Additional agents `:2874`

**Sending**

- `server/src/lib/notifications/sendEventEmail.ts`: `SendEmailParams` `:56`, `service.sendEmail` call `:527`, delivery claim and attachment gate `:407-460`.
- Every layer below already does cc/bcc: `TenantEmailService.ts:40-43,573-576`, `BaseEmailService.ts:78-81,609-613`, the email log at `:843-895`, and the Graph, Resend and SMTP providers.

**Workflow**

- `shared/workflow/runtime/actions/businessOperations/tickets.ts:702` (`tickets.add_comment`) calls `TicketModel.createComment` (`shared/models/ticketModel.ts:1383`) with `eventPublisher = undefined`, so no event is emitted.
- Reference for email-list inputs: `email.send` (`email.ts:65`) already takes to/cc/bcc.

**Inbound** (`shared/services/email/processInboundEmailInApp.ts`)

- Token match `:1550`
- Thread-header match `:1603-1640`
- Quarantine gate `:1256-1292`
- Unmatched-sender watchers `:1139`
- Reply To/Cc → watchers: `:996-1004`, `:1442-1452`, `:1525`
- Watch-list helpers: `shared/lib/tickets/watchList.ts:285-357`

**Reusable UI**

- `ee/server/src/components/workflow-designer/WorkflowRecipientEditors.tsx:192`: chip editor plus `parseEmailRecipients`. It's in EE, so extract the parsing.
- `TicketWatchListCard.tsx:383-439`: Contact, User and UserAndTeam pickers, plus a free-text email input.

**Mobile**

- `ee/mobile/src/api/tickets.ts:~244`
- `features/comments/commentTarget.ts:72`
- `features/ticketDetail/components/CommentsSection.tsx`
- `hooks/useCommentDraft.ts`

## Gotchas

- **Workflow redeploys:** `shared/` changes reach the v2 workflow actions, which run on the workflow-worker. Redeploy the workflow-worker and email-service as well as the server.
- **Duplicate copies:** today every recipient gets their own send and their own Message-ID. When a watcher or agent is also CC'd, add the CC'd address to the `sendIfUnique` seen-set so they get only the combined message.
- **BCC-only fallback:** never put several BCC addresses in one message with an empty `To`. Some providers reject it, and you'd need a fake `To`. Send each BCC address its own message instead.
- **Picker suggestions:** use the specific `/actions/<module>` imports, not the `/actions` barrel. `TicketConversation` is shared code.
- **REST and portal responses:** the REST comment GET may return `metadata` raw today. Check that `email_recipients.bcc` can't leak through any client-portal-facing serializer.

## Composer inventory (verified 2026-10-06)

Four composers need the Cc/Bcc control:

1. **Classic main composer:** `TicketConversation.tsx:824`. The `TextEditor` has `allowFileAttachments`.
2. **Classic inline reply:** `TicketConversation.tsx:532`, an `InlineReplyComposer`.
   - It passes `initialInternal = parent.is_internal` and `showInternalToggle={false}`.
   - Its `onSubmit` calls `onAddReplyComment(content, parentCommentId, isInternal)`, which goes to `TicketDetails.handleAddReplyComment` (`:2297`) and then to `createComment` with `parent_comment_id`.
3. **Classic thread drawer:** `TicketConversation.tsx:923`, a `CommentThreadDrawer`. Internally it renders an `InlineReplyComposer` (`packages/ui/src/components/CommentThreadDrawer.tsx:78`), with the same `onAddReplyComment` path.
4. **Bento layout:** `bento/BentoTimelineTile.tsx`.
   - Its own main `TextEditor` (`:828`, submit `:718`) and its own `InlineReplyComposer` (`:1129`).
   - Wired through `TicketBentoLayout.tsx:943-958`, with the same `onAddNewComment` / `onAddReplyComment` props.

Other facts:

- `InlineReplyComposer.tsx:81-88` renders `TextEditor` with `allowFileAttachments={roomName?.startsWith('ticket-')}` and `uploadFile`, so "Attach files" is present on ticket replies.
- `ticketEmailSubscriber` has no reply-specific branch (no `parent_comment_id` / `is_reply` checks). A threaded reply is emailed exactly like a top-level comment, so CC on replies needs no extra delivery work.
- The client portal also renders `TicketConversation`. The control must be opt-in through a prop.
- There is an existing contract test: `TicketConversation.replyComposer.e2e.contract.test.tsx`. Keep it green.

## Review round 2 (2026-10-06)

Fixes from the review:

- **Suggestion picker was mouse-dead.** `onBlur={commitDraft}` closed the list on the pointer press (focusout is a discrete React event), so the `<ul>` unmounted before the click landed. Suggestion buttons now `preventDefault()` on mousedown, and blur only commits text that contains an `@` — a half-typed name no longer becomes an error chip that blocks Send.
- **Gated sends counted as delivered.** `sendNotificationIfEnabled` returned `void`, so `sendIfUnique` reported `true` even when a gate skipped the send. It now returns whether a message reached the email service.
- **Disabled notifications:** decided that the tenant kill switch wins (PRD FR15, F017, T027). The fallback runs but passes the same gate, so nothing goes out. A bypass would send a copy of a comment the requester themself is not being emailed.
- **Author-less MSP comments.** `isFromAgent` needs a user row; a comment written with `author_type = 'internal'` and no `user_id` (a workflow's own comment) now counts as MSP-authored for the one-off fallback only. The requester-notification gate is untouched.
- **Thread headers** are built once and used by both the requester message and the fallback. (The email service also applies ticket-scoped headers, so this is belt and braces — the test asserts the delivered message.)
- **Bcc mask moved into `TicketService.getTicketComments`**, which spreads the raw row; `stripCommentBccFromMetadata` was missing from the db-coupled module's re-export list, which the new storage suite caught at runtime.
- **The ceiling counts people**: dedupe before the 20-recipient check, the error names the list that overflowed, and the composer blocks Send with an inline message instead of failing in the action.
- **Mobile** gained the contact suggestions F042 claimed.

Test coverage this round: the grep-based delivery contract is gone except for the attachment claim/gate (which the SMTP harness cannot reach cheaply). The isolated-SMTP suite grew to 14 cases, a new storage suite covers identity resolution / metadata merge / bundle mirror / API read / Bcc mask, the workflow handler is exercised, and the composer wiring has its own suites. Eight tests stay unimplemented with the reason recorded in `tests.json`: the five server-action integration tests (no harness for calling a Next.js server action against a database), T032 (needs stored attachments), T057 (scheduling job path) and T069 (bento inline reply rendering stack).

## Round 3 — Resolve and close (2026-10-07)

Operator feedback: the Cc/Bcc rows ate too much vertical space, and "Resolve and
close" — the other way to leave a comment — had no Cc/Bcc at all.

- **Two columns.** The Cc and Bcc rows now sit side by side (`sm:grid-cols-2`);
  half the width is plenty for an address. `TicketResolutionDialog` also pairs
  the close-status select with the Internal switch, so the dialog is two rows
  shorter.
- **The dialog is a composer.** It renders the shared
  `CommentEmailRecipientsControl` (toggle in the editor footer via
  `footerActions`, rows above the editor), blocks **Resolve and close** on an
  invalid address, hides-and-keeps the values while Internal is on, and resets
  on reopen. `onConfirm` carries the payload to `addResolutionComment` →
  `addTicketCommentWithCache`.
- **Delivery had to move.** A resolution paired with a close is written with
  `metadata.closes_ticket`, and `handleTicketCommentAdded` deliberately returns
  early for those rows — the close email carries the resolution body. So the
  Cc/Bcc had to ride the **close** email: `handleTicketClosed` now reads the
  closing resolution's `email_recipients`, puts them on the requester's close
  message, runs the same no-requester fallback shapes, and adds them to the
  seen-set so a cc'd watcher or assignee gets one message. The selection logic
  is now one function, `selectOneOffEmailRecipients`, used by both handlers.
  This also fixes the classic composer's "resolution + close status" path,
  which collected Cc/Bcc and had nowhere to deliver them.
- **Scope:** only a resolution row carrying `closes_ticket` is read. A
  resolution left open already mailed its own copies as a normal comment, so a
  later close does not copy them again (T079).
- **Other ways to leave a comment** were audited: classic composer, inline
  reply, `CommentThreadDrawer`, both bento composers, mobile, REST and the
  workflow action were already wired; `TicketResolutionDialog` was the only one
  missing. `QuickAddTicket`, `BentoHero` and `TicketInfo` use `TextEditor` for
  ticket *descriptions*, not comments, and `TaskCommentThread` is project tasks.

## Commands

- Regenerate OpenAPI and sync the developer portal with the `alga-openapi-sync` skill.
- Validate this plan with `python3 ~/.claude/skills/software-planner/scripts/validate_plan.py ee/plans/2026-10-06-ticket-comment-cc-bcc`.
