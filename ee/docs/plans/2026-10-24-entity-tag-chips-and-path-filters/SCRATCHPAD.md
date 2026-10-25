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

## Commands / Runbooks

- Validate this plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-10-24-entity-tag-chips-and-path-filters`
- Dev DB that ran the PR #3858 migration: `ALTER TABLE contacts DROP COLUMN IF EXISTS is_vip, DROP COLUMN IF EXISTS is_primary_contact; ALTER TABLE clients DROP COLUMN IF EXISTS is_vip;`, then delete its row from `knex_migrations`.
- Citus: `tag_display_rules` must be distributed on `tenant` and co-located with `tag_definitions`. See the `citus-migration-gotchas` skill, and avoid `now()` inside CASE/COALESCE in any seed SQL.

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

- Display-rule writes: `settings:update` (draft) or `tag:update`?
- `where` URL encoding: readable single-level form plus base64url fallback (draft), or always opaque?
- Onboarding: seed both VIP definitions, or only the contact one?
- `maxBadges` in list cells: fixed at 2 (draft), or a display setting?
