# PRD — Contact-scoped ticket visibility for the client portal (opt-in)

- Slug: `2026-09-12-client-portal-contact-scoped-ticket-visibility`
- Date: `2026-09-12`
- Status: Draft — **blocked on one product decision**, OQ1 (null-contact policy).
  A recommendation with supporting evidence is attached; it needs a yes/no, not
  research. OQ2 (kernel scope) is resolved: required.

## Draft implementation review (2026-09-12)

The implementation is an unpublished draft. **OQ1 still needs Robert’s decision before landing.** The draft implements the recommendation: ordinary members of contact-scoped groups cannot see tickets with no contact; client admins can see them on their allowed boards. Default client-scoped groups retain existing behavior. This is a provisional choice, not a recorded product approval.

Implementation refinements verified in this checkout:

- The kernel’s built-in rules combine with OR. A single `contact_visibility` template therefore intersects client, board, and effective contact scope in both JS and SQL. Splitting these into separate built-in rules would widen access.
- `server/src/lib/authorization/kernel/*` are re-export shims. The package implementation is authoritative; both bundle catalogs are updated. The new template uses trusted resolved context, not editable per-rule IDs, so no additional bundle configuration/service override is needed.
- Both update actions preserve saved scope when older callers omit `ticketScope`. Both editors submit scope explicitly.
- The contact index is partial (`contact_name_id IS NOT NULL`), since contact equality cannot match NULL.
- User documentation is in `docs/client-ticket-visibility.md`. `website-docs.patch` is the corresponding nm-store update, prepared here for review and application with the feature release; the website checkout was not changed or published.

Full existing-schema Citus deployment verification and the null-contact decision remain release checks. See `SCRATCHPAD.md` for the executed PostgreSQL/Citus checks and their limits.

## Summary

Let an MSP restrict a client portal contact to seeing only the tickets they are
the contact on, instead of every ticket belonging to their client. The setting
lives on the existing client portal visibility group, is opt-in, and defaults to
today's client-wide behavior so no existing tenant changes on deploy.

## Problem

Client portal ticket visibility is currently all-or-nothing at the client level.
Every portal user at a client can read every ticket for that client, narrowable
only by board. There is no way to express "this contact sees only their own
tickets."

The reproducing shape: an HR or operations manager at a client files a ticket
that concerns a specific employee — a scheduled offboarding, a disciplinary
matter, a compensation change. Every portal user at that client can then read
it, including, potentially, the employee it is about. The MSP has no setting to
prevent this short of not letting the client use the portal for those requests
at all.

Board scoping does not solve it. Boards are an MSP-side routing concept; the
sensitive ticket and the routine ticket usually land on the same board, and the
client cannot be asked to reorganize the MSP's boards to get privacy.

Two independent customer requests for this arrived in the same week (one via
community chat, one via website feedback), which is the signal that this is a
general gap rather than one org's workflow preference.

## Goals

- A visibility group can be configured so its members see only tickets they are
  the contact on.
- Client admins retain client-wide visibility regardless of group setting.
- The restriction holds on **every** portal read path, including direct-ID
  access, the REST API, dashboard counts, and the activity feed.
- Composes with existing board scoping (a group may be both contact-scoped and
  board-limited).
- Opt-in: default is today's behavior, and no existing group changes meaning.

## Non-goals

- Restricting which statuses portal users can set (separate card).
- Watcher/CC contacts on tickets. `ticket_resources` holds only
  `additional_user_id` (MSP users); there is no contact-level watcher table and
  adding one is out of scope.
- Any change to MSP-side ticket visibility.
- Contact-scoping anything other than tickets (invoices, assets, projects,
  documents, appointment requests are unaffected).

## Users and Primary Flows

**MSP technician** (`packages/clients/src/components/contacts/ContactPortalTab.tsx`)
— creates or edits a visibility group for a client, chooses its ticket scope,
assigns it to a contact.

**Client portal admin** (`contacts.is_client_admin`, at
`/client-portal/client-settings?tab=visibility-groups`) — same, self-service,
for their own client only. Always retains client-wide visibility themselves.

**Client portal contact** — no new UI. Their ticket list, dashboard, search, and
direct links simply reflect the scope their group specifies.

## UX / UI Notes

Add a scope control to the group editor on **both** admin surfaces (they are two
independent implementations of the same editor; see Data section).

Use `RadioGroup` from `packages/ui/src/components/RadioGroup.tsx` —
`orientation="vertical"`, with the per-option `description` field carrying the
explanation. Two options is the case where a radio group beats a dropdown: both
choices stay visible, and the difference needs a sentence, not a word. Do not
hand-roll a control, and do not copy the raw `<input type="checkbox">` used by
the portal-side board list.

Copy (plain, no jargon — "contact" is our word, not the customer's):

- **All of this client's tickets** — "Members see every ticket for this client
  on the boards above."
- **Only their own tickets** — "Members see only tickets they are listed as the
  contact on. Client admins always see everything."

The second description must state the client-admin carve-out inline. An admin
configuring this needs to know why their own view did not change.

Both group **list** views should show the scope, not just the board count — the
MSP list row (`ContactPortalTab.tsx:1039-1041`) and the portal list row
(`VisibilityGroupsSettings.tsx:427-429`) currently show `N boards · M assigned
contacts`. A group that restricts by contact but shows no indication of it is a
trap for whoever edits it next.

The MSP-side assignment help text ("Assign a visibility group for this contact,
or keep full access.") implies board-only semantics and must be reworded.

## Requirements

### Functional Requirements

**FR1 — Schema.** `client_portal_visibility_groups.ticket_scope`, values
`'client' | 'contact'`, NOT NULL, DEFAULT `'client'`, with a CHECK constraint.

**FR2 — Context.** `ContactVisibilityContext` gains `ticketScope: 'client' |
'contact'` and `isClientAdmin: boolean`, both resolved in
`getClientContactVisibilityContext`. A contact with no group resolves to
`'client'`. `is_client_admin` is typed optional on the contact interface, so it
must be coalesced to `false`.

**FR3 — Client admin override.** If `isClientAdmin` is true the effective scope
is `'client'` regardless of the group's setting. This is required, not optional:
the manager who files the sensitive ticket is exactly the person who must keep
org-wide visibility, or the feature is unusable.

The override belongs in the **resolver**, computed once into an
`effectiveTicketScope`, not re-derived at each call site. Nine enforcement sites
each re-deriving `isClientAdmin ? 'client' : group.scope` is nine chances to get
it wrong, and the failure mode is a silent leak.

**FR4 — Enforcement.** Every portal ticket read path applies the contact
predicate when the effective scope is `'contact'`. Full site matrix in the
Implementation Notes section below.

**FR5 — Composition.** Contact scope and board scope both apply when both are
configured; neither replaces the other.

**FR6 — Admin surfaces.** Scope is settable and visible on both the portal-side
and MSP-side group editors, and is carried by both action modules' create, update,
and read paths.

**FR7 — Null-contact policy.** See Open Questions. Whatever is chosen is
implemented in one place (the shared predicate), documented, and asserted by a test.

### Non-functional Requirements

**NFR1 — Fail closed.** The resolver throws on a missing or cross-client group
today, and `ticketActions.ts:251` / `optimizedTicketActions.ts:234` catch and
return `[]` (deny-all). That behavior must survive. A resolver failure must
never degrade to client-wide visibility.

**NFR2 — No behavior change on deploy.** Every existing row gets
`ticket_scope = 'client'` via the column DEFAULT.

**NFR3 — Index.** Verified: **there is no index on `tickets.contact_name_id`.**
The only artifact is a foreign key, and Postgres does not index the referencing
side of an FK. `tickets` is Citus-distributed on `tenant`, so the tenant
predicate prunes to one shard, but within that shard the new equality filter is
unsupported.

Add `CREATE INDEX CONCURRENTLY idx_tickets_tenant_contact ON tickets (tenant,
contact_name_id)`, matching the `(tenant, <col>)` convention of
`idx_tickets_response_state` and `idx_tickets_master_ticket_id`. Given the high
null fraction established in OQ1, evaluate a partial index (`WHERE
contact_name_id IS NOT NULL`) — those rows can never satisfy an equality
predicate, so excluding them makes the index materially smaller.

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction, which the house
`exports.config = { transaction: false }` already accommodates.

## Data / API / Integrations

### Schema

One new column on `client_portal_visibility_groups`. The table is **Citus-local**
(no `create_distributed_table` anywhere, absent from the distributed-table list
in `citus-migration-smoke.yml`), so a plain `ALTER TABLE ... ADD COLUMN ... NOT
NULL DEFAULT 'client'` plus CHECK is sufficient and the DEFAULT backfills
existing rows in one statement. The per-tenant select-then-update backfill idiom
is **not** needed here — that idiom exists for distributed tables. Verify on a
Citus stack before landing; if the table turns out to be distributed, fall back
to the backfill idiom.

House style: `exports.config = { transaction: false }`, `hasColumn` guard,
mirrored `down`.

### Two action modules, two UIs

The card named the portal-side pair. There is a second, complete implementation
on the MSP side that must be kept in parity:

| | Portal-side | MSP-side |
|---|---|---|
| UI | `client-portal/.../VisibilityGroupsSettings.tsx` | `clients/.../ContactPortalTab.tsx:930-1074` |
| Actions | `client-portal-actions/visibilityGroupActions.ts` (zod) | `contact-actions/contactActions.tsx:1771-2280` (hand-validated) |
| Gate | `is_client_admin` | `contact:update` permission |

Verified: the MSP update writes only `name`, `description`, `updated_at`, so it
will **not** clobber `ticket_scope` if left untouched. The risk is comprehension,
not data loss — an MSP tech would edit a contact-scoped group through a form
that gives no indication the group restricts by contact.

### i18n

Strings live in `server/public/locales/<locale>/client-portal.json` under
`clientSettings.visibilityGroups` — **not** in the `client-portal/` directory,
which holds only `service-requests.json`. Ten locales: `de en es fr it nl pl pt
xx yy` (`xx`/`yy` are pseudo-locales).

`visibilityGroupsLocales.test.ts:48` hard-gates key parity but its array omits
`pt`. Add `pt` while adding the new keys.

MSP-side: the visibility-group section of `ContactPortalTab.tsx` is hardcoded
English today. New MSP strings should get real keys in
`server/public/locales/*/msp/contacts.json` rather than extending that precedent.

## Security / Permissions

The threat model is a peer at the same client, authenticated, using the product
normally or by guessing/【sharing】a ticket ID. Not an attacker with DB access.

The security-relevant property is that **every** read path enforces the scope.
One missed path is a silent leak, and the most likely miss is not the ticket
list — it is a secondary surface (dashboard feed excerpt, document list, a
direct-ID fetch behind a comment action). The mitigation is the single-predicate
design in FR3/FR4 plus the enforcement-matrix test.

`resolveVisibleTicket` is confirmed to be the single gate for direct-ID access
*within the portal actions*: the comment-insert path (`client-tickets.ts:643`)
and the status-update path (`:885`) both run after it, so closing that one gate
closes both.

It is **not** the only direct-ID surface. `GET /api/tickets/[id]/live-token`
reaches `getTicketById` with no user-type check of its own and mints a
collaborative-document token — see OQ2. Any audit that stops at the portal
action layer will miss it.

Note also that the permission layer is not a backstop here:
`hasPermission(user, 'ticket', 'read')` returns **true** for client users by
design, and `withAuth` does not assert user type. Visibility narrowing is the
only control. This is why the enforcement matrix has to be exhaustive rather
than best-effort.

## Rollout / Migration

Opt-in with a safe default; no flag needed. Deploy order is migration → code;
the column is additive and the code tolerates its absence only after the
migration, so standard ordering applies.

No backfill beyond the DEFAULT. No data is destroyed and the change is
reversible — setting a group back to `'client'` restores prior visibility
immediately, since scope is resolved per request and nothing is denormalized.

User-facing docs to update in `nm-store`:
`packages/nm-store/src/site/content/docs/client-ticket-visibility.md` (primary),
with references in `client-portal-user-guide.md:124` and
`client-portal-overview.md:35`.

## Open Questions

### OQ1 — Null-contact ticket policy (BLOCKING, product decision)

`tickets.contact_name_id` is nullable and often null. A naive `WHERE
contact_name_id = :me` hides every ticket that has no contact from every
contact-scoped user.

**The card lists three options, but two of them collapse.** Given FR3 (client
admins always get client-wide scope), option (c) "show null-contact tickets to
client admins only" is already satisfied — admins see everything, including
null-contact tickets, by virtue of the override. For a non-admin contact-scoped
user, (c) and (a) produce identical SQL. So the real decision is binary:

- **Hide them** — `contact_name_id = :me`. Sensitive by default. Nothing a
  contact-scoped user should not see can leak. Risk: a sparse ticket list.
- **Show them to everyone at the client** — `contact_name_id = :me OR
  contact_name_id IS NULL`. Closest to today; leaks nothing that is not already
  visible. Risk: the privacy promise is conditional in a way that is hard to
  explain — "only your own tickets, plus any ticket we could not attribute."

Engineering cost is identical. This is a product call about which failure is
worse: an empty-looking portal, or a privacy setting with an asterisk.

#### Evidence — how often is it null?

Audited every ticket-creation path. All of them funnel through one insert
(`shared/models/ticketModel.ts:756`, `contact_name_id: cleanedInput.contact_id
|| null`), and nothing anywhere validates that a contact is present. The null
rate is **structurally high**:

| Reliably sets a contact | Structurally always null | Conditional, often null |
|---|---|---|
| Client portal create (throws if the user has no contact) | Create-ticket-from-asset (no contact field in the schema at all) | MSP UI create — contact is **not a required field**, and the form only appends it for company-type clients |
| Portal service-request → ticket | Renewals queue (UI and background job) | Inbound email — see below |
| | Inbound email resolved via provider defaults (`inbound_ticket_defaults` has no contact column) | RMM / Huntress alerts — null unless an org-mapping default or client primary contact is configured |
| | | REST API and mobile — `contact_name_id` is optional in `createTicketSchema` |
| | | Telephony (caller-ID match), Teams, inbound webhooks |

On inbound email specifically: **no contact is ever auto-created.** The
`create_or_find_contact` workflow action exists but is invoked by no shipped
path. Attribution requires an exact sender-address match that also passes
SPF/DKIM alignment and is unambiguous; the matcher deliberately returns null on
ambiguity. Unmatched senders are instead added to a ticket watch list — the
existence of that fallback is the codebase's own statement that unmatched-sender
tickets are normal steady state, not an edge case.

Note the dev seeds are 100% contact-populated, so local testing will **not**
reproduce production null rates. Any manual smoke test must create null-contact
tickets deliberately.

#### Recommendation: hide them

Two reasons the sparse-portal risk is smaller than it first looks:

1. **The null-heavy paths are mostly tickets no individual filed.** RMM alerts,
   asset tickets, renewals, and provider-default email tickets have no human
   requester to attribute them to. A contact-scoped user not seeing them is the
   correct answer, not a gap. Meanwhile the case that matters most — a portal
   contact emailing in from their known address — *does* attribute correctly,
   because portal contacts are by definition contacts with email on file.
2. **The blast radius is bounded by design.** The feature is opt-in per group,
   client admins see everything via FR3, and the MSP chooses which contacts get
   a contact-scoped group. A client that lives on email-and-RMM tickets simply
   does not turn it on.

Hiding also keeps the promise honest: "only their own tickets" means what it
says, with no asterisk. Showing nulls would make the setting's behavior depend
on invisible upstream attribution quality — the same ticket would be private or
public depending on whether DKIM aligned that morning, which is not a rule
anyone can reason about.

The cost is real and must be stated, not buried: **contact-scoped users will not
see tickets raised on their behalf by a technician who did not set the contact
field.** That is the trade being accepted, and it belongs in the admin UI copy
and the user-facing doc, not just in this PRD.

Whichever is chosen: it is implemented once in the shared predicate, stated
plainly in the user-facing doc and in the radio option's description text, and
asserted by an explicit test.

### OQ2 — Scope of the authorization-kernel work — **RESOLVED: required**

Board scope has three parallel implementations: the direct
`applyVisibilityBoardFilter` helper, and the authorization kernel's JS and SQL
facets (`selected_boards`). The portal's own read paths use the first. The MSP
ticket actions named in the card use the kernel, where there is no query to
filter — narrowing is expressed as a relationship-rule template, and no
contact-aware template exists.

The question was whether that kernel work is needed now or is defence-in-depth.
**It is needed now**, for one concrete reason:

`GET /api/tickets/[id]/live-token` (`server/src/app/api/tickets/[id]/live-token/route.ts:118`)
calls `getTicketById(ticketId)` and, on success, mints a Hocuspocus
collaborative-document JWT. Middleware explicitly exempts the route from the
API-key gate (`middleware.ts:212`) and the handler **never checks `user_type`**.
A client-portal session can call it directly. `getTicketById`'s kernel narrowing
is therefore the only thing standing between a portal user and a live
collaboration token for an arbitrary ticket ID.

So if contact scope is not taught to the kernel, a contact-scoped user can still
mint a live token for a sibling's ticket on a visible board — precisely the leak
this card exists to close, and a worse one than read access.

Two further facts mean the remaining (currently unreachable) action paths should
also be covered rather than trimmed:

- `withAuth` does not assert user type (`packages/auth/src/lib/withAuth.ts:83`),
  and `hasPermission(user, 'ticket', 'read')` returns **true** for client users
  (`rbac.ts:88` plus the seeded `{ resource: 'ticket', action: 'read', client:
  true }` permission). The permission gate does not stop a client principal.
- Next.js server actions are addressable by action ID from any route, so a
  portal session can invoke an action no portal page renders. This is exactly
  the surface the original kernelization work set out to defend.

**Additional hardening (recommended, small):** add a `user_type !== 'internal'`
rejection to the live-token route handler, matching `apiMiddleware.ts:235`. That
route should not be relying on a downstream action's narrowing for its access
control. This is cheap, independently correct, and reduces how much this
feature's safety rests on kernel plumbing.

## Acceptance Criteria (Definition of Done)

1. A group set to contact scope hides a sibling contact's ticket from: ticket
   list, ticket detail, ticket documents, dashboard counts, dashboard activity
   feed, new-ticket board list, and the REST API.
2. A contact-scoped user cannot reach a sibling's ticket by direct ID —
   including via the comment add/update/delete and status-change paths, and
   including `GET /api/tickets/[id]/live-token`, which must mint no token.
3. A contact-scoped user who is a client admin sees everything.
4. A group with both contact scope and board scope applies both predicates.
5. Groups left at default scope behave exactly as before (regression guard).
6. The chosen null-contact policy is asserted by an explicit test.
7. Scope is settable and visible from both admin surfaces; both action modules
   round-trip it.
8. New i18n keys present in all ten locales; parity test extended to include `pt`.
9. The `t.board_id` alias defect in `getClientTicketDocuments` is fixed and
   covered (see Implementation Notes).
10. User-facing doc updated to describe the setting and the null-contact policy.

## Implementation Notes

### The choke point, and a defect it already caused

`applyVisibilityBoardFilter(query, visibleBoardIds, boardColumn = 't.board_id')`
takes its column with a **default**. `client-tickets.ts:1082` opens its query as
`.table('tickets')` — no alias — and calls the helper at `:1088` without the
third argument, inheriting `'t.board_id'`. There is no `t` in that FROM clause,
so for any contact in a board-restricted group `getClientTicketDocuments` emits
SQL referencing a missing alias and errors instead of returning documents.

This is a live defect on the already-shipped board-scoping feature, not
something this card introduces. Fix it here, since we are rewriting the call.

It is also the argument for the shape of the replacement: the new
`applyTicketVisibilityFilter(query, visibility, { boardColumn, contactColumn })`
should take its columns **explicitly, with no defaults**, so a caller cannot
inherit an alias its own FROM clause does not define. Per the card, do not leave
two competing helpers — migrate all callers and retire the old export (via the
`visibilityResolver.ts` re-export shim, which must be updated in step).

Existing unit tests mock the helper wholesale and assert only that it was
*called*; they never render SQL, which is why this survived. At least one
DB-backed test must exercise real SQL per alias context.

### Enforcement site matrix (verified, with aliases)

| Path | File:line | Ticket table | Board col | Contact col |
|---|---|---|---|---|
| Single-ticket gate (`resolveVisibleTicket`) | `client-tickets.ts:158` | `tickets as t` | `t.board_id` | `t.contact_name_id` |
| Ticket list | `client-tickets.ts:220` | `tickets as t` | `t.board_id` | `t.contact_name_id` |
| Ticket detail | `client-tickets.ts:333` | `tickets as t` | `t.board_id` | `t.contact_name_id` |
| Ticket documents | `client-tickets.ts:1082` | `tickets` | `tickets.board_id` | `tickets.contact_name_id` |
| Dashboard counts | `dashboard.ts:218` | `tickets` | `tickets.board_id` | `tickets.contact_name_id` |
| Dashboard activity feed | `dashboard.ts:318` | `tickets` | `tickets.board_id` | `tickets.contact_name_id` |
| REST API (`applyClientTicketScope`) | `TicketService.ts:284` | `t` | `t.board_id` | `t.contact_name_id` |
| New-ticket board list | `ticketFormActions.ts:107` | n/a (board query) | — | — |
| MSP actions via kernel | `ticketActions.ts:251`, `optimizedTicketActions.ts:234` | kernel | — | — |

Two sites the card did not list, both real: the filter call inside
`resolveVisibleTicket` itself (`client-tickets.ts:165`), and the re-export shim
`client-portal-actions/visibilityResolver.ts`, which must carry any rename or it
silently stops exporting a symbol that still has importers.

`ticketFormActions.ts:107` is a board-list query, not a ticket query — contact
scope does not restrict which boards you may file on. It needs no contact
predicate, but it is in the matrix so the audit is explicit rather than silent.

### Test infrastructure gotchas

- Unit suites run under the **server** vitest config, from `./server` with
  `SKIP_DB_TESTS=1` — not the per-package configs.
- `client-tickets.visibility.test.ts`'s `makeChainable` fake builder (`:129`)
  has a **closed method list** (`:131-134`). A new builder method called by the
  SUT fails with "not a function" until added.
- `server/src/test/unit/client-portal/algadeskPortalTicketing.contract.test.ts:39`
  asserts the **source text** of `client-tickets.ts` contains
  `'applyVisibilityBoardFilter'`. Renaming the helper fails this test; update it
  to assert the new choke point rather than deleting the assertion.
- `server/src/test/integration/ticketClientPortalAbac.integration.test.ts` is an
  existing DB-backed REST suite covering no-group, empty-group, cross-client,
  and fail-closed cases — the right home for REST contact-scope tests and for
  real-SQL alias coverage.
