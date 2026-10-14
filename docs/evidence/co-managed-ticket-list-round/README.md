# Real-UI evidence: co-managed client integration + ticket-list unification

Captured 2026-09-13 with local Playwright driving system Chrome against the
development server on `http://localhost:3374` (database `server_co_managed`,
MSP tenant `Oz`), signed in as `glinda@emeraldcity.oz`.

The tenant holds two co-managed relationships: **White Rabbit** (`provisioning`)
and **Emerald City** (`terminated`). There is no relationship in the `active`
state, which bounds what could be exercised — see *Not covered* below.

## Native ticket list is not regressed

The unification adds a scope bar to `/msp/tickets` and otherwise leaves the
native list alone. These prove the native surface still works.

| file | shows |
|---|---|
| `03-msp-tickets-native.png` | Board tab strip (`All tickets`), the new Working queue / Customer oversight + Workspace scope bar between the heading and the board strip, `Search tickets and comments…`, Filters, Bundled toggle, View, inline tags, bundle paths, Client and Assigned To columns, the adaptive `1 column hidden / Show all` notice, pagination |
| `04-msp-tickets-search.png` | Native search accepting input |
| `05-msp-tickets-view-menu.png` | Native View menu |
| `40-msp-tickets-share-menu.png` | Share menu: Print, Print options, Export CSV (correctly disabled with no selection), Import CSV |
| `06-msp-tickets-row-detail.png` | Row click reaching `/msp/tickets/<id>` ticket detail |

## Qualified (combined) list

| file | shows |
|---|---|
| `12-legacy-co-managed-tickets.png` | The qualified list with **real rows** — 5 tickets, `Ticket / Status / Priority / Responsible organization / Updated`, workspace name under each ticket, `5 tickets · 5 open · 0 closed`, Export CSV, Add MSP ticket. All columns render with no hidden-column notice, which is the opt-in `columnFitMode="scroll"` path |
| `13-msp-tickets-qualified-oversight.png` | Customer oversight scope: toolbar (search, Status, Sort by, Order, Reset) and the empty state `No permitted tickets match these filters.` |

## Client record integration

| file | shows |
|---|---|
| `21`,`22` | White Rabbit co-managed section — seats, customer workspace, administrator, Setup progress (Retry / Cancel setup), Work links — and the same after a full page refresh |
| `24`,`25` | Emerald City (terminated) co-managed section, before and after refresh |
| `23`,`26` | The client Tickets tab for each |

## Overview and legacy adapters

| file | shows |
|---|---|
| `10-co-managed-overview.png` | `/msp/co-managed`: pool totals (3 purchased / 1 allocated / 2 available), Shared work tile, co-managed client table with translated headers and Manage access links, Customer workspaces table |
| `12` | `/msp/co-managed/tickets` → `/msp/tickets?queueView=working&workspace=all` |
| `31-legacy-op-access.png` | `/msp/co-management?operationId=…` → `/msp/clients/<client>?tab=co-managed&relationshipId=…&section=access` |
| `32-legacy-op-sla.png` | the same legacy route with `section=sla` |
| `33-legacy-clientid-overview.png` | `/msp/co-managed?clientId=…` → `/msp/clients/<id>?tab=co-managed` |

`11-legacy-co-management.png` shows bare `/msp/co-management` rendering
`Could not load access settings`. That is **pre-existing**, not caused by this
round: with no `operationId`/`clientId` the adapter renders its children
unchanged, and those children are the customer-side access panel, which has
nothing to load for a sponsor tenant.

## Not covered

- **Handback.** No ticket in this database is eligible for return to customer IT
  (all five qualified rows are MSP-responsible), so the selection checkboxes,
  the handback composer, per-item outcomes and session recovery were never
  exercised in a browser.
- **Active-state relationship behavior.** Both relationships are
  `provisioning`/`terminated`.
- **Qualified row click-through and CSV download.** Title links render with the
  correct hrefs but were not clicked, and no CSV file was downloaded.
- **Release-flag-off rendering.** The new
  `TicketListQualifiedFallback` (qualified URL + flag off → redirect to the
  native list) is code- and typecheck-verified only.

## Amendment finishing pass (2026-10-14)

Everything is under `amendment-2026-10-14/`. Shots were taken on the running app
(port 3374) against `server_co_managed`. The directory's `.gitignore` rules drop
`*.png` and `*.log`, so shots are force-added and logs are committed as
`raw-logs/*.txt` (same convention as `docs/evidence/co-managed-completion/`).
Verify with `git ls-files docs/evidence/co-managed-ticket-list-round/amendment-2026-10-14`.

Data caveats, stated plainly:
- The dev DB holds ONE shared ticket (000001). Pagination, page size and
  duplicate-identity rows therefore cannot be shown in a browser; they are
  proven by unit and real-DB tests only (see "Not shown in a browser").
- Shots `97`/`98` follow a delegated grant created through Alice's UI so the
  "shown" half of Delegated administration could be captured. That grant stays in the dev DB.
- The German shots used a temporary `user_preferences` locale row for qa
  (the user preference beats the cookie); the row was deleted afterwards.

| shots | shows |
|---|---|
| `01`–`06` | Alice (customer IT) takes back a shared ticket, then escalates it |
| `10`, `51`, `62` | qa on All Tickets: callout (counts from the authorized reader) |
| `12`, `52`, `63` | qa follows the callout to `/msp/tickets/customer`; row count matches |
| `13`, `14`, `71` | shared ticket detail opened from Customer Tickets, then back |
| `16` | legacy `queueView` URL redirected |
| `17`, `92` | client record Tickets tab: still the native `MspClientTickets` |
| `21`, `22`, `53` | handback composer, selected row, post-handback state (earlier pass) |
| `40`–`44`, `94`, `95` | noassign: no entry points, ordinary native list |
| `64`, `65` | customer oversight, with filters |
| `70`, `71`, `72` | F006: filters applied, open a row, Back: search box and filters restored |
| `74`, `75` | F032: forced load failure shows Retry, then a successful Retry |
| `76`, `96` | F032: filtered no-match message vs the unfiltered-empty message (noassign) |
| `77`, `78` | client options and client narrowing |
| `79` | F021: sort by header (direction toggles) |
| `73` | F021: table |
| `80` | F036/F038: 768px, toolbar wraps, table scrolls inside its frame |
| `81` | F038: 390px, see the open note: the app's expanded sidebar leaves the list about 134px |
| `82`, `83` | F036: dark theme |
| `84`, `85` | F038: de locale (translated title, tabs, toolbar, columns, counts) |
| `86`, `87` | F036/F038: keyboard-only tab through the toolbar, focus ring on Filters |
| `90`, `109` | `/msp/tickets?workspace=msp` and `?workspace=msp&queueView=working` land on native with no qualified params |
| `91`, `97`, `98` | Delegated administration: shown for qa after a grant and for alice; hidden for noassign (`95`) |
| `93` | co-management task queue unchanged |
| `111`–`116` | T019 handback by keyboard: row selected with Space, composer opened with Enter, note typed, submit; focus lands on the outcome list; Reload lands on the counts line; All Tickets after |
| `db-*.txt` | routing events and ticket-work rows after handback |

### Step-2 parity checks (`raw-logs/step2-parity.txt`)
- Against `origin/main`, `server/src/app/msp/tickets/page.tsx`, `TicketingDashboard.tsx` and
  `TicketingDashboardContainer.tsx` differ only by the `listCallout` slot and the legacy `queueView` redirect.
  (Against the older `391e83112e` the diff also shows main's template-menu work, which is not ours.)
  `DataTable.tsx` differs from `391e83112e` only by `columnFitMode`.
- `ticketQueue.ts` has no `projection(actor.tenant` branch; the only hit in `packages/co-managed`
  is the unrelated project-task queue (`projectTaskQueue.ts:117`).
- `/msp/tickets?workspace=msp` stays at that URL and renders native (`resolveLegacyQueueRedirect` only
  redirects on an explicit `queueView`); with `queueView` it redirects to `/msp/tickets` with the
  qualified params stripped (`90`, `109`).
- Client Tickets tab renders `MspClientTickets` (`92`).
- Delegated administration: hidden for noassign, shown for qa once a grant exists (`91`, `95`, `97`).
  By design, a PSA tenant's entry appears only when the delegated directory returns a workspace with a grant.
- `/msp/co-management/tasks` and the task-queue sources are unchanged against `e65b297c2a~`.

### Mutation / revert checks
- `raw-logs/mutation-t003-t004-red.txt`: reader mutated, T003 and T004 red, restored.
- `raw-logs/t014-mutation-red.txt`: per-item stale/forbidden reporting broken in `ticketBulkHandback.ts`, T014 red, restored.
- `raw-logs/f006-revert-red.txt`: F006 mount-adoption effect removed, test red, restored.
- `raw-logs/reader-reverted-fail.txt`: reader reverted to red (earlier round).

### Run results (this commit)
| run | result |
|---|---|
| unit: customerTicketsRows (13), customerTicketsFlagOff (3), coManagedT21Boundary (6), qualifiedTicketList (23), page.customerTickets (9), coManagedCallout (20) | 6 files, 74 tests pass (`raw-logs/unit-run.txt`) |
| unit: `packages/ui` DataTable.columnFitMode | 1 file, 3 tests pass |
| real DB coManagedBootstrap T003, T004, T014 and the five T021 cases | 8 passed, 1422 skipped (`raw-logs/realdb-final-T003-T004-T014-T021.txt`) |
| `cd server && NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit` | exit 0, no output (`raw-logs/tsc-full-server.txt`) |

The real-DB harness clones the schema of `DB_NAME_SERVER`; run it against
`DB_PORT=5376 DB_NAME_SERVER=server_co_managed` (the shared test DB on 5472 predates the routing-notification migration and fails the seed).

One test change worth review: `coManagedCallout.test.tsx` "returns when a count changes" asserted the
dismissed segment's absence synchronously and failed intermittently (1 in 3 runs); it now uses `waitFor`.

### Fixes made this pass
- F006: `QualifiedTicketList` adopts the address bar on mount, because `history.replaceState` writes are not restored by the router on Back.
- F038 focus return: after a handback, focus moves to the outcome list; after "Reload current state" it moves to the counts line (previously it fell to `<body>`).

### Not shown in a browser
- F021 pagination and page size: one shared ticket in the dev DB. Unit-tested in `qualifiedTicketList.test.tsx`.
- Duplicate-identity open (T019): same-id rows from two customers are proven by `customerTicketsRows.test.tsx` and the real-DB `realdb-same-number` run; the dev DB has no such pair.
- 390px: the shell's expanded sidebar leaves the list about 134px (`81`); the list itself was not judged at that width.
