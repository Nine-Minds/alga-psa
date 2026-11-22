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

## Commands

```bash
npm run build:shared
npx nx build tickets
cd server && npm run test:unit
cd server && npm run test:integration -- priorityBoardType itilBoardDeletionCleanup
grep -rn "LEVERAGE:" shared/lib/sla packages/sla/src
```
