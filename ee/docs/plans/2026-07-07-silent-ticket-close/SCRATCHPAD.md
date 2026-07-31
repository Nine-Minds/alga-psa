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

## 2026-07-09 Implementation Notes — Close Notification Gates

- Completed F016-F019 and F025:
  - `ticketEmailSubscriber.handleTicketClosed` now resolves the operation suppression flags once and gates contact-facing close emails, bundle-child requester emails, internal staff emails, and watcher emails at the send sites. Contact suppression skips primary/requester/external watcher sends; full suppression also skips assignee/additional/internal watcher sends. Added debug-level skip logs.
  - `surveySubscriber` returns before loading triggers when `suppressContactNotifications` is true, so silent closes do not invite surveys.
  - `internalNotificationSubscriber` now uses shared predicates for ticket update/close in-app notifications: contact suppression skips client-portal contact notifications, internal suppression skips staff notifications, and contact-only still notifies staff.
- Tests added:
  - `server/src/lib/eventBus/subscribers/__tests__/ticketEmailSubscriber.suppression.test.ts`
  - `server/src/lib/eventBus/subscribers/__tests__/surveySubscriber.suppression.test.ts`
  - `server/src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.suppression.test.ts`
- Verification:
  - `cd server && npx vitest run --config vitest.config.ts src/lib/eventBus/subscribers/__tests__/ticketEmailSubscriber.suppression.test.ts src/lib/eventBus/subscribers/__tests__/surveySubscriber.suppression.test.ts src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.suppression.test.ts`
- Bundle note: current bundled-master close behavior sends child-requester close emails from the master `TICKET_CLOSED` event; it did not publish separate child close workflow events in the existing optimized path. The close-gate batch gates the existing child-requester email path.

## 2026-07-09 Implementation Notes — Bundle Silent Child Close Propagation

- Completed F020/T024 in `packages/tickets/src/actions/optimizedTicketActions.ts`.
- Decision: publish child `TICKET_CLOSED` workflow events only for suppressed bundled-master closes whose sync update actually changes a child `status_id`. This satisfies silent child propagation and avoids introducing duplicate child requester emails for normal, non-suppressed master closes, which already notify child requesters from the master close handler.
- Child close event payload carries the child ticket id, child status change, `closedAt`, actor attribution when present, and the same `suppressContactNotifications` / `suppressInternalNotifications` flags as the master close.
- Test added to `packages/tickets/src/actions/optimizedTicketActions.liveUpdates.test.ts` (`T024` case) to verify only the changed child gets the suppressed child close event.
- Verification:
  - `cd packages/tickets && npx vitest run src/actions/optimizedTicketActions.liveUpdates.test.ts`
  - `npm -w @alga-psa/tickets run typecheck`

## 2026-07-09 Implementation Notes — Update/Assignment Email Gates

- Completed F021-F024 (F025 was completed with the close gate commit):
  - Direct `handleTicketUpdated` gates `ticket-updated-client` contact sends on contact suppression; assignee/additional/internal watcher emails on internal suppression; external watcher emails on contact suppression.
  - `handleAccumulatedTicketUpdates` resolves a conservative batch-level suppression policy: any contact-suppressed event suppresses the combined contact email, and any full-suppressed event suppresses combined staff emails.
  - `sendTicketAssignedNotifications`, used by direct and accumulated assignment handling, gates client team/first-agent assignment emails and team watcher emails on contact suppression; assigned-user/additional-agent emails on internal suppression.
- Tests extended in `server/src/lib/eventBus/subscribers/__tests__/ticketEmailSubscriber.suppression.test.ts` for T026-T028/T030.
- Verification:
  - `cd server && npx vitest run --config vitest.config.ts src/lib/eventBus/subscribers/__tests__/ticketEmailSubscriber.suppression.test.ts src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.suppression.test.ts`
  - `cd server && NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -- --pretty false`

## 2026-07-09 Implementation Notes — Reusable Suppression Control

- Completed F026/T033/T034.
- Added `packages/tickets/src/components/ticket/TicketNotificationSuppressionControl.tsx`, a ticket-specific reusable control with:
  - contact checkbox (`Don't notify contact`) plus helper text;
  - indented internal checkbox (`Also skip internal notifications`);
  - coupling where internal is disabled until contact is checked, and unchecking contact clears internal;
  - kebab-case ids derived from an `idPrefix` prop;
  - `features/tickets` translation keys under `notifications.suppression`.
- Added English and `xx` pseudo-locale entries for the new keys. Broader pseudo-locale generation/validation remains open under F061/T069.
- Tests added in `TicketNotificationSuppressionControl.test.tsx`.
- Verification:
  - `cd packages/tickets && npx vitest run src/components/ticket/TicketNotificationSuppressionControl.test.tsx`
  - `npm -w @alga-psa/tickets run typecheck`

## 2026-07-09 Implementation Notes — Entry Hero Suppression Wiring

- Completed F027/T035.
- `TicketInfo` now renders `TicketNotificationSuppressionControl` in the Save/Cancel bar while the entry hero has unsaved changes.
- Suppression state is local to the save session and resets after successful save or discard. Normal saves preserve the previous one-argument `onSaveChanges(changes)` call shape; only contact-suppressed saves pass a second options argument.
- `TicketDetails.handleBatchSaveChanges` and `TicketDetailsContainer.handleBatchTicketUpdate` now accept optional suppression options. The MSP container calls `updateTicketWithCache(..., options)` when suppression is enabled and keeps using `updateTicketWithCacheForCurrentUser` for normal saves, preserving the client-safe wrapper contract.
- Test added to `TicketInfo.boardChangeStatusReselection.test.tsx` for the entry hero save options.
- Verification:
  - `cd packages/tickets && npx vitest run src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx src/components/ticket/TicketNotificationSuppressionControl.test.tsx`
  - `npm -w @alga-psa/tickets run typecheck`

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

## 2026-07-09 — Activity metadata + silent timeline annotation (F013-F014, T014-T015)

- Activity metadata (F013/T014):
  - `packages/tickets/src/actions/optimizedTicketActions.ts`
    - Silent ticket updates/closes now pass `details.notification_suppression` into `writeTicketActivity`.
    - Shape: `{ notification_suppression: { suppress_contact_notifications: true, suppress_internal_notifications: boolean } }`.
    - Normal/non-suppressed updates continue writing no suppression metadata.
  - `packages/tickets/src/actions/optimizedTicketActions.liveUpdates.test.ts`
    - Captures `ticket_audit_logs` inserts and asserts silent updates carry the metadata while normal updates do not.
- Timeline annotation (F014/T015):
  - `packages/tickets/src/components/ticket/TicketActivityTimeline.tsx`
    - Derives a muted inline annotation from `activity.details.notification_suppression`.
    - Contact-only text: `silent — contact not notified`; full silence text: `silent — no notifications`.
    - Exported `formatEntries` for focused formatter tests.
  - `packages/tickets/src/components/ticket/TicketActivityTimeline.silentAnnotation.test.tsx`
    - Verifies contact-suppressed update annotation, fully-suppressed close annotation, and no annotation for normal rows.
- Verification:
  - `npx vitest run src/actions/optimizedTicketActions.liveUpdates.test.ts src/components/ticket/TicketActivityTimeline.silentAnnotation.test.tsx` from `packages/tickets` passed: 2 files, 14 tests.
  - `npm -w @alga-psa/tickets run typecheck` passed.

## 2026-07-09 — Client portal suppression guard (F015, T016)

- Client-callable MSP wrapper:
  - `packages/tickets/src/actions/optimizedTicketActions.ts` already keeps `updateTicketWithCacheForCurrentUser(id, data)` limited to `id` + `data` and calls `updateTicketWithCache(id, data)` without options, so extra client-side suppression args cannot be forwarded through that wrapper.
  - Added a guard in `packages/tickets/src/actions/ticketActions.suppressionMirror.contract.test.ts` to keep that wrapper from accepting/forwarding suppression options.
- Client portal status update path:
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` already exposes `updateTicketStatus(ticketId, newStatusId)` only, and its `TICKET_CLOSED`/`TICKET_UPDATED` payloads omit suppression fields. With schema defaults, client-portal changes remain non-silent and notify normally.
  - Added `packages/client-portal/src/actions/client-portal-actions/client-tickets.suppression.contract.test.ts` to guard the action signature and event payload blocks.
- Verification:
  - `npx vitest run src/actions/ticketActions.suppressionMirror.contract.test.ts` from `packages/tickets` passed: 1 file, 5 tests.
  - `npx vitest run src/actions/client-portal-actions/client-tickets.suppression.contract.test.ts` from `packages/client-portal` passed: 1 file, 3 tests.
  - `npm -w @alga-psa/tickets run typecheck` passed.
  - `npm -w @alga-psa/client-portal run typecheck` passed.

## 2026-07-09 — Resolution-comment close restore (F029, F043-F050, T037, T049-T055)

- Completed the grid composer close-status chain:
  - `TicketBentoLayout.onAddNewComment` and `BentoTimelineTile.onAddNewComment` now accept `closeStatusId` plus optional notification-suppression options.
  - `TicketDetails` threads `closedStatusOptions` into the grid layout, and `BentoTimelineTile` renders a resolution-only close-status select populated from those options.
  - Sending a grid resolution comment with a close status calls the shared `TicketDetails.handleAddNewComment` close path; that path still sets `metadata.closes_ticket` and closes through the same status-update path, preserving close-rule validation.
- Silent resolution-close:
  - Grid and entry resolution composers now show the shared two-level suppression control.
  - Suppression options are only forwarded when a close status is selected; a comment-only resolution remains unchanged and does not imply a silent comment notification.
  - Suppression state resets to unchecked after successful send and whenever the composer leaves resolution mode/closes.
- No-sticky suppression:
  - Added a source-level regression covering false defaults and resets across hero save bars, bulk dialogs, bulk move, and resolution composers. Auto-close rules are excluded from the no-sticky interpretation because their suppression flags are intentionally persisted rule settings.
- Test added:
  - `packages/tickets/src/components/ticket/bento/BentoResolutionClose.contract.test.ts`
- Verification:
  - `cd packages/tickets && npx vitest run src/components/ticket/bento/BentoResolutionClose.contract.test.ts src/components/ticket/bento/BentoHero.unsavedChanges.test.tsx src/components/ticket/TicketNotificationSuppressionControl.test.tsx`
  - `npm -w @alga-psa/tickets run typecheck`

## 2026-07-09 — Platform and final regression pass (F061-F066, T025, T032, T068-T077)

- i18n/platform:
  - Added missing suppression and bento resolution-close keys to `server/public/locales/*/features/tickets.json`.
  - Re-ran `node scripts/generate-pseudo-locales.cjs`; generated pseudo-locale updates are included.
  - Added `server/src/test/unit/ticketsSilentPlatform.contract.test.ts` to guard locale keys, pseudo-locale structure, kebab-case IDs, suppression debug logs, v1 API suppression handling, and workflow/event-catalog schema exposure.
- REST API v1:
  - `server/src/lib/api/schemas/ticket.ts` now accepts optional `suppressContactNotifications` / `suppressInternalNotifications` on generic update, status update, and assignment update bodies.
  - `TicketService.update` strips the flags before row writes, validates `internal => contact`, and publishes them on `TICKET_CLOSED` / `TICKET_UPDATED`.
  - `SdkGeneratorService` exposes the optional fields on `UpdateTicketRequest`.
- Workflow/event catalog:
  - `shared/workflow/runtime/schemas/ticketEventSchemas.ts` now includes the suppression fields on ticket assigned/closed/updated runtime schemas.
  - Legacy workflow catalog initialization in `ee/packages/workflows/src/models/eventCatalog.ts` includes the fields for ticket update/close JSON payload schemas. Modern catalog rows use `payload_schema_ref`; the existing domain catalog migration already points ticket assigned/updated/closed at schema refs.
- Regression coverage:
  - Tagged the normal close notification policy test as T025.
  - Added T032 to `ticketActions.moveToBoard.test.ts` so non-silent bulk status updates pass `{}` options and therefore keep normal notification behavior.
  - Tagged the grid hero silent-save test as T068; it combines with subscriber gates to cover contact suppression from grid saves.
- Verification:
  - `node scripts/generate-pseudo-locales.cjs`
  - `cd packages/tickets && npx vitest run src/actions/optimizedTicketActions.liveUpdates.test.ts src/actions/ticketActions.moveToBoard.test.ts src/actions/close-rules/closeRuleActions.suppression.contract.test.ts src/components/ticket/bento/BentoHero.unsavedChanges.test.tsx src/components/ticket/bento/BentoResolutionClose.contract.test.ts src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx src/components/ticket/TicketActivityTimeline.silentAnnotation.test.tsx src/components/ticket/TicketNotificationSuppressionControl.test.tsx`
  - `cd server && npx vitest run --config vitest.config.ts src/lib/eventBus/subscribers/__tests__/ticketEmailSubscriber.suppression.test.ts src/lib/eventBus/subscribers/__tests__/surveySubscriber.suppression.test.ts src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.suppression.test.ts src/lib/eventBus/subscribers/webhook/__tests__/webhookTicketPayload.test.ts src/lib/eventBus/index.suppressionPayload.test.ts src/test/unit/migrations/autoCloseSuppressionMigration.test.ts src/test/unit/ticketsSilentPlatform.contract.test.ts`
  - `cd packages/jobs && npx vitest run src/lib/handlers/autoCloseTicketsHandlerTenantScoped.contract.test.ts`
  - `npm -w @alga-psa/tickets run typecheck`
  - `npm -w @alga-psa/jobs run typecheck`
  - `npm -w @alga-psa/shared run typecheck`
  - `npm -w @alga-psa/workflows run typecheck`
  - `cd server && NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -- --pretty false`

## 2026-07-09 — Bulk Update Suppression Surfaces (F030-F037, T029/T038-T043)

- Completed the eligible bulk-update surfaces:
  - `BulkChangeStatusDialog`, `BulkChangePriorityDialog`, `BulkAssignTicketsDialog`, and `BulkSetDueDateDialog` render `TicketNotificationSuppressionControl`, reset it to unchecked when opened, and only pass an options object when contact suppression is checked.
  - Routed bulk clients in `server/src/app/msp/tickets/_components/` accept optional `TicketNotificationSuppressionOptions` and pass them to `bulkUpdateTicketStatus`, `bulkUpdateTicketPriority`, `bulkAssignTickets`, and `bulkUpdateTicketDueDate`.
  - Inline Move to Board in `TicketingDashboard.tsx` now renders the same suppression control, resets it on open/close/success, and passes selected flags to `moveTicketsToBoard`.
- Bulk actions now forward suppression flags per ticket:
  - `bulkUpdateTicketStatus`, `bulkUpdateTicketPriority`, `bulkUpdateTicketDueDate`, and user assignment pass options into `updateTicketInTransaction`.
  - `moveTicketsToBoard` passes options into `updateTicketWithCache` for each moved ticket.
  - `bulkAssignTickets` passes options into `assignTeamToTicket`; `assignTeamToTicket` validates `internal ⇒ contact` and includes the flags on its `TICKET_ASSIGNED` payload.
- Scope note: `BulkAddTagsDialog` remains intentionally unchanged because `bulkAddTagsToTickets` writes tags directly and publishes no ticket lifecycle update event. Added a regression guard for that exclusion.
- Tests/verification:
  - `cd packages/tickets && npx vitest run src/actions/ticketActions.moveToBoard.test.ts`
  - `cd server && npx vitest run --config vitest.config.ts src/app/msp/tickets/ticketsModalRoutes.contract.test.ts`

## 2026-07-09 — Grid Hero Pending Save + Board Reselection (F028/F051-F060, T036/T056-T067)

- Replaced `BentoHero`'s 700ms `commitField`/`flushPending` auto-save model with an explicit pending diff:
  - `pendingChanges` + `originalTicketValues` drive display overrides and self-clean when a value returns to its original value.
  - `hasUnsavedChanges` controls the grid Save/Cancel bar and `useRegisterUnsavedChanges`.
  - `onLiveDirtyFieldsChange` is now threaded through `TicketDetails` → `TicketBentoLayout` → `BentoHero` so live update conflict filtering sees dirty grid hero fields.
  - `usePageSaveShortcut` is wired for grid hero saves.
- Grid hero Save/Cancel bar:
  - Uses the reusable `TicketNotificationSuppressionControl` and passes options into `handleBatchSaveChanges` through `onBatchSelectChange`.
  - Clears pending buffers and resets suppression state after successful save.
  - Cancel opens a discard confirmation and reverts pending values.
- Board-change parity:
  - Selecting a new board clears `status_id`, `category_id`, and `subcategory_id` immediately.
  - `BentoHero` loads board-scoped statuses via `getTicketStatuses(effectiveBoardId)` and categories/board config via `getTicketCategoriesByBoard(effectiveBoardId)`.
  - Added a Category picker in the hero for the effective board.
  - If the destination board's priority type differs from the saved board, `priority_id` is cleared.
  - Save is disabled and a warning is shown until a destination status is selected.
  - Saving persists board/status/category/subcategory/priority reset in one batched write.
- Live conflict note:
  - Grid "take theirs" for a board conflict clears the board-coupled pending fields and invalidates stale async priority reset work from the discarded pending board.
- Tests/verification:
  - `cd packages/tickets && npx vitest run src/components/ticket/bento/BentoHero.unsavedChanges.test.tsx`
  - `cd packages/tickets && npx vitest run src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx src/components/ticket/bento/BentoHero.unsavedChanges.test.tsx`
  - `npm -w @alga-psa/tickets run typecheck`

## 2026-07-09 — Auto-Close Rule Suppression (F038-F042, T044-T048)

- Migration:
  - Added `server/migrations/20260709120000_add_suppression_to_board_auto_close_rules.cjs`.
  - Adds `suppress_contact_notifications` and `suppress_internal_notifications` as boolean `NOT NULL DEFAULT false`.
  - Adds `board_auto_close_rules_suppression_check` so internal suppression requires contact suppression.
  - Migration is guarded with `hasColumn`; rollback drops the check and both columns.
- Rule actions:
  - `IBoardAutoCloseRule` / `BoardAutoCloseRuleInput` now include the two suppression fields.
  - `getBoardAutoCloseRules` selects them.
  - create/update persist them; update preserves existing values when omitted.
  - validation rejects `suppress_internal_notifications` without `suppress_contact_notifications`.
- Settings UI:
  - Auto-close rules in `BoardsSettings.tsx` expose contact and internal suppression checkboxes.
  - Contact uncheck clears internal; internal is disabled until contact is checked.
  - Save/reload maps the fields through `autoCloseRulesForm`; new English and pseudo-locale keys were added.
- Handler:
  - `autoCloseTicketsHandler` selects the rule suppression flags for due closes and passes them into `updateTicketInTransaction`, so existing `TICKET_CLOSED` subscriber gates skip contact/survey/portal/internal work according to the level.
  - Pre-close warnings are skipped when contact suppression is set. Decision: mark `warning_sent_at` and write an `AUTO_CLOSE_WARNING_SENT` activity with `outcome: warning_suppressed` so the worker does not retry an intentionally suppressed warning every run.
- Tests/verification:
  - `cd packages/tickets && npx vitest run src/actions/close-rules/closeRuleActions.suppression.contract.test.ts`
  - `cd packages/jobs && npx vitest run src/lib/handlers/autoCloseTicketsHandlerTenantScoped.contract.test.ts`
  - `cd server && npx vitest run --config vitest.config.ts src/test/unit/migrations/autoCloseSuppressionMigration.test.ts`
  - `npm -w @alga-psa/tickets run typecheck`
  - `npm -w @alga-psa/jobs run typecheck`
  - `cd server && NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck -- --pretty false`

## 2026-07-09 — Post-Review Fix Round (10 confirmed findings from high-effort code review)

- Suppression flags dropped on real paths (feature's core guarantee):
  - `internalNotificationSubscriber.handleTicketAssigned` now resolves the suppression flags and gates the assignee staff notification, the client-portal assignment notification, and team-member notifications (previously ignored the flags entirely). Harness exports `handleTicketAssigned`; wiring guarded by a source-contract test.
  - Team assignment from the entry hero save bar: `TicketInfo.handleSaveChanges` passes `saveOptions` into `onAssignTeam`; `TicketDetails.handleAssignTeam` forwards them to `assignTeamToTicket`.
  - `TicketDetails.handleBatchSaveChanges` fallback (no `onBatchTicketUpdate`): when suppression is requested, non-ITIL fields now save through one `updateTicket` mirror call carrying the options instead of per-field `handleSelectChange` calls that dropped them.
- Silent resolution-close: runs the `checkTicketClosure` pre-check like the non-silent path, opens the blocked-close dialog (which now carries the suppression choice into `submitCloseOverride`), and surfaces a failed batch save with a toast instead of resetting the composer as if closed.
- BentoHero:
  - Board re-select: returning to the saved board drops the board-driven overrides via a functional `setPendingChanges` (closure-read of `pendingChanges.priority_id` was racy against the async priority-type reset — caught as a 1-in-5 test flake, fixed by reading `prev`). Previously `{status_id: null}` stayed staged and Save always failed zod.
  - Status options: the displayed status is force-included in `scopedStatusOptions` when the board fetch omits it (global/legacy statuses) so the select never renders blank.
  - Stale docblocks describing the removed 700ms debounce model rewritten. Nav-guard parity with entry hero confirmed (`UnsavedChangesContext` handles beforeunload).
- Accumulated update emails: `resolveAccumulatedTicketNotificationSuppression` switched `.some()` → `.every()` (guarded non-empty) — one silent update no longer swallows a later loud update in the same accumulation window. T027 updated to cover mixed batches.
- Bundle closes: removed the suppressed-only per-child `TICKET_CLOSED` publish — it made silent closes fire child events (internal emails, staff notifications, webhooks, workflow runs) that loud closes never fire. The master event carries the flags and the close subscriber both sends and (when suppressed) skips child requesters from that single event. T024 updated: no per-child close events, live updates still per changed child.
- `updateBoardAutoCloseRule` validates the merged (input over existing) suppression pair and persists the same values — partial updates can no longer pass raw-input validation yet violate the DB CHECK constraint (or be spuriously rejected).
- New/updated tests: internalNotificationSubscriber wiring guard, T024, T027, closeRule merged-validation contract, BentoHero board re-select regression + status-retention regression.
