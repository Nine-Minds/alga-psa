# Scratchpad — shared tickets on the native ticket screen

## Origin
- Captain review of PR #3363 (step 4 of the review guide): the MSP's shared ticket
  view "feels like it's not from the same app". Captain chose option (a): hold the PR
  and rework before merge. PR converted to draft 2026-10-15 to stop auto-merge.

## Discoveries (2026-10-15)
- `TicketDetails.tsx` (4647 lines) + ~20 sections call ~115 distinct actions; >90%
  imported directly; all withAuth/session-tenant except avatar batch actions, which
  take an explicit tenant and no auth check (do NOT call with a foreign tenant).
- Only ~8 actions flow as props (`onTicketUpdate`, `onBatchTicketUpdate`,
  `onAddComment`, `onUpdateDescription`, 3 attachment callbacks, `bootstrap`).
- Existing contexts used by the tree: SchedulingCallbackProvider,
  DocumentsCrossFeatureProvider, TicketLiveProvider (disabled default — model for the
  new context), TicketConversationAttachmentsProvider, TagContext.
- Existing flags: isAlgaDeskMode, hideSlaStatus, hideBilling, hideScheduling,
  hideTimeEntry, hideMaterials, disableAttachment*, disableAgentSchedule; checklist and
  external links accept `disabled`. No flags for credentials, bundles, delete, tags,
  email logs, activity log, reactions, live.
- Context swap alone won't fix: useTicketLive URL/room, CommentItem
  `window.location.reload()`, `router.refresh()` calls, BackNav href, TicketNavigation,
  `<Documents>` and EE credentials (own actions).
- Shared read (`sharedWorkRead.ts:131`) deliberately excludes rich text
  (description), people/contacts, commercial fields, linked resources, counts. Fields:
  work_revision, responsibility, first_escalated_at, last_transition_at,
  explicit_grant_active, ticket_number, title, board/status/priority refs, is_closed,
  entered_at, updated_at, closed_at.
- Sponsor-editable: title, url, status_id, priority_id, due_date, response_state
  (`ticketEditing.ts:10-17`), per-field optimistic baselines + receipts.
- MSP assignment lives on the sponsor's `co_managed_ticket_references`, not
  `tickets.assigned_to`.
- Conversation: 3 audiences (requester / shared_it / organization_private), private
  store in the sponsor tenant, BlockNote without image/file/mention blocks, own-author
  edit/delete, audience change = disclosure command.
- Time: CoManagedTimeEntry already uses native `NewWorkItemTimeEntry` with
  work_item_type 'co_managed' via a sponsor-tenant work reference.
- List unification precedent: separate page + identity union
  (`packages/tickets/src/lib/ticketListIdentity.ts`), package components never import
  app actions; app fills slots.

## Decisions
- Seam = context provider (`TicketDataSource`) with native default; shared impl in the
  app layer. Props can't carry ~90 actions through two layouts.
- Keep the MSP route (stored notification links + emails already point at it).

## Commands
- Focused suite: see handoff brief (15 files under server/src/test/unit/).
