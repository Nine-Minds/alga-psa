# ITIL boards: one set of rules for priorities, categories, board setup and SLA

A ticket board is either ITIL or it is not. Before this branch the board/priority check ran on a
few write paths and was missing on most, ITIL categories only worked on a tenant's first ITIL
board, the standard set was matched by name, board create/update/delete differed between the web
and the REST API, and the automatic SLA policy for a new ITIL board depended on a page render.

This branch puts the rules in one shared module (`shared/lib/tickets/boardFieldRules.ts`), routes
every picker and every ticket write through it, gives every ITIL board its own copy of the standard
categories, makes board create/update/delete identical on web and REST, adds a supported board type
switch, fixes the SLA hook so a server action reaches it, and adds a second-ITIL-board surface
suite and a build guard.

Plan, decisions (D1–D10), rules (R1–R9), the category migration order, the commit groups and the
acceptance criteria are in `ee/plans/2026-11-21-itil-remediation/`. Items whose implementation or
test differs from the plan as written are listed under "Deviations for the operator" in the PRD.

## What changes

- One rules module for a board's priorities and categories, used by every picker, every create and
  every update; a guard script fails the build on a new direct read or write that goes around it.
- Every ITIL board owns its own copy of the standard categories. One Citus-safe migration adds the
  link, maps the flagged rows, gives each ITIL board its set, re-points every reference (tickets,
  templates, recurring definitions and overrides, inbound defaults, saved views, integration and
  checklist settings), clears the old flags last and adds the partial unique index. It keeps a
  remap table and has a working `down()`.
- Where a category list spans boards, a standard category appears once and matches every board's
  copy — in the ticket-list filters, saved views, checklist rules, the knowledge-base picker and
  the inventory review filter.
- Impact × Urgency decides the priority on an ITIL board; a direct priority change clears the
  assessment; a patch that empties both halves clears it too. A ticket's ITIL level is read from
  its priority, never stored.
- One board create, update and delete for the settings screen, the REST API, onboarding and the
  reference-data import, which now creates boards through a creator registered at startup.
- A board type switch behind `ticket_settings`, with a summary that counts what will no longer fit
  and states the board's SLA after the switch. No ticket, default, template or schedule is
  rewritten, and no SLA policy is assigned or removed.
- The SLA hooks live on `globalThis` and are registered from `initializeApp`, so creating an ITIL
  board through a server action or the REST API assigns the ITIL Standard policy with no page
  having rendered. The policy is found by a flag, not by its name.

No migration in this branch changes a ticket's priority, Impact or Urgency, and none assigns an SLA
policy to an existing board.

## Testing

Suites run on this branch (after merging current `main`):

- ITIL integration suites, all 16 files together: 228 passed — board field rules, the category
  board rules and filters, Impact/Urgency, create writers, update writers, priority pickers, board
  lifecycle, board deletion cleanup, board type switch, the SLA policy, the dev seed, the mismatch
  report, the second-ITIL-board surfaces, inbound defaults and the pre-existing priority/board
  suite. No expected-fail rows remain.
- `itilUpdateWriters.integration.test.ts`: 19 passed, including the new explicit-clear case at the
  rule and through `TicketModel.updateTicket`.
- `itilBoardLifecycle.integration.test.ts`: 13 passed, including the new board-import case (an
  imported ITIL board gets the kind, statuses, default priority, its own categories, the SLA policy
  and one `BOARD_CREATED`; with no creator registered the import refuses).
- `itilSlaPolicy.integration.test.ts`: 9 passed, including the SLA cancellation driven through the
  delete server action with the hook registered from outside the action's module.
- Guard: `npm run guard:ticket-board-field-rules` passes, and
  `itilBoardFieldRulesGuard.test.ts` 17 passed — one failing fixture per call shape (builder
  method, `from()`, helper with leading arguments, the join family, an aliased `leftJoin`, a helper
  ending in `Join`, a callable connection, a multi-line call), plus a compared string that is not a
  read and a stale allow-list entry that is reported.
- Contract and component suites: the ITIL contracts, the category picker's standard badge (new),
  the board editor suites, the reference-data import suites and the onboarding board statuses
  suite.
- `npm run lint:migrations`: 0 violations, 20 annotations honoured, 3 files scanned.
- `npm run test:i18n`: 81 passed.
- Pinned permission and read-coverage contracts: passed (the merge resolution of the pinned list is
  what they caught).
- `npm run generate:artifacts`: the OpenAPI, MCP and chat-registry artifacts regenerate byte for
  byte, so nothing was hand-merged.

Production build: `npm run build`, then the built server started and
`scripts/check-itil-sla-on-production-build.mjs` run against it. Without rendering any MSP page it
creates an ITIL board through the `createBoard` server action and through `POST /api/v1/boards`;
both came out with the tenant's ITIL Standard policy, their own categories and their statuses.

Browser check on the review slot: a custom board with five open tickets switched to ITIL and an
ITIL board switched back to custom, through the board type switch dialog. Both summaries matched
the database on every count before the confirm; after each switch the board opens and lists, the
tickets keep the priority they had, and no SLA assignment moved. Two runs were interrupted by the
shared development database reaching its connection limit and succeeded on retry. Earlier rounds'
browser findings — an assessment that survived a direct priority change, and a second ITIL board
with an empty category list — are the behaviour of the impact-urgency, writers-update and
category-rules groups, all committed here and covered by the suites above.
