# PRD — Entity tag chips and path filters

- Slug: `entity-tag-chips-and-path-filters`
- Date: `2026-10-24`
- Status: Draft
- Replaces: the VIP / POC flags build on PR #3858 (same branch, `feature/vip-poc-flags-on-contacts-and-clients-shown-as-b`)

## Summary

Agents need to see, on every ticket, the labels that matter about the person and company behind it, such as "VIP", and to filter the ticket list by them. PR #3858 solved this with two boolean columns (`is_vip`, `is_primary_contact`). This plan solves it with what tenants already use, tags, and builds two general mechanisms along the way:

1. **Entity chips with display rules.** Anywhere the UI shows a contact or client, it shows a chip: avatar, name, and the tags the tenant has chosen to display for that entity type. Which tags display is decided by tenant display rules, per audience (internal staff or client portal).
2. **Path filters on one shared predicate model.** A filter is `{ path, operator, value }`, for example `contact.tags in [<VIP tag>]`. The model lives in a new leaf package shared with workflow conditions. A compiler turns ticket-list predicates into tenant-correlated SQL from a declared relation schema. Every existing ticket-list filter moves onto it, and new dimensions never add a key to the flat filter bag again.

VIP becomes a contact tag (or a client tag) plus a display rule. No `is_vip` column, no migration on `contacts` or `clients`.

## Problem

- Contacts and clients can already be tagged, with colors. But the ticket list only shows and filters **ticket** tags (`tagged_type = 'ticket'` in `optimizedTicketActions.ts`). A tag on the requester or the client never reaches their tickets.
- PR #3858 adds a second way to say "VIP" that can disagree with a VIP tag the tenant already uses. It only fixes that one word; "Key account" or "Exec" would each need another column. Nothing in the product reads the flags except the badge and the filter.
- Each new ticket-list dimension today is a new key declared in five places (types, server zod schema, named-view schema, board default-view schema, container URL parse/write/normalize plus adapter sanitize). The VIP keys repeat that, and already drifted (missing from `TICKET_VIEW_URL_FILTER_PARAMS`, missing from the `exportFilters` dependency array).
- The bundled view treats dimensions inconsistently. Client and contact filters match "master or any child". Ticket tags and the VIP keys check only the master.
- Expanded bundle children (`fetchBundleChildrenForMaster`) skip row enrichment entirely: no contact, no logos or avatars, no tags.
- The repo already has several `{ path/field, operator, value }` condition dialects (workflow conditions, workflow event-wait filters, reporting filters, inbound email rules, automation and webhook schemas). A ticket-list predicate model built in isolation would be another one.

## Goals

1. Meet the card's definition of done with tags. Tag a contact "VIP" once, see the badge on every ticket row and ticket header for that requester, and filter the list to tickets whose requester (or client) is tagged VIP.
2. Tags shown on chips are chosen by tenant display rules, per entity type and audience. Nothing is shown to client-portal users unless a rule opts in.
3. A single shared predicate model (`@alga-psa/predicates`) with an in-memory evaluator and a SQL compiler. Workflow conditions are re-typed onto it.
4. Every existing ticket-list filter compiles through the predicate compiler. The bundled "master or any child" rule is owned once by the compiler and applies to every relation hop, including tags.
5. Saved views, board default views and URLs store new dimensions as predicates. Existing stored views keep working through versioned migration.
6. Remove the PR #3858 flag schema and keep its reusable pieces (compact badge rendering, Contact column on by default, test scaffolding).

## Non-goals

- Tag-driven behavior: tag → SLA policy, priority, routing or notification rules. Planned as the next phase; the predicate model and display rules are designed so it can reuse them. "Tags that drive behavior display by default" belongs to that phase.
- Product-defined concept slots (for example "Priority customer") that tenants map a tag onto.
- Rendering requester or client chips in the client portal. The portal shows no requester or client chip today. This plan stores and enforces the client audience server-side so that work is safe later.
- Moving the REST API ticket filters (`server/src/lib/api/schemas/ticket.ts`, `TicketService.applyTicketFilters`), the legacy `ticketActions.getTicketsForList`, reporting filters, inbound email rules or workflow event-wait filters onto the predicate model. Each gets a `LEVERAGE` marker.
- Chips on project list and project detail (plain text today).
- Full-text search. `searchQuery` stays a separate input to the list query; it is not a predicate path.
- A general advanced-filter builder UI. New dimensions get toolbar controls through a descriptor table, not a free-form query editor.

## Users and Primary Flows

**MSP dispatcher / technician**
1. Opens the ticket list. The Contact column is visible by default. A requester tagged VIP shows a red VIP badge next to their name; their client's displayed tags show in the Client cell.
2. Filters by "Requester tags: any of VIP". The list, counts, export, select-all and prev/next all honour it. In bundled view a master appears if its own requester or any child's requester is VIP.
3. Opens a ticket. The requester and client chips in the header show the same badges.
4. Picks a contact in a ticket form. The contact picker options show the displayed tags.

**MSP admin**
1. Opens Settings → Tags → Display on chips.
2. For Contacts and for Clients, chooses an ordered list of tags to display, for internal staff and (optionally) for the client portal.
3. Removing VIP from every contact does not lose the rule; the tag definition is kept while a rule references it.

**New tenant**
1. Starts with a "VIP" contact tag and a "VIP" client tag, each with a display rule for internal staff. They can rename, recolor or delete them.

## UX / UI Notes

- **Entity chip** (`EntityChip` in `packages/ui`): avatar, name, optional click-through, and a badge row of displayed tags in rule order, using each tag's colors. Inputs: entity type, id, name, image URL, tags (already filtered server-side), size, `maxBadges`. Overflow renders as `+n` with a tooltip listing the rest. Built from `ClientNameCell` and the compact mode of PR #3858's `FlagBadges`, which it replaces.
- List cells use `maxBadges = 2`. Ticket header, requester tile and pickers show all displayed tags.
- **Ticket list toolbar:** two new multi-select tag filters, "Requester tags" and "Client tags", each with any-of / none-of (matching the existing include/exclude pattern). Options are contact-type and client-type tag definitions. Active-filter chips for these dimensions come from a filter descriptor table (the `filter-descriptor-table` LEVERAGE marker in `TicketingDashboard.tsx`).
- **Settings → Tags → Display on chips:** per entity type (Contacts, Clients), per audience (Internal, Client portal), an ordered, reorderable tag list with add/remove. Client portal lists start empty with a short note that these tags would be visible to the client's own users.
- Removed from PR #3858: the VIP / POC toggles on contact and client forms, the "VIP only" toolbar toggle, `VipBadge` / `PocBadge`.
- All new strings go through i18n in every locale file the branch already touches.

## Requirements

### Functional Requirements

**Shared predicate model (`@alga-psa/predicates`, new leaf package)**
- `PredicateClause { path, operator, value? }` and `PredicateGroup { join: 'and' | 'or', clauses: (PredicateClause | PredicateGroup)[] }`. Groups may nest.
- Operators use the workflow condition names: `equals`, `not_equals`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`, with `takesValue` / `takesList` metadata.
- On a set-valued path (such as `contact.tags`), `in` means "has any of", `not_in` means "has none of", `is_empty` / `is_not_empty` mean "has no / at least one element".
- Null semantics are defined once and shared by both backends: a missing value never satisfies a comparison, satisfies `is_empty`, and satisfies `not_in`. The SQL compiler emits `IS NULL OR NOT IN` (or `NOT EXISTS` for sets) to match.
- zod schema for validation and storage.
- Deterministic in-memory evaluator over JSON values, with no Node APIs, safe inside the Temporal workflow sandbox.
- SQL compiler (`@alga-psa/predicates/sql`, knex as peer dependency) driven by a caller-supplied query schema:
  - attributes: path → column or raw expression, value type, allowed operators
  - relations: path segment → target table, join keys, cardinality (one or many)
  - tag relations: a helper that declares `<entity>.tags` against `tag_mappings` / `tag_definitions` for a `tagged_type`
  - every hop is correlated on `tenant` (the compiler owns the `tenant-correlated-exists` pattern)
  - a root modifier for "self or any child" (used by the bundled ticket view), applied uniformly to every relation hop
  - computed attributes with a custom resolver for dimensions that are not plain columns (SLA status, response state, relative due dates)
- Unknown paths and disallowed operators are rejected at validation, never silently dropped.

**Workflow conditions on the shared model**
- `shared/workflow/runtime/designer/conditionModel.ts` re-types its clause, group and operator types as `@alga-psa/predicates` types. The JSONata parse/serialize adapter stays where it is and keeps its current behavior (flat groups only in the builder, `null` for unrepresentable expressions).
- The Temporal worker and shared package resolve the new package.

**Ticket list query schema and compiler**
- A declared ticket query schema covering every existing filter dimension: board (with inactive-board state and `no-board`), status (by id, by name, open-only via `status.is_closed`), priority, category (category or subcategory, with `no-category`), client, contact, assignee / team / unassigned, assigned-to-me (resolved to the current user id), due date (relative presets resolved in the user's timezone), response state, SLA status, ticket tags, contact tags, client tags.
- `ITicketListFilters` legacy keys compile to a predicate group through one codec (`ticketFiltersToPredicates`). `buildTicketListBaseQuery` compiles that group plus `filters.where` through the predicate compiler. Hand-written where-clauses for those keys are deleted.
- `ITicketListFilters` gains one final key, `where?: PredicateGroup`. New dimensions are predicates only; the flat bag stops growing.
- Bundled view applies the "self or any child" modifier to every relation hop. Ticket tag, contact tag and client tag filters now match a master through its children, like client and contact already do.
- `bundleView`, sorting, pagination, search and read authorization stay outside the predicate group.
- All callers of `buildTicketListBaseQuery` (list, all-matching ids, load by ids, adjacent ids for prev/next, export) get the new behavior with no per-caller change.

**Tag identity**
- Tag filter values are tag definition ids, not tag text. The existing ticket `tags` filter (tag text) converts to `tags in [<definition ids>]` by `(tag_text, 'ticket')`, which is unique per tenant.

**Storage and URLs**
- Named list views: tickets definition moves to `schemaVersion: 2`. The v2 filter shape holds legacy keys plus `where`. `migrate` converts v1 `tags` text to ticket tag definition ids and drops `requester_vip` / `client_vip`. `define()` accepts a version and migrate hook.
- Board default views and the tenant default view gain a version field and the same migration. `sanitizeStoredTicketView` and `validateCapturedFilters` keep `where` (validated against the predicate schema and the known-id universes) instead of dropping non-scalar values.
- Sanitizing drops predicate clauses whose tag ids no longer exist, through the existing dropped-reference collector and toast.
- URL: legacy params stay. Predicate dimensions round-trip through one `where` query parameter (compact, URL-safe encoding). `TICKET_VIEW_URL_FILTER_PARAMS` includes `where`. Prev/next `returnFilters` carries it unchanged.
- The filter shape is declared once: the named-view schema and the board default-view schema both derive from one exported ticket filter schema. The dead `server/src/lib/schemas/ticket.schema.ts` filter schema is deleted.

**Display rules**
- New table `tag_display_rules (tenant, rule_id, tagged_type, audience, tag_id, position, created_at, created_by)`. `audience` is `internal` or `client`. Unique on `(tenant, tagged_type, audience, tag_id)`. Foreign key to `tag_definitions (tenant, tag_id)` with cascade delete, so explicitly deleting a tag removes its rules.
- Orphan cleanup (`TagDefinition.deleteOrphaned`, `tagCleanup.ts`, the `deleteTag` orphan branch) keeps any definition referenced by a display rule. Tag option lists (`findAllTagsByType`, the filter option loader) include referenced definitions even with no mappings.
- Actions: list rules for an entity type and audience, replace the ordered list for an entity type and audience. Reads available to internal users. Writes require `settings:update`.
- Resolver: given audience, entity type and the entity's tags, return the displayed tags in rule order. No rules for an audience means no tags displayed for that audience.
- Migration seeds internal rules for existing contact-type and client-type definitions whose text is `VIP` (case-insensitive).
- New-tenant onboarding creates a `VIP` contact tag definition and a `VIP` client tag definition (red), each with an internal display rule.

**Chip hydration**
- One batch loader (`loadDisplayTagsForEntities(knex, tenant, audience, refs)` in `packages/tags`) loads tags for a set of `(tagged_type, id)` pairs and applies display rules. Audience is derived server-side from `user.user_type`.
- Ticket list rows carry `contact_tags` and `client_tags` (already filtered) on the row, beside `client_logo_url` and `contact_avatar_url`. No new metadata sidecar.
- `fetchBundleChildrenForMaster` joins contacts and runs through `enrichTicketListItems`, so children get contact name, logos, avatars, ticket tags and chip tags.
- Ticket detail (`getConsolidatedTicketData`) returns displayed tags for the requester and client.
- Contact and client picker option loaders return displayed tags for their options.

**Surfaces**
- `EntityChip` replaces the hand-rolled Client and Contact cells in `ticket-columns.tsx`, the requester and client rows in `TicketBentoLayout`, the contact and client rows in `TicketProperties`, and the option and selected-value rows in `ContactPicker` and `ClientPicker`.
- The Contact column stays `defaultVisible: true`.

**Removal of PR #3858 flags**
- Delete migration `20261022120000_add_vip_and_primary_contact_flags.cjs` and every `is_vip` / `is_primary_contact` / `contact_is_vip` / `client_is_vip` / `requester_vip` / `client_vip` reference: types, schemas, API schemas and services, contact/client forms, list select, dashboard toggle, URL parse/write, list-view and board schemas, `FlagBadges`, and the VIP-specific tests (replaced by tag-based tests).

### Non-functional Requirements

- Compiled SQL for existing dimensions returns the same rows as today on the existing integration suites (bundled client/contact, assignee sort, activity sort, latest activity, client portal ABAC). The bundled tag behavior change is the one intended difference.
- Every compiled hop correlates on `tenant`; queries stay single-shard on Citus.
- Ticket list page load adds at most two batched tag queries (contact, client) per page, plus one display-rules read.

## Data / API / Integrations

- New package `packages/predicates` (`@alga-psa/predicates`, tags `scope:predicates`, `type:horizontal`), source-transpiled. Aliases in `tsconfig.base.json`, `server/tsconfig.json`, `ee/server/tsconfig.json`, `server/next.config.mjs` (paths and transpile list), `ee/temporal-workflows/tsconfig.json`, and a dependency from `shared/package.json`.
- New table `tag_display_rules`, distributed and co-located with `tag_definitions` on Citus.
- `ITicketListItem` gains `contact_tags?: ITag[]`, `client_tags?: ITag[]`.
- `ITicketListFilters` gains `where?: PredicateGroup`; loses `requester_vip`, `client_vip`.
- List views tickets `schema_version` 2. Board default views and tenant default view get a version.
- Contact and client REST APIs lose the `is_vip` / `is_primary_contact` fields the branch added (they never shipped).

## Security / Permissions

- `findTagsByEntityId` and `findTagsByEntityIds` require `tag:read` (today they only use `withAuth`, so a client-portal session can call them as server actions). Client users do not hold `tag:read`.
- The display-tag loader applies audience rules server-side before data leaves the server. Client-portal users receive only tags with a `client` audience rule.
- Predicate filter values are validated against the query schema; unknown paths and operators are rejected. Raw SQL appears only in schema-declared computed attributes, never from input.
- Display-rule writes require `settings:update`.

## Observability

No new observability work.

## Rollout / Migration

- PR #3858 never merged, so its migration file is deleted rather than reversed. Any dev database that ran it must drop the columns by hand (noted in the scratchpad).
- `tag_display_rules` migration plus the VIP seed. EE/Citus distribution in the matching migration step.
- Stored views migrate on read (existing list-views behavior) and are rewritten on the next save. Board and tenant default views migrate on read the same way.
- Old URLs with `tags=<text>` still parse: the codec resolves text to ticket tag definition ids.
- No feature flag.

## Open Questions

1. Display-rule writes gated by `settings:update` or `tag:update`? Draft uses `settings:update` because it is tenant configuration.
2. Should the `where` URL parameter be human-readable (`contact.tags:in:<id>,<id>`) or an opaque base64url of the JSON group? Draft uses a readable form for single-level groups and falls back to base64url for nested groups.
3. Onboarding seed: create both VIP definitions, or only the contact one?
4. `maxBadges` in list cells: 2 is the draft default. Should it be a display-rule setting instead?

## Acceptance Criteria (Definition of Done)

1. With a contact tagged `VIP` and an internal display rule for it, every ticket row for that requester shows the VIP badge in the Contact cell, and the ticket header shows it on the requester chip. The same holds for a client tagged `VIP` in the Client cell and header.
2. "Requester tags: any of VIP" lists exactly the tickets whose requester is tagged VIP, with correct totals across pages, in export, select-all and prev/next. In bundled view, a master whose child's requester is VIP is included.
3. "Client tags: none of VIP" excludes tickets for VIP clients and keeps tickets with no client.
4. A client-portal user never receives contact or client tags without a client-audience rule, and cannot call the tag read actions directly.
5. Removing the VIP tag from every contact keeps the definition and its display rule. Re-tagging a contact shows the badge again with no configuration.
6. Every pre-existing ticket list filter returns the same results as before through the compiler (existing integration suites pass), and no hand-written where-clause remains for those keys in `buildTicketListBaseQuery`.
7. A saved view and a board default view created before this change load with the same filters; a v1 `tags` text filter becomes the equivalent tag id predicate.
8. Workflow condition builder round-trip tests pass with the condition types imported from `@alga-psa/predicates`.
9. Expanded bundle children show contact name, avatar, logo, ticket tags and chip tags.
10. No `is_vip`, `is_primary_contact`, `requester_vip` or `client_vip` references remain.
