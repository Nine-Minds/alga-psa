# Plan: add tickets to a bundle by search in the Bundle dialog

Card: "Bundling search tickets" (212aa7f5-452a-45b2-b185-422953c19aac)
Branch: `feature/bundling-search-tickets`, worktree `/home/robert/alga-copies/feature-bundling-search-tickets`

## Goal

Today the only way to choose which tickets go into a bundle from the ticket list is to tick their checkboxes. The Bundle dialog then only asks which ticket is the master and never lists the member tickets. After this change, users can search for tickets inside the Bundle dialog and add them to the bundle, and remove tickets from it. Checkbox selection keeps working and seeds the dialog.

## Current state (what the code does now)

| Concern | Location |
|---|---|
| Bundle dialog state (11 `useState`s) | `packages/tickets/src/components/TicketingDashboard.tsx:393-402` |
| Selected rows → details (`tickets` + `smartSearchRows` only) | `TicketingDashboard.tsx:1371-1384` (`buildSelectedTicketDetails`, `isSelectedBundleMultiClient`) |
| Existing-master lookup effect (keyed on `selectedTicketIdsArray`) | `TicketingDashboard.tsx:1783-1835` |
| Closed-master context effect | `TicketingDashboard.tsx:1837-1880` |
| `performBundleTickets` / `handleConfirmBundleTickets` | `TicketingDashboard.tsx:1882-1952` |
| Multi-client confirm dialog | `TicketingDashboard.tsx:2926-2939` |
| Dialog JSX (only a master `CustomSelect`, sync checkbox, closed-master fields) | `TicketingDashboard.tsx:3157-3296` |
| Dialog only opens with `selectedTicketIds.size >= 2` | `TicketingDashboard.tsx:3198` |
| Bulk bar `onBundle` seeds master = first selected id | `TicketingDashboard.tsx:3316-3322` |
| Bundle button disabled below 2 selected | `packages/tickets/src/components/BulkTicketActionBar.tsx:63,80-83` |
| Server bundle action (no board or status restriction on children; rejects children already in a bundle and children that are masters of another bundle) | `packages/tickets/src/actions/ticketBundleActions.ts:227-292`, `ticketBundleUtils.ts:663+` |
| Board-scoped child search used on ticket details (open, unbundled, same board only; **no per-ticket read authorization**) | `ticketBundleActions.ts:667-741`, UI in `ticket/TicketDetails.tsx:3236-3330, ~3470` |
| Authorized, search-index-backed list query | `optimizedTicketActions.ts:3726` `fetchTicketsWithPagination`, `:2277` `loadTicketListItemsByIds` |
| Async search combobox primitive | `packages/ui/src/components/AsyncSearchableSelect.tsx` |

Another problem: tickets picked with "select all matching" that aren't on the current page never appear in `selectedTicketDetails`, so the master picker cannot offer them. The dialog rework fixes this as a side effect (see step 3).

## Design decisions

1. **Search backend: reuse `fetchTicketsWithPagination`, not `searchEligibleChildTicketsAction`.**
   - Bulk bundling has no same-board or open-only rule, so the board-scoped search's policy doesn't fit here.
   - `fetchTicketsWithPagination` already applies ticket read authorization (`applyTicketReadAuthorizationSql` / `filterAuthorizedTickets`) and uses the same search the list uses (ticket number, title, search index). Results match what the user would find in the list, and the search can't return tickets the user isn't allowed to see. The existing child search skips per-ticket authorization, so it must not be widened to the whole tenant.
   - Its rows are `ITicketListItem`, which is what `buildSelectedTicketDetails` already accepts. Search results can go straight in as another row source, with no new DTO or mapping.
   - Call it with `{ searchQuery, bundleView: 'individual', boardFilterState: 'all', showOpenOnly: false }`, page 1, limit 10. `individual` returns bundled children as their own rows, so the dialog can show them as not addable. It doesn't replace them with their master.

2. **The dialog keeps its own set of member tickets, separate from the list selection.** When the dialog opens, the set is copied from `selectedTicketIds`. Search adds to it and the remove button takes tickets out. Cancel discards the set and leaves the list selection alone. A successful bundle clears both, as it does today. The master lookup, closed-master context, multi-client warning, and submit all read from this set instead of `selectedTicketIdsArray`.

3. **Extract the dialog into its own component.** Create `packages/tickets/src/components/BulkBundleDialog.tsx` to own the dialog state, the effects at 1783-1880, `performBundleTickets`, the multi-client confirm, and the JSX at 3157-3296. `TicketingDashboard.tsx` is 3,353 lines and this feature would make it bigger, while the dialog needs almost nothing from the dashboard:
   - Props: `id`, `isOpen`, `onClose`, `initialTicketIds: string[]`, `knownRows: ITicketListItem[][]` (the dashboard's `[tickets, smartSearchRows]`), `onBundled()` (dashboard runs `clearSelection(); onFilterChange({})`).
   - On open, the dialog resolves any ids in `initialTicketIds` that aren't in `knownRows` using `loadTicketListItemsByIds` (already authorized and batched). This fixes the off-page gap.
   - Keep the automation ids unchanged (`${id}-bundle-dialog`, `${id}-bundle-master-select`, `${id}-bundle-confirm`, `${id}-bundle-cancel`, `${id}-bundle-sync-updates`). The Playwright tests at `ee/server/src/__tests__/integration/ticket-bundling.playwright.test.ts:291-297,417-423` depend on them. To do this, pass the dashboard's `id` through and build ids the same way.

4. **Allow opening the dialog with one selected ticket.** One selected ticket plus search is the main case for this feature. Change `bundleEnabled` to `count >= 1` in `BulkTicketActionBar.tsx:63` and change its title key, and remove the `>= 2` gate at `TicketingDashboard.tsx:3198`. The confirm button stays disabled until the set has at least 2 tickets. Opening from 0 selected (a toolbar button) is out of scope.

5. **Dialog layout, top to bottom:**
   - Existing alerts: error, existing-master lock, cross-client warning (the warning now reads from the member set).
   - **"Tickets in this bundle"**: an `AsyncSearchableSelect` search box (`id=${id}-bundle-add-ticket-search`, overlay mode, `portalContainer` set to the dialog so it isn't clipped). Picking a result adds it to the set and clears the input. `value` stays `''`, so the control works as an "add" picker.
   - Each search result shows `ticket_number – title · client_name`, plus a badge when it can't be added:
     - already in the set → "Added", not selectable
     - `master_ticket_id != null` → "In bundle {{bundle_master_ticket_number}}", not selectable (the server would reject it with `already_bundled`)
     - `bundle_child_count > 0` → "Bundle master" badge, selectable. The existing master-status effect then locks it as the master or blocks the bundle when there are 2 or more masters, as today.
     - closed → status badge only, selectable, since the server accepts closed children.
   - `AsyncSearchableSelect` has no per-option `disabled`. Add an optional `disabled?: boolean` to its `SelectOption` (`AsyncSearchableSelect.tsx:13-20`) and honour it in the `Command.Item` render/select path. This is a small general improvement to the primitive. Don't filter the tickets out, because the user needs to see why a ticket they searched for can't be added.
   - Member list (`ul`, `id=${id}-bundle-members`): one row per ticket showing `ticket_number`, title, client, a "Master" tag on the current master, and a remove button (`${id}-bundle-member-remove-${ticket_id}`). Removing the current master resets the master to the first remaining ticket, unless an existing master is locked. An existing bundle master can be removed, which clears the lock.
   - The existing master `CustomSelect`, with options from the member set.
   - The sync checkbox, help text, and closed-master fields, unchanged.
   - Validation copy: the confirm button is disabled with fewer than 2 members. Also show the hint "Add at least one more ticket to bundle."

6. **Effect keys.** The master-status effect (currently 1786-1833) must depend on a stable, sorted-joined key of the member ids so it refetches only when the set changes. Guard it with a cancellation or sequence ref, as the current code does. Otherwise quick adds can apply out of order.

## Order of work

1. `AsyncSearchableSelect`: optional `disabled` on `SelectOption`, skipped by `onSelect` and styled muted. Add a unit test next to `SearchableSelect.escape.test.tsx`.
2. Create `BulkBundleDialog.tsx` by moving the existing behaviour over unchanged, keyed on `initialTicketIds`. Wire it into `TicketingDashboard.tsx` and delete the moved state, effects, and JSX (393-402, 1378-1384 bundle use, 1783-1952, 2926-2939, 3157-3296, and the `onBundle` body at 3316-3322). `isSelectedBundleMultiClient` moves into the dialog. Check that nothing else reads it: `grep` before deleting. Run the existing tests. This step should change no behaviour.
3. Add the member set and the off-page resolution through `loadTicketListItemsByIds`.
4. Add the search picker (`fetchTicketsWithPagination`) and the result badges and disabled rules.
5. Add the member list with remove and the master reassignment rules.
6. Enable Bundle at 1 selected (`BulkTicketActionBar.tsx`) and remove the dashboard gate.
7. i18n: add the new keys under `bulk.bundle.*` in `server/public/locales/en/features/tickets.json`. Mirror them in de/es/fr/it/nl/pl/pt, and generate the `xx`/`yy` pseudo-locale entries the way the repo does. Keys: `membersLabel`, `addTicketSearchPlaceholder`, `addTicketEmpty`, `badgeAdded`, `badgeInBundle`, `badgeMaster`, `masterTag`, `removeMember`, `needMoreTickets`, and the new action-bar title `bulk.actionBar.bundleNeedsOne`.
8. Tests (see Verification), then a manual pass in the browser in light and dark themes (per `docs/AI_coding_standards.md:51`).

## Out of scope

- Changing the ticket-details "Add to bundle" search (`TicketDetails.tsx`) or `searchEligibleChildTicketsAction`. That flow is board-scoped on purpose. The authorization gap in `searchEligibleChildTicketsAction` (no per-ticket read check) should be recorded as a separate follow-up. It shouldn't be fixed silently here.
- Opening the Bundle dialog with nothing selected.
- Adding tickets to an existing bundle from the list without the dialog, and any server, API (`/api/v1/tickets/[id]/bundle`), or schema changes. `bundleTicketsAction` already accepts any child ids.
- Changing how the list checkbox selection behaves.

## Risks and gotchas

- **The overlay gets clipped inside `Dialog`.** Use `dropdownMode="overlay"` with `portalContainer` set to the dialog content element. Check that it scrolls and isn't cut off in a short viewport.
- **Search cost.** `fetchTicketsWithPagination` also runs count and enrichment queries. With a 300 ms debounce and a limit of 10 that's acceptable. If it's slow, add a `skipTotal`-style option or a lean projection later. Don't fork the query.
- **Stale responses.** `AsyncSearchableSelect` owns its debounce. Confirm it discards out-of-order responses. If it doesn't, fix that in the primitive, not in the dialog.
- **Existing-master semantics.** Adding a ticket that is already a master through search has to go through the same lock and block logic. It will, as long as the effect is keyed on the member set.
- **Multi-client confirmation** must use the member set's clients, including tickets added by search and tickets resolved off-page.
- **Moving code during extraction.** Step 2 is a straight move. Land it as its own commit so reviewers can diff it separately from the feature.
- **Mocked tests.** Tests that mock `../actions/optimizedTicketActions` (for example `TicketingDashboardContainer.urlSync.contract.test.tsx:45`) may need `loadTicketListItemsByIds` in their mock factory.

## Verification

- **Unit (vitest, `packages/tickets`)**: a new `BulkBundleDialog.test.tsx` with mocked actions, covering:
  - The dialog is seeded from `initialTicketIds`, and off-page ids are resolved through `loadTicketListItemsByIds`.
  - A search result can be added. Already-added and already-bundled results are shown but can't be selected. A master result adds with the "Bundle master" badge, and the master select then locks to it.
  - Remove works, and removing the master reassigns it.
  - Confirm is disabled with fewer than 2 members, and submitting calls `bundleTicketsAction` with the right `masterTicketId` and `childTicketIds` (members minus the master).
  - Cancel doesn't call `onBundled` and doesn't change the list selection.
  - The multi-client confirm appears when a ticket added by search brings in a second client.
- **Unit (`packages/ui`)**: disabled options in `AsyncSearchableSelect` can't be selected by click or Enter.
- **Playwright**: the existing `ticket-bundling.playwright.test.ts` must still pass unchanged. Add a case: select 1 ticket, open Bundle, search a second ticket by number, add it, bundle, then check that the list shows the master with a child count of 1.
- **Manual (dev server on port 3409)**, at `/msp/tickets`:
  - Select one ticket, click Bundle, search by number and by title, add two tickets, remove one, change the master, and bundle. Check the grouping in Bundled view.
  - Repeat with a search result that is a child of another bundle (not selectable, with a badge), with a closed master (closed-master fields appear), and with a second client (confirm appears).
  - Check the pseudo-locale `xx` shows no hardcoded strings, and check dark mode.
- `npm run lint` and type-check for `packages/tickets` and `packages/ui`.
