# Scratchpad — Ticket list: "Me" option in the assignee filter

Source: AlgaPSA ticket alga-2026-0002989. Plan written against origin/main at 88c634d5b5.

## Verified code facts (2026-11-10)

- `packages/tickets/src/lib/ticketFilterPredicates.ts`
  - L109-116: assignee/team/unassigned is one OR group (`assigned_to in`, `assigned_team_id in`,
    `assigned_to is_empty`). Confirmed.
  - L118-120: `assignedToMe && !context.assignedToMeBypass` → `involves_user equals userId`. Confirmed.
  - `TicketFilterCodecContext` carries `userId` (L18) and `assignedToMeBypass` (L20). Confirmed.
  - Sentinels `'no-board'` (L51-53, L61) and `'no-category'` (L85-94) resolved here. Confirmed.
- `involves_user` (shared/lib/ticketQuery/ticketQuerySchema.ts L160-183) is broader than described in the
  brief: assignee OR additional agent (`ticket_resources.additional_user_id`) OR **member of the assigned
  team** (`team_members`). So "Me" (assigned_to only) is materially narrower.
- `assignedToIds` is UUID-validated in several layers; a raw `'me'` would currently be rejected or dropped:
  - `packages/tickets/src/schemas/ticket.schema.ts` L177 `z.array(z.string().guid())` (server action input).
  - `packages/list-views/src/lib/definitions/tickets.ts` L58 `z.array(z.string().guid())` (named views; the
    board default schema `boardViewSettingsSchema.ts` is derived from the same `ticketFiltersShape`).
  - `ticketFilterUtils.ts` `normalizeAssignedToIds` (URL) and `normalizeAssignedToIdList` (stored) keep
    UUIDs only (`ASSIGNEE_UUID_PATTERN`).
  - `ticketViewSettings.ts` `validateCapturedFilters` L336 runs `normalizeAssignedToIdList` then keepList
    against known users.
  - `ticketListViewAdapter.ts` `sanitizeTicketListView` L189 `keepList('assignedToIds', ..., known.userIds)`
    with no pseudo-values (compare boardIds/categoryIds, which pass sentinels).
  - `MultiUserAndTeamPicker` filter-mode cleaner (~L148-168) calls `onValuesChange(validValues)` to strip
    any value that is not an internal user id.
  => The brief's "a sentinel in assignedToIds round-trips through views and URLs" is NOT true today; this
  plan widens each of those boundaries (FR4-FR10).
- Precedent: `'unassigned'` is already a URL-only sentinel (`UNASSIGNED_FILTER_SENTINEL`) translated to
  `includeUnassigned` at the URL boundary. The schema unions for `'no-board'` / `'no-category'` are the
  precedent followed for `'me'`.
- `MultiUserAndTeamPicker.tsx` (846 lines): "Unassigned" row at L643-656 (filter mode). Used by
  `TicketingDashboard.tsx` L2608-2624 with `filterMode`, `compactDisplay`. Chips built ~L2295-2312
  (assignee chip looks the user up in `initialUsers`; would fall back to the generic "Assignee" label for
  `'me'`, hence FR12).
- Other filter-mode consumers of the picker: MspClientTickets, MspContactTickets, ProjectDetail (x2). None
  get "Me" in this card (opt-in prop).
- All optimized list reads go through `buildTicketListBaseQuery` (getTicketsForList, cursor variant,
  getAllMatchingTicketIds, loadTicketListItemsByIds, getAdjacentTicketIds), so the codec is the single
  resolution point.
- `@alga-psa/types` exports runtime consts (`TICKET_ORIGINS`), and list-views depends on types but must not
  import tickets → constant goes in types.
- Locale files: `server/public/locales/{en,de,es,fr,it,nl,pl,pt,sv,xx,yy}/features/tickets.json`;
  `filters.unassigned` already lives there.

## `git grep assignedToMe` (excluding unrelated hits)

Unrelated same-name identifiers: co-managed project task queue (`reference.assignedToMe` boolean), mobile
workflow task gating, scheduling WorkItemPicker, mobile i18n string. None touch ticket list filters.

Ticket-filter hits:
- `packages/types/src/interfaces/ticket.interfaces.ts` — key definition.
- `packages/projects/src/components/TaskTicketLinks.tsx` L200-204 — **live caller**: `{ boardFilterState:
  'all', assignedToMe: true }` → legacy `ticketActions.getTicketsForList` (via msp-composition
  useTicketIntegrationValue).
- `packages/tickets/src/actions/ticketActions.ts` L2235-2250 — legacy hand-built SQL: assigned_to OR
  ticket_resources OR team_members, skipped when caller has `project:read`.
- `packages/tickets/src/actions/optimizedTicketActions.ts` L1229 — computes `assignedToMeBypass`.
- `ticketFilterPredicates.ts` L118 + tests; `ticketListFilterMatrix.integration.test.ts` L506 asserts the
  involves/bypass semantics.
- `list-views` schema L61 and `ticketListViewAdapter.ts` L69 (`FALSE_IS_NO_OP`).
- No API route, mobile, n8n or migration code uses it. The mobile app's own "me" (TicketsListScreen L234)
  resolves to the session user id client-side and sends REST `assigned_to`; independent.
- Brief said "no toolbar control sets `assignedToMe`" — correct, but the key is not unused: the task-link
  dialog sets it on the legacy action.

## Decisions

- Sentinel `'me'` in `assignedToIds`, constant `TICKET_ASSIGNEE_ME` in `@alga-psa/types`. Resolved only in
  `ticketFiltersToPredicates` from `context.userId`. Never resolved at capture/URL/storage.
- "Me" = `assigned_to = viewer`. Not `involves_user`; not subject to the `project:read` bypass.
- `assignedToMe` stays, behaviour unchanged, comments rewritten (FR14). Reason: mapping it to the sentinel
  would change the task-link dialog's scope (involves → assigned) and drop its deliberate bypass; and the
  strict view schemas accept the key, so removing it would reject any stored document carrying it.
  Follow-up worth raising separately: for almost every technician the bypass makes that scope a no-op.
- Picker: generic caller-supplied pinned pseudo-options living in `values`, rather than a ticket-specific
  `showMeOption` flag. Keeps packages/ui ticket-agnostic and lets client/contact/project lists opt in later.
  "Unassigned" is left on its existing boolean prop because every caller stores it as a separate
  `includeUnassigned` key; folding it into pinned options is a possible later cleanup
  (`// LEVERAGE: pattern picker-pinned-option` at the Unassigned row is reasonable when implementing).
- No predicate-level "current user" reference value yet; documented as the promotion path if a second
  consumer appears.

## Commands

- `git grep -n assignedToMe -- ':!ee/docs' ':!docs'`
- `git grep -n assignedToIds -- ':!ee/docs' ':!docs'`
- Integration test: `server/src/test/integration/ticketListFilterMatrix.integration.test.ts` (needs local
  test DB; see test-utils/requireDb).
- Translations: `node scripts/validate-translations.cjs`

## Gotchas

- Fixture in the filter matrix: T2 has no `assigned_to` (team only), T1 is agent X with Y as additional
  agent, T4 is agent Y. Good shape for proving "Me" ≠ involves_user.
- `validateCapturedFilters` has a single `sentinels` arg shared across every key; build the `'me'`
  allowance into the assignee check itself so callers (TicketingDashboardContainer x2, server
  `msp/tickets/page.tsx`) need no change.
