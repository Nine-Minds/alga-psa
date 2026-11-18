# Client picker perf F: remaining full-list client callers use the async picker

- Card: `ba0e64ae-b971-422e-b582-b8a99a75e3f7` (PSA ticket alga-2026-0002752, Tom's Help Desk)
- Branch: `feature/client-picker-perf-f-remaining-full-list-client-2`
- Stacked on card C (async `ClientPicker` + `searchClientsForPicker`), merged to main at `f69de98c5f`
- Status: design of record for the implementation steps. This is a restart: the two previous drafts of this
  card (branch `...-client`, ten local-only commits) are gone, so nothing from them is reused.

## Problem

A tenant with about 5,000 clients reports that client dropdowns "grind the browser to a halt". Card C
built the async picker: `AsyncClientPicker` (`packages/ui/src/components/AsyncClientPicker.tsx`) searches
and pages on the server through `searchClientsForPicker`
(`packages/clients/src/actions/clientPickerActions.ts`), and `ClientPicker` delegates to it. Cards D and E
moved the ticket, contacts, billing, projects, assets and time-entry surfaces onto it.

What remains is the long tail listed on the card: documents, interactions, merge and recurring-client
dialogs, ticket templates and imports, user-activity filters, the inventory/SLA/opportunities server pages,
settings screens, and the EE integration mapping screens. Each still loads the whole tenant client table
(often with logos) and hands it to a picker.

## Why the screens are still slow: the `clients` prop, not the picker

`ClientPicker` takes the async path only when `searchClients` is set **or** `clients` is undefined
(`ClientPicker.tsx:123`). A caller that fetches every client and passes `clients={rows}` keeps the old
synchronous path *and* the full fetch that builds it. So the unit of work is the call site, not the
component: delete the fetch, stop passing `clients`, and let the provider-supplied searcher drive the
picker.

## Decisions (later steps must honour these)

**D1. The searcher is injected through context; feature packages never import `@alga-psa/clients`.**
`ClientPickerSearchContext` + `MspClientTagsProvider` already supply `searchClientsForPicker` at both MSP
shells. The previous attempt died on an NX cycle
(`server:build-deps -> integrations -> ee-threecx -> telephony -> clients -> portal-shared -> users -> tickets -> clients`)
caused by importing `@alga-psa/clients` from `packages/tickets`; `custom-rules/no-feature-to-feature-imports`
forbids it as well. Any screen in `tickets`, `documents`, `user-activities`, `inventory`, `projects`,
`opportunities` or the EE integrations reaches the picker through the context provider, or receives the
search function as a prop from the MSP shell. No new feature-to-feature import is added anywhere.

**D2. A full client list is acceptable only where the screen is an export or a report, and it stays
server-side.** The two known legitimate cases are the Clients page export path (`Clients.tsx:1237/1243`)
and `server/src/app/api/clients/route.ts` if it is still a bulk export. They are named in the PR body and
in the contract-test allowlist; everything else loses the fetch.

**D3. Selected values are resolved by id, never by searching the loaded list.**
`AsyncClientPicker` already accepts `ids` (seeded from the server) and `excludeIds`. Where a screen needs
more than a name for a client that may be off-page (currency, region, logo, inactive flag), fetch that one
client by id — do not preload the tenant to find it. Add a single tenant-scoped, permission-checked
`getClientsByIds(ids: string[])` to `packages/clients/src/actions` **if** no equivalent exists (check
`clientLookupActions` first; do not add a second one).

**D4. Documents use the generic paged entity search.**
`AssociatedEntityPicker` already pages every other entity type through
`searchDocumentAssociationEntities(type, search, page, limit)` in its `loadOptions`. Route `client` through
that same path and delete the `getDocumentAssociationClientsForPicker` effect (`AssociatedEntityPicker.tsx:123-151`)
together with the `clients` state that only fed `clients={clients}` at line 219. Keep one by-id lookup so an
already-associated client still renders.

**D5. Mapping screens search per row; they do not preload the tenant.**
The EE integration settings and mapping managers (Huntress, Entra, Hudu, Tanium, Level, NinjaOne, Datto,
UniFi) legitimately display many mapped rows. Each row's client selector is an async picker with
`ids={[mappedClientId]}`; a mapping table that needs client names resolves its mapped ids in one bounded
`getClientsByIds` call, sized by the mapping set, not by the tenant.

**D6. Server components do not fetch the tenant to feed a client picker.**
For the inventory, SLA and opportunities pages the picker moves behind a small `'use client'` component
that the MSP shell's `ClientPickerSearchProvider` already covers. The RSC stops calling `getAllClients` at
all. `CreateOpportunityRouteClient` and `loadMspInteractionsPageData` are ordinary client code and lose
their `getAllClients` calls the same way.

## Work groups (implement in this order)

1. **F1 — Documents.** `packages/documents/src/components/AssociatedEntityPicker.tsx` (D4) and the removal
   of `getDocumentAssociationClientsForPicker` from `documentActions.ts` if no other caller remains.
   Smallest, self-contained, proves the pattern.
2. **F2 — Interactions and client dialogs.** `QuickAddInteraction.tsx:368`, `InteractionDetails.tsx:209`,
   `MergeClientsDialog.tsx:134`, `ClientDetails.tsx:750`, `OverallInteractionsFeed.tsx`. These live in
   `packages/clients` and may import the searcher directly, but prefer the same context path so one shape
   is used everywhere.
3. **F3 — Tickets.** `AddRecurringClientsDialog.tsx` (already server-searched on this branch: picker at
   line 96, selected name resolved by id via `searchClientsForPicker({ ids })` at line 60; verify only),
   `TicketTemplatesPage.tsx:73`, `TicketTemplateEditor.tsx:351`, `loadMspInteractionsPageData.ts:10`, and
   the client lookups behind `TicketBentoLayout` / `TicketProperties` (the `getAllClients` member of the
   ticket data source: `ticketDataSource.ts:499`, `nativeTicketDataSource.ts:145`,
   `server/src/lib/co-managed/sharedTicketDataSource.ts:217`). `TicketImportDialog` already passes
   `searchClientsForPicker` and is the reference implementation. Watch the NX cycle (D1) — this group is
   where the last attempt died.
4. **F4 — User activities.** `useActivityFilterOptions.ts:68` and `ActivitiesTableFilters.tsx:686`; the
   filter needs the selected clients' names, so resolve them by id (D3) rather than by holding the list.
5. **F5 — Server pages.** `server/src/app/msp/inventory/{units,loaners,sales-orders}/page.tsx`,
   `server/src/app/msp/settings/sla/page.tsx`, `server/src/app/msp/opportunities/page.tsx`,
   `CreateOpportunityRouteClient.tsx` (D6).
6. **F6 — Settings and EE integrations.** `UserManagement.tsx:448`, `GeneralSettings.tsx:189`, the EE
   integration settings components and mapping managers, `EntraReconciliationQueue.tsx`,
   `EntraTenantMappingTable.tsx` (D5).

Each group ends with: the fetch removed, the picker driven by server search, a focused test where one
already exists (update it), `tsc` clean for the touched packages, and a note on the card when a screen keeps
a full-list load for a D2 reason.

## Verification

- **Contract test** (new, `packages/ui/src/components/clientPicker.fullList.contract.test.tsx` or a
  repo-level vitest in `packages/ui`): scan `packages/*/src`, `server/src` and `ee/server/src` for files that
  both reference a full-list client action (`getAllClients(`, `getSchedulingClients(`,
  `getDocumentAssociationClientsForPicker(`) and render `ClientPicker` / `AsyncClientPicker`; fail on hits
  outside an explicit allowlist holding only the D2 sites. This is what makes the card's "grep shows no
  full-tenant client list feeding a picker" done-condition mechanical instead of a promise.
- Existing suites for the touched packages; `npx tsc --noEmit` for the touched packages and `server`.
- Manual smoke with the canonical test login: open each touched dialog, type two characters, confirm the
  request is paged and the selected client still renders from `ids`.

## Out of scope

- No new caching layer, no changes to the Clients list page (already paginated), no change to
  `searchClientsForPicker`'s contract beyond the by-ids helper in D3.
- No retirement of the synchronous `ClientPicker` path in this card; D2 keeps it alive for exports. If it
  ends with zero callers, the removal is a follow-up, not part of F.

## Risks

- **NX cycle / feature-to-feature import** — the failure that lost the first two drafts. D1 is the guard;
  the contract test plus `nx run server:build-deps` in the checks catch it early.
- **Silent fallback to the sync path** when a caller passes both `clients` and a searcher. Removing the prop
  is part of each group's definition of done; the contract test covers new regressions.
- **Long mapping tables** — a row-level async picker is heavier than one list; for a mapping over a few
  hundred rows, render the picker on demand (row edit) rather than for every row.
