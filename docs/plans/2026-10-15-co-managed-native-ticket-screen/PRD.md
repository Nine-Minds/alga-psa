# PRD — Shared tickets on the native ticket screen

- Slug: `co-managed-native-ticket-screen`
- Date: `2026-10-15`
- Status: **Scope confirmed by the captain 2026-10-15 (answered "defaults" to Q1–Q6)**
- Parent: [Co-managed IT completion](../2026-09-20-co-managed-it-completion/PRD.md), PR #3363

## Summary

When an MSP technician opens a co-managed shared ticket, they get a standalone
`CoManagedTicketPanel` page (`/msp/co-management/tickets/[customerTenant]/[relationshipId]/[ticketId]`):
one stacked card holding a summary line, responsibility, SLA, a small field editor,
effort, a "Log time" button, assignment, a plain conversation and handoff history.
The customer side of the same ticket gets the native `TicketDetails` screen with that
panel appended below it.

This plan replaces the MSP's standalone page with the native ticket screen, backed by
a shared-ticket data source, and folds the co-managed controls into the native layout
on both sides. The co-managed engine (admission, redaction, revisions, audiences,
time-work references, receipts) is kept as-is and becomes the backend of that data
source.

## Problem

- The MSP technician, who does most of the work on shared tickets, gets the thinnest
  tool: no properties sidebar, no native conversation editor, no stopwatch, no
  Grid/Entry layout, none of the familiar section placement. Captain review called it
  "not even from the same app".
- Two ticket screens will drift: every native ticket feature has to be either
  re-implemented in the panel or knowingly omitted.
- The panel itself has seams showing (two adjacent "Reload current state" buttons,
  unlabeled selects, sections stacked in one card).
- Root cause: `TicketDetails` and its ~20 child sections call ~115 server actions,
  >90% imported directly and all resolving the tenant from the session. There is no
  data-source seam, so a ticket in another tenant could not be rendered, and a second
  screen was built instead of changing the engine.

## Goals

1. An MSP user opening a shared ticket sees the native ticket screen (same header,
   layouts, properties, conversation, time controls) for every capability the shared
   model supports.
2. `TicketDetails` gains a **ticket data source** seam: one interface covering the
   reads and writes the screen makes, a default implementation that is today's native
   actions (no behavior change for native tickets), and a shared-ticket implementation
   that routes through the co-managed actions with a qualified resource.
3. A **capability model** decides which sections render. Sections the shared model
   does not support are absent (not disabled shells), driven by the data source, not by
   ad-hoc `if (coManaged)` checks in the screen.
4. The co-managed concepts — responsibility, escalate / hand back / take back /
   revoke, customer and MSP SLAs, MSP assignment, effort split, handoff history,
   conversation audience — appear as native-styled sections in both layouts, on both
   the MSP side and the customer side. `CoManagedTicketPanel` and its stacked
   sub-components are deleted.
5. No widening of what the MSP can read or write beyond what the captain approves in
   "Open questions"; every read and write keeps today's server-side admission.

## Non-goals

- Live (Hocuspocus) collaborative updates on shared tickets for the MSP side (room
  naming and live-token are tenant-local). The shared screen refreshes after its own
  writes, as the panel does today.
- Bundles, materials, quick invoice, billing rollup, delete, credentials, external
  links, email logs, survey summary and appointment requests on shared tickets.
- Changing the Customer Tickets list, callouts or badge (done in the list
  unification).
- Changing time-entry billing semantics for co-managed work.

## Users and Primary Flows

- **MSP technician (sponsor side)** — opens a shared ticket from Customer Tickets, a
  callout, or a notification; reads the description and conversation; changes status
  and priority; posts a Shared IT message or an MSP-private note; starts the stopwatch
  or logs time; assigns it within the MSP; hands it back.
- **Customer IT technician (owner side)** — opens their own ticket natively; sees
  responsibility, the MSP's SLA and the MSP assignment in the properties area; chooses
  the conversation audience (requester / Shared IT / private); escalates or takes back.
- **Read-only MSP viewer (oversight)** — same screen, every write affordance absent.

## UX / UI Notes

- Same route for the MSP side (kept for links already sent and stored); it renders
  the native screen inside the MSP shell, with the customer workspace name as
  context in the header (where the client name sits on native tickets) and the board
  rendered as text.
- **Co-managed section** in the properties column (Entry) / a tile (Grid):
  responsibility, the two SLA clocks, MSP assignee (user/team picker of the MSP),
  handoff actions, handoff history drawer. Same section on the customer side, minus
  sponsor-only controls.
- **Conversation**: the native composer's Internal toggle becomes an audience control
  when the data source reports audiences: Requester / Shared IT teams / Private to
  <organization>. Default Shared IT on the MSP side. Author labels show the
  organization for foreign authors.
- **Time**: the native stopwatch and time-entries list, backed by the co-managed time
  work reference; effort split (customer / MSP) shown in the time summary.
- Absent sections leave no placeholders.

## Requirements

### Functional Requirements

1. `TicketDataSource` interface + React context in `packages/tickets`, default value
   built from the existing native actions; `TicketDetails` and its sections call the
   context instead of importing actions. Native behavior unchanged.
2. `TicketCapabilities` delivered with the data source; sections and affordances
   render only when their capability is present. Native default: everything present
   (still subject to the existing `hide*`/`isAlgaDeskMode` flags).
3. Shared-ticket loader returning the `ticketData` shape `TicketDetailsContainer`
   consumes, populated only from admitted, redacted co-managed reads; fields not
   disclosed are absent, never padded with fake values.
4. Shared data source implementing: ticket read/refresh, field edits (via
   `saveSharedTicketEditAction` with per-field baselines and operation ids), status /
   priority option search, conversation read/create/reply/edit/delete/audience change,
   attachments, MSP assignment, handoffs, SLA display, handoff history, effort, time
   work registration + native time entry launch.
5. Co-managed section + conversation audience control rendered natively on both
   sides; panel removed from `server/src/app/msp/tickets/[id]/page.tsx`.
6. MSP route renders the native screen; old panel and its stacked children deleted;
   notification/email links unchanged (same route).
7. Viewer-scoped calls (layout preference, permissions, mentions search) stay on the
   local session. Avatar batch actions are never called with a foreign tenant.

### Non-functional Requirements

- Native ticket screen: no extra round-trips, no change to bootstrap/streaming.
- Package boundary: `packages/tickets` does not import co-managed actions; the shared
  data source lives in the app/composition layer and is injected.

## Data / API / Integrations

- New/extended co-managed reads are required for whatever Q1 approves (e.g.
  description rich text, requester contact display name, category). Each goes through
  `withCoManagedSharedPrincipal` + home-policy redaction like the existing summary.
- Field editing keeps `editCoManagedTicket` (native `updateTicketInTransaction`
  injected) and its receipts.
- No migrations expected unless Q1 adds a disclosure that needs policy storage.

## Security / Permissions

- No new authority. The data source is a client-side routing layer; each call lands
  on an existing (or newly added, admitted) server action.
- Negative tests: a shared screen never invokes native ticket-id actions with a
  foreign id, and never calls tenant-argument actions (avatars) with the foreign
  tenant.

## Rollout / Migration

- Behind the existing co-managed release boundary. Native screen change (context
  refactor) ships unflagged and must be behavior-identical.

## Captain decisions (2026-10-15, all defaults accepted)

| ID | Question | Decision |
| --- | --- | --- |
| Q1 | What the MSP reads | Add to the shared read: description (rich text), requester contact display name, client display name, category, due date, and the customer's own assignee (read-only display). Each subject to the sponsor home-policy redaction like existing summary fields. Documents, checklist, assets, tags stay hidden this round. |
| Q2 | What the MSP edits | Existing set (title, url, status_id, priority_id, due_date, response_state) plus description and category_id. Customer assignee stays read-only; the MSP uses its own MSP assignment. |
| Q3 | Sections absent on shared tickets | Bundles, materials, billing/quick invoice, delete, credentials, external links, email logs, survey summary, appointment requests (plus documents, checklist, assets, tags per Q1). |
| Q4 | Customer side | Yes: co-managed section folded into the native screen for the customer too; panel below the native screen removed; native composer shows the audience control (requester / Shared IT / private) instead of the Internal toggle on co-managed tickets. |
| Q5 | Live updates | Out of scope for shared tickets on the MSP side; refresh after own writes. Native live updates unchanged for the customer side. |
| Q6 | Time | Native stopwatch + time-entries list backed by the co-managed time work reference; customer/MSP effort split in the time summary. |

## Open Questions

None blocking. Category edit (Q2) needs the category options to be the customer's categories for the ticket's board, searched through a co-managed option action like status/priority.

## Acceptance Criteria (Definition of Done)

- MSP opening a shared ticket sees the native screen in both layouts; status/priority
  edit, Shared IT message, private note, stopwatch/time entry, MSP assignment and
  handback work end to end, with browser evidence.
- Customer side shows the co-managed section natively; no panel below the screen.
- Native ticket screen unchanged (existing TicketDetails test suites green, visual
  spot-check of both layouts).
- `CoManagedTicketPanel` and its stacked children removed; no dead imports.
- Focused unit suites + the co-managed DB integration suite green.
