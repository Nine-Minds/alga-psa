# PRD — Authorization completion: client-restricted users

- Slug: `authorization-client-scope-completion`
- Date: `2026-11-10`
- Status: Draft for slice breakdown
- Code baseline: `origin/main` at `88c634d5b5`
- Companion plan: `ee/docs/plans/2026-11-10-co-managed-seat-and-workspace` (the co-managed seat is built on this plan)

## Summary

Authorization bundles let an MSP restrict an internal user to selected clients. The restriction holds on tickets, projects, assets, document reads, quotes and credentials. It does not hold on client and contact lists, search, time entries, the schedule, tag lists, counts, reports, record creation, and most REST controllers. This plan makes a client restriction hold everywhere a client's data can be read or created, adds a deny-by-default bundle, and adds contract tests that fail when a new read path skips authorization.

This is one of two plans. The co-managed seat plan depends on this one. This plan has value without it: it makes a shipped, tier-gated feature do what it says.

## Problem

Advanced authorization bundles are a Pro feature, described in the product as access control, and shipped with starter bundles named "Assigned Client Technician" and "Restricted Asset Operator". An administrator who assigns one reasonably expects the user to stop seeing other clients.

What the code does today:

- **Rules only narrow, and no rule means unrestricted.** `BundleAuthorizationKernelProvider.evaluateNarrowing` returns the allow-all scope when no rule matches the resource and action (`packages/authorization/src/kernel/providers/bundleProvider.ts`). The rule table is check-constrained to `effect = 'narrow'`.
- **Whole surfaces never consult the kernel.** Client and contact lists and pickers, interactions, time-entry lists, schedule and dispatch, document folder trees, tag lists, reports, and REST controllers for clients, contacts, time entries, time sheets, interactions and search.
- **Search ignores bundles.** `resolveClientAccess` returns unrestricted access for every non-client user (`packages/search/src/runAppSearch.ts`). REST search and the MCP search tool both go through it. Five indexers set no client scope.
- **Create is never checked.** No call site evaluates `action: 'create'`, so a restricted user can open a ticket for any client.
- **Update does not require read.** Ticket update evaluates only update rules.
- **Rule loading fails open** in the project, asset and document read paths (`catch → []`). The ticket path fails closed.
- **The client list for `selected_clients` lives on the rule.** One restriction per client means one bundle per client. The `client_portfolio` template exists, but nothing stores a portfolio; ticket code passes an empty list.
- **Counts and options leak.** Bundle statistics count child tickets across clients. Ticket form options return every user in the tenant, portal users of every client included, and tag text from every ticket.
- **Field redaction is uneven.** REST applies `redactedFields`; the MSP ticket screens do not.
- **The policy screen offers six resource types.**

The project has been paying this down one security card at a time. This plan pays it as one piece of work with a test that keeps it paid.

## Terms

| Term | Meaning |
| --- | --- |
| Kernel | The authorization engine in `packages/authorization/src/kernel`: RBAC first, then built-in rules, then bundle rules, intersected. |
| Subject | Who is asking: user id, user type, teams, managed users, client portfolio. |
| Client portfolio | The set of clients a user is responsible for, stored per user. |
| Open bundle | Today's behavior: a resource and action with no rule is unrestricted. |
| Closed bundle | New. A resource and action with no rule is denied for subjects the bundle is assigned to. |
| Narrowed subject | A subject for whom at least one rule or built-in restricts clients. |
| Client ownership | How a row ties to a client: a column, a chain of parents, or a polymorphic pair. |

## Goals

1. A user restricted to clients sees, searches, counts, exports and creates records only for those clients, on every surface.
2. An administrator can express "this user works for these clients" once per user, not once per bundle.
3. An administrator can assign a bundle that denies everything it does not name.
4. A read path added later that skips authorization fails a test.
5. A tenant that assigns no bundles and stores no portfolios sees no behavior change and runs no additional queries.

## Non-goals

- A data-layer row guard in the tenant query facade. It was investigated and rejected: about 170 files bypass the facade, user context does not reach background work, and a silent row filter under a restricted user corrupts derived writes.
- Postgres row-level security.
- Changing RBAC roles or the permission catalog, beyond the permission checks named in segment H.
- Restricting what an MSP employee may see of the MSP's own user directory. That is a co-managed seat concern and is in the companion plan.
- Board ticket counts on the ticket list. That defect has its own card ("Security: authz in getBoardListStats").
- The client merge roster. That has its own card ("Client merge misses drop-ship purchase orders"); segment A coordinates with it.
- New audit streams, metrics or dashboards.

## Design decisions

### D1. Authorization stays at the action boundary

Every enforcement point calls the kernel, as tickets, projects and assets do today. List paths compile narrowing to SQL through `compileTenantScopedResourceReadAuthorizationSql`; record paths evaluate the record. This is the house pattern and has no hazards from request context being inherited by background work.

### D2. One subject resolver

Today each package builds its own subject (`resolveAuthorizationSubjectForUser` in tickets, others in assets and projects), and they disagree: tickets hard-code an empty portfolio. One resolver in `packages/authorization` builds the subject for every caller.

### D3. Portfolio is a property of the user

A `client_portfolio` rule reads the subject's stored portfolio. One bundle then serves every restricted user. `selected_clients` remains for the case where the client list belongs to the rule.

### D4. Closed is a property of the bundle

A bundle revision is published open or closed. Closed means the bundle is an allow-list: a resource and action it does not name is denied. When a subject holds both kinds, the closed bundle's denial stands, because scopes intersect. This is a real policy distinction (deny-list versus allow-list), stated once on the bundle, not a per-rule option.

Rejected: a wildcard deny rule. Rules are ANDed, so a wildcard would deny everything unless the engine gained rule precedence, which changes the meaning of every existing bundle.

### D5. Client ownership is declared per table

The table manifest already carries `clientKeyed`. It becomes a declaration of how a row reaches a client: a named column, a parent chain, or a registered resolver for polymorphic tables. The coverage contract and the search indexers read it. The client merge roster can read the same declaration.

### D6. Built-in rules are an extension point

The built-in provider already resolves rules by subject (`resolveDefaultBuiltinRelationshipRules`: client users get `same_client`). A registry lets a package register a resolver for a class of subjects. Rules from a resolver are not editable in the policy screen. The co-managed seat uses this.

### D7. Coverage is proven by a contract, with a pinned exception list

An AST contract test walks exported server actions and REST handlers. If one reads a table whose ownership declaration maps to a covered resource, it must call an authorization entry point. Exceptions are pinned in a list with a reason each. The list may shrink and may not grow. The write-admission coverage test is the precedent.

## Segments

| Segment | Title | Depends on | Posture |
| --- | --- | --- | --- |
| A | Subject, portfolio and ownership foundations | none | dark |
| B | Kernel semantics | A | complete |
| C | Coverage of operational resources | A, B | complete |
| D | Aggregates, options and exports | C | complete |
| E | Search | A, C | complete |
| F | REST and MCP parity | C | complete |
| G | Field redaction parity | none | complete |
| H | Coverage contracts | A, C, F | complete |
| I | Policy administration | A, B | complete |

A segment is a unit of intent. Segment C in particular is several slices, one per resource.

### Segment A — Subject, portfolio and ownership foundations

- One subject resolver used by every package.
- A per-user client portfolio table and its commands.
- `client_portfolio` evaluated against the stored portfolio, in the matcher and the SQL compiler.
- Client ownership declared per table, with resolvers for polymorphic tables.
- A fast path so tenants with no assignments and no portfolios pay nothing.

### Segment B — Kernel semantics

- Rule loading fails closed everywhere.
- Closed bundles.
- Create is evaluated. Update and delete require read.
- A registry for built-in rule resolvers.
- Denial reasons name what denied.

### Segment C — Coverage of operational resources

One resource at a time: clients, contacts, interactions, time entries, schedule entries, documents, tags, project task comments, and the ticket lookups that skip authorization today. Each gets a resource type, a SQL adapter where it has lists, and enforcement at its actions.

### Segment D — Aggregates, options and exports

Counts, dashboards, reports, form options and exports are computed over what the subject may read, or refused.

### Segment E — Search

An internal subject with a client restriction searches in the client-restricted mode. The indexers that set no client scope gain one, and existing rows are re-indexed.

### Segment F — REST and MCP parity

The controllers that skip the kernel call the same authorization as the actions. Bundles assigned to an API key narrow that key.

### Segment G — Field redaction parity

The MSP screens apply `redactedFields` the way REST does.

### Segment H — Coverage contracts

The read-coverage contract and a permission-coverage contract, each with a pinned exception list.

### Segment I — Policy administration

All resource types in the policy screen, a portfolio editor on the user, closed bundles in the editor, the simulator explaining the new denials, and one starter bundle.

## Users and Primary Flows

### MSP administrator: restrict a technician to two clients

1. Opens the user, sets **Client portfolio** to the two clients.
2. Assigns the "Single-client technician" starter bundle, or their own.
3. Uses the simulator to confirm the user is denied a ticket of a third client and told why.

### Restricted technician

1. Signs in to the MSP application as before.
2. The client list shows two clients. Search, contact pickers, the schedule and tag suggestions contain nothing from other clients.
3. Creating a ticket offers only those two clients. A direct request naming a third is refused.

### API integration with a narrowed key

1. An administrator assigns a bundle to an API key.
2. Requests with that key to clients, contacts, time entries and search return only in-scope records.

## UX / UI Notes

- Standard components only: the existing policy management screen, client picker, `DataTable`, dialogs.
- No raw IDs. Portfolios show client names.
- A closed bundle is marked in the bundle list and the editor explains in one sentence what closed means, with a preview of the resource types it will deny.
- The schedule shows an out-of-scope entry on a colleague's calendar as busy time with no title or work item.
- Strings exist in every shipped locale.

## Requirements

### Functional Requirements

See `features.json`. Each feature names its segment in `prdRefs`.

### Non-functional Requirements

- **Neutrality.** A tenant with no published bundle assignments and no portfolio rows sees no behavior change and runs zero additional queries on ticket list, ticket detail, client list, search and time-entry paths. Query-budget entries prove it.
- **Fail closed.** Any failure to load rules or resolve a subject denies.
- **Lists narrow in SQL.** Counts and pagination reflect the narrowed set. Per-row filtering after the query is not used for lists.
- **Migrations.** Expand-only, dated after the newest on main, `NOT VALID` then `VALIDATE` separately, indexes created concurrently, no triggers, Citus-safe, N-1 compatible. Unique indexes include `tenant`.
- **Generated artifacts** (OpenAPI, MCP and chat registries) are regenerated in the same pull request.
- **Every new table** is registered in the tenant table manifest.

## Data / API / Integrations

| Change | Detail |
| --- | --- |
| New table `user_client_portfolios` | `(tenant, user_id, client_id)`, one row per client in a user's portfolio. |
| `authorization_bundle_revisions` | Gains a baseline: open (default) or closed. |
| Table manifest | `clientKeyed` becomes a client-ownership declaration: column, parent chain, or resolver. |
| `app_search_index` | Client scope populated for client, contact, interaction, document and time-entry records. A re-index fills existing rows. |
| Kernel catalog | New resource types: `client`, `contact`, `interaction`, `time_entry`, `schedule_entry`, `tag`. `document` gains list coverage. |

Bundle evaluation is not tier-checked today and stays that way: published rows apply in any edition. Authoring remains a Pro feature.

## Security / Permissions

- The closed baseline and the built-in resolver registry are the two mechanisms other work builds on. Both are covered by a matrix test over subject kind, bundle kind, resource and action.
- Client-restricted subjects cannot see contacts, interactions or time entries that have no client, other than their own time entries.
- The permission-coverage contract pins today's actions that perform no permission check. None of the pinned exceptions may read commercial tables; the two known ones (`getServices`, `getEligibleContractLinesForUI`) are fixed in the companion plan.

## Rollout / Migration

- Segment A ships dark. Nothing reads the new table or declarations yet.
- Segments B to I ship complete. They change behavior only for tenants that have assigned bundles: those users see less, which is the feature working.
- Release notes state that restricted users will now also be restricted in search, client and contact lists, time, schedule and the API.
- The re-index for search runs as a background job per tenant and is safe to repeat.
- No down-migration in production.

## Risks

- **Existing bundle users see less overnight.** This is intended, and some administrators will have relied on the gaps without knowing. Mitigation: release notes, and the simulator.
- **Fail-closed lockout.** A rule-loading fault now denies where it used to allow. Mitigation: the ticket path already behaves this way without incident.
- **Polymorphic ownership.** Time entries, schedule entries, document associations and tag mappings have no client column. A resolver that returns the wrong client leaks; one that returns none hides. Each resolver has its own test.
- **Rows with more than one client.** Documents associated with several clients, ticket bundles spanning clients, and link tables with two parents. The rule is: visible only when every client the row touches is in scope for strict types, any for documents. This needs a decision per table and is listed under Open Questions.
- **Report definitions.** Some reports cannot be narrowed mechanically. They are refused for narrowed subjects rather than run unfiltered.
- **Size of segment C.** The survey estimated 400 to 600 read entry points across the operational packages. Many funnel through a few list functions, but the true count is not known until the coverage contract runs.

## Open Questions

Each has a default the cards build to.

1. **A document associated with two clients.** Default: readable when any associated client is in scope, matching `documentAuthorization.ts` today.
2. **A ticket bundle whose children span clients.** Default: a narrowed subject sees only in-scope children and their mirrored comments; counts follow.
3. **Contacts and interactions with no client.** Default: hidden from client-restricted subjects.
4. **Ad hoc and non-billable-category time entries.** Default: visible to their own user and to subjects with no client restriction.
5. **Reports that cannot be narrowed.** Default: refused for narrowed subjects with a message naming the reason.
6. **Should closed bundles be assignable to roles and teams, or only to users and API keys?** Default: all four targets, as today.
7. **Tier.** Default: authoring closed bundles and portfolios is Pro, the same as bundles. Evaluation applies in any edition.

## Acceptance Criteria (Definition of Done)

1. A user whose portfolio is two clients, with the starter bundle assigned, cannot retrieve a record of a third client through any list, detail, picker, search, export, count, REST endpoint or MCP tool in the operational packages.
2. That user cannot create a ticket, contact, interaction, time entry or document association for a third client.
3. A closed bundle denies every resource and action it does not name, and the simulator says so.
4. Rule-loading failure denies on every path.
5. The read-coverage contract fails when a new action reads a covered table without calling authorization.
6. A tenant with no bundle assignments and no portfolios has unchanged query budgets on the measured paths.
7. A bundle assigned to an API key narrows clients, contacts, time entries, interactions and search for that key.

## Evidence

"Verified" means read directly in `origin/main` while writing this plan. "Surveyed" means reported by a code survey with citations and not re-read line by line.

| Fact | Where | Status |
| --- | --- | --- |
| RBAC first, then built-in and bundle scopes intersected | `packages/authorization/src/kernel/engine.ts` | Verified |
| No matching rule returns allow-all | `kernel/providers/bundleProvider.ts` | Verified |
| Built-in rules resolve per subject; client users get `same_client`, internal users none | `kernel/providers/builtinProvider.ts` | Verified |
| Ticket list compiles narrowing into SQL | `packages/tickets/src/actions/optimizedTicketActions.ts` (`applyTicketReadAuthorizationSql`) | Verified |
| Rule `effect` is constrained to `narrow` | `server/migrations/20260421190000_create_authorization_bundle_control_plane.cjs` | Surveyed |
| Assignment targets are role, team, user, API key | `packages/authorization/src/bundles/service.ts` | Surveyed |
| Rule loading fails open for project, asset, document | `projectReadAuthorization.ts`, `assetReadAuthorization.ts`, `shared/lib/documentAuthorization.ts` | Surveyed |
| `selected_clients` list is stored on the rule | `bundles/service.ts`, `PolicyManagement.tsx` | Surveyed |
| Ticket code passes an empty portfolio | `optimizedTicketActions.ts` | Surveyed |
| Search returns unrestricted access for non-client users | `packages/search/src/runAppSearch.ts`, `acl.ts` | Surveyed |
| Five indexers set no client scope | `packages/search/src/indexers` | Surveyed |
| Controllers without kernel use | `server/src/lib/api/controllers` (Client, Contact, TimeEntry, TimeSheet, Interaction, Search, others) | Surveyed |
| No create-action call sites | repo-wide grep | Surveyed |
| Ticket form options return every user and all tag text | `optimizedTicketActions.ts` (`getTicketFormOptions`) | Surveyed |
| REST applies redaction; MSP ticket actions do not | `apiRecordProjection.ts`; `packages/tickets` | Surveyed |
| Policy screen lists six resource types | `ee/server/src/components/settings/policy/PolicyManagement.tsx` | Surveyed |
| 632 tenant tables; 44 with a direct client column, 80 through parents, 25 polymorphic | `tenantTableMetadata.ts`, `tenantTableForeignKeys.ts` | Surveyed |
| Write-admission coverage is an AST contract | `server/src/test/unit/product/writeAdmissionCoverage.contract.test.ts` | Surveyed |
| Bundles are sold as a Pro feature | `docs/tier-gating-guide.md`, `packages/types/src/constants/tierFeatures.ts` | Verified |
