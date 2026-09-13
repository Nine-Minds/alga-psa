# Scratchpad — Contact-scoped ticket visibility for the client portal

- Plan slug: `2026-09-12-client-portal-contact-scoped-ticket-visibility`
- Created: `2026-09-12`

## What This Is

Working memory for the contact-scoped portal ticket visibility effort. Append
discoveries and decisions; revise earlier notes when a decision changes.

## Decisions

- (2026-09-12) Scope lives on the **visibility group**, not on the contact.
  The group is already per-client, already assigned per-contact from two
  surfaces (portal-side self-service admin and MSP-side contact tab), and
  already has a settings UI, an actions layer, and tests. Putting a
  `ticket_scope` enum on the group reuses all of that. A per-contact flag would
  need a new assignment surface on both sides and would not compose with board
  scoping as cleanly.
- (2026-09-12) Client admins always keep client-wide visibility, regardless of
  their group's scope. Without this the feature is unusable: the manager who
  files the sensitive ticket is exactly the person who must still see
  everything. `contacts.is_client_admin` is already first-class and end-to-end
  wired, so this is an override in the resolver, not new plumbing.

## Discoveries / Constraints

### Verified current behavior (against this worktree, 2026-09-12)

- `ContactVisibilityContext` is built solely by
  `getClientContactVisibilityContext`
  (`packages/tickets/src/lib/clientPortalVisibility.server.ts:17`). Confirmed:
  `contactId` is carried but **never used as a filter** — only as the group
  lookup key and as the author stamp on portal create
  (`client-tickets.ts:1228`). Visibility today is strictly client-wide,
  narrowable only by board.
- The contact row is already read with `.first('contact_name_id', 'client_id',
  'portal_visibility_group_id')` at `clientPortalVisibility.server.ts:27-36`, so
  adding `is_client_admin` to that select costs no extra query.
- `contacts.is_client_admin` is typed **optional** (`is_client_admin?: boolean`,
  `packages/types/src/interfaces/contact.interfaces.ts:78`). The resolver must
  coalesce to `false` rather than trusting the field to be present.

### Enforcement sites — the card's matrix was complete but not exhaustive

Two call sites the card did not list, both real:

- `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:165`
  — the board filter inside `resolveVisibleTicket` itself (the card cited the
  function at :150 but not the filter call).
- `packages/client-portal/src/actions/client-portal-actions/visibilityResolver.ts`
  — a pure re-export shim (`applyVisibilityBoardFilter`,
  `getClientContactVisibilityContext`, `ContactVisibilityContext`, plus the two
  error constants). Any rename must pass through here or the shim silently
  stops re-exporting a symbol that still has importers.

Confirmed *not* enforcement gaps (gated upstream, no change needed):

- `client-tickets.ts:643` (comment insert) and `:885` (status update) are both
  writes that run **after** `resolveVisibleTicket`, so closing that one gate
  closes both paths. `:1291` is a post-insert reload of a just-created ticket.
  This validates treating `resolveVisibleTicket` as the single-ticket choke point.

### Pre-existing bug found while auditing (fix as part of this work)

`client-tickets.ts:1082` opens the query as `.table('tickets')` — **no alias** —
then calls `applyVisibilityBoardFilter(queryBuilder, visibility.visibleBoardIds)`
at `:1088` using the helper's **default** `boardColumn = 't.board_id'`. There is
no `t` in that FROM clause. For any contact in a board-restricted group,
`getClientTicketDocuments` therefore emits SQL referencing a missing alias and
errors out (`missing FROM-clause entry for table "t"`) instead of returning
documents.

Two consequences for this plan:

1. It is a live defect on the board-scoping feature that shipped earlier, not
   something this card introduces. Fix it here since we are rewriting the call.
2. It is direct evidence that the helper's **implicit default column is a
   footgun**. The replacement `applyTicketVisibilityFilter` should take its
   column names explicitly with no defaults, so a caller physically cannot
   inherit an alias that its own FROM clause does not define.

The existing unit tests do not catch this because they mock
`applyVisibilityBoardFilter` wholesale and only assert it was *called* — they
never render SQL. Column/alias correctness needs at least one DB-backed test.

### Alias inventory (the new helper needs per-site column names)

| Site | Ticket table expression | Board column | Contact column |
|---|---|---|---|
| `client-tickets.ts:158` resolveVisibleTicket | `tickets as t` | `t.board_id` | `t.contact_name_id` |
| `client-tickets.ts:220` list | `tickets as t` | `t.board_id` | `t.contact_name_id` |
| `client-tickets.ts:333` detail | `tickets as t` | `t.board_id` | `t.contact_name_id` |
| `client-tickets.ts:1082` documents | `tickets` (no alias) | `tickets.board_id` | `tickets.contact_name_id` |
| `dashboard.ts:218` counts | `tickets` | `tickets.board_id` | `tickets.contact_name_id` |
| `dashboard.ts:318` activity feed | `tickets` | `tickets.board_id` | `tickets.contact_name_id` |
| `TicketService.ts:289` REST | `t` | `t.board_id` | `t.contact_name_id` |

### The hard part: MSP action paths do not filter a query

`ticketActions.ts:251` and `optimizedTicketActions.ts:234` do **not** apply a
WHERE clause. They call `resolveClientSelectedBoardIds`, which returns
`visibleBoardIds ?? undefined`, and that array is fed into an **authorization
kernel** as a `selected_boards` relationship-rule template
(`optimizedTicketActions.ts:~253`: `selectedBoardIds === undefined ? [] :
[{ template: 'selected_boards' }]`). The semantics are `undefined` = no
narrowing, `[]` = narrow to nothing.

So contact scoping cannot be bolted on here with the same helper — it needs the
kernel to express "ticket.contact_name_id = subject.contact". Whether that is a
new rule template or a different mechanism is the main design risk in this plan.

Both functions already `catch { return [] }` to fail closed; that behavior must
survive whatever replaces them.

### Contract test that constrains refactoring

`server/src/test/unit/client-portal/algadeskPortalTicketing.contract.test.ts:39`
asserts the *source text* of `client-tickets.ts` contains the literal string
`'applyVisibilityBoardFilter'` (also `'resolvePortalVisibility'` and
`'Selected visibility group does not allow any boards'`). Migrating all callers
to a new helper name **will fail this test**. It must be updated in the same
change, and updated to assert the new choke point rather than deleted.

### There are TWO visibility-group admin UIs and TWO action modules

The card named the portal-side pair. There is a complete second implementation
on the MSP side:

| Surface | Portal-side (client admin) | MSP-side (technician) |
|---|---|---|
| UI | `packages/client-portal/src/components/settings/VisibilityGroupsSettings.tsx` | `packages/clients/src/components/contacts/ContactPortalTab.tsx:930-1074` |
| Actions | `.../client-portal-actions/visibilityGroupActions.ts` (zod-validated) | `packages/clients/src/actions/contact-actions/contactActions.tsx:1771-2280` (hand-validated, no zod) |
| Gate | `resolveManagementScope` → `is_client_admin` | `resolveContactAndVerifyPermission` → `contact:update` |

The MSP module is a full CRUD editor, not just an assignment picker. **Verified:
its update (`contactActions.tsx:2172-2178`) sets only `name`, `description`,
`updated_at` — it does NOT touch `ticket_scope`, so it will not clobber the
scope.** The real risk is a comprehension gap, not data loss: an MSP tech
editing a contact-scoped group would see a form with no scope control and no
indication the group restricts by contact. Both modules and both UIs must carry
the field or the MSP surface silently misrepresents what it is editing.

### i18n — the card's path was wrong

The visibility-group strings are **not** in `server/public/locales/*/client-portal/`
(that directory contains only `service-requests.json`). They are in the sibling
**file** `server/public/locales/<locale>/client-portal.json`, under
`clientSettings.visibilityGroups` (33 keys today) and
`errors.visibilityGroups`.

Ten locale directories exist: `de en es fr it nl pl pt xx yy` (`xx`/`yy` are
pseudo-locales). All ten already carry all 33 keys, so new keys mean editing ten
files.

`packages/client-portal/src/components/settings/visibilityGroupsLocales.test.ts:48`
hard-gates key parity — but its array is
`['de','es','fr','it','nl','pl','xx','yy']`: **`pt` is missing**. Pre-existing
gap; `pt` has the keys, it just isn't asserted. Worth fixing while we are here.

MSP side is worse: the entire visibility-group section of `ContactPortalTab.tsx`
is hardcoded English today despite the file using `useTranslation('msp/contacts')`.
New MSP-side strings should get real keys rather than following that precedent.

### UI component for the scope choice

`packages/ui/src/components/RadioGroup.tsx` exists and is exported from
`packages/ui/src/components/index.ts:111`. It supports a per-option
`description`, which is exactly what the two scope options need (the difference
is not obvious from a one-word label). It registers with the UI-reflection
system and emits `data-automation-id` per option, which the `algadev` smoke
tests need. This satisfies the standards rule against hand-rolling a control.

Note the portal-side board list currently uses raw `<input type="checkbox">`
while the MSP-side uses the design-system `Checkbox` — do not copy the raw-input
precedent for the new control.

### Citus — the migration is simpler than the card assumed

Both tables are registered `{ scope: 'tenant' }` in
`packages/db/src/lib/tenantTableMetadata.ts:288-289`. **That is the
application-level tenant-scoping axis, which is NOT the same as Citus
distribution.** On the Citus axis, `client_portal_visibility_groups` appears to
be **Citus-local**, not distributed and not a reference table:

- No migration anywhere calls `create_distributed_table`,
  `create_reference_table`, or `ensureTenantDistribution` for either table.
- Neither table appears in the distributed-table list in
  `.github/workflows/citus-migration-smoke.yml:126-134`.
- Corroborating: the create migration wraps the `contacts →
  client_portal_visibility_groups` FK in `.catch(() => {})`. `contacts` *is*
  distributed, and a distributed→local FK is unsupported on Citus — which is
  exactly why that constraint has to be allowed to fail silently.

Consequence: the select-then-update-with-tenant-in-WHERE backfill idiom the card
points at is **not required here**. That idiom exists for *distributed* tables
(the budget-hours migration backfills `projects`). For a Citus-local table a
plain `ALTER TABLE ... ADD COLUMN ticket_scope text NOT NULL DEFAULT 'client'`
plus a CHECK constraint is sufficient, and the DEFAULT backfills existing rows
with today's behavior in one statement — no per-row loop.

House style still applies: `exports.config = { transaction: false }` at the top,
`hasTable`/`hasColumn` idempotency guards, and a mirrored `down`.

**Verify on a real Citus stack before landing** — this rests on absence-of-
evidence. If the table turns out to be distributed, fall back to the backfill
idiom. The DEFAULT-only approach is correct either way for *new* rows; only the
backfill of existing rows would change.

### Migration source-text test

`server/src/test/unit/migrations/clientPortalVisibilityGroupsMigration.test.ts`
reads the create-migration file as a **string** and asserts `toContain(...)`.
Editing the existing migration's text breaks it. We are adding a new migration
rather than editing that one, so it should be unaffected — but a sibling test in
the same style is the local convention for a new migration.

### Test infrastructure

- Unit suites run under the **server** vitest config, not the per-package ones.
  CI runs from `./server` with `SKIP_DB_TESTS=1`.
- `client-tickets.visibility.test.ts` uses a `makeChainable` fake builder
  (`:129`) whose method list is a **closed set** (`:131-134`). Any new builder
  method the SUT starts calling (e.g. `andWhere`, `whereNull`) must be added
  there or the suite fails with "not a function". Adding a contact predicate
  will likely trip this.
- Those suites mock `applyVisibilityBoardFilter` wholesale and assert only that
  it was *called* with given args. They never render SQL, which is why the
  `t.board_id` alias bug above survived. Mock-level assertions cannot be the
  only coverage for the new predicate.
- The resolver's fake `trx` throws `Unexpected table: ${table}` on any unmocked
  table — good, it will fail loudly rather than silently if the resolver starts
  reading something new.
- **A DB-backed REST suite already exists**:
  `server/src/test/integration/ticketClientPortalAbac.integration.test.ts` (946
  lines) drives the real `TicketService` with a synthetic client
  `ServiceContext` and already covers no-group, empty-group, cross-client, and
  fail-closed cases. This is the right home for the REST contact-scope tests and
  for at least one real-SQL test that would have caught the alias bug. It is
  skipped under `SKIP_DB_TESTS=1`, so it runs in the integration job, not the
  unit job.

### The authorization kernel — the real architectural finding

There are **three parallel implementations of board scope**, not one:

1. **Direct SQL helper** — `applyVisibilityBoardFilter`, used by the client
   portal actions, `TicketService`, and (a third, independent inline variant) by
   `ticketFormActions.ts:107-120`.
2. **Kernel JS** — `relationshipTemplates.ts:181-187` `selected_boards.matches`,
   used for per-row in-memory filtering.
3. **Kernel SQL** — `selected_boards.compileSql`, used for list/count/pagination
   queries.

The card's step 4 ("widen the choke point — it is the single function every read
path calls") is true only of implementation 1. The MSP action paths named in the
card's matrix (`ticketActions.ts:251`, `optimizedTicketActions.ts:234`) feed
implementations 2 and 3 instead: they return `visibleBoardIds ?? undefined` into
a `selected_boards` relationship rule. There is no query to add a WHERE clause to.

Facts that shape the options:

- `RelationshipTemplateKey` (`packages/authorization/src/kernel/contracts.ts:99-109`)
  has 10 templates. **None is contact-aware.** `AuthorizationSubject` has no
  `contactId`; `AuthorizationRecord` has no `contactId`;
  `RelationshipSqlAdapter` has no contact column.
- `RELATIONSHIP_TEMPLATES` is a `Record<RelationshipTemplateKey, ...>`, so adding
  a key is a **compile error until both `matches()` and `compileSql()` exist**.
  That exhaustiveness is a real safety net: the JS and SQL facets cannot drift
  apart silently at the type level.
- Tri-state semantics today: `undefined` = add no rule (no narrowing), `[]` = add
  the rule with an empty list = hard deny (`whereRaw('1 = 0')`), non-empty =
  `whereIn`. Note `undefined` conflates "internal MSP user" with "client contact
  with no visibility group", so the same trick cannot be naively reused for
  contacts.
- `packages/authorization` is **duplicated** at `server/src/lib/authorization`
  (`catalog.ts` verified byte-identical). Catalog/service edits must be made twice.
- Several tests hard-code the full template list and will fail on a new key:
  `kernel.relationshipSql.test.ts:19-30` (has an exhaustiveness assertion),
  `bundle.catalog.test.ts:11-15`, `relationshipSqlParity.integration.test.ts`
  (a JS↔SQL parity harness — the right place to prove the two facets agree).
- Also surfaced: `ApiTicketController.ts:67-104` never calls
  `resolveClientSelectedBoardIds`, so the REST list API does not apply portal
  board scope via the kernel — it relies on `TicketService.applyClientTicketScope`
  instead. Worth confirming no path reaches tickets through the kernel without
  portal scope.

### Null-contact evidence (settles OQ1)

Every ticket-creation path funnels through one insert:
`shared/models/ticketModel.ts:756` — `contact_name_id: cleanedInput.contact_id
|| null`. The `|| null` collapses `''`, `undefined`, and `null` alike. The
column is nullable and nothing validates it.

Only the client portal reliably stamps a contact — `resolvePortalVisibility`
throws if the portal user has no contact, so it is structurally impossible to
create a portal ticket without one.

Always null: create-from-asset (no contact field in the schema), renewals queue
(UI and job), provider-default email tickets (`inbound_ticket_defaults` has no
contact column).

Often null: MSP UI create (contact is **not** in `validateForm`'s required list,
and `QuickAddTicket.tsx:866` only appends it when `selectedClientType ===
'company'`), REST/mobile (optional in `createTicketSchema`), RMM/Huntress (null
unless an org-mapping default or client primary contact is configured),
telephony, Teams, inbound webhooks.

Inbound email: **no contact is ever auto-created.** `create_or_find_contact`
exists as a workflow action but no shipped path invokes it. Matching needs an
exact address hit that also passes sender-auth alignment and is unambiguous (the
matcher returns null on ambiguity by design). Unmatched senders go to a ticket
watch list instead — `buildUnmatchedSenderWatchListRecipients` existing as a
first-class fallback is the codebase's own admission that this is steady state.

**Trap for testing:** dev seeds (`server/seeds/dev/14_tickets.cjs`) are 100%
contact-populated. Local testing will not reproduce production null rates. Null
cases must be created deliberately.

**No index on `tickets.contact_name_id`** — only an FK, and Postgres does not
index the referencing side. Needs `(tenant, contact_name_id)`, possibly partial
on `IS NOT NULL` given the null fraction.

Decision impact: options (a) and (c) from the card collapse into each other once
the FR3 client-admin override exists, because admins already see everything. The
choice is binary. Recommendation is (a)/(c) — hide nulls; rationale in the PRD.

### Reachability of the MSP ticket actions from a portal session (settles OQ2)

Audited. The client portal imports **none** of the seven MSP ticket actions —
its ticket surfaces are self-contained (`getClientTickets`,
`getClientTicketDetails`, etc.), and from `@alga-psa/tickets` it takes only
presentational components. The MSP-only consumers render solely under `/msp/*`,
which middleware blocks for non-internal users.

**One live exception, and it is load-bearing:**
`GET /api/tickets/[id]/live-token` (`server/src/app/api/tickets/[id]/live-token/route.ts:118`)
calls `getTicketById(ticketId)` and mints a Hocuspocus collaborative-doc JWT.
Middleware exempts it from the API-key gate (`middleware.ts:212`) and the
handler never checks `user_type`. A portal session can call it directly. Today
`getTicketById`'s kernel board-narrowing is the only thing preventing a portal
user from minting a live token for an arbitrary ticket. Contact scope must
therefore reach the kernel, or contact-scoped users keep a working path to a
sibling's ticket.

**Why the other six still get covered rather than trimmed:**

- `withAuth` does not assert user type (`packages/auth/src/lib/withAuth.ts:83`).
- `hasPermission(user, 'ticket', 'read')` returns **true** for client users —
  `rbac.ts:88` branches on `user_type === 'client'` and the seeded permission
  set includes `{ resource: 'ticket', action: 'read', msp: false, client: true }`
  (`20250716144947_update_client_portal_permissions.cjs:217`). The permission
  gate does not stop a client principal; only the narrowing does.
- Next.js server actions are addressable by action ID from any route, so a
  portal session can invoke an action no portal page renders.

Historical note: `resolveClientSelectedBoardIds` was **not** added in response to
a discovered client-reachable path. It came in with the ABAC kernelization work
(commit `f7d300659a`, feature F038) to make "client principal ⇒ board-scoped" a
kernel-level primitive that holds wherever a client principal appears. The
existing test (`ticketActions.authorizationNarrowing.test.ts:360`) is a contract
test on the action with a synthetic client caller, not a reproduction of a
product flow. Same intent applies to contact scope.

## Commands / Runbooks

- (2026-09-12) Count the choke-point callers before/after a rename:
  `grep -rn "applyVisibilityBoardFilter\|getClientContactVisibilityContext" --include=*.ts --include=*.tsx packages server | grep -v node_modules`

## Links / References

- Card: "Client portal: contact-scoped ticket visibility (opt-in)"
- Schema migration that created the groups:
  `server/migrations/20260315110000_create_client_portal_visibility_groups.cjs`
- User-facing doc to update:
  `nm-store/packages/nm-store/src/site/content/docs/client-ticket-visibility.md`
  (visibility groups are also referenced in `client-portal-user-guide.md:124`
  and `client-portal-overview.md:35`)

## Open Questions

- **OQ1 — Null-contact ticket policy.** BLOCKING, needs Robert. Decides what a
  contact-scoped user sees for tickets with `contact_name_id IS NULL`. The
  card's options (a) and (c) collapse into one another once the client-admin
  override exists, so the choice is binary: hide nulls, or show them to
  everyone. Recommendation (hide) and evidence are in the PRD; this needs a
  decision, not more research.
- **OQ2 — Kernel scope.** RESOLVED: required, because of the live-token route.
  See the reachability notes above.
- Not blocking, but decide during implementation: whether the new
  `(tenant, contact_name_id)` index should be partial on `IS NOT NULL`.

## Draft implementation — 2026-09-12

Implemented the opt-in scope migration, partial contact index, resolver/admin override,
explicit-column SQL helper, all portal/REST callers, and the kernel narrowing for
client users invoking MSP ticket actions. `getTicketById` narrows with the real
kernel; the live-token handler also rejects non-internal principals before lookup.
Both admin editors and action modules carry scope, both group lists show it, and
old callers omitting scope on update preserve the saved value.

OQ1 remains **unapproved**. The unpublished draft explicitly implements the
recommendation (NULL contacts hidden from ordinary contact-scoped members, visible
to client admins within their board scope). The decision packet was surfaced to
Robert; no answer has been recorded. This must not be treated as approval to land.

### Corrections to design-session assumptions

- The server kernel files are re-export shims, not duplicate logic. Both bundle
  catalogs still need the new key. No per-rule override/service schema addition is
  needed: `contact_visibility` consumes trusted, resolved request context.
- Built-in relationships are OR-combined. One template intersects client, board,
  and effective contact scope, rather than OR-ing separate board/contact rules.
- The Citus skill was found at
  `/home/robert/nm-skills/skills/citus-migration-gotchas/SKILL.md`.
- Local runtime DB is plain PostgreSQL. Its app connection is PgBouncer on 6472;
  the same stack's direct PostgreSQL endpoint is 5472. The new migration has been
  applied to this dev DB via a temporary CE+EE overlay and a targeted `migrate.up`.
  Historical migration entries are missing even from that overlay; only this
  targeted invocation used `disableMigrationsListValidation: true`. No historical
  entries were changed and no other migrations were run.
- The port-3812 app was not listening at takeover smoke time. A temporary dev
  process started successfully and returned HTTP 307 for the unauthenticated
  visibility-settings URL. It was stopped after the check. Alga Dev browser
  discovery timed out, so no authenticated browser/light-dark visual pass is claimed.

### Validation evidence

- `NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck -w server`: passed.
  The default Node heap failed with OOM; the larger-heap check passed. A full
  production Next build was not run.
- Server Vitest with `SKIP_DB_TESTS=1`, focused on the changed visibility suites,
  both editors, group permission tests, authorization SQL/catalog, and live-token
  route: **15 files, 97 tests passed**. This includes the real kernel in
  `ticketActions.authorizationNarrowing.test.ts`; the previous kernel double was
  removed because it could not prove the new rule semantics.
- `DB_HOST=127.0.0.1 DB_PORT=5472 TEST_DB_NAME=contact_scope_draft_test REQUIRE_DB=1
  npx vitest run src/test/integration/ticketClientPortalAbac.integration.test.ts`
  (from `server`): **18 tests passed**. Uses an isolated, migrated test database.
  Added actual portal list/detail/documents/dashboard/comment/status calls,
  sibling and NULL REST denial, pagination totals, admin behavior, explicit-alias
  SQL, kernel JS/SQL agreement, invalid-scope CHECK rejection, and both group
  action modules' create/update/read round trips including omitted-scope updates.
- Permission mocks in that integration harness now route both auth import paths
  through the same mock, preventing new portal imports from changing the existing
  scheduled-comment test's permission behavior.
- Exact new migration executed against a disposable DB on `alga-smoke-citus`:
  up/retry/down/up passed, existing group row retained default `client`, invalid
  scope was rejected, concurrent partial index built on distributed `tickets`.
  Scratch DB was removed. This is not a full production-schema Citus upgrade;
  F004 remains a before-landing verification item.
- `node scripts/validate-translations.cjs`: passed, zero errors/warnings. The
  targeted locale parity test also checks Portuguese and all MSP scope keys.
  New pseudo-locale strings use `tools/i18n/lib/pseudo-locale.mjs`.
- `git diff --check`: passed.

### Documentation and review order

`docs/client-ticket-visibility.md` is the user-facing draft in this branch.
`website-docs.patch` applies cleanly to nm-store's existing ticket-visibility guide
(`git -C /home/robert/nm-store apply --check <patch>` passed). The website repository
was left unchanged; apply the patch with the approved feature release.

Review first: OQ1, `clientPortalVisibility.server.ts`, `clientPortalVisibility.ts`,
`contact_visibility` JS/SQL semantics, and the database enforcement matrix. Then
review both editors and localized descriptions. New translations need normal
human language review. Full target-schema Citus verification, the website patch,
and authenticated browser review remain release tasks.

The existing unrelated `package-lock.json` changes were preserved and excluded
from the implementation commit. No branch push or PR creation is authorized.

### Final projection audit

The optimized action paths have five partial projections that feed the JS kernel:
bundle children/master (`ct`/`mt`) and fallback matching IDs, board IDs, and adjacent
IDs (`t`). Added `contact_name_id` to each; without it the kernel correctly denies
an incomplete record but hides even the caller's own tickets. The database suite
now forces the JS fallback with a redaction-only bundle rule and checks matching
IDs, board IDs, and adjacent positions for the contact-scoped user. This is in
addition to the SQL and portal enforcement matrix above.

The existing DB suite leaves a public document on its shared fixture in one test.
The new own-document assertion therefore checks successful, client-visible results
rather than assuming an empty list, preserving randomized test-order independence.
