# Scratchpad — Entity tag chips and path filters

- Plan slug: `entity-tag-chips-and-path-filters`
- Created: `2026-10-24`

## Decisions

- (2026-10-24) VIP is a tag plus a display rule, not a column. Tags are the tenant's words; the product's vocabulary is behaviors (display, later SLA/priority/routing); rules connect the two by tag definition id. A per-tag flag such as "highlight on tickets" was rejected: it puts the behavior on the tag, so each new behavior adds a column to `tag_definitions`. Rules put the reference on the behavior instead.
- (2026-10-24) Scope is chips + display rules + path-filter engine, with every existing ticket filter moved onto it. Tag-driven behavior and product concept slots are later phases.
- (2026-10-24) Build on PR #3858's branch (user choice). Its migration is deleted, not reversed, since it never merged.
- (2026-10-24) The predicate model is shared with workflow conditions from day one (user choice). New leaf package `packages/predicates` rather than `shared/`: `shared/` is a tsup-built grab bag with heavy Node deps and sits above `packages/*`, so a leaf package avoids cycles and stays Temporal-sandbox safe. The JSONata adapter stays in `shared/workflow/runtime/designer/conditionModel.ts`.
- (2026-10-24) Operator names follow the workflow condition model (`equals`, `in`, `is_empty`, ...). Set-valued paths reuse `in` / `not_in` / `is_empty` instead of adding new operators.
- (2026-10-24) Null semantics follow JSONata (missing satisfies `not_in`), and the SQL compiler matches them. SQL `NOT IN` alone would disagree.
- (2026-10-24) Display rules live in a relational table, not in `tenant_settings.settings` JSON. Orphan tag-definition cleanup has to see which definitions are referenced, and an FK cascade gives correct behavior on an explicit tag delete. The research agent's suggestion of `tenant_settings.settings.entityChips` was set aside for this reason.
- (2026-10-24) `ITicketListFilters` gets one last key, `where`. Legacy keys stay as a codec for URLs and the existing toolbar. New dimensions are predicates only.
- (2026-10-24) Chip tags go on the row (`contact_tags`, `client_tags`), beside `client_logo_url` / `contact_avatar_url`. The ticket-tag metadata sidecar stays because tags are edited inline through it, but no new sidecar is added.
- (2026-10-24) No display rules for an audience means no chip tags for that audience. Existing VIP definitions are seeded so current users see their VIP tags without configuring anything.

- (2026-10-24, plan review) The semantics spec is the anchor of the shared model. `packages/predicates/spec/` holds `SEMANTICS.md` plus a JSON conformance table run by every backend: the in-memory evaluator, the SQL compiler, and the workflow JSONata path (adapter serialize + `expressionEngine`). The evaluator stays in scope; the spec is what makes sharing it with workflows safe.
- (2026-10-24, plan review) Clean cutover. The compiler replaces the hand-written filter code in one change, with no side-by-side parity harness, fallback flag or kept-alive old builder. The old code is in git history for comparison; problems are fixed forward. Coverage comes from a table-driven filter matrix with explicit expected results instead.
- (2026-10-24, plan review) Ticket `where` is a single flat `and` group in storage, URLs and the toolbar. The model allows nesting; ticket storage does not until a version bump says so.
- (2026-10-24, plan review) One URL form for `where`: `v1:<path>:<op>[:<values>];...`, percent-encoded components, no base64 fallback. Unknown versions and malformed input are dropped through the dropped-reference collector.
- (2026-10-24, plan review) Persisted formats are contracts: stored filter shape, path names, the URL parameter, `tag_display_rules`, the conformance table. Path renames go through a migrate-hook alias map. See the PRD's *Persisted and external formats* table.
- (2026-10-24, plan review) Computed attributes are fenced: enumerated in the ticket query schema file, each a named resolver with its own tests, and the only place raw SQL is allowed.
- (2026-10-24, plan review) Open questions resolved: `settings:update` for display-rule writes; one readable versioned URL form; seed both VIP definitions; `maxBadges` fixed at 2.

- (2026-10-25, implementation) `@alga-psa/predicates` ships as a prebuilt (tsup, `bundle: false`) package like `formatting`, not source-transpiled, so `server/next.config.mjs` has both a src alias and a `prebuiltDirAbs` alias. `shared` bundles it (`noExternal` in `shared/tsup.config.ts`), so the Temporal worker image needs no extra dist.
- (2026-10-25, implementation) Complement operators (`not_in`, `is_empty`) compile as `NOT (positive form over the whole path)`. With a relation hop that is `NOT EXISTS`, so a missing relation row satisfies them. With `selfOrAnyChild` the negation wraps the whole self-or-any-child match: `contact.tags not_in [VIP]` excludes a bundle master whose child has a VIP requester.
- (2026-10-25, implementation) `equals null` / `not_equals null` mean "no value" / "has a value" in the evaluator and the SQL compiler; zod and query-schema validation accept null for those two operators only.
- (2026-10-25, implementation) The workflow engine throws "Expression result is not JSON-serializable" for ordering comparisons (`gt`..`lte`) on a missing value instead of returning false. Documented in SEMANTICS.md; the JSONata conformance harness maps that rejection to "not satisfied". JSONata also cannot represent set paths or null-vs-missing: those rows carry `skip.jsonata`.
- (2026-10-25, implementation) SQL conformance and self-or-any-child tests use TEMP tables in a rolled-back transaction on the `postgres` database of the test container, so they need no migrated schema; the ticket-level suites use the migrated schema.
- (2026-10-25, implementation) Cutover: `buildTicketListBaseQuery` compiles codec output plus `where` through `compilePredicateFragment` (whole fragment parenthesized so a top-level OR cannot escape the tenant AND; found by the matrix). `response_state` is an enum, so the column attribute has `castToText` (`<> ''` on the enum raised invalid input). Legacy `closed`/`all` status sentinels never restricted the list and still do not. `assignedToMe` now resolves to `involves_user` (assignee, ticket_resources, team member) and the `project:read` bypass is resolved in `resolveTicketFilterCodecContext`.
- (2026-10-25, implementation) Intended behaviour changes for the release notes: bundled-view ticket tag match goes through children; `assignedToMe` honoured by the main list; chip tags come from display rules.
- (2026-10-25, implementation) View migration: `define()` takes `{schemaVersion, migrate, prepareMigration}`. `migrate` stays pure and sync; `prepareMigration` runs once per read (listViewActions `loadMigrationContext`, tenant-scoped `tag_definitions` lookup) and hands it a `tagIdsByText` map. Unresolvable tag text is dropped (the tag no longer exists). Board/tenant default documents carry `schemaVersion` inside the JSON and migrate in `sanitizeStoredTicketView` without the lookup, so legacy `tags` text stays there; the list codec resolves text at query time, so nothing is lost.
- (2026-10-25, implementation) The ticket filter field schema is declared once as `ticketFiltersShape` in list-views; the board default schema omits `CAPTURE_EXCLUDED_FILTER_KEYS`. `assignedToIds` is now uuid on both write paths (a test fixture used a non-hex id). `ticketWhereShapeSchema` (list-views) checks the envelope; path/operator validation (`ticketWhereSchema`, `sanitizeTicketWhere`) is on the tickets side because list-views cannot import tickets.
- (2026-10-25, implementation) `where` URL codec is `ticketWhereUrl.ts`; strings that read as `true|false|null|number` are written with a `~` prefix. Sanitize universes for `where` tag ids come in as `known.whereTagIds` per path; the dashboard supplies them in the filter-descriptor step (absent universe keeps the clause).

## Discoveries / Constraints

- (2026-10-24) `tag_definitions` is unique on `(tenant, tag_text, tagged_type)`. "VIP" on a contact and "VIP" on a client are different definitions with different ids and colors.
- (2026-10-24) Definitions only exist while mapped. `tagCleanup.ts` and the `deleteTag` orphan branch call `TagDefinition.deleteOrphaned`, `findAllTagsByType` hides orphans, and migration `20260209000000` deleted existing orphans. Without a change, a display rule would dangle once the last VIP contact was untagged, and re-tagging would mint a new id.
- (2026-10-24) `ITag.tag_id` is the mapping id in most read paths, not the definition id. Display rules and predicates key on the definition id (`tag_definitions.tag_id`).
- (2026-10-24) The ticket list `tags` filter holds tag text and matches case-sensitively with an IN subquery. The REST API's `TicketService.applyTicketFilters` matches case-insensitively with EXISTS. Legacy `ticketActions.getTicketsForList` uses its own IN subquery. That makes three dialects.
- (2026-10-24) `assignedToMe` is honoured only by legacy `getTicketsForList`, not by `buildTicketListBaseQuery`. The codec fixes this by resolving it to the current user id.
- (2026-10-24) `contactId` is not parsed or written by the container URL sync, and is absent from `TICKET_VIEW_URL_FILTER_PARAMS`.
- (2026-10-24) `sanitizeStoredTicketView` drops any value that is not a scalar or a string array, so a nested `where` would be silently dropped today.
- (2026-10-24) Board default views (`boards.list_view_settings`) and the tenant default view (`tenant_settings.ticket_display_settings.list`) have no version field. Named list views have `schema_version`, migrated on read only (`toSummary` → `migrateListViewSettings`), and `define()` hard-codes version 1.
- (2026-10-24) `getCurrentFiltersQuery` writes tags with `join(',')` and no per-tag encoding, so a tag containing a comma breaks prev/next. Switching to uuid values removes the problem.
- (2026-10-24) Branch bugs that become moot once the VIP keys are removed: `requesterVip` missing from `TICKET_VIEW_URL_FILTER_PARAMS`; `requesterVipOnly` missing from the `exportFilters` dependency array; `client_vip` with no URL or UI round-trip.
- (2026-10-24) `server/src/lib/schemas/ticket.schema.ts` has no importer and has drifted (no `assignedToMe`, no `slaStatusFilter`, narrower `sortBy`).
- (2026-10-24) `findTagsByEntityId(s)` check only `withAuth`, not `tag:read`. Client users hold no `tag:read`, so the check closes the gap.
- (2026-10-24) The client portal ticket list (`getClientTickets`) is a separate loader, and filters priority, category and search in JS. It neither joins contacts nor shows requester chips. That is out of scope here; the client audience is enforced in the loader.
- (2026-10-24) The `optimizedTicketActions.tenantScopedAuth.contract.test.ts:141` source-string test pins text inside `buildTicketListBaseQuery`, so it must move with the compiler.
- (2026-10-24) The workflow condition evaluator runs inside the Temporal sandbox. Anything `@alga-psa/predicates` exports at its root must be deterministic and free of Node APIs. Keep knex behind the `/sql` subpath.
- (2026-10-24) Overlapping condition dialects to mark with LEVERAGE comments: workflow event-wait filters (`shared/workflow/runtime/types.ts:115-150`, operator names `=`, `exists`), reporting `FilterDefinition` (silently drops empty values; duplicated byte-for-byte under `server/src/lib/reports`), inbound email rules (case-insensitive), automation API, webhook schemas (no evaluator found), and service-request visibility rules.
- (2026-10-25) Step 6 shipped: `tag_display_rules` (migration `20261024120000`, registered in both tenantDb metadata tables, `exports.config = { transaction: false }`), model `tagDisplayRule.replace` validates that ids are definitions of the rule's type, actions `listTagDisplayRules` (internal only) / `replaceTagDisplayRules` (`settings:update`), loader `loadDisplayTagsForEntities` (audience is the access control: no rule, no tags), pure `resolveDisplayedTags`. All orphan cleanup funnels through `TagDefinition.deleteOrphaned`, so one `NOT EXISTS` on rules covers `tagCleanup` and `deleteTag`.
- (2026-10-25) Onboarding seed is `ee/server/seeds/onboarding/psa/12_vip_tags.cjs` (runner is `ee/temporal-workflows/src/db/onboarding-seeds-operations.ts`); algadesk gets no VIP seed since it has no contacts/clients chips. The seed imports `@alga-psa/db` from `dist`, so after adding a table to the tenantDb metadata, rebuild `packages/db` (`npm run build`) before running seeds in tests.
- (2026-10-25) Tenant deletion lists `tag_display_rules` right after `tag_mappings` (before `tag_definitions`) in `tenant-deletion-activities.ts`.
- (2026-10-25) Shared card DB (`server` on 5474): `tag_display_rules` was applied by hand by calling the migration's `up()` (no `migrate:latest`; no knex_migrations row; `up()` is idempotent). No VIP definitions existed there, so nothing was seeded.

## Commands / Runbooks

- Validate this plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-10-24-entity-tag-chips-and-path-filters`
- Dev DB that ran the PR #3858 migration: `ALTER TABLE contacts DROP COLUMN IF EXISTS is_vip, DROP COLUMN IF EXISTS is_primary_contact; ALTER TABLE clients DROP COLUMN IF EXISTS is_vip;`, then delete its row from `knex_migrations`.
- Citus: `tag_display_rules` must be distributed on `tenant` and co-located with `tag_definitions`. See the `citus-migration-gotchas` skill, and avoid `now()` inside CASE/COALESCE in any seed SQL.

- Adding a ticket-list dimension (keep this recipe in `packages/predicates/README.md` and at the top of the ticket query schema file; it is reproduced here for the plan):
  1. Declare the attribute or relation in the ticket query schema. If it is not a plain column or relation, add a named computed-attribute resolver beside the others.
  2. If it introduces an operator, path kind or value type, update `SEMANTICS.md` and add conformance rows first; all backends must pass.
  3. Add rows to the table-driven ticket filter matrix with explicit expected ids and totals, including bundled view and a client-portal user.
  4. Add a filter descriptor table entry for the toolbar and active-filter chip.
  5. The new path is a persisted contract from its first release.

## Links / References

- PR #3858: https://github.com/Nine-Minds/alga-psa/pull/3858
- Filter SQL: `packages/tickets/src/actions/optimizedTicketActions.ts` `buildTicketListBaseQuery` (~1181), `enrichTicketListItems` (~2152), `fetchBundleChildrenForMaster` (~3975)
- Filter declarations: `packages/types/src/interfaces/ticket.interfaces.ts:143`, `packages/tickets/src/schemas/ticket.schema.ts:161`, `packages/list-views/src/lib/definitions/tickets.ts:27`, `packages/tickets/src/actions/board-actions/boardViewSettingsSchema.ts:47`, `packages/tickets/src/lib/ticketViewSettings.ts`, `packages/tickets/src/lib/ticketListViewAdapter.ts`, `TicketingDashboardContainer.tsx`, `server/src/app/msp/tickets/page.tsx`, `packages/tickets/src/lib/boardTabs.ts:180`
- list-views engine: `packages/list-views/src/lib/registry.ts`, `packages/list-views/src/actions/listViewActions.ts:155`
- Workflow conditions: `shared/workflow/runtime/designer/conditionModel.ts`, `shared/workflow/runtime/expressionEngine.ts`, `ee/server/src/components/workflow-designer/WorkflowConditionBuilder.tsx`
- Tags: `server/migrations/20250702000000_normalize_tags_with_mappings.cjs`, `packages/tags/src/actions/tagActions.ts`, `packages/tags/src/lib/tagCleanup.ts`, `packages/tags/src/models/tagDefinition.ts:100`
- Chip starting points: `packages/ui/src/components/ClientNameCell.tsx`, `EntityAvatar.tsx`, the branch's `FlagBadges.tsx`, `packages/tickets/src/lib/ticket-columns.tsx` (~441, ~503)
- Settings precedent: `packages/client-portal/src/lib/clientPortalFeatureSettings.ts`

## Open Questions

None open. See the plan-review decisions above.
