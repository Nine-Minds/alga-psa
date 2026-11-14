# Client picker perf E: contacts, billing, projects, assets and time entry use the async picker

- Card: c9e51a64-09e7-4a88-a66e-9b0774d8d8bf (PSA ticket alga-2026-0002756, Tom's Help Desk)
- Branch: `feature/client-picker-perf-e-contacts-billing-projects-a`
- Stacked on card C (async `ClientPicker` + `searchClientsForPicker`), which is merged to `main` (#3784, f69de98c5f)
- Status: design of record for the implementation steps

## Problem

A tenant with about 5,000 clients reports that client dropdowns freeze the browser and reload everything on every open. Card C added a server-searched, paged picker: `AsyncClientPicker`, which `ClientPicker` uses when `searchClients` is passed, backed by `searchClientsForPicker` in `packages/clients/src/actions/clientPickerActions.ts`.

The screens in this card still fetch the whole client table, with logos, and pass it to the picker. Many also use that list for something other than the picker:

- name lookups
- logo maps for table columns
- currency and region of the selected client
- saved-view sanitising
- an N+1 report loop

Swapping the picker prop alone would therefore not remove the fetch on any of these screens.

## Constraint that shapes the design

Billing, projects, assets and scheduling are vertical feature packages. The `custom-rules/no-feature-to-feature-imports` lint rule (`eslint-plugin-custom-rules/no-feature-to-feature-imports.js`) forbids them from importing `@alga-psa/clients`. Billing already works around this on purpose; see the headers of `billingClientLocationActions.ts` and `contractSimulationActions.ts`. So these packages cannot import `searchClientsForPicker` directly.

The picker already solves the same problem for tags. `packages/ui/src/context/ClientTagsContext.tsx` declares the capability, and `packages/msp-composition/src/clients/MspClientTagsProvider.tsx` supplies it at the MSP shell (`DefaultLayout`, `AlgaDeskMspShell`). The search function should be delivered the same way.

## Decisions (later steps must honour these)

**D1. The search function is injected through context, not imported by feature packages.**
- Add `ClientPickerSearchContext` in `packages/ui/src/context/`. It exposes `{ searchClients?: ClientPickerSearchFn }`, and a `useClientPickerSearch()` hook reads it.
- `MspClientTagsProvider` also provides it with `searchClientsForPicker`. It is already mounted in both MSP shells, so the two shells need no change.
- `AsyncClientPicker` resolves `props.searchClients ?? context.searchClients`. An explicit prop still wins, which tests and non-MSP hosts rely on.
- Rejected: a shared query core with four per-domain wrapper actions. That would be the same action written four times, i.e. a missing layer. Also rejected: importing `@alga-psa/clients` from verticals, which the lint rule forbids.

**D2. Async is the default mode; the in-memory list is opt-in.**
- `ClientPicker` uses async mode whenever `clients` is not passed. Passing `clients` keeps the deprecated in-memory path for small, pre-filtered lists. This applies to callers in cards D and F that have not migrated yet.
- If neither a prop nor the context supplies a searcher, log a `console.error` in development and render the in-memory picker with an empty list (today's behaviour).
- The finish line for D, E and F can then be counted with grep: no `<ClientPicker ... clients=` left except intentionally pre-filtered lists.
- **Audit required before flipping:** callers that render `ClientPicker` without a `clients` prop. Today that is QuickAddContact (passes `searchClients`) and the workflow form widgets, `server/src/lib/workflow/forms/customWidgets.tsx` and `ee/packages/workflows/src/forms/customWidgets.tsx`. Confirm each still behaves correctly.

**D3. Picking a client requires `client:read`, everywhere.**
- `searchClientsForPicker` asserts MSP `client:read`. Contacts, billing and scheduling already required it.
- `getAllClientsForProjects` had no RBAC check, and `getAllClientsForAssets` had only the PSA product guard. A custom role with `project:create` or `asset:create` but no `client:read` will now see "Failed to load results" in the picker, where it used to see the full client directory.
- This is intended: listing the client directory is reading clients. The default roles that create projects or assets hold `client:read`. Technician and Dispatcher lack it, but they also lack `project:create` and `asset:create`, and time entry already required it.
- Implementation must not widen the action's permission to compensate.

**D4. Fields the screen needs from the selected client come from a by-id lookup in the owning domain. Domain fields are not added to the slim picker row.**
- Billing pickers need `default_currency_code`, and ManualInvoices needs `region_code`. Use `getClientByIdForBilling(id)` when a client is selected and when the screen opens with a preselected value.
- Quick-add-client callbacks already return the full new client; use it directly instead of appending to a local list.
- The selected client's label and avatar are hydrated by the picker itself through `ids` (card C).

**D5. Table columns render names from their own rows; logos are attached per page.**
- Projects (`ProjectModel.getAll` joins `client_name`), assets (`record.client.client_name`), usage records (`record.client_name`) and contacts (`getAllContacts` / `getContactsByClient` join `client_name`) already carry the name.
- The full client list was only providing `logoUrl`. Each list action now batch-resolves logos for the distinct `client_id`s in its result, using `getClientLogoUrlsBatch` from `@alga-psa/formatting/avatarUtils`. That helper is already single-query after card B. The logo is returned on the row (`client_logo_url`) and the client-side `clientLogoById` maps are deleted.

**D6. Non-picker list uses are replaced by targeted lookups.**
- Name maps become row fields or by-id lookups.
- Saved-view sanitising (`known.clientIds` for projects and assets) checks only the client ids that the saved view references, through `searchClientsForPicker({ ids })` via context (at most 100 ids).
- Quick views that need a full `IClient` load it by id when opened.
- See the per-screen table.

**D7. Shared components stay type-compatible with cards D and F while their callers migrate.**
- These `clients` props become optional, `@deprecated` and ignored, the way card C handled `QuickAddContact.clients`:
  - `ContactDetailsView.clients`
  - `ContactDetailsEdit.clients`
  - `ContactBentoLayout.clients`
  - `ContactQuickView.clients`
  - `QuickAddContactRenderProps.clients` in both `packages/ui/src/context/QuickAddClientContext.tsx` and `packages/projects/src/context/ClientIntegrationContext.tsx`
- Ticket surfaces (card D) and interactions or integrations (card F) still pass them.
- Removing a prop entirely is the job of whichever card removes its last caller.

**D8. Delete dead code and dead queries this card would otherwise have to migrate.**
- `packages/clients/src/components/contacts/ContactDetails.tsx` is rendered nowhere; its only reference is a re-export in `components/index.ts`. Delete it, along with its re-export, `ContactDetails.inboundDestination.wiring.test.ts`, and the source-text assertions that target it (see Risks).
- `getProjectDetails` returns `clients` that no caller reads. Drop the field.
- `ProjectDetail` accepts a `clients` prop it never uses. Drop it.

**D9. Billing disabled and excluded semantics are kept as they are.**
- No billing screen in scope computes `disabledClientIds` from contracts. The only case is TransferCreditDialog, which disables the credit's own client.
- Keep that as `disabledClientIds={new Set([credit.client_id])}`: the row is shown but cannot be selected, as today. Do not switch it to `excludeIds`.
- Card C's `AsyncClientPicker` keeps disabled state presentation-only and keyed by content, so this does not trigger refetches.

**D10. Build on current `main`.**
- The branch is an ancestor of `origin/main`: card C is merged and 363 commits are ahead. Fast-forward before the first implementation commit so card B's batched-logo helper and A's reflection change are in place.

## Per-screen design

Line numbers are as of HEAD 34888dd3eb. Re-locate before editing.

### Infrastructure (UI and composition)

| File | Change |
|---|---|
| `packages/ui/src/context/ClientPickerSearchContext.tsx` (new) | Context, provider and `useClientPickerSearch()`. |
| `packages/ui/src/components/AsyncClientPicker.tsx` | `searchClients` becomes optional and resolves from context (D1). |
| `packages/ui/src/components/ClientPicker.tsx` | Route to async when `clients === undefined` (D2). Update the deprecation doc. |
| `packages/msp-composition/src/clients/MspClientTagsProvider.tsx` | Also provide `searchClientsForPicker`. |
| `packages/ui/src/components/ClientPicker.async.test.tsx` | Add: context-supplied searcher, prop overrides context, async by default without `clients`. |

### Contacts (`packages/clients`, `server/src/app/msp`)

| Site | Today | Change |
|---|---|---|
| `contacts/Contacts.tsx:226` | `getAllClients()` for the table column (name and logo), `ClientQuickView` fallback, print `getClientName`, CSV export, `ContactQuickView`/`QuickAddContact`/`ContactsImportDialog` props | Remove the fetch. Column and print use `contact.client_name` plus the row logo (D5); `getAllContacts` and `getContactsByClient` attach `client_logo_url`. The `ClientQuickView` fallback loads `getClientById(id)` on click. `exportContactsToCSV` (`contactActions.tsx:~1100`) reads `contact.client_name`. Drop the props passed down. |
| `contacts/ContactsImportDialog.tsx:321` | Matches CSV `client` names against the full list | Add a clients action `findClientsByNames(names: string[])` that returns `{client_id, client_name}` for exact, case-sensitive name matches (the current semantics), called once with the distinct names from the parsed file. |
| `server/src/app/msp/contacts/[id]/page.tsx:85` | Server-side `getAllClients()` for the hero name, `newTicketHref` and the `ContactBentoLayout` prop | Replace with `getClientById(contact.client_id)` when the contact has a client. Pass the single client (or `clientName`) to `ContactBentoLayout` for the hero and `newTicketHref`. |
| `contacts/bento/ContactBentoLayout.tsx:62,294,361` | Name lookup from the list; passes the list to `ContactDetailsEdit` | Take the contact's client (or name) as a prop. Stop threading the list (D7). |
| `contacts/ContactDetailsEdit.tsx:445` | Picker only | Async picker. `clients` prop is deprecated and ignored (D7). |
| `contacts/ContactDetailsView.tsx:253,459,475,494` | Picker, `getClientName`, phone `defaultCountry` from `location_country_code`, re-threads the list | Async picker. The selected client's name comes from the picker's hydration. Name display and `defaultCountry` come from a by-id `getClientById(selectedClientId)` held in local state and refreshed on select. Stop re-threading. `clients` prop is deprecated and ignored (D7), because ticket surfaces (card D) and `InteractionDetails` (card F) still pass it. |
| `contacts/bento/useContactQuickViewDrawer.tsx:81` | `getAllClients(true)` on every open | Remove the fetch. The drawer loads the contact and, if needed, its client by id. Resolve the `LEVERAGE: pattern contact-drawer-loader` marker at :64 and `useContactEditDrawer.tsx:19`: with no client list left to load, the shared shape is just "load contact, then replace drawer". Fold the two hooks onto one loader if they still match after the change; otherwise delete the stale markers. |
| `contacts/bento/useContactEditDrawer.tsx:36` | `getAllClients(true)` on every open | Remove it; `ContactDetailsEdit` uses the async picker. Keep the doc comment's guarantee (alga0002338): the picker must offer every tenant client, which the server search does by construction. |
| `clients/ClientContactsList.tsx:40` | `LEVERAGE: friction client-picker-option-threading` | Delete this marker once the drawers stop threading. D1 and D2 are its fix. Update `ClientContactsList.clientOptions.test.tsx` (asserts `getAllClients(true)`) to assert that no full-list call happens. |
| `contacts/QuickAddContact.tsx` | Migrated by C | No change. |
| `server/src/app/msp/_components/CreateContactRouteClient.tsx:30` | `getAllClients(false)`, loading gate, ignored `clients` prop | Delete the fetch, state and spinner. |

### Billing (`packages/billing`)

| Site | Today | Change |
|---|---|---|
| `contracts/ContractDialog.tsx:130` (picker :409) | Full list on every open; currency from the selected client (:221, :503); quick-add upsert (:826) | Async picker with the same `filterState`, `clientTypeFilter` and `onAddNew`. Currency comes from `getClientByIdForBilling` on select and for `initialClientId` or the edited contract (D4). Quick-add sets the id and uses `newClient.default_currency_code`. |
| `contracts/wizard-steps/ContractBasicsStep.tsx:99` (picker :248) | List on mount; currency on select; summary name (:795) | Async picker. On select, `getClientByIdForBilling` gives `currency_code`. Keep `client_name` in wizard data (or take it from the same lookup) for the summary. |
| `quotes/QuoteForm.tsx:345` (picker :1610) | Active list; currency seeding (:427), `selectedClient` (:499, :521, :1408), `applyClientCurrency` (:552) | Remove the clients load from `loadFormData`. One `selectedClient` state, loaded by `getClientByIdForBilling` when `client_id` changes (initial context, edit and select), drives currency, the currency-source label and the subtitle. Quick-add uses `newClient` directly. |
| `quotes/QuoteDetail.tsx:194` | Active list used only for the name (:236, :1101) | `getClientByIdForBilling(quote.client_id)`. This also fixes the inactive-client name falling back to the raw id. |
| `UsageTracking.tsx:325` | Logo map (:203), `CustomSelect` client filter (:709), dialog picker (:842) | Logos come from the usage rows (D5). The filter becomes an async `ClientPicker` with a clear-to-"All Clients" affordance. The dialog picker is async. |
| `invoicing/GenerateTab.tsx:65` → `ManualInvoices.tsx` and `PrepaymentInvoices.tsx` | List fetched on mount and every refresh, passed to both children; currency (:1411, :41) and region (:1480) | Remove the fetch and the `clients` props. Both children use async pickers. A `getClientByIdForBilling` lookup on select supplies `default_currency_code` and `region_code`, and the name for existing invoices (:1570). |
| `invoicing/DraftInvoiceAdjustmentsCard.tsx:62` | `getAllClientsForBillingRecoverable` for a fixed `invoice.client_id` | Add `getClientByIdForBillingRecoverable = withSerializableAuth(getClientByIdForBilling)` and load just that client. ManualInvoices takes the fixed client through its new prop shape. |
| `reports/ContractUsageReport.tsx:78` | All clients, then N calls `getClientContractsForBilling` plus `getDetailedClientContractForBilling` | New billing action `getContractAssignmentsForReport(contractId)`: one query joining `client_contracts` to `clients` for the contract, returning the assignment fields the table shows plus `client_name` and batched logos. |
| `reports/ContractPerformance.tsx:87` | One full client fetch per contract, then per-client contract calls (N×M) | New billing action `countActiveClientsByContract(contractIds)` that returns `{contract_id, active_client_count}` in one grouped query. The revenue placeholder is untouched (non-goal). |
| `credits/AddCreditButton.tsx:42` | List once; currency of the selected client (:35) | Async picker plus a by-id lookup for currency. |
| `credits/TransferCreditDialog.tsx:50` | List fetched on mount even while closed; no error check; disabled source client; currency hint (:138) | Async picker; `disabledClientIds` kept (D9). The selected target is looked up by id for the currency hint. Nothing loads while closed. |

After this, `getAllClientsForBilling` and `getAllClientsForBillingRecoverable` have no callers. Delete both, along with `getAllClients` in `shared/billingClients/clients.ts` and its re-export. Update:
- `packages/billing/tests/actions/billingProfileAuthSerialization.test.ts` (Recoverable)
- `server/src/test/unit/sharedInfrastructureTenantFacadeWave2.contract.test.ts` (reads `clients.ts` as text)

`getAllClientsPaginatedForBilling` stays; BillingCycles uses it.

### Projects (`packages/projects`, `server/src/app/msp`)

| Site | Today | Change |
|---|---|---|
| `server/src/app/msp/projects/page.tsx:32` → `Projects.tsx` | Server-side full list for the column (name and logo, :860), list-view client filter (:1138), saved-view `known.clientIds` (:411), quick-view fallback (:801), and props to `ProjectDetailsEdit`, `ProjectQuickAdd` and `renderQuickAddContact` | Drop the fetch and the `clients` prop. `getProjects` attaches `client_logo_url` per row (D5); the column uses `client_name` from the row. The filter becomes an async picker; filtering by `client_id` stays client-side over the loaded projects. Saved-view sanitising checks only the view's client ids by lookup (D6). The quick view loads by id. Children get no list. |
| `ProjectQuickAdd.tsx:313` | Prop plus `localClients` merge, forwarded to `renderQuickAddContact` | Async picker. Delete `localClients` and `mergedClients`. |
| `ProjectDetailsEdit.tsx:318` | Picker only, plus a debug `console.log` (:68) | Async picker. Remove the prop and the log. |
| `ProjectInfo.tsx` / `ProjectPage.tsx:185,199` | `getProjectMetadata().clients` | Stop passing it. `getProjectMetadata` drops `clients`. Update the `ProjectMetadata` interface and `SchedulingCrossFeatureContext.tsx:55`. |
| `ApplyTemplateDialog.tsx:123` | Refetch on every open | Async picker. Remove the fetch. |
| `server/src/app/msp/_components/CreateProjectRouteClient.tsx:28` | `getAllClients(false)` plus spinner | Delete; `ProjectQuickAdd` needs no list. |

Delete `getAllClientsForProjects` and the private `getAllClientsForProjectsInternal`, and drop `clients` from `getProjectDetails` (D8). Update `server/src/test/unit/app/serverProductRouteGuardPages.test.tsx` and `QuickAddServiceDefaults.test.tsx`.

### Assets (`packages/assets`)

| Site | Today | Change |
|---|---|---|
| `QuickAddAsset.tsx:180` (picker :718) | Active list on every open; quick-add append (:964) | Async picker. Remove the fetch. Quick-add sets the id. |
| `AssetForm.tsx:344` | Active list feeding a `CustomSelect` (:1375); `selectedClient` name (:551, :1392); an inactive linked client shows blank | Replace the `CustomSelect` with an async `ClientPicker`. Its `ids` hydration ignores status, so an inactive linked client now displays. That fixes the blank, so call it out in the PR. |
| `AssetDashboardClient.tsx:307` | Full list for the logo map (:448), name map (:435) used by print/export (:1401) and the filter pill (:1707), and saved-view `knownClientIds` (:1358). The picker filter (:1630) is already server-side | The asset list action attaches `client_logo_url`. Print and export use row names. The pill label comes from a by-id lookup of the active filter's client. Saved views use the targeted id check (D6). The picker is async. |
| `server/src/app/msp/_components/CreateAssetRouteClient.tsx` | No fetch of its own | No change. |

Delete `getAllClientsForAssets`. Keep `getClientByIdForAssets`, which keeps `assertPsaOnlyTenantAccess` in `clientLookupActions.ts` for `serverActionProductAccess.contract.test.ts`. Remove the mock from these 5 tests:
- `AssetForm.drawerActions`
- `AssetForm.procurement`
- `AssetForm.customTypes`
- `QuickAddAsset.customTypes`
- `AssetDashboardClient.customTypes`

### Time entry (`packages/scheduling`)

| Site | Today | Change |
|---|---|---|
| `time-management/time-entry/time-sheet/WorkItemPicker.tsx:162` (picker :525) | `getSchedulingClients()` on every mount | Async picker with the same `filterState='active'`. `onSelect` → `clientId` → `searchPickerWorkItems({ clientId })` is unchanged. |

Delete `getSchedulingClients`. Keep `getSchedulingClientById`.

## Order of work

1. Fast-forward to `origin/main` (D10).
2. Infrastructure: context, optional `searchClients`, async by default, the provider, and tests (D1, D2). Audit the callers that render `ClientPicker` without `clients`.
3. Server-side read shapes: `client_logo_url` on the contacts, projects, assets and usage list actions; `findClientsByNames`; `getClientByIdForBillingRecoverable`; `getContractAssignmentsForReport`; `countActiveClientsByContract`. Add integration tests for each new query (tenant scoping included).
4. Contacts screens and drawers, with D7 deprecations and the D8 deletion of `ContactDetails.tsx`.
5. Billing screens.
6. Projects screens, plus the `getProjectMetadata` / `getProjectDetails` cleanup.
7. Assets screens.
8. Time entry.
9. Delete the full-list actions that now have no callers:
   - `getAllClientsForBilling`
   - `getAllClientsForBillingRecoverable`
   - shared `getAllClients`
   - `getAllClientsForProjects` and its internal helper
   - `getAllClientsForAssets`
   - `getSchedulingClients`

   Fix their test mocks. `getAllClients` in `@alga-psa/clients` stays; about 25 callers remain for cards D and F.
10. Verification: grep for each deleted action. Grep that no in-scope screen passes `clients=` to `ClientPicker`. Browser smoke on the dev origin against a tenant seeded with at least 5,000 clients.

Each numbered step should land as its own commit so a regression bisects to one screen group.

## Acceptance (per picker)

Each migrated picker must:
- select a client and fire the same downstream effect as before (currency or region applied, work items refiltered, filter applied)
- show a preselected value, including an inactive client, without a full list
- keep its status, type and tag filters and any `onAddNew` quick-add
- keep billing's disabled-source behaviour in TransferCreditDialog
- issue no full-list client call. Check the network panel when opening, typing and reopening.

## Non-goals

- **Ticket surfaces (card D) and every other `getAllClients` caller (card F).** Card F's list includes `InteractionDetails`, `QuickAddInteraction`, `loadMspInteractionsPageData`/`OverallInteractionsFeed`, `ClientDetails`, `Clients.tsx` CSV export, `MergeClientsDialog`, the opportunities, SLA and inventory pages, user management, general settings, the EE integrations and credentials screens, and `ActivityCrossFeatureContext`. They keep working through the deprecated in-memory path (D2) and the ignored-prop shims (D7).
- **Removing `getAllClients` from `@alga-psa/clients` or `packages/tickets`.** Both still have callers.
- **Paginating the contacts or projects lists themselves.** They still load every contact or project; only the client fan-out goes away.
- **Client-side caching of picker pages across opens.** The server search is cheap and paged.
- **Fixing ContractPerformance's placeholder revenue, or the redundant extra `loadWorkItems` call in `WorkItemPicker.onSelect`.**
- **Changing `getAllClientsPaginatedForBilling` / BillingCycles.**

## Risks

- **Permission tightening (D3).** Custom roles that create projects or assets without `client:read` lose the picker. Mitigation: the picker shows an explicit error state, not a silent empty list. Mention it in the release notes.
- **Contract tests that read component source as text** and assert on structure that this card moves or deletes. Update them in the same commit as the source change; do not weaken their intent.
  - `ContactDetailsSave.contract.test.ts`
  - `ContactDetails.productMode.contract.test.ts`
  - `algadeskClientContactComposition.contract.test.ts`
  - `ClientQuickView.callSites.contract.test.ts`
  - `mspClientsContactsAssetsOnboardingBatch.test.ts` (i18n key inventory)
  - `sharedInfrastructureTenantFacadeWave2.contract.test.ts`
  - `serverActionProductAccess.contract.test.ts`
- **Tests that render pickers without the MSP shell.** These include ContractDialog, the wizard, QuoteForm, UsageTracking, GenerateTab, ManualInvoices and the asset tests. They must pass `searchClients` explicitly or wrap in `ClientPickerSearchProvider`; otherwise D2's dev error fires. ManualInvoices tests currently stub `ClientPicker` with `clients[0]` and need a new stub.
- **Pre-built `clients` and `assets` packages** (`docs/architecture/package-build-system.md`). After editing their actions during a running dev session, rebuild with `npx tsup`, or the dev server serves stale `dist/`.
- **Selected-client lookups adding a round trip on select.** This is acceptable (one indexed row). Guard against out-of-order responses when the user changes the selection quickly: ignore stale results by id.
- **Saved views referencing a deleted client.** The targeted id check must drop the filter just as the old full-list check did, not apply a filter that matches nothing.
- **Card D running in parallel.** It may touch `ContactDetailsView`/`QuickAddContactRenderProps`. D7 keeps both cards' callers compiling regardless of merge order.

## Release notes (draft text)

- **Client dropdowns on contacts, billing, projects, assets and time entry now search on the server.** They no longer load the whole client list, so they open quickly on tenants with thousands of clients.
- **Permission change:** choosing a client on the projects and assets screens (new project, apply template, project details, new asset, asset form, asset filters) now requires the `client:read` permission. Users with a custom role that has `project:create` or `asset:create` but not `client:read` will see "Failed to load results" in the client picker. Grant `client:read` to such roles. The default roles that create projects or assets already hold it.
- Asset records linked to an inactive client now show that client's name in the asset form instead of a blank field.
