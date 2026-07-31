# PRD — Ticket Bento "Story" Layout

- Slug: `2026-07-03-ticket-bento-story-layout`
- Date: 2026-07-03
- Status: Implemented (114/118 features; 4 deferred with rationale — see Open Questions
  + features.json `deferred` flags). Verified live in the dev app on ticket TIC1001 and
  a minimal fixture. Behind the `ticket-bento-layout` PostHog flag via the Grid|Entry
  toggle. Test coverage: unit + DB-integration written, E2E manually verified — see
  SCRATCHPAD "Test status summary".
- Mockup: `mockups/option-b-ticket-story.html` (+ `bento-b*.png` captures)

## Summary

Rebuild the MSP ticket detail screen as a bento grid whose center is a single
chronological timeline of everything that happened on the ticket: client replies,
internal notes, time entries, system changes, and linked alerts. State tiles orbit the
timeline: who asked, what the SLA clocks say, what is left on the checklist, what the
work has cost so far, and what is scheduled next. Today the screen is a long form with a
stacked sidebar; a technician reconstructs the story of a ticket by reading comments,
opening the activity drawer, and cross-referencing the time entries list. The bento
layout puts that story in one place and promotes state the data model already holds
(SLA clocks, audit trail, scheduled work, interactions, RMM alerts) onto the screen.

## Problem

- The current screen buries "what happened" across three surfaces: the comments list,
  the activity drawer (History icon), and the Time Entry card. Reconstructing sequence
  and effort takes clicks and memory.
- Data the platform already records is invisible at the point of work: SLA response and
  resolution clocks (shown only as a small badge row), scheduled visits, logged
  calls/emails, RMM alerts that created or relate to the ticket, and billing posture.
- The sidebar is a stack of nine cards with equal visual weight; nothing communicates
  "what should I look at first."

## Goals

1. One chronological timeline as the screen's spine: comments, time entries, audit
   events, and RMM alerts interleaved, filterable by lane, with the reply composer
   attached at the bottom.
2. Surface existing-but-buried state as glanceable tiles: SLA clocks, checklist
   progress, time logged (with per-day mini chart), billing posture, next scheduled
   visit, and recent calls/emails.
3. Keep every capability the current screen has. Nothing is removed; sections are
   repositioned into grid tiles.
4. House-voice copy throughout (see copy table). Plain operator language, sentence
   case, no SaaS filler.
5. Ship as a per-user view toggle on the ticket screen: **Grid** (the bento layout) vs
   **Entry** (the current form layout). Entry stays the default; the toggle itself is
   gated by a PostHog flag during rollout.

## Non-goals

- No drag/resize tile customization in v1 (that is the Option C concept; the grid is a
  fixed, responsive arrangement).
- No client-portal changes. `packages/client-portal/**` and
  `server/src/app/client-portal/**` are untouched.
- No new database tables or migrations. Every tile reads existing schema.
- No changes to ticket write semantics: batch save, cache invalidation, and live-edit
  conflict behavior are preserved, not redesigned.
- No dollar-amount billing math in v1 (rate resolution through contract lines is a
  stretch item; hours and contract identity ship first).
- No KB "suggested articles" matching engine in v1 (stretch; tile ships only if a
  cheap title/tag match is agreed on).

## Users and Primary Flows

- **Technician (primary):** opens a ticket, reads the timeline top-to-bottom or
  filtered to client replies, replies from the composer, logs time, checks SLA clocks
  and checklist before closing.
- **Dispatcher / service manager:** scans hero band + right rail (SLA, time logged,
  next visit) to answer "is this on track and who is on it" without reading the thread.
- **Owner/biller:** glances at the billing tile to see logged vs billable hours and the
  governing contract before month-end.

Primary flows that must survive unchanged: edit ticket fields and save (batched),
comment (client/internal/resolution), start/stop/pause session timer and log an entry,
attach/link documents, manage checklist, watch list, agent team, materials, linked
assets, customer feedback summary, delete ticket, prev/next navigation.

## UX / UI Notes

### Grid regions (desktop ≥1280px)

12-column CSS grid (Tailwind), `gap-4/6`, tiles are `ContentCard`-style surfaces using
theme tokens. Mirrors the mockup:

- **Hero band** (span 12): ticket number, title (inline edit), status / priority /
  board as editable chip-selects, assignee, response-state chip ("Waiting on us" /
  "Waiting on client"), due date, tags, resolution-SLA countdown slab, actions (create
  task, link, delete, save changes). A "More details" affordance opens the remaining
  form fields (category/subcategory, ITIL impact/urgency, location, contact override)
  without leaving the page.
- **Left rail** (span 3): Request (description + origin), Contact (with client quick
  view link), Assets, Next visit, Calls and emails.
- **Center** (span 6): Timeline tile with lane filter pills
  (Everything / Replies / Time / System / Alerts), day-break separators, and the reply
  composer pinned at the bottom (client / internal / resolution segment control).
- **Right rail** (span 3): SLA clocks, Checklist, Time logged, Billing, Team and
  watchers, Materials (AlgaDesk-gated), Customer feedback, Documents.

### Responsive behavior

- ~1024–1279px: rails collapse to span 4/8 with the right rail flowing under the left.
- <1024px: single column, order = hero, timeline, SLA clocks, checklist, then remaining
  tiles. No horizontal scroll at any width.

### Timeline

- Reuses the existing unified timeline pipeline (see Data section). Rendered inline,
  not in a drawer. The drawer stays available during rollout and is removed at GA.
- Lanes and visual treatment: client replies (speech bubble, accent), internal notes
  (visibly distinct, labeled "Internal"), time entries (duration badge), system events
  (compact single-line), alerts (warning treatment).
- Day-break separators are plain dates ("Jun 9", "Today"). No editorial captions.
- Default order oldest-first with the composer at the bottom; a sort toggle preserves
  the current screen's newest-first option.
- Comment tabs from the current screen (All / Client / Internal / Resolution) map to
  timeline filters; resolution comments get a "Resolution" marker.

### Empty and edge states

Every tile has a designed empty state in house voice (see copy table). Tiles never
render as blank cards. SLA tile with no policy shows "No SLA policy applies"; billing
tile with no contract shows hours only; timeline for a brand-new ticket shows the
creation event.

### Theming and accessibility

- CSS variable tokens only; `dark:` variants required; verified in both themes.
- Every interactive element gets a unique `id` per the reflection UI conventions.
- Timeline is keyboard-navigable; filters are buttons with `aria-pressed`.

### Copy (house voice, de-SaaS pass)

Operator-to-operator, sentence case, plain MSP language. No "journey", "insights",
"impact", "touchpoints", or invented nouns. UI strings avoid em dashes.

| Mockup label | Ships as | Notes |
|---|---|---|
| Ticket Story | **Timeline** | The concept name stays internal; the label is plain. |
| "comments · time · system · alerts in one stream" | **"Replies, time, and system changes in one place"** | Subtitle under the tile header. |
| Everything / Comments / Time / System / Email pills | **Everything / Replies / Time / System / Alerts** | "Replies" over "Comments" (covers client + internal); "Alerts" is the RMM lane. |
| The Ask | **Request** | "The ask" is meeting-speak. |
| Reporter | **Contact** | Matches existing product vocabulary. |
| VIP chip | *dropped* | No backing field; mockup flavor only. |
| Next On-Site | **Next visit** | Covers remote sessions too. |
| Touchpoints | **Calls and emails** | Says what it is. |
| SLA Clocks | **SLA clocks** | Operators live by SLAs; keep the term, fix the case. |
| "until breach" | **"left"** | "4h 12m left". Countdown states: "Met in 42m", "4h 12m left", "Overdue by 2h", "Paused". |
| Path to Done | **Checklist** | Existing product term. |
| Effort | **Time logged** | Plain. Sub-line: "11h across 4 entries". |
| Billing Impact | **Billing** | Sub-lines: "11h logged, 11h billable", "Not invoiced yet", contract name. |
| "In scope · billable" | **"Covered by contract"** | Only when derivable from the contract link. |
| Knowledge / auto-matched | **Knowledge base / Suggested** | Stretch tile. |
| Files | **Documents** | Existing product term. |
| "Continue the story — reply to Alice…" | **"Reply to {contact first name}…"**, fallback **"Write a reply"** | |
| "Awaiting internal — the ball is in our court" | **"Waiting on us"** / **"Waiting on client"** | Response-state chip. Neutral state: "No reply needed". |
| Agent team + Watch List | **Team and watchers** | One tile, two rows. |
| Customer Feedback | **Customer feedback** | Case fix only. |
| Empty timeline | **"Nothing yet. The ticket was opened {date}."** | |
| Empty next visit | **"Nothing scheduled"** + "Schedule a visit" action | |
| Empty calls and emails | **"No calls or emails logged"** | |
| Empty SLA | **"No SLA policy applies"** | |
| Empty billing | **"No time logged yet"** | |

## Requirements

### Functional Requirements

**FR-1 Layout shell and toggle.** A segmented control labeled **Grid | Entry** in the
ticket screen header switches between the bento layout (Grid) and the current layout
(Entry). The choice persists per user and applies to subsequent ticket loads; Entry is
the default. The toggle is visible only when the `ticket-bento-layout` PostHog flag is
on; flag off renders the current `TicketDetails` layout unchanged with no toggle. Grid
renders from the same consolidated ticket payload (no duplicate fetch).

**FR-2 Hero band.** Title inline-edit, status/priority/board/assignee editable
controls, response-state chip, due date, tags, SLA countdown slab, create-task / link /
delete / save actions, prev-next navigation, origin badge, presence bar. "More details"
surface exposes category, subcategory, ITIL fields, location, and contact override.
All edits flow through the existing dirty-field + batch save pipeline
(`handleBatchSaveChanges` semantics preserved), including the unsaved-changes guard
and live-edit conflict highlighting.

**FR-3 Timeline tile.** Inline unified timeline fed by `getTicketTimelineEntries`,
extended to interleave time entries and RMM alerts (see Data). Lane filters, day
breaks, sort toggle, and the reply composer (client/internal/resolution) which reuses
the existing comment save path. New comments and saves appear without a manual reload
(the current `router.refresh()` flow is acceptable).

**FR-4 Left rail.** Request tile (description, origin, created-by), Contact tile
(contact + client quick-view links preserved as injected render props), Assets tile
(relocated `AssociatedAssets`), Next visit tile (schedule entries for this ticket,
soonest upcoming first, link into scheduling), Calls and emails tile (interactions for
this ticket, most recent first, link to the interactions view).

**FR-5 Right rail.** SLA clocks tile (response + resolution rings/progress computed
from existing `sla_*` columns, reusing the `SlaStatusBadge`/status logic), Checklist
tile (existing section relocated), Time logged tile (total + per-day bars + add-entry
action + session timer controls preserved), Billing tile (logged vs billable hours,
invoiced flag, governing contract name), Team and watchers tile (agent team + watch
list combined), Materials tile (AlgaDesk-gated as today), Customer feedback tile
(survey summary card), Documents tile (existing section relocated).

**FR-6 Mode compatibility.** AlgaDesk mode toggles (`hideSlaStatus`, `hideTimeEntry`,
`hideMaterials`) hide the corresponding tiles and re-flow the grid without gaps.

**FR-7 Permissions.** Timeline visibility follows the existing rule: internal users
only (`getTicketTimelineEntries` already blocks `user_type === 'client'`). Tiles honor
existing per-feature permission gates (e.g. billing visibility).

### Non-functional Requirements

- No regression in initial render: new tile data (schedule entries, interactions, RMM
  alerts, timeline) joins the existing consolidated fetch or loads per-tile without
  blocking first paint of the hero + timeline.
- Both themes, keyboard navigation, unique element ids (reflection UI).
- Fail fast: tile data errors render a visible tile-level error state, not a silent
  blank.

## Data / API / Integrations

Existing pipeline (verified in repo, all paths repo-relative):

- Route: `server/src/app/msp/tickets/[id]/page.tsx` → `getConsolidatedTicketData`
  (`packages/tickets/src/actions/optimizedTicketActions.ts`) — one transaction,
  ~9 parallel queries, returns ticket (incl. all `sla_*` columns), comments,
  documents, client/contact info, options, agent schedules.
- Timeline: `shared/lib/ticketActivity/` (`buildUnifiedTicketTimeline`,
  `readTicketActivity`) + `packages/tickets/src/actions/ticketActivityActions.ts`
  (`getTicketTimelineEntries`) + UI `TicketActivityTimeline.tsx` (currently drawer-only).
- SLA logic: `packages/sla/src/` services + `SlaStatusBadge`.
- Timer: `packages/ui/src/hooks/useTicketTimeTracking.ts` + interval-tracking widgets
  under `packages/scheduling/src/components/time-management/interval-tracking/`.

Planned additions (no schema changes):

1. Extend `buildUnifiedTicketTimeline` (or compose in the action) to interleave:
   time entries (`time_entries` by `work_item_id`/`work_item_type='TICKET'`) and RMM
   alerts (`rmm_alerts.ticket_id`). Comments and audit rows already interleave.
2. New read actions (or consolidated-fetch additions): schedule entries for ticket
   (`schedule_entries.work_item_id`), interactions for ticket
   (`interactions.ticket_id`), billing rollup for ticket (sum billable/non-billable
   minutes, invoiced flag from `time_entries.invoiced`, contract identity via the
   client's active contract).
3. All new reads are `withAuth` server actions, tenant-scoped (CitusDB tenant column
   discipline), `ticket:read` gated.

## Security / Permissions

- Timeline and audit data stay internal-only (existing client-user hard block).
- New read actions follow the existing `withAuth` + permission-gate pattern.
- No new write paths.

## Rollout / Migration

- The switching mechanism is the **Grid | Entry** toggle (per-user preference,
  default Entry). The PostHog flag `ticket-bento-layout` (tenant-targeted, same
  pattern as `advanced-features-enabled`) gates whether the toggle appears at all.
  Flag off = current screen, byte-for-byte behavior, no toggle.
- Both layouts coexist long-term; there is no forced migration to Grid.
- The activity drawer remains reachable from the Entry layout; Grid shows the same
  timeline inline.
- No data migration. No client-portal impact.

## Open Questions

All resolved 2026-07-03 with product owner:

1. **Hero "More details" surface:** drawer (existing `Drawer` component). ✔
2. **Timeline default order:** oldest-first, composer at bottom, per-user persisted
   sort toggle. ✔
3. **Billing tile:** hours-only v1; dollar amounts deferred. ✔
4. **Knowledge base tile:** deferred (stretch feature F100). ✔
5. **Team and watchers:** merged into one tile. ✔
6. **Layout at GA:** both layouts stay; a per-user **Grid | Entry** toggle is the
   product answer, not a rollout-only flag. ✔

## Acceptance Criteria (Definition of Done)

1. With the flag on, the ticket screen shows the **Grid | Entry** toggle; Grid renders
   the bento layout, Entry renders the current screen, and the choice persists per
   user across reloads. With the flag off, the current screen renders unchanged with
   no toggle.
2. The timeline shows comments, audit events, time entries, and RMM alerts for the
   ticket in one chronological stream with working lane filters and day breaks;
   posting a reply from the composer lands in the stream and in the comments data.
3. Every capability from the current screen is reachable on the new layout (checklist,
   documents, watch list, agent team, materials, feedback, assets, timer + intervals,
   delete, prev/next, email logs drawer).
4. Field edits from the hero band batch-save exactly as today, including
   unsaved-changes guard and live-edit conflict indicators.
5. SLA clocks, Next visit, Calls and emails, Time logged, and Billing tiles render
   real data for a fixture ticket and designed empty states when data is absent.
6. AlgaDesk mode hides SLA/time/materials tiles cleanly.
7. Client portal ticket view is unaffected (no diff in its render path).
8. All copy matches the house-voice table; both themes pass visual review;
   interactive elements have unique ids.
