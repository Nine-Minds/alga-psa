# PRD — Ticket list: "Me" option in the assignee filter

- Slug: `ticket-assignee-me-option`
- Date: `2026-11-10`
- Status: Draft (scope decided)
- Source: AlgaPSA ticket alga-2026-0002989

## Summary

Add a "Me" choice to the ticket list's assignee filter. "Me" is stored as a sentinel value (`'me'`) inside
`assignedToIds` and is resolved to the viewing user only when the filter compiles to SQL. A shared saved
view (or board default view, or URL) holding "Me" therefore shows each viewer their own tickets. "Me"
combines with "Unassigned", specific users and teams through the existing assignee OR group, so
"Unassigned or Me" is one view.

## Problem

The assignee filter can only name specific users. A saved view captures those ids literally, so a view
can only ever mean "assigned to Alice". A team that wants a "My queue" view needs one private view per
technician, maintained separately, instead of one shared view everyone uses. The same applies to board
default views and shared URLs.

## Goals

1. The assignee filter offers "Me" alongside "Unassigned", users and teams.
2. "Me" means `tickets.assigned_to = <viewing user>`, resolved at query time, never at capture/storage time.
3. "Me" ORs with the other assignee parts exactly like a user id does ("Unassigned or Me", "Me or Team X").
4. "Me" round-trips unchanged through the URL, named saved views and board default views, and survives
   every sanitize/normalize step on the way.
5. "Me" displays as "Me" everywhere it is shown (picker trigger, picker list, filter chips), never as a
   user name or an id.
6. The existing, unrelated `assignedToMe` key is documented so it is not confused with "Me".

## Non-goals

- Changing what `assignedToMe` / `involves_user` do, or removing them (see "Decision: `assignedToMe`").
- Offering "Me" in other lists that use the same picker (client/contact ticket tabs, project task
  filters). They can opt in later by passing the same picker option; this card wires the main ticket list.
- A "Me" choice for the team filter ("my teams"). Different semantics; separate request if wanted.
- REST API / n8n / mobile app filters. The mobile app already resolves its own "me" client-side to an id
  for the REST `assigned_to` parameter; that path is untouched.
- A general "current user" reference value in `@alga-psa/predicates` (see "Future: promote to a
  predicate reference value").

## Users and Primary Flows

Persona: MSP technician / dispatcher using the MSP ticket list.

1. Dispatcher opens the assignee filter, ticks "Unassigned" and "Me", saves the view as "My queue" and
   shares it with the team.
2. Each technician applies "My queue" and sees unassigned tickets plus the tickets assigned to themselves.
   The filter chips read "Unassigned" and "Me".
3. A technician copies the URL (`...&assignedToIds=me&includeUnassigned=true`) to a colleague; the
   colleague sees their own queue.
4. An admin sets a board's default view to assignee "Me"; every technician arriving at that board tab
   sees their own tickets on it.

## UX / UI Notes

- `MultiUserAndTeamPicker` (packages/ui) gains a generic, caller-supplied list of pinned pseudo-options
  that live in `values` alongside user ids (shape: `{ value, label, icon? }`). They render as checkbox
  rows in the pinned area at the top of the dropdown, next to the existing "Unassigned" row, and above the
  user list. The picker stays ticket-agnostic: it does not know what `'me'` means; the ticket list passes
  `{ value: TICKET_ASSIGNEE_ME, label: t('filters.me', 'Me'), icon: <person icon> }`.
- Use a person icon distinct from Unassigned's `UserMinus` (e.g. lucide `UserCheck`).
- Pinned options are not filtered by the user search box (same as "Unassigned"); they are always visible.
- Compact trigger: "Me" alone shows the icon + "Me"; mixed selections count it like any other selection
  ("Me +1", or "Unassigned +1" etc. following the existing first-item rule, with a pinned option ranking
  before users).
- Pill (non-compact) display: "Me" renders as a removable pill with its label.
- "Clear all" clears it (it lives in `values`).
- The viewer still appears in the user list under their own name. Ticking their name means "this specific
  person"; ticking "Me" means "whoever is viewing". Both may be selected; the result is the same for that
  viewer and different for others, which is the intended distinction.
- TicketingDashboard filter chips: an `assignedToIds` entry equal to the sentinel renders the chip label
  "Me" (not a user lookup, not the id), removable like other assignee chips.
- New translation key in `features/tickets`: `filters.me` = "Me", added to every locale file
  (en, de, es, fr, it, nl, pl, pt, sv, plus pseudo-locales xx, yy). Run `node scripts/validate-translations.cjs`.

## Requirements

### Functional Requirements

**Sentinel**

- FR1. Define one constant `TICKET_ASSIGNEE_ME = 'me'` in `@alga-psa/types` next to `ITicketListFilters`
  (both `@alga-psa/list-views` and `@alga-psa/tickets` depend on types; list-views must not import tickets).
  Update the `assignedToIds` doc comment on `ITicketListFilters` (and the duplicate in
  `server/src/interfaces/ticket.interfaces.tsx`) to mention it.

**Compile (the only place it is resolved)**

- FR2. `ticketFiltersToPredicates` replaces the sentinel in `assignedToIds` with `context.userId` (deduped)
  before emitting `assigned_to in [...]`. It stays inside the existing assignee/team/unassigned OR group.
  It does NOT use `involves_user` and is NOT subject to `assignedToMeBypass`.
- FR3. Because all list reads go through `buildTicketListBaseQuery`, "Me" applies identically to the list
  page, cursor paging, select-all (`getAllMatchingTicketIds`), `loadTicketListItemsByIds` and prev/next
  navigation (`getAdjacentTicketIds`). No per-caller work.

**Accept and preserve the sentinel at every boundary**

- FR4. `ticketListFiltersSchema` (packages/tickets/src/schemas/ticket.schema.ts):
  `assignedToIds: z.array(z.union([z.string().guid(), z.literal(TICKET_ASSIGNEE_ME)]))`, mirroring the
  `'no-board'` / `'no-category'` unions in the same schema.
- FR5. `ticketFiltersShape.assignedToIds` (packages/list-views/src/lib/definitions/tickets.ts) gets the same
  union, which covers both named views and board default views (`boardViewSettingsSchema` is derived from
  the shape).
- FR6. `normalizeAssignedToIds` (URL CSV) and `normalizeAssignedToIdList` (stored arrays) in
  `ticketFilterUtils.ts` keep the sentinel token (deduped) alongside UUIDs; `unassigned` behaviour is unchanged.
- FR7. `validateCapturedFilters` (ticketViewSettings.ts) keeps the sentinel in `assignedToIds` regardless of
  the known-user universe (built into the assignee check, not left to each caller's `sentinels` argument).
- FR8. `sanitizeTicketListView` (ticketListViewAdapter.ts) passes the sentinel as an allowed pseudo-value to
  `collector.keepList('assignedToIds', ...)` so it is neither dropped nor reported as a dropped reference.
- FR9. Capture never resolves the sentinel: `captureTicketListView` stores `assignedToIds` as-is, and URL
  serialization (`assignedToIds` CSV in TicketingDashboard / TicketingDashboardContainer) writes `me`.

**UI**

- FR10. `MultiUserAndTeamPicker` supports caller-supplied pinned pseudo-options in `values` (see UX notes),
  and its stale-value cleaner (`validValues` / cleaning effect) keeps values that match a pinned option.
- FR11. TicketingDashboard passes the "Me" pinned option to its assignee picker.
- FR12. TicketingDashboard filter chips label the sentinel "Me".
- FR13. `filters.me` translation key in all `features/tickets` locale files.

### Decision: `assignedToMe`

`git grep assignedToMe` (see SCRATCHPAD) shows the key is not dead and is not an assignee filter:

- Live caller: the project task "link existing ticket" dialog (`packages/projects/src/components/TaskTicketLinks.tsx`)
  sends `{ assignedToMe: true }` to the legacy `ticketActions.getTicketsForList`, which hand-builds
  "assignee OR additional agent OR member of the assigned team", skipped when the caller has
  `project:read`. There it is a scope for the link picker, and the bypass is deliberate: a project reader
  may link any ticket they can read.
- The optimized list path (`ticketFilterPredicates.ts` → `involves_user`, plus `assignedToMeBypass`) is a
  parity port of that behaviour with its own integration test
  (`ticketListFilterMatrix.integration.test.ts`); no toolbar control sets it.
- Stored-view schemas accept it (`.strict()` schemas), so removing it would make any document carrying it
  fail validation.

Mapping it onto the new sentinel would silently change the task-link dialog from "involves me" to "assigned
to me" and drop its bypass. So **it stays, unchanged in behaviour**, and this card only documents it:

- FR14. Rewrite the doc comments on `ITicketListFilters.assignedToMe`, `TicketFilterCodecContext.userId` /
  `assignedToMeBypass` and the codec branch so they say: this is the "tickets involving me" scope used by
  the task-link picker (assignee, additional agent or assigned-team member; bypassed for `project:read`);
  it is not the assignee filter's "Me" (`TICKET_ASSIGNEE_ME`, `assigned_to` only, never bypassed).
  Drop a `// LEVERAGE: friction ticket-involves-me-scope` marker at the codec branch: a visibility scope
  carried as a list filter key is the friction.

Whether the task-link dialog should keep that scope at all (for nearly every technician the bypass makes it
a no-op) is a follow-up question, not part of this card.

### Non-functional Requirements

- No schema migration; no data backfill. Existing stored views are unaffected.
- "Me" adds no queries: the resolved id is already on the codec context (`context.userId`).

## Data / API / Integrations

- Wire format: `assignedToIds: Array<uuid | 'me'>` in URL CSV, named view JSON (`list_views` filters) and
  board default view JSON. `'me'` is lowercase, exact match.
- `TicketFilterCodecContext` already carries `userId` (the authenticated caller from `withAuth`), so no
  context change is needed.
- Server actions that validate with `ticketListFiltersSchema` (both the optimized and legacy
  `getTicketsForList`) accept `'me'`. The legacy action ignores `assignedToIds` entirely today; that is
  unchanged.

## Security / Permissions

- `'me'` resolves from the authenticated session user, never from client input, so it cannot be used to
  read another user's assignments.
- It only narrows the result set; ticket read authorization and client-portal visibility still apply on
  top. A client-portal caller passing `'me'` simply matches no assigned tickets.

## Observability

None beyond existing.

## Rollout / Migration

Ships unflagged. Old clients never send `'me'`. Old stored documents never contain it. New documents
containing `'me'` read back correctly on this version.

## Future: promote to a predicate reference value

"Current user" is resolved here inside the ticket filter codec because this list is the only consumer. If a
second consumer needs "the viewing/acting user" inside a predicate (for example checklist rules, workflow
predicates or `filters.where` clauses), promote it to a reference value in `@alga-psa/predicates` (a
literal like `{ ref: 'current_user' }` resolved by the compiler from its context) and have the ticket codec
emit that instead of substituting. Not in this card.

## Open Questions

None blocking. (Sentinel spelling `'me'` chosen for readable URLs; UUIDs cannot collide with it.)

## Acceptance Criteria (Definition of Done)

1. The ticket list assignee filter shows a "Me" row pinned with "Unassigned"; selecting it shows only tickets
   whose `assigned_to` is the viewer.
2. "Me" + "Unassigned" returns the union; "Me" + a team returns the union.
3. "Me" does not match tickets where the viewer is only an additional agent or only a member of the
   assigned team.
4. A named view saved with "Me", applied by a different user, shows that user's tickets; the stored
   document contains `'me'`, not a UUID.
5. `?assignedToIds=me` in the URL loads the viewer's queue (SSR and client paths) and the URL is rewritten
   with `me`, not an id.
6. Chips and the picker show "Me"; no id is visible anywhere.
7. Existing `assignedToMe` behaviour (task-link dialog and its integration test) is unchanged; its comments
   explain the difference from "Me".
