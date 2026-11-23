# SCRATCHPAD — ITIL boards: one set of rules

Working notes for `PRD.md`. Findings are from reading code on `main` at `e776e1f1ee`; nothing here was executed unless it says so.

## Decisions

| # | Decision | Source |
|---|---|---|
| D1 | No SLA assigned to boards that never had one | Natallia, 2026-11-21 |
| D2 | New ITIL boards keep the automatic "ITIL Standard" policy | Natallia, 2026-11-21 |
| D3 | Rule-breaking tickets stay editable; nothing rewrites them silently | Natallia, 2026-11-21 |
| D4 | No new mixed boards; existing ones untouched | Natallia, 2026-11-21 |
| D5 | A direct priority change on an assessed ITIL ticket clears Impact/Urgency; they may be empty | Review, 2026-11-21 |
| D6 | Switching an existing board to ITIL assigns no SLA; the switch summary states the board's SLA | Review, 2026-11-21 |
| D7 | Workflow `tickets.create` and inbound webhook create fall back | Review, 2026-11-21 |
| D8 | Ticket ITIL level is derived from the priority, not stored | Review, 2026-11-21 |
| D9 | Per-board copies of ITIL categories, like non-ITIL boards; priorities stay tenant-wide | Natallia, 2026-11-22 |
| D10 | Cross-board category lists and reports show a standard category once (R9) | Natallia, 2026-11-22 |

Review of the first draft (2026-11-21) found seven gaps, all now in the PRD:
1. Migration order: clearing flags before re-pointing lost the mapping. Now map, copy, re-point, then clear.
2. Flagged categories with no board were not covered.
3. Saved list views hold category ids and the loader drops unknown ones.
4. Cross-board filters and reports would show one entry per board.
5. No reversal path. Now `itil_category_remap` plus `down()`.
6. The type-switch summary did not mention SLA.
7. The priority model had the same mass-assignment hole as categories.

Rejected alternative for D5: writing the matrix-diagonal pair. It stores Impact and Urgency values nobody chose and pollutes reporting on them.

Why per-board categories and not per-board priorities:
- Custom categories and statuses are already board-owned, so per-board ITIL categories make `category.board_id = ticket.board_id` the only rule. The nine `board_id`-only pickers become correct without a query change.
- Priorities have no board column for either family. `sla_policy_targets` is keyed on `priority_id`, one policy spans boards and clients, and the ticket list filter, bulk priority change, RMM/Huntress severity maps, workflow conditions and co-managed SLA mappings treat a priority as one value across boards.

## How it works today

### Data
- `boards.category_type`, `boards.priority_type`: `'custom' | 'itil'`, NULL means custom. Independent columns.
- `priorities`: tenant-wide, `item_type` (`ticket` / `project_task`), `is_from_itil_standard`, `itil_priority_level`. `UNIQUE (tenant, priority_name, item_type)` from migration `20250606174000`.
- `categories`: `board_id`, `parent_category`, `is_from_itil_standard`. No unique constraint beyond the primary key.
- `standard_priorities`, `standard_categories`: global reference rows with `is_itil_standard`.
- `tickets`: `itil_impact`, `itil_urgency`, `itil_priority_level` (migration `20250910120000`, which also added unused columns such as `resolution_code`, `root_cause`, `sla_breach`, `escalation_level`).

### ITIL setup — `packages/tickets/src/services/itilStandardsService.ts`
- `copyItilPrioritiesToTenant` (L23): matches by `priority_name` + `item_type`; flags an existing unflagged row (L61).
- `copyItilCategoriesToTenant` (L82): top-level match by name with no board filter (L106), flags the match (L130), inserts children under it with the new board's id (L161). A second ITIL board gets no rows.
- `handleItilConfiguration` (L190): priorities, then SLA through the injected hook (skipped silently when unset, L210), then categories.
- `cleanupUnusedItilStandards` (L233): runs when no board of that kind is left; deletes unused ITIL priorities and categories, SLA targets, an empty "ITIL Standard" policy (found by name, L441), nulls `boards.default_priority_id`, `inbound_ticket_defaults.priority_id` and `tickets.sla_policy_id`.

### Listing
- Canonical categories: `getTicketCategoriesByBoard`, `packages/tickets/src/actions/ticketCategoryActions.ts:406-416` — ITIL board lists by flag, other boards by `board_id`. Hand-copied in `optimizedTicketActions.ts:696-716` and `server/src/app/api/v1/tickets/categories/route.ts:49-67`.
- Canonical priorities: `getPrioritiesByBoardType`, `packages/reference-data/src/actions/priorityActions.ts:281-290`.
- Client-side family filter re-implemented in `QuickAddTicket`, `TicketInfo`, `BentoHero`, `BoardsSettings`, surveys `TriggerForm`, `TicketImportDialog`, mobile `CreateTicketScreen`.

### Pickers that are wrong (traced)
| Surface | Where | Categories | Priorities |
|---|---|---|---|
| Co-managed ticket edit | `packages/co-managed/src/ticketEditing.ts:176-178,215-219` | `board_id` only | all ticket priorities |
| CSV import | `packages/tickets/src/actions/ticketImportActions.ts:247-251,337-347,586-589`; `lib/ticketImportUtils.ts:361-373,609-632` | grouped by `board_id`; "create new" inserts an unflagged row on an ITIL board | name match across families; fallback first by `order_number`; ITIL-ness taken from the default board, not the row's board |
| REST `/categories/ticket`, tree, search | `server/src/lib/api/services/CategoryService.ts:307,610,707` | `board_id` only | — |
| REST priorities | `server/src/app/api/v1/tickets/priorities/route.ts:28-33`; `PriorityService.ts:24-45` | — | no board filter; `/tickets/priorities` omits the level |
| Inbound email defaults | `packages/integrations/src/components/email/forms/InboundTicketDefaultsForm.tsx:94,202,470`; `ticketFieldOptionsActions.ts:338-342` | `board_id` only | `getAllPriorities('ticket')` unfiltered |
| Workflow designer (two copies) | `ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx:441-465,669-691`; `ee/packages/workflows/src/components/automation-hub/WorkflowActionInputFixedPicker.tsx:334-345,452-467` | client filter by `boardId` | no family data sent |
| Huntress settings | `ee/server/src/lib/actions/integrations/huntressActions.ts:486-503,150-153` | client filter by `board_id` | all; severity prefill by name |
| Inbound webhook mapping | `server/src/lib/actions/inboundWebhookLookups.ts:129-173` | `board_id` only | no `item_type`, no board |
| Categories settings | `packages/tickets/src/components/settings/CategoriesSettings.tsx:108,348,379,550` | `getAllCategories` does not select the flag, so the ITIL badge never renders | — |
| Service request editor | `server/src/app/msp/service-requests/actions.ts:173-204` | canonical | custom board gets all ticket priorities |
| Create ticket from asset | `packages/assets/src/components/CreateTicketFromAssetButton.tsx:82,178` | — | all |
| Activities inline priority | `packages/user-activities/src/components/InlinePriorityPicker.tsx:18` | — | all |
| Checklist apply rules | `server/src/components/settings/general/ChecklistTemplatesSettings.tsx:192-574` | client filter by `board_id` | all |
| RMM alert rules | `packages/integrations/src/actions/integrations/rmmAlertRuleActions.ts:339` | — | no `item_type` |
| Mobile ticket detail | `ee/mobile/src/features/ticketDetail/hooks/useTicketPriority.ts:15-18` | — | "same family as the current priority" heuristic |

Templates and recurring: listing is canonical (`useTicketFieldReferenceData.ts:117-125`), but `ticketFieldReferences.ts:206-213` rejects `category.board_id !== fields.board_id` with no ITIL exemption, at save and at every generated occurrence.

### Writers
- Creates funnel into `TicketModel.createTicket` (`shared/models/ticketModel.ts:1193`), some through `createTicketWithSideEffects`. Raw inserts: `shared/rmm/alerts/ticketCreator.ts:123`, `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts:71`.
- The model validates subcategory→parent, status→board, location→client. Nothing about board kind or category ownership. `INPUT_DRIVEN_TICKET_COLUMNS` (L492) includes `itil_impact` and `itil_urgency` but not `itil_priority_level`, so no create stores the level.
- Updates have no funnel. Direct writes of priority, board or category:
  - `packages/tickets/src/actions/ticketActions.ts:1761`
  - `packages/tickets/src/actions/optimizedTicketActions.ts:3274`, `:3294`
  - `server/src/lib/api/services/TicketService.ts:2500`
  - `packages/tickets/src/actions/ticketBundleUtils.ts:1477`, `:1577`
  - `packages/user-activities/src/actions/activityStatusActions.ts:423`, `:514`
  - `TicketModel.updateTicket` (`ticketModel.ts:1494`) serves workflow `update_fields` and inbound webhook update only.
- ITIL priority is computed server-side in four places, triggered by the presence of Impact and Urgency, never by the board's kind, and looked up by name: `ticketActions.ts:654-671`, `:1584-1604`, `optimizedTicketActions.ts:3050-3070`, `server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts:293-304`.
- PR #3880 check (`findPriorityBoardTypeProblem`, `findTicketUpdatePriorityBoardTypeProblem`) is applied at `ticketActions.ts:499`, `:673`, `:1611`, `optimizedTicketActions.ts:3084`, `TicketService.ts:1971`, `:2296`, `:2726`, `instantiateTicketTemplate.ts:188`. On update it fires only when the patch changes board or priority — keep that shape (D3).
- Other writers and where they insert or update:
  - Client portal create: `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:1535`
  - Inbound email: `shared/workflow/actions/emailWorkflowActions.ts:1339`; defaults saved in `packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions.ts:141` (validates status↔board only)
  - CSV import: `ticketImportActions.ts:796` with `skipCategoryValidation: true`
  - Workflow `tickets.create` / `update_fields`: `shared/workflow/runtime/actions/businessOperations/tickets.ts:540`, `:902`
  - Workflow maintenance ticket: `.../assetMaintenance.ts:219`
  - Teams / guest intake / manual telephony: `ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionRegistry.ts:1360` (`resolveDefaultPriorityIdForBoard` L592-634), `.../bot/teamsGuestIntake.ts:277`, `packages/integrations/src/actions/integrations/telephonyActions.ts:1231`
  - Inbound webhooks: `packages/tickets/src/actions/inboundActions.ts:136`, `:229`, `:367`
  - Telephony auto-ticket: `packages/telephony/src/services/autoTicketFromCall.ts:65`
  - Renewal ticket: `shared/billingClients/renewalTicket.ts:126`
  - Data-migration import: `server/src/lib/migrations/appliers/entityAppliers.ts:356`
  - Batch duplicate: `ticketActions.ts:1270`
  - Bulk board move: `ticketActions.ts:2652-2662` (clears category on board change)
- "Default priority for a board" exists five times: `QuickAddTicket.tsx:147-174`, service request editor `:224-238`, `boardActions.ts:446-480`, Teams `:595-636`, import `:586-589`.

### Board lifecycle — `packages/tickets/src/actions/board-actions/boardActions.ts`
- Create: default priority chosen (L446-479), board inserted (L481), ITIL copy (L516), statuses seeded (L525-548). `default_assigned_team_id` is in the schema and sent by the UI but missing from the insert (L481-508). The returned row and `BOARD_CREATED` payload predate the SLA assignment.
- Update on a kind change (L1244-1263): copy or cleanup, no confirmation, no re-homing, default priority untouched. Not reachable from the settings screen (`BoardsSettings.tsx:947-949` passes stored kinds through).
- Delete (L737-1039): default-board, inbound-defaults, sender-route, automation, co-managed and ticket checks; status and reference cleanup; last-ITIL cleanup; step 8c re-points the shared category set (L1029-1039).
- REST `server/src/lib/api/services/BoardService.ts`: create L45-55, update L74-92, delete L108 through `BaseService` hard delete. Reuses only the zod schema.
- Other create paths: `importReferenceData('boards')` (`packages/reference-data/src/actions/referenceDataActions.ts:619-624`), onboarding raw insert (`onboardingActions.ts:940`).
- Schemas accept the two kinds independently: `boardInputSchema.ts:42-43`, `server/src/lib/api/schemas/board.ts:15-16`. UI has one switch for new boards (`BoardsSettings.tsx:1186-1187`, `3103-3121`).
- `display_itil_impact`, `display_itil_urgency`: written at `boardActions.ts:490-491`, REST and dev seed 85; never read to branch on.

### Category actions — `packages/tickets/src/actions/ticketCategoryActions.ts`
- `copyTicketCategoriesToBoard` (L211-250): rejects only a kind mismatch (L219); ITIL→ITIL copies the set with the flag kept.
- `deleteCategory` (L657-691): ITIL and in-use guards, no permission check.
- `updateTicketCategory` (L333-338): mass-assigns `Partial<ITicketCategory>`.
- `deleteReferenceDataItem('categories')` (`referenceDataActions.ts:714-766`): no authorization, no ITIL guard; used by onboarding (`TicketingConfigStep.tsx:1056`).
- REST `deleteTicketCategory` (`CategoryService.ts:564-590`): checks `tickets.category_id` but not `subcategory_id`.

### Where category ids are stored besides tickets
- Board delete step 8c (`boardActions.ts:1029-1039`) moves surviving ITIL categories to another ITIL board, or sets `board_id` to NULL when none is left. So flagged categories without a board exist wherever the last ITIL board was deleted while tickets still used them, and a later ITIL board reuses them through the name match.
- Saved views: `boards.list_view_settings` (migration `20260819120000`, schema `board-actions/boardViewSettingsSchema.ts`) captures ticket filters, including `categoryId`, `categoryIds`, `excludeCategoryIds`. `packages/tickets/src/lib/ticketViewSettings.ts:278-335` drops ids that are not in the known set for the board, silently by design.
- Personal views: `list_views.settings` jsonb, with the default-view pointer and last active board in `user_preferences` (`packages/list-views/src/models/listViewModel.ts`, `packages/tickets/src/lib/boardTabs.ts:29`). All server-side.
- Ticket list URL parameters carry the same three keys (`server/src/app/msp/tickets/page.tsx:127-137`), so shared links hold category ids too.
- CSV import treats a category without a board as `_global` and matches it for any board (`ticketImportActions.ts:339`, `ticketImportUtils.ts:371,623`).
- Priority model: `packages/reference-data/src/models/priority.ts:60` inserts `{ ...priority, tenant }`.

### SLA
- Hook: `registerSlaIntegration` (`packages/msp-composition/src/tickets/registerSlaIntegration.ts`) is called only from `server/src/app/msp/_components/WorkspaceRouteLayout.tsx:9`. `/msp/settings` and `/msp/onboarding` do not use that layout.
- `server/src/lib/initializeApp.ts` already has a register-then-assert pattern (`assert…NotifierRegistered`); use it.
- `packages/sla/src/services/itilSlaService.ts`: policy found by name (L25, L50); an existing policy is returned untouched (L54), so re-created priorities get no targets; board assigned only when it has no policy (L207).
- `ensureSlaParity` in `ee/temporal-workflows/src/db/product-upgrade-operations.ts:557-651` is a second implementation that does top up targets and assigns boards during a product upgrade. Out of scope beyond sharing the constants and the flag.
- Target times exist in `itilSlaService.ts:17`, `product-upgrade-operations.ts:135`, `shared/lib/itil/slaTargets.ts`, and the unused `server/src/lib/utils/itilUtils.ts:127`.
- `shared/services/tickets/ticketSlaStageEvents.ts:71,101` builds `TICKET_SLA_STAGE_*` from `getSlaTarget(itilPriorityLevel)` hours and returns null without a stored level. Because no create stores the level, these events depend on a field that is rarely set. Deriving the level without also moving the events onto the real SLA would switch them on with hard-coded hours — do both in the same group.
- Policy resolution is client, then board, then tenant default, duplicated in `shared/lib/sla/slaPolicyResolver.ts` and `packages/sla/src/services/slaService.ts:814` (LEVERAGE marker already there). A resolved policy with no target for the priority stamps the ticket with no due dates (`slaService.ts:138`). Not changed here.

### Dead code
- `server/src/lib/utils/itilUtils.ts` (348 lines): no importers.
- `packages/tickets/src/lib/itilUtils.server.ts`: no importers; reads the global `standard_priorities`.
- `packages/tickets/src/lib/itilUtils.ts`: `isSlaBreached`, `getEscalationLevel`, `ItilCategories`, `ItilResolutionCodes`, `formatItilCategoryDisplay`, `getItilCategoriesAsTicketCategories` have no users outside the file.
- `ticketFieldOptionsActions.ts`: `getAvailablePriorities`, `getAvailableCategories` unused; stray `console.log('categories', …)` at L187.
- `server/src/lib/models/ticketCategory.tsx`: imported only by `CategoryService.ts:14`, which never uses it.
- `docs/itil/itil-integration.md` lists fields and features that are not implemented.

## Gotchas

- New `shared/lib/**` modules need an entry in `shared/tsup.config.ts` and an export in `shared/package.json`, then `npm run build:shared`.
- `reference-data` must not import `tickets`; co-managed deliberately does not import the tickets package (`ticketEditing.ts:189-191`). The rules module has to live in `shared/`.
- Migrations: `const { tenantDb } = require('./utils/tenantDb.cjs')`, never `@alga-psa/db`. No column references in UPDATE on distributed tables. Unique indexes must include `tenant`.
- Priority name collisions: a tenant priority already named like an ITIL one hits `UNIQUE (tenant, priority_name, item_type)`. Seeding by level must report this instead of flagging the existing row.
- Dev seeds: `80_itil_categories.cjs` runs before `85_itil_priorities.cjs` creates the ITIL board, so it stamps the set onto a non-ITIL board.
- The category migration and the lister switch must deploy together.
- `scripts/reports/priority-board-mismatch.sql`: its category sections compare the flag with the board kind; under R2 the check is `category.board_id` vs the ticket's board.
- Existing guard scripts to model on: `scripts/guard-*.mjs`, wired as `guard:*` npm scripts and in `.github/workflows/`.
- Glossary and locale gates fail CI on a single miss; add strings to every locale in the same group.

## Code checks (done 2026-11-22)

| Check | Result |
|---|---|
| Does the production build share one module instance between startup code and server actions? | No, by the repo's own account. `packages/auth/src/lib/emailRegistry.ts:6-12` says Next webpack chunk boundaries create separate module instances for instrumentation and server-action contexts; `packages/tickets/src/lib/ticketListViews.ts:14`, `ticketResponsibility.ts:11` and two authorization registries hold their state on `globalThis` for that reason. The SLA hooks are plain module variables (`itilStandardsService.ts:7`, `ticketActions.ts:164`), `@alga-psa/tickets` is in `transpilePackages` (bundled, `server/next.config.mjs:559`), and `BoardsSettings.tsx` is a client component importing the `'use server'` board actions. So registering at startup is not enough on its own: the hooks move to `globalThis`. Not confirmed by running a production build; the `sla` group has a test for that. |
| Which settings hold a category id without a board? | With a board, so the migration can re-point: Huntress settings (`huntressActions.ts:261-264`, `boardId` + `categoryId`), workflow `tickets.create` inputs (`tickets.ts:426-454`), inbound webhook `handler_config` (`board_id` is a required field, `inboundActions.ts:96`), recurring overrides (board falls back to the template). Without a board: workflow `tickets.update_fields` (`tickets.ts:765`, only a ticket id), checklist apply rules (board is an optional predicate, migration `20261028120000`). Those are handled by translation at write time and by the predicate engine. |
| Does REST block editing ITIL priorities? | There is nothing to block. `server/src/app/api/v1/priorities/route.ts` and `[id]/route.ts` export only `GET`; `PriorityService` overrides only `list` and `getById`. The priority write hole is in the reference-data model and web actions only. |
| Can `ee/temporal-workflows` import from `@alga-psa/shared`? | Yes. It is a dependency (`ee/temporal-workflows/package.json:40`) and already imported in that package. |
| Where do the cross-board category filters load their lists? | MSP ticket list: every category of the tenant, `optimizedTicketActions.ts:2767`, passed un-narrowed to `CategoryPicker` on every tab, including a single board's (`TicketingDashboard.tsx:522,2977`). The picker has no board label and no de-duplication. Client portal: `getTicketCategories()` in `packages/client-portal/src/components/tickets/TicketList.tsx:178`. The filter is applied in `packages/tickets/src/lib/ticketFilterPredicates.ts:82-98` and matches `category_id` or `subcategory_id`. |
| Which reports group tickets by category? | Two REST surfaces only. Ticket stats `tickets_by_category` is keyed by category name (`ApiTicketController.ts:397`), so it already merges same-named categories. Category usage stats group by category id (`CategoryService.ts:789-800`) and stay one row per category. No dashboard or report definition groups by ticket category. |
| Where are personal views and tab filters stored? | On the server: `list_views.settings` jsonb (migration `20260922120000`) and `user_preferences` for the default-view pointer and the last active board (`packages/list-views/src/models/listViewModel.ts`, `boardTabs.ts:29`). No category id is kept in browser storage. Shared links carry them in the URL. |
| Does any flow create a category without a board on purpose? | No. Web create requires a board (`ticketCategoryActions.ts:145,467`); the REST create schema requires `board_id` (`categorySchemas.ts:73`), which makes the `whereNull('board_id')` branches in `CategoryService.ts:414-434` unreachable; onboarding, CSV import and reference-data import all pass a board. Boardless rows come only from board delete step 8c and from migration `20260805090000`, which detached categories of boards that no longer existed. |
| Are the two dead-code candidates really unused? | `server/src/lib/models/ticketCategory.tsx`: its only importer is `CategoryService.ts:14`, which never uses it. Removable with that import. `shared/services/emailService.ts`: used only by `emailServiceContactLookup.integration.test.ts`; it is not a production write path, and it stays. |

What the checks changed in the plan:
- SLA hooks are held on `globalThis`; registering at startup alone would not reach server actions.
- A write that names another ITIL board's standard category is translated to the ticket's board's copy (R2). Without this, a workflow `tickets.update_fields` with a fixed category, and API callers holding the shared id, would be refused on every ITIL board but one after the migration.
- Standard-aware matching sits in the predicate engine (R9), so checklist rules are covered together with list filters and saved views.
- The category filter lists every tenant category on a single board's tab too, so the one-entry-per-standard-category rule applies there as well.
- REST priority guards and the `emailService.ts` removal are dropped from scope.

Still open: a free-form workflow expression comparing a ticket's category to a literal id cannot be found or re-pointed.

## Implementation notes

### Commit group 1 — `core-rules` (done)

Landed: `shared/lib/itil/priorityMatrix.ts`, `shared/lib/tickets/boardFieldRules.ts`, both registered in
`shared/tsup.config.ts` and `shared/package.json`; `packages/tickets/src/lib/itilUtils.ts` now re-exports the
matrix instead of holding a second copy; the PR #3880 helpers in `ticketFieldReferences.ts` delegate;
`ItilStandardsService.copyItilPrioritiesToTenant` matches by family + level; the priority write whitelist in
`packages/reference-data/src/models/priority.ts` and `priorityActions.ts`.

- **`boardDefaultPriority.ts` overlap (asked for by the plan).** `packages/tickets/src/lib/boardDefaultPriority.ts`
  is the *client* rule: it picks from a list already fetched, for the Quick Add and the client portal form. The
  server rule is `defaultPriorityForBoard`/`defaultPriorityForBoardRow` in the shared module. They agree on R7 —
  stored default when its family matches, else the level-3 ITIL priority, else the lowest-order own ticket
  priority — and differ only at the end: the client helper falls back once more to "the first priority in the
  list" so a `<Select>` is never empty, while the server returns `null`, as R7 says ("otherwise none"). The client
  helper is folded into the one filter helper in the `priority-pickers` group; until then it stays as the client
  half and must be changed with the server half.
- **New field problems carry no `messageKey` yet.** `findBoardFieldProblems` reports existence, item-type,
  category-ownership and Impact/Urgency problems as plain English `message`s, the way
  `findTicketFieldReferenceProblems` already reports its own. Only the two family-mismatch messages (which
  already have keys in all ten locales) carry a key. The group that first shows one of the new messages to a
  user adds its key to every locale in that group's commit — adding keys here would put untranslated strings in
  ten locale files that nothing renders.
- **`findTicketUpdatePriorityBoardTypeProblem` keeps its narrow contract.** It now runs the shared patch check,
  which also looks at the category, but filters the result down to the two family-mismatch problems. Widening it
  here would turn a dangling category into a `PriorityBoardTypeError` on paths that report that separately
  (`findTicketFieldReferenceProblems`, `TicketModel`). The category half of the patch check is wired into the
  writers in the `writers-create` and `writers-update` groups.
- **T010 is the existing suite.** `server/src/test/integration/priorityBoardType.integration.test.ts` is
  deliberately unmodified: it is the test that the delegation did not change behaviour.
- **Seeding is now fail-loud.** A tenant priority named like an ITIL one used to be flagged (and silently moved
  into the ITIL family); it now aborts ITIL setup with a message naming the row. That is the PR's intent (R3: the
  flag is set by seeding alone), and it makes `handleItilConfiguration` able to fail — the `board-lifecycle`
  group has to surface it as a field error on board create rather than a server error.
- Not run here: the integration suites. This worktree has no test database (`.env.localtest` points at port
  5472, which is closed; `secrets/` is absent), so `itilBoardFieldRules.integration.test.ts` was written against
  the harness in `itilBoardDeletionCleanup.integration.test.ts` and is first executed by CI. The unit and
  contract tests in the group were run locally.

### Commit group 2 — `email-hotfix` (done)

Landed: the board-filtered priority select, clear-on-board-change and stored-value warning in
`InboundTicketDefaultsForm.tsx`; the mismatch badge in `InboundTicketDefaultsManager.tsx` fed by a new
`priorityMismatchIds` on `getInboundTicketDefaults`; `assertPriorityFitsBoard` on both inbound-defaults
writes; fall-back priority resolution in `createTicketFromEmail`; the four new strings in every locale.

- **`getPrioritiesByBoardType` now delegates to the shared lister.** The plan lists the per-component
  family filters under `priority-pickers`, but the canonical action is what the inbound-defaults form
  has to call, so it moved here. It also now returns the whole priority row (as it did before) — the
  shared lister selects `*` for the list functions and narrow column sets for the checks.
- **Inbound defaults are validated as a whole, not as a patch.** R5 ("only what a change touches")
  is a rule about tickets. A defaults row is a writer configuration: every email it matches is created
  with the priority stored in it, so the effective `(board, priority)` pair is checked on every save,
  including a description-only one (T036). A row saved before the rule existed cannot be saved again
  until its priority is fixed, and the list badges it in the meantime.
- **The form keeps a stored non-fitting priority rather than clearing it**, so the admin can see what
  was configured; a board change the admin makes does clear it. The picker cannot *display* a value it
  does not offer, so T037 proves the value survived by checking the payload of the save instead of the
  select's DOM value.
- **The inbound-defaults authz gate was already there.** `requireInboundTicketDefaultsAdmin` is applied
  to read, write and delete on `main`; the plan's "beside the new authz gate" needed no work.
- **T038–T041 test the rule, not `createTicketFromEmail` end to end.** That function dynamically imports
  `withAdminTransaction`, `TicketModel.createTicketWithRetry`, the workflow publisher and the analytics
  tracker; standing all of that up adds no coverage of the decision under test. The four cases run
  against `resolveTicketPriorityFields` with the real database, and a contract test asserts that
  `createTicketFromEmail` calls it with `policy: 'fallback'` and passes the result to the create — the
  one thing that can silently regress.

### Commit group 3 — `test-harness` (done)

Landed: `server/src/test/integration/fixtures/itilSecondBoardFixture.ts` and
`server/src/test/integration/itilSecondBoardSurfaces.integration.test.ts`.

- **The fixture builds today's shape, not the target shape.** The ITIL category set is stamped on the
  first ITIL board only, because that is what `copyItilCategoriesToTenant` does. The exported
  `expectedItilCategoryOwnership` says which shape is being built, and the `category-schema` /
  `category-rules` commits flip it to `per-board-copies` together with the migration — so the fixture
  and the product change in the same commit. The ITIL priorities and the standard category names are
  read from `standard_priorities` / `standard_categories`, so the fixture follows the product's set.
- **Two things keep the table honest.** `T044` parses the PRD's refuse/fall-back table and the
  SCRATCHPAD's traced-pickers table and requires every surface named there to be claimed by exactly
  one row (38 tokens today); a second check requires the set of groups with expected-fail rows to be
  exactly the set of groups still unimplemented in `features.json`, so flipping a group's flags
  without flipping its surface rows fails here.
- **The two table-versus-plan checks sit outside the database `describe`**, so they run in every lane;
  only the fixture test and the per-surface probes need Postgres.
- **Expected-fail rows are `it.todo`**, which is what makes "no expected-fail rows left" readable in
  the run output: 37 todos today, three covered rows (the shared rules, the inbound-defaults picker
  and the inbound-email writer).

### Fix after the first round's test run

`resolveTicketPriorityFields` fed a stored Impact × Urgency pair back into the matrix on a write that
only moved the priority, so an assessed ITIL ticket snapped back to the old pair's priority and kept
the assessment (T003). The stored pair is now used only when the write supplies part of the
assessment or leaves the priority where it is. D5 holds: a direct priority change clears both;
re-sending the stored priority is not a change and keeps them.

### Commit group 4 — `category-schema` (done)

Landed: `server/migrations/20261122120000_itil_categories_per_board.cjs`, the
`itil_category_remap` entry in both tenant-table metadata snapshots, the dev seed renamed
`80_itil_categories.cjs` → `86_itil_categories.cjs` (after `85_itil_priorities.cjs` creates the ITIL
board) and rewritten to seed per ITIL board with `standard_category_id`, plus
`server/migrations/__tests__/itilCategoriesPerBoardMigration.integration.test.ts` (29 of the group's
tests) and `server/src/test/integration/itilDevSeedCategories.integration.test.ts` (T061).

- **The remap table is a journal, not only a remap** (PRD updated). `down()` has to delete the
  copies the migration inserted, restore the parents it moved and the flags it cleared, and none of
  that is derivable afterwards: an unflagged row is indistinguishable from an ordinary category, and
  an inserted copy from one linked in place. So the table carries a `kind` column with
  `replace` / `insert` / `reparent` / `unflag`, and `replace` rows are exactly the pairs the PRD
  describes — `(tenant, board_id, old_category_id)` still answers "what did this board's X become?".
  A journal row is written only when a mutation happens, which is also what keeps the run idempotent.
- **The flag is written as "has a standard link".** Step 5 is implemented as one reconciliation:
  a row keeps the flag only when it is the chosen copy on an ITIL board, every other row loses it.
  That covers the plan's step 5 and F047 (a flagged row whose name is not a standard one) in one
  pass, and makes a re-run a no-op.
- **One copy per board, so duplicates stay as ordinary categories.** If two rows on the same ITIL
  board map to the same standard row (possible through the old name match), the older one becomes
  the board's copy and the other keeps its id, its board and its tickets without the flag — the
  partial unique index allows only one. References to it are re-pointed to the board's copy.
- **`list_views` is re-pointed only when the view names one board.** `filters.boardId === B`, or a
  single-entry `filters.boardIds`. A view spanning boards is left to R9 matching, as the plan says.
- **Static ids in settings.** Huntress is `rmm_integrations.settings.boardId/categoryId`; a workflow
  `tickets.create` is `config.inputMapping.board_id/category_id` on an `action.call` step, found
  recursively through control blocks, in both `workflow_definitions.draft_definition` and every
  `workflow_definition_versions.definition_json`; an inbound webhook is a quoted JSONata literal in
  `handler_config.field_mapping`, and the quote style is kept.
- **The migration suite runs on a fixture schema** holding only the tables the migration touches
  (the pattern of the other suites in `server/migrations/__tests__/`), with a three-parent
  stand-in standard set so a scenario reads. The bootstrap applies the migration, each test rolls it
  back and drives `up()`/`down()` itself. T061 instead asserts the real set on a bootstrapped
  development database, which also runs the migration against the real schema.

### Commit group 5 — `category-rules` (done)

Landed: `listCategoriesForBoard` and `translateStandardCategoryForBoard` in the shared module;
the three flag-based listers switched to the shared lister; the category half of
`ticketFieldReferences`, co-managed `ticketEditing` and the asset-maintenance workflow action
delegating to `findBoardFieldProblems`; per-board seeding keyed by `standard_category_id` in
`ItilStandardsService.copyItilCategoriesToTenant`; board delete taking its own categories with it;
the locks on a standard row in the web actions, `CategoryService` and the reference-data delete;
the `updateTicketCategory` whitelist and the permission gates; the Standard badge and the
read-only ITIL board in `CategoriesSettings`; CSV import matching per board with no `_global`
fallback and no create on an ITIL board; five new strings in every locale.

- **F053 needed no query change.** The nine `board_id`-only pickers the SCRATCHPAD traced
  (inbound defaults, workflow designer ×2, Huntress, inbound webhook mapping, checklist rules,
  REST list/tree/search, co-managed, onboarding) were *already* asking the right question; what
  was wrong was the data they asked it of. Per-board copies make them correct as they stand, which
  is why the group's diff holds no picker edits. The surface rows prove it rather than a code
  change claiming it.
- **The cross-board category message now names the board.** The shared rule says
  `Category ‘X’ does not belong to board ‘B’` where the two copies said
  `… the selected board`. Two assertions in `recurringTicketActions.integration.test.ts` were
  updated to the new text; the PRD asks the messages to name the value and the board.
- **A boardless category is now a reported problem** (R2), which means the template and schedule
  validator reports it too — it is a dangling reference under the new rule. A ticket that already
  holds one still saves every other field, because the patch check only looks at what a change
  touches (T103).
- **Board delete stopped blocking on another board's ticket.** The old check counted tickets
  holding the board's categories, whatever board the ticket was on. Under R2 that is rule-breaking
  data, not a reason to refuse: the delete keeps those categories without a board (and their
  parents, so the hierarchy still reads) and deletes the rest. D3 — the ticket keeps its value.
- **`cleanupUnusedItilStandards` is priorities only.** Its category half and the two
  `categories*` fields of its result are gone: a board's categories go with the board, so there is
  nothing tenant-wide left to sweep. The last-ITIL-board prompt no longer offers to remove
  categories.
- **The co-managed surface row split in two.** Its category half is covered here; the priority
  list it offers is still both families, so a second row carries that to `priority-pickers`. The
  two plan tokens are split across them, one each, so T044 still sees exactly one claim per token.
- **No `ApiCategoryController` signature change was needed** (the plan asked for it to be noted):
  the guards live inside `CategoryService`, so the controller and the route schemas are untouched.
- **`updateTicketCategory` is now a gated three-field write** (name, display order, parent) and
  `deleteCategory` requires `ticket_settings:delete`; both return the existing
  `permissionError` shape, which is what T093 asserts.
- Run against this slot's database: `itilCategoryBoardRules` 28/28, `itilBoardDeletionCleanup`
  5/5 (its re-point test rewritten as T087), `itilSecondBoardSurfaces` 11 covered + 33 todos,
  `itilBoardFieldRules` 27/27, `inboundTicketDefaultsPriorityBoard` 8/8, plus the two contract
  suites. `npm run test:i18n`'s validator, audit and glossary checks are green.

### Commit group 6 — `category-filters` (done)

Landed: `shared/lib/tickets/standardCategoryFilterOptions.ts` (registered in `shared/tsup.config.ts`
and `shared/package.json`); the standard-aware category match in
`shared/lib/ticketQuery/ticketQuerySchema.ts`; the de-duplicated feed in `optimizedTicketActions`
and the client portal `TicketList`; the alias translation in `validateCapturedFilters`, fed from the
options payload through `TicketingDashboardContainer`.

- **Amendment 1, answered.** A checklist apply rule's category predicate is *not* evaluated through
  `ticketFilterPredicates.ts`. `shared/lib/ticketChecklists/applyTemplates.ts` compiles the rule's
  stored `where` against `createTicketQuerySchema` and selects the fragment against the ticket row;
  the checklist settings screen writes `path: 'category_id'`, while the ticket list's legacy-filter
  codec writes the computed `category` path. The layer both share is the ticket query schema, so R9
  lives there: `category`, `category_id` and `subcategory_id` all match "this row, or any board's
  copy of the same standard category". `category_id` and `subcategory_id` stopped being plain
  columns for exactly that reason, which is why they now carry explicit operator sets and a
  resolver that reproduces the column semantics (including the null comparisons) around the widened
  match. T117 is the test that decides it, and it drives a real ticket row.
- **One SQL shape, four callers.** The match is `?? IN (…) OR EXISTS (SELECT 1 FROM categories
  __cself JOIN categories __ctarget …)`, tenant-correlated on both sides, so the list filter, a
  saved view, a shared link and a checklist rule all widen identically. A category with no standard
  link compiles to the same comparison as before, so nothing changes for the tenant's own
  categories (T108, T118).
- **De-duplication and translation are one function.** `standardCategoryFilterOptions` returns the
  kept rows *and* the aliases it created (dropped id → representative id). Without the aliases the
  saved-view loader would still drop a stored id, because the known universe it validates against
  is the de-duplicated list. The representative is the row with the lowest `(board_id, category_id)`,
  so every representative comes from one board and the parent/child shape survives; a kept child's
  parent is re-pointed anyway, so a partial set cannot orphan one.
- **`categoryAliases` is additive on the options payload.** An older cached payload has no such
  key, which the container reads as "nothing to translate" — the same convention the tag universes
  already use there.
- **F060 needed no code.** `ApiTicketController` already groups `tickets_by_category` by
  `category_name`, so the boards' copies of one standard row collapse into one entry; T116 asserts
  that on real rows instead of assuming it.
- Run against this slot's database: `itilCategoryFilters` 11/11, `itilSecondBoardSurfaces` 14
  covered + 30 todos, `ticketQuerySchema` + `ticketFilterPredicates` 50/50,
  `checklistRulePredicates` 5/5, the portal contract test 2/2.

### Commit group 7 — `impact-urgency` (done)

Landed: `resolveTicketPriorityFieldsOrThrow` and `resolveTicketPriorityPatch` in
`packages/tickets/src/lib/ticketFieldReferences.ts` (with `TicketBoardFieldError`, which
`PriorityBoardTypeError` now extends and `ticketActionErrorFrom` reports); MSP create and both MSP
update functions, the service-request provider, template instantiation (so every recurring
occurrence too) and batch duplicate call them; `itil_priority_level` is no longer accepted or
written, and the level is read from the priority row; the "Not assessed" display in `TicketInfo`,
`BentoHero` and `QuickAddTicket`; four strings in every locale.

- **The four name-pattern lookups are gone, and a test bans the pattern.** The `P{n} -%` lookup is
  replaced by `resolveItilPriorityId`, which finds the priority by `itil_priority_level` (D8). The
  integration fixture names its ITIL priorities `ITIL level n (renamed)`, so a test that passes
  there cannot be passing by name, and `itilImpactUrgencyContract.test.ts` scans every source file
  of the touched packages for the pattern and for a second `calculateItilPriority` caller on the
  server.
- **Where the stage events get their level, and why both halves are in this branch.** The SCRATCHPAD
  gotcha says deriving the level without moving `TICKET_SLA_STAGE_*` onto the ticket's real SLA would
  switch those events on with hard-coded hours. The PRD's commit table puts the derivation in group 7
  and the real-SLA source in group 13, and both ship in this branch — the whole card is one release —
  so the gotcha's "deploy one without the other" case cannot happen. Nothing was reinterpreted; it is
  recorded here because the two groups are written apart.
- **Quick add no longer demands the pair when a prefill carries a priority.** R4 accepts an ITIL
  priority on its own ("Not assessed"), and a duplicate or template prefill can bring one. The form
  required both values, which would have forced a re-prioritisation of such a ticket; it now requires
  the pair only when there is no priority, and still refuses one value without the other.
- **`resolveTicketPriorityPatch` writes a field only when the answer differs from the stored value**
  (or the patch named it). That keeps an unrelated edit's patch untouched — R5/D3, the legacy ticket
  whose pair already mismatches — while still clearing Impact and Urgency when D5 says so.
- **T119–T132 test the rule where it lives.** `addTicket`/`updateTicket` pull in the authorization
  kernel, the event bus and analytics; standing those up adds no coverage of the decision. The
  behaviour runs against this slot's database through the two helpers the actions call, and the
  contract test pins that each named writer calls them, which is the thing that can silently regress.
  `instantiateTicketTemplate.itilPriority.test.ts` is the one path tested end to end, because its
  create seam is already mocked there.
- **Three assertions in other suites had to be reconciled** (all this card's own doing, found by
  running the package's suites): `optimizedTicketActions.tenantScopedAuth` asked for a `priorities`
  read in `updateTicketInTransaction` that moved into the shared module, and its resolver-subquery
  tenant check matched only `FROM … AS __x WHERE __x.tenant = ??` — R9's matcher (group 6) joins a
  second copy of `categories`, which is correlated but not in that shape, so the check became
  per-alias; `optimizedTicketActions.contactAuthor` asked for the removed ITIL-flag category query;
  and the CSV-import fake query builder in `ticketImport.contactCacheRollback` needed `pluck`, which
  the group-5 ITIL-board lookup uses. Two order-dependent flakes in
  `packages/tickets/src/lib/{ticketListViews,nativeTicketDataSource}.test.ts` fail identically with
  and without this group's changes (vitest shuffles within the file and both tests assert "nothing
  has been called yet" against state that lives on `globalThis`); they are not this card's.
- Run against this slot's database: `itilImpactUrgency` 12/12, `itilBoardFieldRules` 27/27,
  `itilSecondBoardSurfaces` 16 covered + 28 todos, `itilImpactUrgencyContract` 9/9, and all 173 test
  files of `packages/tickets/src/{actions,lib,schemas}` (1465 tests).

### Commit group 8 — `writers-create` (done)

Landed: `prepareTicketCreateFields` / `prepareTicketCreateFieldsOrThrow`,
`translateStandardCategoryPairForBoard` and `BoardFieldRuleError` /
`isBoardFieldRuleError` in the shared module; `ValidationOptions.boardFieldPolicy` and
`TicketModel.applyBoardFieldRules` inside `createTicket`; `boardFieldPolicy` on
`createTicketWithSideEffects`; the policy set at every writer R6 names; the per-row check and
board-default fallback in the CSV import; the Teams default-priority resolver replaced by R7;
priority fall-back and the `item_type` filter in the RMM creator; field resolution in the
Huntress creator; the priority check in `assets.create_maintenance_ticket`; the 400 mapping in
REST create and create-from-asset; `server/src/test/integration/itilCreateWriters.integration.test.ts`
(21 cases), `server/src/test/unit/itilCreateWritersContract.test.ts` (12 cases) and the eleven
`writers-create` surface probes.

- **The rule lives in the funnel, with a policy, and defaults to refusing.** F069 asks for "every
  create that reaches it", so the policy cannot be opt-in: `createTicket` applies the rules
  whenever the input names a board, and `boardFieldPolicy` defaults to `refuse`. Each of the nine
  fall-back writers in R6 passes `'fallback'` explicitly, and the contract test asserts both
  halves — a fall-back writer that loses its policy starts dropping tickets, and a refuse writer
  that gains one starts storing values nobody chose.
- **`BoardFieldRuleError` moved to `shared/`, and is recognised by its `code`.** `TicketModel`
  cannot import `packages/tickets`, so the error class the model raises is the shared one and
  `TicketBoardFieldError` now extends it. `ticketActionErrorFrom` and the client portal and REST
  mappers test `isBoardFieldRuleError(error)` instead of `instanceof`: the same reason the SLA
  hooks move to `globalThis` (two bundles, two classes) applies to an error class crossing the
  same boundary.
- **The translation is part of the create rule, not of each caller.**
  `prepareTicketCreateFields` translates a standard category of another board (R2) *before* it
  checks it, on both policies, so an API caller, a workflow with a fixed category and a Huntress
  mapping all keep working on every ITIL board. A category with no standard link cannot be
  translated: refused on a refuse path, dropped on a fall-back one (T154).
- **The CSV import checks per row, in the pre-resolve pass.** Its old fallback priority was the
  tenant's first row by `order_number`, which is the wrong family on an ITIL board; it is now
  `defaultPriorityForBoard` per destination board (R7), memoised. A row whose values do not fit
  is reported and skipped there, so one bad row never rolls back a batch of 25. The step's "pure
  logic, no DB" comment was updated: it now asks the database once per distinct board.
- **Two assertions in other suites are this group's own doing**, both found by running them:
  `inboundWebhooks/ticketInboundActions.test.ts` pinned the create's `{}` validation options and
  now pins `{ boardFieldPolicy: 'fallback' }`; and `ticketCreatedEventCoverage`'s source scan
  allows 800 characters between `TicketModel.createTicket(` and `silentTicketCreation(` in
  `entityAppliers.ts`, so the policy comment there is one line.
- **Where a writer is tested at the funnel seam rather than end to end.** The nine fall-back
  writers reach the same `createTicket` call with the same policy; standing up a workflow runtime,
  a telephony call record or a renewal cycle adds no coverage of the decision under test, so the
  behaviour runs at the seam and the contract test pins each caller's policy. The two writers with
  no funnel — the RMM and Huntress creators — are driven end to end, because for them the seam is
  the thing that could be missing.
- **Not run here:** `checklistRulePredicates.integration.test.ts` and the suites that pin
  `DB_PORT=5472` through `wireLocalTestDbEnv` (`ticketClientPortalAbac`, `ticketListActivitySort`,
  `ticketListAssigneeSort`). The first fails with `sorry, too many clients already` — the shared
  Postgres sits at 190/200 connections from other worktrees — and the others skip every test
  because port 5472 is closed in this worktree. Both are environment limits, not this group's.
  Everything else named above was run against this slot's database (`test_itil_mc15`).

### Commit group 9 — `writers-update` (done)

Landed: `prepareTicketFieldPatch` in the shared module and `prepareTicketFieldPatchOrThrow` in
`packages/tickets`; both MSP update functions, the REST update, `TicketModel.updateTicket`, both
Activities inline priority writes, both bundle sync write sites and the bulk board move routed
through it; `server/src/test/integration/itilUpdateWriters.integration.test.ts` (17 cases),
`server/src/test/unit/itilUpdateWritersContract.test.ts` (8 cases) and the five `writers-update`
surface probes.

- **`resolveTicketPriorityPatch` became `prepareTicketFieldPatchOrThrow`.** Group 7's patch helper
  covered the priority half; F082 asks for one function over the whole field group, so the helper
  was widened rather than joined by a second one with an overlapping contract. The two group-7
  tests that named it (`itilImpactUrgencyContract`, `optimizedTicketActions.tenantScopedAuth`) and
  the group-7 behaviour suite were updated to the new symbol; the signature is unchanged.
- **A board move clears a category the patch did not name; it does not refuse it.** R5 says a
  check looks at what a change touches, and a move does touch the category — but nobody *chose*
  the old board's category for the new board, so refusing would make a move impossible to perform
  without also picking a category. Between two ITIL boards the category survives as the
  destination's copy of the same standard row (F089). A category the patch itself names is
  refused, because that one the caller chose.
- **The bulk move stopped clearing the category itself.** `moveTicketsToBoard` set
  `category_id: null` on every board change; the rule now decides, so an ITIL→ITIL bulk move keeps
  the category by meaning. `ticketActions.moveToBoard.test.ts` asserted the nulls in the patch and
  now asserts the patch the action really sends, with a pointer to the rule and to T166.
- **The bulk move also reported a refusal as a success.** `updateTicketWithCache` *returns* a field
  error rather than throwing, and the move ignored the result, so a refused ticket landed in
  `movedIds`. It now rethrows it, and `ticketBulkFailureMessage` reports an already-formed action
  error as itself instead of the generic fallback — without that, T164's refusals would all read
  "Failed to move ticket".
- **The Activities inline picker clears the assessment, not only checks the family.** Both writes
  now spread the resolved patch (priority, Impact, Urgency) into the UPDATE, so a direct priority
  change on an assessed ITIL ticket clears the pair there exactly as on the ticket form (D5).
- **Bundle sync writes children in groups.** The legacy mirror built one field set for open
  children and one for closed; it now builds one per child (closed children keep their status,
  children on a board of the other priority family keep their priority) and groups the children
  that end up with the same set into one UPDATE. The boundary path writes two groups for the same
  reason. The published `updatedFields` are diffed against the set each child actually received.
- **`findTicketUpdatePriorityBoardTypeProblem` has no production caller left.** The REST update was
  the last one. It stays exported because `priorityBoardType.integration.test.ts` is the suite that
  proves the PR #3880 behaviour did not change; `cleanup` can take it.
- Run against this slot's database: `itilUpdateWriters` 17/17, `itilUpdateWritersContract` 8/8,
  `itilSecondBoardSurfaces` 32 covered + 12 todos, `itilImpactUrgency` 12/12,
  `itilCreateWriters` 21/21, all 65 files of `packages/tickets/src/actions` (530 tests) and the
  bundle contract suites. Not this group's: five `packages/user-activities` files fail to resolve
  `@alga-psa/core/capability` through `packages/db/src/lib/seatTicketWork.ts` (a package-build
  gap, no file of this card involved), two `src/test/unit/api/*.db.test.ts` files need port 5472,
  and `microsoftEmailSetupCallback.test.ts` has two `warn`-count assertions unrelated to tickets.

### Commit group 10 — `priority-pickers` (done)

Landed: `filterPrioritiesForBoard` / `priorityFitsBoardKind` in
`packages/tickets/src/lib/boardDefaultPriority.ts`, used by Quick Add, ticket detail, the hero,
Boards settings, the CSV import dialog, the surveys trigger form, the service-request editor, the
from-asset dialog and the Huntress screen; the family and the board's kind carried on
`TicketFieldOptions` and both workflow designer pickers narrowing by the fixed board; the
Activities inline picker and the co-managed option search asking by board; the webhook and RMM
lookups restricted to ticket priorities (and the webhook one to the mapped board's family);
`GET /api/v1/tickets/priorities?board_id=` with `itil_priority_level`; mobile asking the API by
board. Tests: the helper's cases in `boardDefaultPriority.test.ts` (T171),
`server/src/test/unit/itilPriorityPickersContract.test.ts` (11 cases),
`server/src/test/integration/itilPriorityPickers.integration.test.ts` (4 cases), the mobile hook's
board cases, and nine surface probes.

- **One client helper, and a scan that keeps it the only one.** T183 walks every `.tsx` under
  `packages`, `server/src` and `ee` and fails on a component that filters a priority list by
  `is_from_itil_standard` itself. That is what stops the six copies from growing back; the helper
  also takes the `{ value, label, is_from_itil_standard }` option shape the ticket screens hold,
  not only a priority row.
- **The workflow designer narrows in the filter, not in the loader.** The second copy
  (`ee/packages/workflows`) receives its data through injected actions and cannot call a server
  action of its own, so adding a board-scoped lister there would have meant a new injected
  dependency in every host. Both copies instead narrow `ticket-priority` in
  `filterWorkflowPickerOptions`, which now also takes the loaded data so it can read the fixed
  board's `priority_type`. The payload carries both halves: `TicketFieldOptions.boards` gained
  `priority_type` and its `priorities` gained `is_from_itil_standard`.
- **Only the create-side actions declare the board dependency.** `tickets.create` and
  `assets.create_maintenance_ticket` now say `['board_id']` on their priority picker.
  `tickets.update_fields` has no board input — its board comes from the ticket — and declaring
  `['ticket_id']` there would render an unresolved-dependency hint instead of a list, so it was
  left alone and its priority list stays the tenant's whole ticket set.
- **The CSV dialog maps per row, not per default board.** A mapping is per priority *name*, and a
  name can appear on rows of several boards, so the dialog collects the board kinds of the rows
  that use each name: one kind offers that family, two kinds offer nothing (no single priority
  fits both) and "Create new" is refused as soon as one of them is ITIL.
- **The service-request editor's own `getDefaultPriorityId` is gone**; it imports the shared one.
  Its priority select also used to list every ticket priority on a board with the tenant's own
  priorities, which is the bug T176 names.
- **Mobile keeps its old heuristic as the fallback.** With a board id the server answers with the
  board's list (the new `board_id` parameter) and the hook shows it as it came; without one — an
  older screen, a cached payload — it still narrows by the current priority's family. The cache
  key gained the board so one board's list cannot be served to another.
- **`DB` note:** the mobile suite cannot run in this worktree (`ee/mobile/node_modules` is not
  installed, so `expo/tsconfig.base/tsconfig.json` is missing and all 17 files fail to transform);
  its two new cases are written and will run where mobile dependencies are installed. The
  `packages/integrations` typecheck needs `NODE_OPTIONS=--max-old-space-size=8192` on this machine.
- Run against this slot's database: `itilPriorityPickers` 4/4, `itilSecondBoardSurfaces` 41
  covered + 3 todos (only `board-lifecycle`, `board-type-switch` and `sla` are left),
  `itilPriorityPickersContract` 11/11, `boardDefaultPriority` 14/14, the 13
  `packages/tickets/src/components/__tests__` files, `packages/surveys` 10/10 and
  `packages/co-managed` 588/588. One group-7 contract assertion was reconciled: it named
  `error instanceof TicketBoardFieldError`, which `writers-create` replaced with
  `isBoardFieldRuleError(error)`.

### Round 3 housekeeping

- **The eight `inboundTicketDefaultsActions.location.test.ts` failures were this card's**, from the
  `email-hotfix` save check (R3): the file's fake knex served `inbound_ticket_defaults`, `statuses`
  and `client_locations` only, so `findBoardFieldProblems` found no board and no priority and every
  case came back "the selected priority no longer exists". The fixture now owns a board and a
  priority of the tenant's own family — the fitting pair — and all nine cases assert what they
  asserted before. The `Cannot convert undefined or null to object` throw went with it: it was the
  same missing rows, not a defect in the action for an update that touches neither client nor
  location.
- **The round-2 WIP stash was dropped, not applied.** `stash@{0}` held the code half of
  `category-rules`, which `cd2edeb245` then landed in full (the stash's `boardFieldRules.ts`,
  `itilStandardsService.ts` and `ticketCategoryActions.ts` are strictly older than HEAD's). Applying
  it would have reverted the finished group. No stash of this card's is left.

### Groups not started

Commit groups 11–16 (`board-lifecycle` through `docs`) are untouched: their features and tests are
still `implemented: false` and their surface rows are still expected-fail. Groups 4, 5 and 6 reach
production together (see Rollout) and are all on this branch.

## Commands

```bash
npm run build:shared
npx nx build tickets
cd server && npm run test:unit
cd server && npm run test:integration -- priorityBoardType itilBoardDeletionCleanup
grep -rn "LEVERAGE:" shared/lib/sla packages/sla/src
```
