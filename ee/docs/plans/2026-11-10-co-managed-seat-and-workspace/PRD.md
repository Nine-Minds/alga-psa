# PRD — Co-managed IT: seat and workspace shapes on one seat pool

- Slug: `co-managed-seat-and-workspace`
- Date: `2026-11-10`
- Status: Draft for slice breakdown, revision 2
- Code baseline: `origin/main` at `88c634d5b5`
- Rollout flag: `release-v2-0-feature`, reached only through a new capability `co-managed-seat`
- Prerequisite plan: `ee/docs/plans/2026-11-10-authorization-client-scope-completion` ("the authorization plan")

## What changed in revision 2

Revision 1 made the seat technician a client-side portal user with a separate technician workspace. Revision 2 makes the seat technician an internal user in the MSP's own application, restricted by the authorization kernel.

Why it changed:

- Restricting an internal user to one client is something the product already sells through authorization bundles. The gaps that made that unsafe (search, client lists, time, schedule, create paths) are defects in a shipped feature and are being fixed in the authorization plan regardless.
- With those fixed, a client-side technician would mean building a second technician surface next to the real one and still paying for the authorization fixes.
- An internal-side technician is what MSPs asked for: a technician in their PSA with limited access.

Graduation from seat to workspace is no longer in this plan. It is a later plan of its own.

## Summary

Co-managed IT on main has one shape: the MSP sponsors a separate customer tenant (a **workspace**) for a client's IT team. This plan adds a second shape, the **seat**: the client's technician signs in to the MSP's own PSA and works their company's tickets there. Both shapes draw from the one seat pool the MSP already buys, at the one price already configured. The MSP picks a shape per client.

## Problem

MSPs asking for co-managed fall into two groups, and the product serves one.

- **Client with a real IT department.** The workspace shape fits: the client owns its service desk and escalates to the MSP.
- **Client with one or two internal IT people.** The MSP runs the main desk. The client's technician needs to be assigned tickets, exchange notes with MSP technicians that the end user does not see, hand work back and forth, and log time. The client portal offers none of those: a portal user cannot be assigned a ticket, cannot read or write a non-public note, and cannot log time.

An MSP that adds that person as an ordinary internal user today exposes every other client and its own commercial data, and pays a full PSA seat for it.

## Terms

| Term | Meaning |
| --- | --- |
| Shape | How a client is co-managed: `seat` or `workspace`. Chosen per client. |
| Arrangement | The live co-managed agreement between the MSP and one client, of either shape. A client has at most one. |
| Seat arrangement | Rows in the MSP's tenant binding one client to a seat allocation, a board scope and its seat technicians. |
| Seat technician | An internal user of the MSP's tenant who holds a live seat assignment for exactly one client. |
| Pool | The MSP's purchased co-managed capacity: one `co_managed_entitlements` row per sponsor. |
| Allocation | Seats taken from the pool for one arrangement: a `co_managed_allocations` row. |
| Committed seats | Seats in use inside an allocation: active technicians plus pending invitations. |
| Responsibility | Which organization is on the hook for a ticket right now: `client_it` or `msp`. |
| Organization | The reader's side of an arrangement: MSP staff, client IT (seat technicians of that client), or requester. |
| Operational surface | The screens a co-managed customer technician gets today: tickets, projects, time, assets, documents. No sales, billing or settings. |

## Goals

1. An MSP enables co-managed IT for a client as a seat arrangement or a workspace, from one entry point.
2. Both shapes consume the same pool at the same price. No second SKU, price id or subscription item.
3. A seat technician works in the real MSP application: the native ticket list and ticket screen, assignment, notes, time.
4. A seat technician can reach only their own client's operational records. Everything else is denied by default, not subtracted piece by piece.
5. One ticket, a real handoff, in both directions, including work the MSP originates.
6. Notes have three audiences: requester, shared IT, MSP-private.
7. Technician time is operational and is never billed or invoiced.
8. A seat technician never counts against the MSP's own licensed seats.
9. Nothing changes for a tenant that does not use the seat shape.

## Non-goals

- Changing how the workspace shape behaves.
- A new price, SKU, annual discount or bundled-seat offer.
- Graduation from seat to workspace. A later plan.
- Client-private notes in the seat shape. Everything a seat technician writes is readable by the MSP.
- Technicians who serve more than one client.
- API keys, REST or MCP access for seat technicians.
- Remote control, script execution or any RMM write.
- Dispatch, scheduling, teams, reports, workflows, settings and user administration for seat technicians.
- Timesheet submission and approval for seat technicians.
- Fixing authorization coverage. That is the authorization plan.

## The two shapes

| Concern | Seat | Workspace |
| --- | --- | --- |
| Where records live | The MSP's tenant | The customer's own tenant |
| Who owns the service desk | The MSP | The client |
| Technician identity | Internal user of the MSP tenant with a seat assignment | Internal user of the customer tenant |
| Sign-in | The MSP's sign-in | The customer workspace sign-in |
| Ticket visibility | The client's tickets on boards the MSP puts in scope | Boards the client shares with the MSP |
| MSP-originated work | Visible and assignable to the technician | Not addressed |
| Device context | The client's assets, RMM inventory included, read-only | The client's own asset records only |
| Notes | Requester, shared IT, MSP-private | Requester, shared IT, private to each organization |
| Time | Operational for technicians, commercial for MSP staff | Each tenant owns its time |
| Seats | Same pool, same price | Same pool, same price |

## Design decisions

### D1. One offering, one pool, one price

Seat and workspace are two allocation kinds on `co_managed_allocations`. Capacity, purchase, reconcile, lapse and grace are computed once across both. Nothing in Stripe changes: the pool is the subscription identified by `metadata.subscription_kind = 'co_managed'` and priced by `STRIPE_CO_MANAGED_USER_PRICE_ID`. Amount and currency come from the Stripe price object and are shown through the existing currency components.

### D2. The seat technician is an internal user restricted by the kernel

A seat technician is a `user_type = 'internal'` user with a live seat assignment row naming one client. Three things restrict them:

1. **Built-in kernel rules.** A resolver registered by the co-managed package gives a seat subject non-editable rules: own client only, in-scope boards for tickets, shared projects for projects, and a closed baseline so any resource it does not name is denied. This uses the resolver registry and closed baseline from the authorization plan (authorization F012, authorization F008).
2. **A seat role.** An MSP-side role with operational permissions and no sales, billing, accounting, settings or user-administration permissions.
3. **The operational surface.** Routes, menu and product guards resolve per principal, so a seat technician gets the surface a co-managed customer technician gets today.

Rejected: a client-side portal user with a separate technician workspace (revision 1). It duplicates the technician surface and leaves the authorization gaps to be fixed anyway.

Rejected: an editable bundle per arrangement. An administrator editing a bundle must not be able to loosen what a client's employee can see.

Rejected: a new `user_type` value. Code that branches on user type treats anything that is not `client` as fully internal in several places.

### D3. A seat technician is not an MSP licence

Internal users are counted against the MSP's licensed seats in about seven places, each with its own query. One function becomes the count of MSP-licensed users and excludes users with a live seat assignment. Seat technicians are admitted against their arrangement's allocation instead.

Revoking a seat deactivates the user. It never leaves behind an ordinary internal user. Turning a seat technician into an MSP employee is an explicit action that passes MSP seat admission.

### D4. A second capability on the same flag

`co-managed-seat` is a new capability key on `release-v2-0-feature`, with its own eligibility and participation resolvers and its own `FORCE_CAPABILITIES` key. No code reads the raw flag.

### D5. Audience visibility is keyed on organization, not tenant

`isCommentAudienceVisible` compares the owning tenant with the reader's tenant. In the seat shape both organizations are in one tenant and both are internal users, so that test shows every MSP-private note to the technician. The predicate and its SQL twin are generalized to the reader's organization, which for a seat technician comes from the seat assignment.

- `requester`: everyone with access to the ticket.
- `shared_it`: MSP staff and seat technicians of the ticket's client.
- `organization_private`: MSP staff only.
- A legacy internal thread with no stored audience resolves private and is never inferred to be shared.

### D6. Responsibility is explicit state

A ticket of a client in a seat arrangement carries a responsibility of `client_it` or `msp`, with a handoff command in each direction, a required shared note, an operation id and a receipt. It is separate from the assignee, so a ticket can be with client IT and unassigned.

### D7. Technician time is operational

Technician entries are written with `billing_mode = 'operational'`: no service, no contract line, zero billable duration. The time-entry dialog and save path have an operational mode that reads no service catalog, tax or contract data and skips billing allocation.

### D8. A client has one live arrangement

A client cannot be in a seat arrangement and a workspace relationship at once. The check runs in the admission command under the pool lock.

### D9. The people a technician can see are projected

An internal user can normally list every user in the tenant. A seat technician sees MSP staff who participate on tickets they can see (name and avatar only), the other technicians of their client, and their client's contacts. Pickers and mentions use the same projection.

## Dependency on the authorization plan

Segments A, B, D and the schema parts of E do not depend on it and can proceed in parallel.

Segment C, and anything that lets a real seat technician sign in, requires these to be on main first:

| Needed from the authorization plan | Feature |
| --- | --- |
| Built-in rule resolver registry | authorization F012 |
| Closed baseline | authorization F008 |
| One subject resolver | authorization F001 |
| Rule loading fails closed everywhere | authorization F007 |
| Create is evaluated; update and delete require read | authorization F010, authorization F011 |
| Coverage: clients, contacts, interactions, time entries, schedule, documents, tags | authorization F014 to authorization F023 |
| Aggregates, options and exports | authorization F024 to authorization F027 |
| Search | authorization F028 to authorization F031 |
| Read-coverage and permission-coverage contracts | authorization F036, authorization F037 |

When slice cards are filed, the slices of segment C here are stacked on the slice cards that carry those features.

The capability is not admitted for any tenant until the authorization plan's acceptance criteria pass and an independent security review of segment C here is done.

## Segments

| Segment | Title | Depends on | Posture |
| --- | --- | --- | --- |
| A | Seat pool: allocation kinds and capability | none | dark |
| B | Arrangement, seat assignment and licensing | A | dark |
| C | Seat authority and surface | B, the authorization plan | dark |
| D | Conversation audiences by organization | B | dark |
| E | Ticket work and handoff | C, D | flagged |
| F | Time, projects, devices and documents | C, E | flagged |
| G | Notifications and email | D, E | flagged |
| H | MSP administration surfaces | B, E | flagged |
| I | Ending, lapse and client lifecycle | B, E | flagged |

### Segment A — Seat pool: allocation kinds and capability

The pool can hold a seat-kind allocation, and one function knows how many seats are taken. Capability `co-managed-seat` is registered.

### Segment B — Arrangement, seat assignment and licensing

Seat arrangements and their technicians exist as durable rows. Technicians are admitted against the allocation, never against the MSP's licensed seats, and admission is race-free.

### Segment C — Seat authority and surface

The seat resolver gives a seat subject its built-in rules and closed baseline. The operational surface resolves per principal. The people projection, the commercial lookups and the client record projection are closed. A matrix test proves every resource type is either granted by a named rule or denied.

### Segment D — Conversation audiences by organization

Every note reaches exactly the audience its author chose when both organizations are internal users of one tenant.

### Segment E — Ticket work and handoff

A seat technician works tickets on the native list and ticket screen with a reduced capability set. Responsibility state and handoff in both directions. The MSP's mirror affordances: responsibility chip, Client IT group in the assignee picker, three-audience composer, list filter, SLA pause.

### Segment F — Time, projects, devices and documents

The time-entry dialog in operational mode. Shared projects. Read-only devices. Client-visible documents. Knowledge base limited to client-audience articles.

### Segment G — Notifications and email

Handoff notifications, private notes never reaching a technician, and email replies keeping their audience.

### Segment H — MSP administration surfaces

Shape chooser on the client's Co-managed IT tab, seat arrangement panel, an overview listing both shapes, and seat technicians shown apart from MSP staff in user administration.

### Segment I — Ending, lapse and client lifecycle

Every way a seat arrangement can stop or degrade has a defined result.

## Users and Primary Flows

### MSP administrator: enable a seat arrangement

1. Opens a client, **Co-managed IT** tab, and selects **Enable co-managed IT**.
2. Sees two options with one line each. Seat: the client's technicians work in your PSA, limited to their company. Workspace: the client's IT team gets its own service desk and escalates to you.
3. Chooses Seat. Sees pool capacity (purchased, allocated, available) and any eligibility blocker.
4. Sets the number of seats, the boards in scope and the first technician's name and email.
5. Confirms. The allocation is reserved and activated, the arrangement is written and the technician is invited.
6. If capacity is short, reviews a pool purchase for the new total, then resumes without paying twice.

### Seat technician: daily work

1. Accepts the invitation and signs in at the MSP's sign-in.
2. Lands in the MSP application with a short menu: Tickets, Projects, Devices, Documents, Time.
3. Opens the ticket list. Only their company's tickets on in-scope boards are there. Views: Client IT, With MSP, Unassigned, All.
4. Opens a ticket on the native ticket screen. Sees requester replies and shared IT notes. Does not see MSP-private notes or any billing field.
5. Assigns it to themselves, changes status, adds a shared IT note, logs time.
6. Selects **Hand to MSP**, writes a shared note, confirms.

### MSP technician: hand work to client IT

1. Opens a ticket for a client in a seat arrangement. A chip shows who is responsible.
2. Selects **Hand to client IT**, optionally names a technician, writes a shared note.
3. The MSP's SLA timers pause. The client's technicians are notified.
4. When the ticket comes back, timers resume and the MSP is notified.

## UX / UI Notes

- Use existing standard components first: `DataTable`, dialogs, the client tab seam, UI slots, the native ticket and project screens, the audience select, the pool editor.
- Never show raw IDs.
- The seat technician uses the MSP application shell. No new shell.
- The shape chooser is two options with one sentence each.
- The audience select replaces the Internal toggle only on tickets of clients with a live arrangement. For MSP staff its default is Private.
- In user administration, seat technicians are listed apart from MSP staff, labelled with their client, and excluded from the licence usage figure.
- Copy follows `psa-copywriting` and `alga-tech-doc-writing`.
- All new strings exist in every shipped locale.

## Requirements

### Functional Requirements

See `features.json` (F001 to F095) and `tests.json`. Each feature names its segment in `prdRefs`.

| Segment | Features |
| --- | --- |
| A | F001 to F011 |
| B | F012 to F025 |
| C | F026 to F034 |
| D | F035 to F045 |
| E | F046 to F065 |
| F | F066 to F078 |
| G | F079 to F083 |
| H | F084 to F090 |
| I | F091 to F095 |

### Non-functional Requirements

From the co-managed redelivery plan, binding on every card:

- **Neutrality.** Flag off means no behavior change for any tenant. Flag on without entitlement means none either.
- **Hot paths.** A tenant not served by `co-managed-seat` runs zero additional queries on native ticket list, ticket detail, comment write and time-entry paths.
- **No wrapping native writers** in seat transactions. Register into seams.
- **Migrations.** Expand-only, squashed per card, dated after the newest on main, `NOT VALID` then `VALIDATE` separately, indexes created concurrently, no triggers, idempotent, Citus-safe, N-1 compatible.
- **No global backfills** of permissions or reference data. Seed on admission.
- **Invariants live in application code.**
- **Workers** never call PostHog and must boot if the seat modules fail to resolve.
- **Generated artifacts** are regenerated in the same pull request.
- **Every new table** is registered in the tenant table manifest.

## Data / API / Integrations

### Changed table

`co_managed_allocations` (sponsor tenant)

| Column | Change |
| --- | --- |
| `allocation_kind` | New. `workspace` (default) or `seat`. |
| `sponsor_client_id` | New, nullable. Required for `seat`. Written for new `workspace` rows as well. |
| `customer_tenant`, `relationship_id` | Become nullable. Required for `workspace`, absent for `seat`. |
| Checks | Kind-aware replacements for `tenant <> customer_tenant` and the target columns. |
| Index | Unique live seat allocation per `(tenant, sponsor_client_id)`. |

### New tables (MSP tenant, tenant-first composite keys)

| Table | A row means |
| --- | --- |
| `co_managed_seat_arrangements` | One client's seat arrangement: client, allocation, state, handoff defaults, settings, revision. |
| `co_managed_seat_board_scopes` | One board in an arrangement's scope, and whether technicians may create tickets on it. |
| `co_managed_seat_assignments` | One technician seat: arrangement, user once accepted, invitation, state. |
| `co_managed_seat_project_grants` | One project shared with an arrangement. |
| `co_managed_seat_ticket_work` | Responsibility for one ticket: `client_it` or `msp`, revision. |
| `co_managed_seat_ticket_handoffs` | One handoff receipt: operation id, fingerprint, from, to, note, actor. |

### Reused, not forked

- Capacity, purchase, reconcile and lifecycle in `packages/licensing/src/lib/co-managed-*`.
- The authorization kernel, its resolver registry and closed baseline.
- The product surface registry and the `co_managed` product's MSP surface rules.
- `time_entries.billing_mode` and the operational field set.
- `comment_threads.collaboration_audience` and `shared/lib/commentAudience.ts`.
- The ticket data source capability set and the native ticket and project screens.
- Internal user invitation, with seat-kind admission.

### External

- Stripe: no change.
- Self-hosted licence: the existing `co_managed_seats` claim covers both shapes.

## Security / Permissions

- **Deny by default.** The seat resolver's baseline is closed. A resource type added to the kernel later is denied to seat technicians until the resolver names it. A contract test fails if the resolver does not classify every catalog resource type.
- **Authority from rows.** The seat scope is resolved per request from the assignment and arrangement. Revocation takes effect on the next request.
- **Commercial data.** The seat role has no commercial permission. The two commercial lookups that perform no permission check today are fixed here. Client records are projected without billing columns for a subject without billing permission.
- **Notes.** Legacy internal notes are never shown to a technician. Email to a technician contains only audience-visible content.
- **Assignment.** A seat technician can be assigned only to tickets and tasks of their own client, in scope. Assignment anywhere else is refused.
- **No API.** A seat technician cannot create an API key, and REST and MCP refuse a seat principal.
- **Residual risk.** A server action that performs no permission check and no kernel call is reachable by any internal user, a seat technician included. The authorization plan's permission-coverage contract pins those and forbids any that read commercial data. An independent security review of segment C is required before the capability is admitted for any tenant.
- **Honest claim.** In the seat shape the client's records live in the MSP's account and the MSP can read everything a technician writes. Product copy says so.

## Rollout / Migration

1. Segments A, B and D merge dark, in parallel with the authorization plan.
2. Segment C merges dark after the authorization plan's features it depends on.
3. Segments E to I merge behind the capability.
4. The internal sponsor tenant is admitted first, after the security review, then a 24-hour watch.
5. Rollback ladder: remove targeting, then `FORCE_CAPABILITIES=co-managed-seat:off`, then traffic flip. No down-migration in production.

## Risks

- **A client's employee inside the MSP application.** The failure mode is one client's employee seeing another client's data or the MSP's margins. The protections are the closed baseline, the seat role, the operational surface and the coverage contracts. The review before admission exists because no one of them is sufficient alone.
- **Unchecked server actions.** See Residual risk above. The size of the pinned list is not known until the contract runs.
- **Legacy internal notes.** Years of candid notes exist on tickets that become visible to a technician. The rule that a legacy note is never inferred to be shared has its own test.
- **Schedule coupling.** A real seat technician cannot sign in until the authorization plan lands.
- **Lock order.** Seat admission takes the tenant advisory lock and then the entitlement row lock of the same tenant. Reservation, purchase and reconcile take the entitlement lock without the advisory lock. Segment B owns the proof that this cannot deadlock.
- **Internal email claim.** Internal emails are unique across the platform. A technician whose email is already an internal user elsewhere cannot be invited. The invitation reports this plainly.
- **Self-hosted capacity.** The survey found no production writer for a `self_host` or `admin_grant` entitlement row on main. If that is right, neither shape is reachable on a self-hosted installation until that writer exists. Outside this plan.

## Open Questions

Each has a default the cards build to.

1. **MSP effort shown to client IT.** Default: off, with a per-arrangement setting to show the MSP's total hours on a ticket.
2. **SLA.** Default: MSP timers pause while responsibility is with client IT, and SLA targets are hidden from technicians.
3. **A technician who also has a requester portal account.** Default: the two accounts stay separate. The portal account is untouched.
4. **Tags.** Default: technicians apply existing tags and cannot create tags.
5. **Project visibility.** Default: none until the MSP shares a project with the arrangement.
6. **Hosted eligibility.** Default: same as workspace. The sponsor is a `psa` tenant on the Pro plan.
7. **Bundled seats.** Whether Pro should include a few pool seats is a pricing decision and is not built here.
8. **Release order.** Default: admit the seat shape before widening the workspace shape.

## Acceptance Criteria (Definition of Done)

1. An MSP administrator enables a seat arrangement for a client from the Co-managed IT tab, and the pool's available count drops by the seats allocated.
2. With one seat left in the pool, a seat arrangement and a workspace provisioning requested at the same time produce exactly one winner.
3. A seat technician signs in to the MSP application and can list, open, create, edit, comment on and log time against tickets of their own client on in-scope boards.
4. A seat technician cannot retrieve, by any route, action, search or export in the product, a record of another client, an MSP-private note, or any service, rate, contract, invoice or quote data.
5. An MSP technician hands a ticket to client IT with a shared note. The technician sees it under Client IT. The MSP's SLA timers pause. Handing it back resumes them.
6. A technician's time entry is operational and does not appear in any billing run, invoice preview or approval queue.
7. The MSP's licence usage is the same before and after seat technicians are added.
8. Revoking a seat, ending an arrangement, and the pool lapsing into read-only each take effect on the technician's next request.
9. A plain PSA tenant with the flag off, and one with the flag on and no entitlement, show no change, and their hot-path query budgets are unchanged.
10. `FORCE_CAPABILITIES=co-managed-seat:off` removes every seat entry point with data intact, without affecting the workspace shape.

## Evidence

"Verified" means read directly in `origin/main` while writing this plan. "Surveyed" means reported by a code survey with citations and not re-read line by line.

| Fact | Where | Status |
| --- | --- | --- |
| All 27 co-managed redelivery cards (L0a to L9) have merged | first-parent PRs on `origin/main` | Surveyed |
| Allocation rows require `customer_tenant` and `relationship_id`, with `CHECK tenant <> customer_tenant` | `server/migrations/20261028130000_create_co_management_foundation.cjs` | Verified |
| Allocated seats are summed in three places | `packages/licensing/src/lib/co-managed-entitlements.ts`, `co-managed-purchases.ts`, `co-managed-reservation.ts` | Surveyed |
| MSP seat counting counts `user_type = 'internal'`, in about seven places | `packages/users/src/lib/internalUserLicenseGuard.ts` and the `getLicenseUsage` and `getActiveUserCount` copies | Surveyed |
| Pool price comes from `STRIPE_CO_MANAGED_USER_PRICE_ID` | `ee/server/src/lib/stripe/coManagedSubscription.ts`, `StripeService.ts` | Surveyed |
| Capability registration steps | `packages/core/src/lib/capability.ts`, `packages/co-managed/src/capability.ts`, `server/src/lib/capability/bootstrap.ts` | Surveyed |
| Built-in rules resolve per subject through a resolver | `packages/authorization/src/kernel/providers/builtinProvider.ts` | Verified |
| Product surface rules are deny-by-default and resolved per tenant | `server/src/lib/productSurfaceRegistry.ts`, `productAccess.ts` | Surveyed |
| Audience visibility compares tenants | `shared/lib/commentAudience.ts` | Verified |
| Human-work assignees must be active internal users | `shared/lib/humanWork/assertHumanWorkAssignee.ts` | Verified |
| The ticket screen reads through a data source with a capability set; the page preloads regardless of capability | `packages/tickets/src/lib/ticketDataSource.ts`; `server/src/app/msp/tickets/[id]/page.tsx` | Verified; Surveyed |
| Operational time mode exists | `packages/co-managed/src/timeEntryBillingMode.ts` | Verified |
| The time-entry dialog and save path read service, tax and contract data and fail without them | `TimeEntryProvider.tsx`, `timeEntryWriteCore.ts` | Surveyed |
| `getServices` and `getEligibleContractLinesForUI` lack a permission check | `serviceCatalogActions.ts`, `contractLineDisambiguation.ts` | Surveyed |
| Ticket form options return every user in the tenant, portal users included | `optimizedTicketActions.ts` | Surveyed |
| Client reads return billing columns | `optimizedTicketActions.ts` (`c.*`), `client.interfaces.ts` | Surveyed |
| Internal emails are unique platform-wide | `packages/db/src/models/user.ts` (`findInternalEmailClaim`) | Verified |
