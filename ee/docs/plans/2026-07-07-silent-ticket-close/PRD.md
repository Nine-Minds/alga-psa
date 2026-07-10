# PRD — Ticket Detail Rework & Notification Suppression

- Slug: `2026-07-07-silent-ticket-close` (folder kept for continuity; scope broadened 2026-07-09)
- Date: `2026-07-07` (revised `2026-07-09`)
- Status: Draft

## Summary

Four related pieces of ticket work, sharing a common notification-suppression primitive and a common "batched unsaved-changes" UI pattern:

- **Workstream A — Silent close.** Close a ticket without notifying the contact (no close email, no survey invitation, no client-portal notification), with an optional deeper level that also skips internal staff notifications. Workflows, SLA, webhooks, and the activity log keep firing; the close event carries the suppression flags.
- **Workstream B — Silent update.** Generalize A's suppression from `TICKET_CLOSED` to `TICKET_UPDATED` and `TICKET_ASSIGNED`, so any ticket update (status, priority, assignee, board, due date) can be applied silently. Expose it on every bulk-update confirmation dialog and on individual ticket updates (the hero Save bar).
- **Workstream C — Restore resolution-comment close in the grid layout.** The older "entry" ticket UI lets a resolution comment close the ticket by picking a close status in the composer; the new "grid" (bento) layout dropped that wiring. Restore it in the grid composer, and (per decision) offer the silent option on a resolution-driven close.
- **Workstream D — Grid hero board-change rework.** In the grid layout, changing the Board is broken because board is committed on its own while the now-invalid board-scoped Status/Category are left untouched, so the write is rejected. Port the entry UI's batched unsaved-changes pattern (pending diff + Save/Cancel bar + destination-status gate + nav guard) to the grid hero so board changes reset and re-select Status/Category before saving.

Suppression is modeled as a property of the update *operation*, not a status. No new ticket status is introduced; `is_closed` on `statuses` stays the single source of truth.

## Problem

**Notifications (A + B).** Every transition to a closed status publishes `TICKET_CLOSED`, and every plain field change publishes `TICKET_UPDATED` (or `TICKET_ASSIGNED` for assignee changes). Each fans out to contact-facing side effects:

- Close → contact "ticket closed" email (`ticketEmailSubscriber.handleTicketClosed`), satisfaction survey invitation (`surveySubscriber`), client-portal notification (`internalNotificationSubscriber`), plus watchers/agents.
- Update → contact "ticket updated" email via the `ticket-updated-client` template (`ticketEmailSubscriber.handleTicketUpdated` / `handleAccumulatedTicketUpdates`) and external-watcher emails.
- Assign → contact/client assignment emails.

There is no per-operation way to suppress the contact-facing sends. Bulk-cleaning stale tickets (status/priority/board changes, mass closes) therefore spams contacts with update and close emails and survey invitations. The only workaround (disabling a tenant-wide notification subtype) silences legitimate activity during the window and does not stop survey invitations, which sit outside the notification-settings gate.

**Resolution-comment close (C).** In the entry UI, a technician marks a comment as "Resolution," picks a close status in the composer, and the ticket closes. The grid (bento) composer has a "Resolution" lane but no close-status selector and never passes a close status up, so a resolution comment is recorded but the ticket is never closed — a regression against the entry UI.

**Board change (D).** In the grid hero, board is called `board_id`; Status and Category are board-scoped. Selecting a new board commits `board_id` immediately (700ms debounce) while leaving `status_id`/`category_id` pointing at the old board's now-invalid values, so the persisted write is rejected and the board change appears blocked. The entry hero already handles this by batching edits, resetting Status/Category on board change, and blocking Save until a destination status is chosen.

## Goals

- **A/B suppression, two-level (everywhere):**
  - Level 1 (default when enabled): **contact-facing silence** — no contact/client email, no survey invitation, no client-portal notification, no external-watcher email. Internal staff (assignee, internal watchers, additional agents) still notified.
  - Level 2: **full silence** — additionally suppress internal staff emails and in-app notifications. Only the activity log records the change.
- Expose the two-level option on: the ticket hero Save/Cancel bar (individual close *and* update, both entry and grid), every bulk-update confirmation dialog, the resolution-comment composer (silent resolution-close), and board auto-close rules (persisted).
- Keep firing on any suppressed operation: workflows, SLA tracking, outbound webhooks, activity timeline, live UI updates. Event and webhook payloads carry the suppression flags so consumers can branch. The activity entry records that the operation was silent.
- **C:** A resolution comment in the grid composer can close the ticket to a chosen close status, matching entry-UI behavior, honoring close-rule validation, and optionally silently.
- **D:** The grid hero adopts the entry UI's batched unsaved-changes model for all hero fields — pending diff, Save/Cancel bar, nav guard, destination-status gate on board change, board-scoped Status/Category reload and reset — reaching full parity with the entry hero (user decision: full parity, not a hybrid).

## Non-goals

- No new ticket status or status-level suppression flag (`statuses` schema unchanged). A status-driven variant can be layered later on the same action primitive.
- No suppression of workflows, SLA events, webhooks, or activity logging.
- No new permission — anyone who can update/close a ticket can do so silently.
- No silent option in the client portal (client users updating/closing their own tickets always notify normally).
- No change to the notification-settings gate architecture (`resolveNotificationGate` untouched).
- `bulkAddTagsToTickets` publishes no ticket-update event today, so it sends no contact notification and is out of suppression scope (its dialog gets no silent checkbox). `TICKET_MERGED` (bundle) is a separate notification surface and is out of scope.
- No visual redesign of the grid hero beyond adding the Save/Cancel bar, destination-status gate, and Category control needed for parity.
- No monitoring/metrics beyond existing debug logging.

## Users and Primary Flows

**Persona:** MSP dispatcher/admin/technician doing ticket hygiene and day-to-day ticket work in the MSP portal.

1. **Silent individual update/close (hero).** User edits fields in the ticket hero (e.g. status → a closed status, or priority), the Save/Cancel bar appears; user checks "Don't notify contact" (optionally "Also skip internal notifications") and Saves. Contact receives nothing; the change persists; timeline records a silent update/close.
2. **Silent bulk update.** User multi-selects stale tickets, picks a bulk action (status/priority/assignee/board/due date); the confirmation dialog shows the two-level suppression option; on confirm, none of the selected tickets notify contacts.
3. **Silent resolution-close (grid).** In the grid composer, user selects the Resolution lane, writes the resolution, picks a close status, optionally checks "Don't notify contact," and sends. The comment is recorded, the ticket closes to the chosen status, and (if silent) no contact notification is sent.
4. **Board change (grid).** User opens the board dropdown in the grid hero and selects a new board. Status and Category clear; a warning prompts selecting a status for the new board; the Save bar stays disabled until a destination status is chosen. On Save, board + status + category persist together.
5. **Auto-close rules.** Admin enables "Close silently" (contact and/or full) on a board auto-close rule; the scheduled job closes aging tickets without notifying contacts, and the pre-close warning email is skipped when contact suppression is set.

## UX / UI Notes

- **Suppression control (reused component).** A small two-checkbox control: "Don't notify contact" (helper: "Skips the customer email, survey invitation, and client-portal notification") + indented "Also skip internal notifications" (enabled only when the first is checked; unchecking the first clears and disables the second). Server validates `internal ⇒ contact`. Defaults unchecked on every open (no sticky state). Used verbatim on the hero Save bar, every bulk dialog, and the resolution composer.
- **Hero Save/Cancel bar (grid, new; entry, existing).** Grid hero gains entry parity: a "Save Changes *"/Cancel bar that appears when there are unsaved changes, a nav-guard registration, and a discard confirmation. The current 700ms auto-commit debounce in the grid hero is replaced by the pending-diff + explicit-Save model. The suppression control lives on this bar.
- **Board change (grid).** Selecting a new board clears Status, Category, Subcategory (and Priority if the new board's priority type differs); shows an amber "Select a status for the new board before saving" warning; disables Save until a destination status is chosen — mirroring `TicketInfo`. A Category picker is added to the grid hero so category can be re-selected inline (today it exists only in the "All fields" drawer).
- **Resolution composer (grid).** The Resolution lane gains a "Close status" select (populated from the board's `is_closed` statuses) plus the suppression control. Choosing a close status and sending closes the ticket; close-rule validation still applies.
- **Timeline.** A silent update/close activity entry shows a muted "silent" annotation ("updated the ticket (silent — contact not notified)" / "closed the ticket (silent)").
- All new interactive elements use kebab-case `id`s and `t('…')` i18n keys (MSP portal locales).

## Requirements

### Functional Requirements — Shared plumbing (A + B)

- **FR1** `UpdateTicketInTransactionOptions` (`optimizedTicketActions.ts:2308`) gains `suppressContactNotifications?: boolean` and `suppressInternalNotifications?: boolean` (default false). Server validates `suppressInternalNotifications ⇒ suppressContactNotifications`.
- **FR2** Both action paths accept and thread the flags: `updateTicketWithCache`/`updateTicketInTransaction` (`optimizedTicketActions.ts:2323/2964`) and the mirror `updateTicket` in `ticketActions.ts`.
- **FR3** The flags are written into the published payload for all three ticket lifecycle events — `TICKET_CLOSED`, `TICKET_UPDATED`, `TICKET_ASSIGNED` — chosen at `optimizedTicketActions.ts:2726-2806` (and the mirror in `ticketActions.ts`). The three Zod payload schemas in `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts` gain the two optional boolean fields (default false); legacy payloads remain valid.
- **FR4** Flags are a no-op (ignored, not errored) when there is nothing contact-facing to suppress; they simply propagate.
- **FR5** `NotificationAccumulator` carries the suppression flags through accumulation so they survive into `handleAccumulatedTicketUpdates` (the production update path).
- **FR6** Outbound webhooks still fire; the flags are included in the webhook payload. Workflow events on the default channel still fire with the flags in payload (`eventBus/index.ts:786-824`).
- **FR7** The close/update activity entry (`writeTicketActivity`) records suppression metadata; the timeline UI renders a "silent" annotation.
- **FR8** Client-portal update/close paths strip/reject the flags for client users (`TicketDetailsContainer` client wrapper and any client-portal action).

### Functional Requirements — Contact-facing subscriber gates (A + B)

- **FR9** `ticketEmailSubscriber.handleTicketClosed` (`:2774`): skip contact/client close email and bundle-child requester emails when `suppressContactNotifications`; additionally skip assignee, additional-agent, and internal-watcher emails when `suppressInternalNotifications`; skip external-watcher emails on contact suppression.
- **FR10** `ticketEmailSubscriber.handleTicketUpdated` (`:1182`) and `handleAccumulatedTicketUpdates` (`:1573`): skip the `ticket-updated-client` contact/client send (`:1416`, `:1820`) and external-watcher send (`:1483`) on contact suppression; skip internal assignee/additional/internal-watcher sends on internal suppression.
- **FR11** `ticketEmailSubscriber` `TICKET_ASSIGNED` contact sends (team-assignment client `:2136`, first individual-assignment client `:2156`, watcher team `:2232`) are gated on contact suppression; internal assignment notifications gated on internal suppression.
- **FR12** `surveySubscriber` skips the survey invitation on contact suppression.
- **FR13** `internalNotificationSubscriber` skips the client-portal contact notification on contact suppression and staff in-app notifications on internal suppression, for both `TICKET_CLOSED` and `TICKET_UPDATED`.
- **FR14** Default behavior unchanged: with flags off, every close/update/assign produces the exact pre-change notification set (regression-guarded, incl. the comment-email de-dup via `metadata.closes_ticket`).

### Functional Requirements — Silent-close & silent-update UI surfaces (A + B)

- **FR15** The reusable two-level suppression control is added to the ticket hero Save/Cancel bar in **both** the entry hero (`TicketInfo`) and the grid hero (`BentoHero`), and its values are threaded into the batched save (`handleBatchSaveChanges` → `updateTicketWithCache` options). This covers individual silent update and silent close from the hero.
- **FR16** The suppression control is added to every bulk-update confirmation dialog that produces a ticket-update event: `BulkChangeStatusDialog`, `BulkChangePriorityDialog`, `BulkAssignTicketsDialog`, `BulkSetDueDateDialog`, and the inline "Move to Board" dialog (`TicketingDashboard.tsx:2306-2420`). (Not `BulkAddTagsDialog` — no event.)
- **FR17** Each bulk route-client/handler threads the flags into its bulk action, and each bulk action (`bulkUpdateTicketStatus/Priority/DueDate`, `bulkAssignTickets`, `moveTicketsToBoard` in `ticketActions.ts`) forwards them into `updateTicketInTransaction`/`updateTicketWithCache` for every ticket in the batch.
- **FR18** Bundle-child close propagation passes the same suppression flags to child closes.

### Functional Requirements — Auto-close rules (A)

- **FR19** Migration adds `suppress_contact_notifications` and `suppress_internal_notifications` boolean NOT NULL DEFAULT false to `board_auto_close_rules`. `closeRuleActions` read/write/validate them (`internal ⇒ contact`); the settings UI exposes the toggles; `autoCloseTicketsHandler` passes them into the close; the pre-close warning email is skipped when contact suppression is set.

### Functional Requirements — Resolution-comment close in grid (C)

- **FR20** The grid composer callback chain carries a close status: `BentoTimelineTile.onAddNewComment` (`:70`) and `TicketBentoLayout.onAddNewComment` (`:112`) gain the third `closeStatusId` argument, matching `TicketConversation.onAddNewComment` (`:73`).
- **FR21** `TicketDetails` threads `closedStatusOptions` (`:413-425`) into `TicketBentoLayout` → `BentoTimelineTile`; the grid Resolution lane renders a "Close status" select populated from those options.
- **FR22** Selecting a close status and sending a resolution comment closes the ticket via the shared `handleAddNewComment` close path (`TicketDetails.tsx:1821`), setting `metadata.closes_ticket` and moving `status_id` to the chosen close status; close-rule validation (`validateTicketClosure.ts:94-107`) still applies.
- **FR23** The grid Resolution lane exposes the two-level suppression control; when set, the resolution-driven close is silent (flags threaded into the close status update and thus the `TICKET_CLOSED` event). Entry UI's `TicketConversation` resolution composer gains the same control for parity.
- **FR24** With no close status selected, a resolution comment behaves as today (records `is_resolution`, does not change status).

### Functional Requirements — Grid hero board-change rework (D)

- **FR25** The grid hero (`BentoHero`) adopts the entry UI's unsaved-changes model: a `pendingChanges`/`originalTicketValues` diff (`handlePendingChange` self-cleaning), a derived `hasUnsavedChanges`, `useRegisterUnsavedChanges` nav-guard registration, a Save/Cancel bar, and a discard confirmation — replacing the current `commitField`/`flushPending` 700ms auto-commit (full parity, all hero fields batched).
- **FR26** Selecting a new board in the grid hero clears `status_id`, `category_id`, `subcategory_id` (and `priority_id` when the new board's priority type differs), mirroring `TicketInfo.tsx:1373-1389`.
- **FR27** The grid hero loads board-scoped statuses (`getTicketStatuses(effectiveBoardId)`) and categories (`getTicketCategoriesByBoard`) for the pending board, and renders Status and a new Category picker from the effective (pending-or-saved) board.
- **FR28** A `requiresDestinationStatusSelection` gate (board changed AND no pending status) shows a warning and disables Save until a destination status is chosen, mirroring `TicketInfo.tsx:243-247`.
- **FR29** Saving the grid hero persists all pending fields in one batched write via `handleBatchSaveChanges`; on success the pending buffers clear and `originalTicketValues` advances. The Save honors the suppression control (FR15). A save keyboard shortcut and live dirty-field reporting (`onLiveDirtyFieldsChange`) are ported for parity.
- **FR30** Live-conflict "take theirs" for board clears the coupled fields (`board_id`, `status_id`, `category_id`, `subcategory_id`) as in `TicketInfo.tsx:710-714`.

### Non-functional Requirements

- **NFR1** Backward compatible: flags optional/default-false; all existing callers, events, webhook consumers, and the entry hero behave unchanged.
- **NFR2** Multi-tenant safe: the only schema change is `ALTER TABLE board_auto_close_rules ADD COLUMN` (booleans); tenant already in PK.
- **NFR3** No hardcoded UI strings; new keys added to MSP portal locale packs and validated by the pseudo-locale generation + validation script run.
- **NFR4** Both action paths (`optimizedTicketActions`, `ticketActions`) ship the suppression change together (mirror-drift risk).
- **NFR5** Grid hero board-change parity is guarded by tests analogous to the entry UI's `TicketInfo.boardChangeStatusReselection.test.tsx`.

## Data / API / Integrations

- **DB migration** (`server/migrations/`): two boolean columns on `board_auto_close_rules` (default false). No other schema change. Activity suppression metadata rides existing activity payload (verify JSONB shape).
- **Event schemas**: extend `ticketClosedEventPayloadSchema` (`:51-58`), `ticketUpdatedEventPayloadSchema` (`:74-79`), `ticketAssignedEventPayloadSchema` (`:36-47`) in `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts`; check whether `event_catalog` stores duplicate payload schemas needing update.
- **Webhook contract**: `ticket.closed`/`ticket.updated` payloads gain the two suppression fields (additive).
- **REST API v1**: if the public tickets API exposes update/close, accept the optional flags (additive); verify surface, N/A if absent.
- **Actions touched**: `optimizedTicketActions.ts`, `ticketActions.ts` (bulk + single), `close-rules/closeRuleActions.ts`, `autoCloseTicketsHandler.ts`, `ticketCategoryActions.ts` (grid category load).

## Security / Permissions

- No new permission; available to any MSP user with ticket update rights. Client-portal users cannot suppress (FR8). Suppression is auditable via the timeline entry.

## Observability

- Existing debug logging only: a one-line "skipped due to suppression" at each subscriber gate.

## Rollout / Migration

- Single additive migration (defaults false ⇒ no behavior change on deploy). No feature flag (default-off flags preserve current behavior). Ship both action paths together. Grid-hero rework and resolution-close restore are UI-guarded by tests; they change grid behavior but not entry behavior.

## Open Questions

- Exact `NotificationAccumulator` field to carry the suppression flags without disturbing dedup keys (verify during implementation).
- Whether a silent resolution-close should also suppress the `TICKET_COMMENT_ADDED` notification for the resolution comment itself (default: no — the comment stays client-visible; only the close-side contact notifications are suppressed). Confirm with product.
- Whether `event_catalog` duplicates payload schemas (FR3) and whether the v1 REST API has an update/close endpoint (Data section).
- Whether the grid Category picker should include subcategory inline or defer subcategory to the drawer.

## Acceptance Criteria (Definition of Done)

1. **Silent close:** closing with "Don't notify contact" sends no contact close email, no survey invitation, no client-portal notification (assignee/watchers still notified), while webhook + workflow + SLA + timeline still fire and the timeline shows a silent close. Both checkboxes ⇒ nothing sent to anyone but timeline/webhook/workflow/SLA.
2. **Silent update:** a silent status/priority/board/assignee change (individual or bulk) sends no `ticket-updated-client`/assignment email to the contact, no external-watcher email, while internal staff are notified per level and the event still reaches workflows/webhooks.
3. **Silent everywhere:** the two-level control appears and works on the hero Save bar (entry + grid), every eligible bulk dialog, the resolution composer, and auto-close rules; bulk applies to every ticket in the selection including bundle children.
4. **Resolution-close restored (grid):** a resolution comment with a chosen close status closes the ticket in the grid layout (honoring close rules), matching entry-UI behavior, and can be done silently.
5. **Board change (grid):** selecting a new board clears Status/Category, warns, blocks Save until a destination status is chosen, and on Save persists board+status+category together; guarded by a test analogous to the entry UI's.
6. **No regressions:** with flags off, all close/update/assign notifications and the entry hero behave exactly as before; existing ticket-close and `TicketInfo` board-change tests pass.
7. **Validation & platform:** `suppressInternalNotifications` without contact is rejected; client-portal users cannot suppress; new strings are i18n keys; new interactive elements have kebab-case ids; `features.json` and `tests.json` fully checked off.
