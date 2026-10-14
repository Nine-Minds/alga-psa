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
(port 3374) against `server_co_managed`, before and after merging main.

| shots | shows |
|---|---|
| `shots/01`–`06` | Alice (customer IT) takes back a shared ticket, then escalates it |
| `shots/10`, `51` | qa on All Tickets: callout (counts from the authorized reader) |
| `shots/12`, `52` | qa follows the callout to `/msp/tickets/customer`; filter applied, row count matches |
| `shots/13`, `14` | shared ticket detail, then back on Customer Tickets |
| `shots/16` | legacy `queueView` URL redirected |
| `shots/17` | client record Tickets tab: still the native list |
| `shots/21`, `22`, `53` | handback composer, selected row, post-handback state |
| `shots/40`–`44` | noassign: no entry points, ordinary empty state |
| `db-*.txt` | routing events and ticket-work rows after handback |
| `reader-reverted-fail.log` | reader reverted to red (earlier round) |
| `mutation-red.log` | this round: reader mutated, T003 and T004 go red |
| `realdb-*.log` | real-DB runs |

Not captured in a browser this round (covered by unit tests only):
Retry after a load failure, the unfiltered-empty message, narrow-width,
keyboard, theme and translated-locale checks (F036/F038), and an explicit
Back-restores-filters pass (F006).
