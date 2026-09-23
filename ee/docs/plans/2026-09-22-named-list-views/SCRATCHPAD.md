# Scratchpad — Named List Views

- Plan slug: `named-list-views`
- Created: `2026-09-22`
- Card: "Names views" — save list configurations as named views that can be private or shared

## Decisions

- **(2026-09-22) A generic layer, not a ticket-only feature.** The design is one `list_views` table, one set of actions, one `ListViewPicker` and a per-list `ListViewAdapter`. Tickets already have capture, sanitize and diff helpers. Four other lists have none. Building a ticket-only version would force a second implementation later.
- **(2026-09-22) Two visibilities in v1: `private` and `shared`.** Shared means every MSP user with the list's read permission. `visibility` is a text column with a check constraint, so team or role scoping can be added without a type change. Whether team scoping is needed at launch is an open question in the PRD.
- **(2026-09-22) Named views sit on top of the ticket board and tenant defaults.** They don't replace them. Board defaults stay admin-authored and act as the baseline. Unlike board defaults, a named view captures board scope, because "Unassigned in Service Desk" is a board-scoped view.
- **(2026-09-22) The personal default lives in `user_preferences`,** under `listViews.default.<list_key>`. It is written only through the new actions, which always use the session user.
- **(2026-09-22) New permissions `list_view:share` and `list_view:manage`.** Board defaults use `ticket_settings:update`, but that permission is ticket-specific, and sharing a Contacts view shouldn't depend on a ticket setting.
- **(2026-09-22) Stale references are dropped when a view is applied,** and a toast reports them. The stored document is never rewritten silently.

- **(2026-09-22, draft implementation) The open questions were settled on the PRD's stated assumptions,** because nobody was available to confirm scope: (1) only private and shared; (2) all five lists adopt; (3) `?view=<id>` alone for the non-ticket lists, with no new URL filter mirroring; (4) see the next entry; (5) `list_view:share` to Admin, Manager and Dispatcher in PSA and Admin in AlgaDesk, `list_view:manage` to Admin; (6) no admin-assigned list defaults.
- **(2026-09-22) Package home: a new source-transpiled package, `@alga-psa/list-views`** (`packages/list-views`). It holds the registry and strict zod schemas (`src/lib`), the model and server actions (`src/models`, `src/actions`), the `useListViews` hook and the `ListViewPicker` UI. The domain packages (tickets, projects, clients, assets) depend on it and own their client adapters, so there is no dependency cycle. The server-side filter schemas live in list-views rather than in each domain package, because the actions must validate without importing the domain packages.
- **(2026-09-22) Migrations:** `20260922120000_create_list_views.cjs` and `20260922120100_add_list_view_permissions.cjs`, which calls reconcileAllTenants.
- **(2026-09-22) The adapter contract is split in two.** The client `ListViewAdapter` (capture, apply, sanitize, differs) is in `packages/types`. The server `ListViewDefinition` (read permission, strict schema, schemaVersion, migrate) is in the list-views registry. `packages/types` has no zod dependency, so a schema cannot live on the client type.

- **(2026-09-22) Deviations in the draft.** Each is deliberate, and a reviewer can reverse it:
  - **Row actions are inline icon buttons,** revealed on hover or focus, rather than a nested `⋯` menu. The picker is a Popover rather than a DropdownMenu, because Radix menu typeahead fights a search box inside the menu.
  - **`tagsInlineUnderTitle` is not stored in a named ticket view.** The strict envelope has no place for it, so it keeps the board/tenant baseline.
  - **Column visibility and order are captured only where the list lets the user choose them:** Tickets (View menu) and Assets (column chooser). Projects, Clients and Contacts have no column chooser, and adding one is out of scope. Their views capture filters, sort, widths and page size.
  - **On Tickets, `?view=` wins over URL filter params in the same link.** Explicit filter params only stop the *personal default* from applying.
  - **Applying a view clears the search text** on every list, because search is never part of a view.
  - **"Default view" on Tickets returns to the current board tab's default,** and keeps board scope. It does not jump back to All tickets.
  - **Column widths:** DataTable's controlled widths are mirrored into the remembered (localStorage) widths. Returning to the baseline therefore keeps the widths on screen rather than resetting them.
- **(2026-09-22) createTableListViewAdapter** (list-views) was extracted once Projects, Clients, Contacts and Assets all proved to share one adapter shape. Tickets keeps a hand-written adapter, because it layers over board defaults.
- **(2026-09-22) Manual smoke on :3768 (users namedviews.smoke.a/b@emeraldcity.oz):**
  - On Tickets: saved a private view, moved to a board tab (the dirty dot appeared), saved changes (the dot cleared), and reloaded `?view=<id>` (the board tab and the name were restored).
  - Saved a shared view.
  - Opened A's private link as user B: it fell back to Default view and the param was removed, and B saw only the shared view, with its owner's name.
  - The pickers render on Projects, Clients, Contacts and Assets.
  - The Playwright E2E tests T013 and T014 were **not** written.
- **(2026-09-23) Deploy fix: `?view=` is now written with `replaceState(null, …)`.** Passing `window.history.state` (Next's `__NA`) made the router re-canonicalise the URL and drop `view=`; the fix is in `writeViewParam` (`packages/list-views/src/hooks/useListViews.ts`), with four Next-state regression tests in `useListViews.test.tsx`.

## Discoveries / constraints

- **Ticket view prior art:** `packages/tickets/src/lib/ticketViewSettings.ts`.
  - `captureTicketViewSettings` (~L147) and `CAPTURE_EXCLUDED_FILTER_KEYS` (L66-72: boardId, boardIds, excludeBoardIds, boardFilterState, searchQuery).
  - `sanitizeStoredTicketView` (~L198), `validateCapturedFilters` (~L273) and `ticketViewDiffersFromSaved` (~L362).
  - The resolver replaces whole groups; it doesn't merge key by key.
- **Ticket defaults storage:**
  - `boards.list_view_settings` JSONB, added by migration `20260819120000_add_board_pinning_and_list_view_settings.cjs`.
  - `tenant_settings.ticket_display_settings.list`.
  - Actions: `packages/tickets/src/actions/board-actions/boardActions.ts:1063-1100` and `packages/tickets/src/actions/ticketDisplaySettings.ts`.
  - UI: `TicketViewMenu.tsx`, rendered at `TicketingDashboard.tsx` ~L2516, with save at L756-780.
- **Ticket live state is in the URL.** Parsing is `parseTicketListStateFromSearch` (`TicketingDashboardContainer.tsx:81`) and writing is `updateURLWithFilters` (~L320).
- **`ITicketListFilters`** is in `packages/types/src/interfaces/ticket.interfaces.ts:116-144`.
- **DataTable** (`packages/ui/src/components/DataTable.tsx`):
  - There is no column visibility prop; auto-fit computes it (`dataTableColumnFit.ts`).
  - There is no column order prop.
  - Column sizing is kept only in localStorage `datatable-column-sizing:<id>` (L359-392).
  - Sorting can be controlled (`manualSorting`, `sortBy`, `sortDirection`, `onSortChange`).
  - Controlled sizing, visibility and order all need adding (F015-F017).
- **Where the other lists keep their state:**
  - Projects: `packages/projects/src/components/Projects.tsx`, with `ProjectListFilters` state at L186, seeded from the URL in `server/src/app/msp/projects/page.tsx:74`.
  - Clients: `packages/clients/src/components/clients/Clients.tsx`, `useState` at L464-486.
  - Contacts: `packages/clients/src/components/contacts/Contacts.tsx`, `useState` at L101.
  - Assets: `packages/assets/src/components/AssetDashboardClient.tsx`, `useState` at L155-168, with `visibleColumnIds`.
- **`user_preferences`:** PK `(tenant, user_id, setting_name)`. The model is `packages/db/src/models/userPreferences.ts`.
  - **Security gap, out of scope here:** `getUserPreference` and `setUserPreference` in `packages/user-composition/src/actions/userQueryActions.ts` (L394, L453) accept any `userId` without checking it against the caller. This should be fixed separately. The new list-view actions must not route through them.
  - Values are stored double-encoded (`JSON.stringify` into JSONB).
- **Visibility prior art elsewhere:** `schedule_entries.is_private` is enforced in `scheduleActions.ts:171`. Service requests use a `visibility_provider` plus `visibility_config` pair. Nothing generic exists.
- **Citus conventions for the new table:**
  - Composite PK `(tenant, view_id)`.
  - `ensureTenantDistribution(knex, 'list_views')` from `server/migrations/utils/citusDistribution.cjs`.
  - `exports.config = { transaction: false }`.
  - FKs added with `DO $$ IF NOT EXISTS`.
  - Include `tenant` in unique indexes.
  - No `ON DELETE SET NULL`, so owner cleanup happens in the app.
  - Reference migration: `20260913120000_create_external_entity_links.cjs`.
- **Permissions:** add them to `server/migrations/utils/permissions/catalog.cjs`. `reconcileAllTenants` then applies the grants.
- **i18n:** locale files are `server/public/locales/<lng>/common.json`. Validate with `node scripts/validate-translations.cjs`.

## Commands / runbooks

- **Applying migrations to the shared dev DB:** `knex migrate:latest` fails with "migration directory is corrupt", because other branches' migrations are recorded in the same DB. Instead, require the migration file, call `up(knex)`, and insert a `knex_migrations` row. Use postgres directly on port 5472 with the credentials in `server/.env.local`.

- Validate the plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-22-named-list-views`
- New migration: `cd server && npx knex migrate:make create_list_views --env migration`
- Rebuild prebuilt packages after editing them (types, ui, …): `npx tsup` in the package directory.
- Dev server for this card: port 3768; compose project `alga-psa-local-test`.

## Links / references

- `docs/AI_coding_standards.md`: `withAuth` actions, `tenantDb`, Dialog and DataTable rules, `id` requirements, i18n (L764-879).
- `docs/architecture/citus-migration-best-practices.md`
- `docs/architecture/tenant-isolation.md`
- `docs/architecture/i18n.md`

## Open questions

See the PRD "Open questions" section: team-scoped sharing, the adopter set and phasing, URL state for non-ticket lists, the package home, default share grants, and admin-assigned list defaults.
