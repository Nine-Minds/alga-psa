# Scratchpad — Ticket Detail Rework & Notification Suppression

> Folder slug is still `2026-07-07-silent-ticket-close` for continuity; scope broadened 2026-07-09 from
> "silent close" to four workstreams (A silent close, B silent update, C resolution-close restore in grid,
> D grid hero board-change rework).

## Decisions

- **Action-level suppression, not a status.** Silence is a property of the update/close *operation*. `is_closed` on `statuses` stays the source of truth. No "Silently Closed" status.
- **Two-level suppression everywhere** (user, 2026-07-07 and re-confirmed 2026-07-09): contact-facing (default) + optional full internal. UI couples them (internal ⇒ contact); server validates the same. Applies to close AND update surfaces (hero, bulk dialogs, resolution composer, auto-close rules).
- **Webhooks + workflows still fire** with flags in payload (user: "fire with silent:true").
- **No new permission** (user).
- **Grid hero: full parity with entry** (user, 2026-07-09): adopt entry's batched pending-changes + Save/Cancel bar for ALL hero fields, replacing the current 700ms auto-commit. Not the hybrid.
- **Silent on resolution-close: yes** (user, 2026-07-09) — the restored grid resolution composer (and entry, for parity) exposes the suppression control.
- **No sticky checkbox state** — suppression is an explicit per-operation choice each time.
- Scope exclusions: `bulkAddTagsToTickets` (no event → no notification, no checkbox), `TICKET_MERGED`/bundle (separate surface), no grid hero redesign beyond Save bar + gate + Category picker.

## Workstream A — Silent close (contact-facing side effects of TICKET_CLOSED)

Fan-out of `TICKET_CLOSED` (published `optimizedTicketActions.ts:2734`, mirror `ticketActions.ts:1035`):
- `ticketEmailSubscriber.handleTicketClosed` (:2774): contact/client email (~:2961/:2996), bundle-child requesters (:3032), assignee (:3062), additional agents (:3082), watchers int+ext (:3101). All via `sendNotificationIfEnabled`(:480)/`resolveNotificationGate`(:370) — tenant gate, DO NOT touch.
- `surveySubscriber.ts:32` → survey invitation to contact. **Outside the notification-settings gate** — why the "disable subtype" workaround is insufficient.
- `internalNotificationSubscriber` TICKET_CLOSED case (~:2739); client-portal contact branch :128-155.
- Keep firing: `webhookSubscriber.ts:32` → `ticket.closed` (`webhook/webhookEventMap.ts:24`), `slaSubscriber.ts:55`, `rmmAlertTicketClosedSubscriber.ts:30`.

## Workstream B — Silent update (generalize to TICKET_UPDATED / TICKET_ASSIGNED)

A plain status/priority/board/due-date change DOES email the contact today (not just close):
- `ticketEmailSubscriber.handleTicketUpdated` (:1182): contact `ticket-updated-client` send :1416-1432; external watcher :1483; assigned internal :1435-1448; additional :1451-1471.
- **Production path is accumulated**: `handleAccumulatedTicketUpdates` (:1573); direct handler forwards in at :1196-1209; contact send :1820-1835. → **The suppress flag MUST ride on the event payload so it survives `NotificationAccumulator`** (`server/src/lib/eventBus/subscribers/NotificationAccumulator.ts`).
- TICKET_ASSIGNED contact sends: team-assignment client :2136-2155, first individual :2156+, watcher team :2232-2257.

Bulk surface (all in `packages/tickets/src/actions/ticketActions.ts`, all funnel through `updateTicketInTransaction`/`updateTicketWithCache`):
- `moveTicketsToBoard` :1661 (loop `updateTicketWithCache` :1738) → TICKET_UPDATED
- `bulkAssignTickets` :1760 (:1796) → TICKET_ASSIGNED
- `bulkUpdateTicketDueDate` :1888 (:1915) → TICKET_UPDATED
- `bulkUpdateTicketStatus` :1934 (:1961) → TICKET_UPDATED or TICKET_CLOSED (if is_closed)
- `bulkUpdateTicketPriority` :1981 (:2008) → TICKET_UPDATED
- `bulkAddTagsToTickets` :1815 (:1870) → **no event** (writes tags directly) → out of scope
- `deleteTickets` :1610 → out of scope

Bulk dialogs (add suppression control): `BulkChangeStatusDialog.tsx:89-101`, `BulkChangePriorityDialog.tsx:84-96`, `BulkAssignTicketsDialog.tsx:134-146`, `BulkSetDueDateDialog.tsx:79-123` (has a radio-group pattern to mirror), inline Move-to-Board `TicketingDashboard.tsx:2306-2420`. NOT `BulkAddTagsDialog`.
Route clients that dispatch: `server/src/app/msp/tickets/_components/BulkChange*RouteClient.tsx`, `BulkAssignTicketsRouteClient.tsx`, `BulkSetDueDateRouteClient.tsx`; shared hook `TicketBulkRouteHelpers.ts`. Multi-select state: `TicketsRouteProvider.tsx:96-149`. Toolbar `BulkTicketActionBar.tsx:65-136`; dispatch `TicketingDashboard.tsx:2628-2677`.

Event payload schemas to extend: `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts` — `ticketClosedEventPayloadSchema:51-58`, `ticketAssignedEventPayloadSchema:36-47`, `ticketUpdatedEventPayloadSchema:74-79`; registered in `eventBusSchema.ts:1040,1069,1393`.
Options type: `UpdateTicketInTransactionOptions` `optimizedTicketActions.ts:2308-2313`; event selection `:2726-2806`.

## Workstream C — Resolution-comment close in grid (bento) layout

Shared action (does NOT itself close — just records comment + `closes_ticket` metadata): `addTicketCommentWithCache` `optimizedTicketActions.ts:2994` (is_resolution :3076, closes_ticket metadata :3082; client wrapper :3290). Close-rule gate: `validateTicketClosure.ts:94-107` (needs is_resolution OR metadata.closes_ticket when board requires).

Entry (works): `TicketConversation.tsx` — onAddNewComment sig has 3rd `closeStatusId` (:73); resolution switch :689-698; **Close status CustomSelect :700-720** (from `closedStatusOptions`, computed `TicketDetails.tsx:413-425`, passed :3390); submit :250-254. The actual close is in shared `TicketDetails.handleAddNewComment`: willCloseTicket :1787, close via `handleSelectChange('status_id', closeStatusId)` :1821-1825.

Grid (broken/missing): `TicketBentoLayout.onAddNewComment` prop :112 — **2 args only**; passes down :940. `BentoTimelineTile.onAddNewComment` :70 — 2 args; resolution lane exists (state :319, button :622) but send passes only 2 args (:525) and there's **no Close status selector**. Because `handleAddNewComment` defaults `closeStatusId=null`, the close block never fires. Both layouts share `handleAddNewComment` (entry :3395, grid :3238).

Fix: add 3rd arg through the grid chain (:112, :70), thread `closedStatusOptions` into the bento layout, add a Close status select + suppression control in the grid Resolution lane, pass `closeStatusId` (+ suppress flags) on send.

OPEN: should a silent resolution-close also suppress the TICKET_COMMENT_ADDED notification for the resolution comment itself? Default NO (comment stays client-visible; only close-side contact notifications suppressed). Confirm with product.

## Workstream D — Grid hero board-change rework (port entry's unsaved-changes model)

Layout switch: `TicketDetails.tsx` — layoutMode :463-466 (default 'entry'), `useGridLayout` :496, fork :3201-3211 (grid `TicketBentoLayout`, entry `TicketInfo` :3317-3371). "All fields" drawer renders full `TicketInfo` even in grid (:3519-3576) — that's the only place grid gets category editing today.

Entry hero `TicketInfo.tsx` (the pattern to port):
- pending state: `pendingChanges` :172, `originalTicketValues` :186-196, `hasUnsavedChanges` :277-289, `useRegisterUnsavedChanges` :292 (`packages/ui/src/context/UnsavedChangesContext.tsx:213-234`), `onLiveDirtyFieldsChange` :307-335 (consumed `TicketDetails.tsx:3363`).
- diff/discard: `handlePendingChange` :820-828 (self-cleaning), `clearPendingChangeFields` :677-691, `handleSaveChanges` :858-953, `usePageSaveShortcut` :955-957, discard :959-976, cancel dialog :2024.
- board→status/category reset: **board select handler :1373-1389** (clears status_id, category_id, subcategory_id), board-scoped statuses `loadBoardStatuses` :380-417 (`getTicketStatuses`), categories :447-497 (`getTicketCategoriesByBoard`, `ticketCategoryActions.ts:212/:222`), priority/ITIL reset :471-477.
- destination gate: `requiresDestinationStatusSelection` :243-247, warning :1249-1253, disables Save :2005, early return :859.
- live-conflict board clear :710-714.
- Locked by test `packages/tickets/src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx` (build grid analogue).

Grid hero `BentoHero.tsx` (what's missing):
- board select :605-613 commits `board_id` ALONE (no reset); status select :580-587; `scopedStatusOptions` :284-290 (filters to saved board only); **no category control at all**; auto-commit via `commitField` :182-188 + `flushPending` :162-178 (700ms) + blur/unmount flush :245-252. No pending/hasUnsavedChanges/Save bar/nav guard (grep confirms).

Persistence (reuse): `handleSelectChange` `TicketDetails.tsx:1560-1650` (per-field immediate), `handleBatchSaveChanges` :2336-2370 (one batched write via `onBatchTicketUpdate` → `updateTicketWithCache`). Grid's new Save bar → `onBatchSelectChange` → `handleBatchSaveChanges`. The batched save is where individual silent-update/close flags attach (FR15/FR29) — `handleBatchSaveChanges`/`onBatchTicketUpdate` must forward suppress options into `updateTicketWithCache`.

## Cross-workstream backbone

One `UpdateTicketInTransactionOptions` flag pair + one payload-schema extension on the three events + gates at the `ticketEmailSubscriber` contact/watcher send sites (`:1416`, `:1483`, `:1820`, `:2136`, `:2156`, close sites in `handleTicketClosed`) + `surveySubscriber` + `internalNotificationSubscriber` = the backbone shared by A, B, and silent resolution-close (C) and individual silent hero save (D/FR15).

## To verify during implementation

- [ ] Exact `NotificationAccumulator` field/shape to carry flags without disturbing dedup keys (F010).
- [ ] `event_catalog` payload-schema duplication (F065) and v1 REST update/close endpoint (F064).
- [ ] `writeTicketActivity` metadata shape (JSONB?) for the silent annotation (F013/F014).
- [ ] Whether grid Category picker should include subcategory inline or defer to drawer (PRD open question).
- [ ] Client-portal ticket update entry points to strip/reject flags (F015).

## Gotchas

- Do NOT use the `publishEvent` explicit-channel shortcut to suppress — it skips email + internal channels but not `surveySubscriber`/`webhookSubscriber` (default channel) and hides the op from internal notifications entirely. Gate in the subscribers instead.
- Interim ops workaround for the production cleanup (before this ships): disabling the "Ticket Closed"/"Ticket Updated" notification subtype tenant-wide silences during the window AND survey invitations still send (outside the gate) — verify surveys are off first.
- Both action paths (`optimizedTicketActions`, `ticketActions`) must ship together (mirror drift).
- Grid full-parity means REMOVING the 700ms auto-commit; make sure nothing else relies on `commitField` firing immediately (blur/unmount flush at BentoHero :245-252).
- Citus: only `ALTER TABLE board_auto_close_rules ADD COLUMN` — safe.

## Links

- Plan folder: `ee/docs/plans/2026-07-07-silent-ticket-close/`
- Entry board-change test to mirror: `packages/tickets/src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx`

## 2026-07-09 — Shared suppression plumbing batch (F001-F010, T001-T011)

- Implemented the base operation-level suppression option pair:
  - `packages/tickets/src/actions/optimizedTicketActions.ts`
    - `UpdateTicketInTransactionOptions` now accepts `suppressContactNotifications` and `suppressInternalNotifications`.
    - `updateTicketWithCache` exposes the same option pair.
    - `updateTicketInTransaction` validates `suppressInternalNotifications` requires `suppressContactNotifications`.
    - `TICKET_CLOSED`, `TICKET_UPDATED`, and `TICKET_ASSIGNED` payloads now include default-false suppression booleans.
  - `packages/tickets/src/actions/ticketActions.ts`
    - Mirror `UpdateTicketOptions` accepts the pair, validates the same invariant, preserves the validation error instead of wrapping it, and emits the flags on the same three event payloads.
- Event schema changes:
  - `packages/event-schemas/src/schemas/domain/ticketEventSchemas.ts` adds optional/default-false suppression fields to the three domain payload schemas.
  - `packages/event-schemas/src/schemas/eventBusSchema.ts` also adds the fields to legacy `TicketEventPayloadSchema`; this matters because `EventSchemas.TICKET_*` unions legacy + domain schemas, and otherwise non-boolean suppression fields could pass through the broad legacy branch.
- Notification accumulator decision:
  - No production code change was needed in `server/src/lib/notifications/NotificationAccumulator.ts`; it already stores each accumulated event's full `payload` while deduping only by `tenantId:ticketId:eventType`.
  - Added a regression test proving both suppression flags survive accumulation and the pending Redis key stays unchanged.
- Tests added/updated:
  - `packages/tickets/src/actions/optimizedTicketActions.liveUpdates.test.ts`
    - contact-only/full suppression succeeds, invalid internal-only suppression rejects, default flags are false, non-closing status updates propagate without error, assigned/closed/update payloads carry flags.
  - `packages/tickets/src/actions/ticketActions.authorizationNarrowing.test.ts`
    - mirror path rejects internal-only suppression before DB work; repaired existing mocks for `trx.raw`, status subquery, positional `where`, and `users.orderBy` used by the current ticket list/detail implementation.
  - `packages/tickets/src/actions/ticketActions.suppressionMirror.contract.test.ts`
    - source-level drift guard that both optimized and mirror paths include both fields in all three ticket event payloads and share the validation invariant.
  - `packages/event-schemas/src/schemas/eventBusSchema.ticketSuppressionFlags.test.ts`
    - legacy payloads default false, domain payloads accept booleans, non-boolean suppression fields reject.
  - `server/src/lib/notifications/__tests__/NotificationAccumulator.suppression.test.ts`
    - payload preservation + dedupe-key regression.
- Verification:
  - `npx vitest run src/actions/optimizedTicketActions.liveUpdates.test.ts src/actions/ticketActions.authorizationNarrowing.test.ts src/actions/ticketActions.suppressionMirror.contract.test.ts` from `packages/tickets` passed: 3 files, 19 tests.
  - `npx vitest run --config vitest.config.ts ../packages/event-schemas/src/schemas/eventBusSchema.ticketSuppressionFlags.test.ts src/lib/notifications/__tests__/NotificationAccumulator.suppression.test.ts` from `server` passed: 2 files, 10 tests.
  - `npm -w @alga-psa/tickets run typecheck` passed.
  - `npm -w @alga-psa/event-schemas run typecheck` passed.
  - `cd server && npm run typecheck -- --pretty false` was first attempted but Node hit heap OOM near 8GB after ~94s.
  - `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -- --pretty false` from `server` passed.

## 2026-07-09 — Webhook/workflow propagation batch (F011-F012, T012-T013)

- Webhook payload propagation (F011/T012):
  - `server/src/lib/eventBus/subscribers/webhook/webhookTicketPayload.ts`
    - `TicketWebhookPayload` now includes `suppress_contact_notifications` and `suppress_internal_notifications`, defaulting false when the source event omits them.
    - The cached DB-derived payload explicitly excludes operation-level suppression fields; the builder adds them per event so cached ticket data cannot leak a previous operation's flags.
  - `server/src/lib/eventBus/subscribers/webhook/__tests__/webhookTicketPayload.test.ts`
    - Added default-false assertions to the documented field-set test.
    - Added update/close cases proving silent source events carry the two flags into the webhook payload.
- Workflow stream propagation (F012/T013):
  - No production code change was needed in `server/src/lib/eventBus/index.ts`; default-channel publish already runs `convertToWorkflowEvent(fullEvent, ...)`, and `convertToWorkflowEvent` keeps `payload: event.payload`.
  - Added `server/src/lib/eventBus/index.suppressionPayload.test.ts`, which mocks Redis, publishes a silent `TICKET_UPDATED`, and verifies the `workflow:events:global` `payload_json` includes both suppression flags.
  - Extended `packages/tickets/src/actions/optimizedTicketActions.liveUpdates.test.ts` silent-close coverage so a suppressed close still publishes the SLA stage completion event when the SLA builder returns one.
- Verification:
  - `npx vitest run src/actions/optimizedTicketActions.liveUpdates.test.ts` from `packages/tickets` passed: 1 file, 11 tests.
  - `npx vitest run --config vitest.config.ts src/lib/eventBus/subscribers/webhook/__tests__/webhookTicketPayload.test.ts src/lib/eventBus/index.suppressionPayload.test.ts` from `server` passed: 2 files, 7 tests.
  - `npm -w @alga-psa/tickets run typecheck` passed.
  - `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -- --pretty false` from `server` passed.
