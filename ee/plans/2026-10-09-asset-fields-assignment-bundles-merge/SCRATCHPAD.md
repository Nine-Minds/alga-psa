# Scratchpad — Asset fields, people assignment, bundles & shared workspaces, merge billing attribution

- Plan slug: `asset-fields-assignment-bundles-merge`
- Created: `2026-10-09`

## What This Is

Working memory for this plan. Short bullets; update earlier notes when a decision changes.

## Decisions

- (2026-10-09) Snipe-IT connector deferred to its own plan. This plan builds the fields and people/grouping model it will map onto.
- (2026-10-09) Manufacturer/model/vendor/cost/order_number become columns, not `attributes` keys. `attributes` stays for custom-type fields only.
- (2026-10-09) Money as `bigint` cents + currency text, matching inventory (`stock_units.unit_cost` / `cost_currency`).
- (2026-10-09) Supplier = inventory `vendors` table, not a new table or free text.
- (2026-10-09) Status: `asset_statuses` registry with `kind` (Snipe-style deployable/pending/undeployable/archived). `assets.status` keeps the slug string; no FK (Citus simplicity, same pattern as `asset_type` slug + `asset_type_registry`).
- (2026-10-09) RMM sync stops writing `status` on update; `agent_status` is connectivity, `status` is human lifecycle. Create still sets active/inactive; delete/tombstone sets `retired`.
- (2026-10-09) Assignment history is its own table (`asset_assignments`), not derived from `asset_history.changes`. Single write helper `setAssetAssignee` so every path (UI, API, RMM, bundle, import) records source.
- (2026-10-09) RMM user → contact explicit mappings reuse `tenant_external_entity_mappings` (`integration_type='rmm:<provider>'`, `alga_entity_type='contact'`, realm = integration id). No new table.
- (2026-10-09) Auto-assign never overrides a non-`rmm` assignment and never unassigns on empty `current_user`.
- (2026-10-09) Groups: new tables, not `asset_relationships` (pairwise, no people). One group per asset (UNIQUE on asset). Kinds: `bundle` (one owner, propagates assignee + location) and `shared_workspace` (users list, members unassigned).
- (2026-10-09) Assets and RMM org mappings get a nullable `billing_profile_id`. Resolution chain for tickets from assets: mapping profile → asset profile → asset location default → client default (existing `TicketModel.resolveTicketBillingProfileId`).
- (2026-10-09) Merge billing choice applies only to assets and RMM mappings. Ticket/project null-profile stamping unchanged (open question 4).
- (2026-10-09) Shared ingestion stops overwriting `client_id` on update (aligns Level.io/Tanium with NinjaOne). Mapping client changes move assets immediately via `moveRmmOrganizationAssets` instead.

## Discoveries / Constraints

- (2026-10-09) Details page is `AssetBentoLayout` (via `AssetDetailView`). `AssetDashboardGrid` + `panels/AssetInfoPanel.tsx` (which did show "Assigned to" and a derived Model row) is dead code; nothing imports the grid. Remove or ignore.
- (2026-10-09) `assets.contact_name_id` FK is NO ACTION; `clearContactLinksBeforeDelete()` in `shared/models/contactModel.ts` nulls it. Contact deletion config in `packages/core/src/config/deletion/index.ts` does not list it.
- (2026-10-09) Status options hardcoded in `AssetForm.tsx:71` (`active|inactive|maintenance`). Shared ingestion writes `status` every update (`sharedAssetIngestionService.ts:253,268,345`) and `inactive` on tombstone (l.142).
- (2026-10-09) `current_user` only on `workstation_assets` / `server_assets`; `pickExtensionTable` handles only those two. Providers: shared ingestion `ext.currentUser`; Level.io `last_logged_in_user`; Tanium `endpoint.currentUser`; NinjaOne `lastLoggedInUser` (own engine `ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts`, not shared ingestion). Tactical: check `tacticalApiClient` for `logged_username`.
- (2026-10-09) `rmm_organization_mappings.default_contact_id` is alert-ticket contact only (`shared/rmm/alerts/resolveContact.ts`). Not assignment. Keep separate.
- (2026-10-09) Client merge: `packages/clients/src/lib/clientMergePlan.ts` (`CLIENT_OWNED_MOVE_TABLES` already includes `assets`, `rmm_organization_mappings`), engine `clientMergeEngine.ts` (`executeClientMerge` l.556), UI `MergeClientsDialog.tsx`, REST `server/src/app/api/v1/clients/[id]/merge`. Source client becomes tombstone (`merged_into_client_id`), not a child.
- (2026-10-09) Ticket billing profile resolution: `TicketModel.resolveTicketBillingProfileId` (`shared/models/ticketModel.ts:849`): explicit → location default → null (client default). Alert tickets: `shared/rmm/alerts/createTicketForAlertId.ts` → `ticketCreator.ts`; neither passes a billing profile today.
- (2026-10-09) Migration importer (`server/src/lib/migrations/appliers/entityAppliers.ts:447-465`) writes manufacturer/model into `attributes` and hardcodes `status: 'active'`.
- (2026-10-09) OpenAPI for asset relationships drifted from the migration (`relationship_id/related_asset_id` vs `parent/child`). Not in scope, but don't copy that shape for groups.
- (2026-10-09) Portal visibility: `packages/authorization/src/portal/visibility.ts` `applyAssetVisibilityFilter` ~l.260-305 with `contactColumn: 'assets.contact_name_id'`; callers in `packages/client-portal/src/actions/client-portal-actions/{client-assets,dashboard,client-tickets}.ts`.
- (2026-10-09) Locale file for MSP asset strings: `server/public/locales/<lang>/msp/assets.json` (de/en/es + others present).
- (2026-10-09) `shared/` RMM code runs on the workflow worker; rebuild shared dist and restart worker to test sync changes.

## Implementation notes

- (2026-10-09, asset-fields) Huntress has no device/asset sync at all — only org mappings (`organizations/orgSync.ts`) and incidents. F007's "Huntress mapper" therefore has nothing to fill; manufacturer/model land for Tactical (own `deviceSync`), Level.io + Tanium (shared snapshot) and NinjaOne (own engine).
- (2026-10-09, asset-fields) Tactical and NinjaOne write assets directly, not through the normalized snapshot, so each got its own "identity patch" helper (`buildTacticalAssetIdentityPatch`, `ninjaOneHardwareIdentityPatch`) with the same rule as shared ingestion: an empty value is omitted so a thin payload never blanks a filled column.
- (2026-10-09, asset-fields) Supplier options come from a new `getVendorOptionsForAssets` in `packages/assets` (gated on asset read), not `@alga-psa/inventory`'s `listVendors` (gated on `vendor` read) — a technician editing an asset should not need inventory permissions.
- (2026-10-09, asset-fields) Tenant default currency = `default_billing_settings.default_currency_code`, falling back to `USD`.

- (2026-10-09, assignment-core) `setAssetAssignee` had to live in `shared/models/assetAssignmentModel.ts`, not `packages/assets/src/lib/assetAssignment.ts`: the shared RMM ingestion service needs it and `packages/assets` already depends on `@alga-psa/shared`, so the planned direction would close a dependency cycle. `packages/assets/src/lib/assetAssignment.ts` is a thin re-export, so every call site named in the PRD still resolves and there is still exactly one implementation.
- (2026-10-09, assignment-core) NinjaOne's `updateExistingAsset` never wrote `client_id`, so F029 has nothing to convert on that side — only shared ingestion had a raw `contact_name_id: null` branch. T045 ("create writes no assignment row") holds because `createNewAsset` never set a contact.
- (2026-10-09, assignment-core) `asset_history.changed_by` is NOT NULL, so a sessionless caller (RMM sync without an audit user) gets the assignment row and the column update but no history entry rather than failing the assignment.
- (2026-10-09, assignment-core) The in-memory knex harnesses in `packages/assets/src/actions/*.test.ts` gained `whereNull`/`whereNotNull`/`join` and an `asset_statuses` seed; the helper and FR-B3 validation both need them.

- (2026-10-09, groups) The portal visibility helpers gained optional `sharedWorkspace` / `sharedWorkspaceTickets` column pairs instead of a new function: omitting them narrows, which is the rule the whole module is built on.
- (2026-10-09, rmm-user-ui) `listRmmSignedInUsers` / `mapRmmSignedInUserToContact` take the **mapping row id**, not `(integrationId, externalOrganizationId)` as F049 wrote it — none of the five settings managers had the integration id to hand, and deriving it server-side avoided threading it through four EE data loaders.
- (2026-10-09, rmm-user-ui) `@alga-psa/integrations` gained a `./components/*` export so EE managers import the one panel file rather than the components barrel (which pulls `@alga-psa/reference-data` and broke a Tanium UI test).
- (2026-10-09, billing/groups/tickets) Four more shared models were added for the same cycle reason as `setAssetAssignee`: `assetGroupContactModel`, `assetTicketContactModel`, `assetBillingProfileModel`, `rmm/moveRmmOrganizationAssets`. The workflow worker needs all of them.
- (2026-10-09, rest-api) The OpenAPI spec regenerates with `npx tsx --tsconfig tsconfig.base.json sdk/scripts/generate-openapi.ts [--edition ee]`. Running `npm run openapi:generate` from `sdk/` fails on `@shared/*` because sdk's tsconfig has no paths — use the root tsconfig.
- (2026-10-09, mobile) `ee/mobile` has no `node_modules` in this worktree (expo missing), so its vitest and typecheck cannot run here; the two edited files were parse-checked with esbuild instead.

## Commands / Runbooks

- Migrations: `npm run migrate` from repo root. Migrations must `require('./utils/tenantDb.cjs')`, never `@alga-psa/db`.
- Rebuild types/assets after interface changes: `npx nx build types && npx nx build assets && npm run build:shared`.
- Tests: `cd server && npm run test:unit`; integration: `cd server && npm run test:integration`.
- OpenAPI regeneration: use the `alga-openapi-sync` skill after REST changes.
- `grep -rn "LEVERAGE:"` to see layering markers dropped during implementation.

## Links / References

- Previous analysis (this session): Snipe-IT entity/API survey; AlgaPSA asset model survey.
- Key files: `packages/assets/src/actions/assetActions.ts`, `packages/assets/src/components/AssetBentoLayout.tsx`, `packages/assets/src/components/AssetForm.tsx`, `shared/rmm/sharedAssetIngestionService.ts`, `shared/rmm/contracts.ts`, `packages/clients/src/lib/clientMergePlan.ts`, `packages/clients/src/lib/clientMergeEngine.ts`, `packages/clients/src/components/clients/MergeClientsDialog.tsx`, `packages/authorization/src/portal/visibility.ts`, `packages/msp-composition/src/clients/MspClientAssets.tsx`, `server/src/lib/api/services/AssetService.ts`.
- Snipe-IT docs: https://snipe-it.readme.io/reference/api-overview , https://snipe-it.readme.io/docs/multi-tenancy-ish

## Open Questions

- See PRD "Open Questions" (7 items). Resolve 1–3 before starting groups D/E; 4 before merge-assets.

## Decisions (2026-10-09, product owner)

- Q1 default people mode `suggest`; Q2 RMM stops writing `status` on update (ok because status is now its own registry); Q3 one group per asset; Q5 currency per asset; Q6 reuse inventory `vendors`.
- Q7 yes: shared-workspace users get portal ticket rights on workspace assets. Portal asset scopes are only `client | contact` (`packages/authorization/src/portal/visibility.ts:19`), and portal ticket creation already validates the asset via `applyAssetVisibilityFilter` (`client-tickets.ts:1451`), so FR-E7 alone grants creation. Added FR-E7b / F108–F109 so the ticket list also shows colleagues' open tickets on workspace assets (read-only).
- Q4 (merge choice also governs ticket/project stamping) still open; recommendation in PRD is yes.
- Q4 decided 2026-10-09: the merge billing choice (`billingStrategy`) covers every moving row with a null profile: tickets, projects, assets, RMM org mappings. Billing history tables (invoices, cycles, payments, transactions, credits, tax settings) keep today's stamping with the moved profile; they are issued history, not moving work. Column renamed `client_merges.billing_strategy`.

## Review round 2 (2026-10-12) — defects fixed

Found by review, all fixed in this round:

1. **F094 — three of five mapping UIs were dead ends.** Tactical, Huntress and
   NinjaOne imported `RmmOrganizationClientChangeDialog` and set
   `pendingClientChange` but never rendered it, so changing a mapped
   organization's client returned early: no dialog, no save, no feedback — a
   regression against the pre-branch select-saves-immediately behaviour. All
   three now render it. Guarded by
   `server/src/test/unit/rmmOrganizationMappingUis.contract.test.ts`, which
   asserts import **and** element for all five providers.
2. **F088 — `assets.billing_profile_id` reached only alert tickets.** The
   inheritance now happens once, in `TicketModel.createTicketFromAsset`
   (`validatedData.billing_profile_id ?? resolveAssetBillingProfileId`), so MSP,
   REST and mobile get it from one place; the portal resolves it alongside its
   contact heuristic and prefers the asset (a device says more about what gets
   billed than "this contact usually belongs to segment X"). The three edge
   schemas gained the optional field so an explicit pick survives the parse.
3. **F109 — the workspace inclusion leaked into the write gate.**
   `resolveVisibleTicket` (the gate for commenting, editing, deleting and status
   changes) no longer passes `sharedWorkspaceTickets`; requester and watcher
   still pass it, which is exactly FR-E7b's "read-only unless". The EXISTS
   clause also gained the missing open/closed predicate — `closedColumn` is now
   a required member of the option, so a read path cannot forget it.
4. **F023 — NinjaOne's delete path wrote `inactive`.** Now `retired`, matching
   shared ingestion's tombstone.
5. **F075 — the Group column always read "None".** `listAssets` never populated
   `asset.group`. New `getAssetGroupSummariesForAssets` fills a whole page in
   four queries rather than four per row.
6. **F106 — mobile's two new rows were dead.** `AssetService.getById` joined
   only clients and vendors; it now left-joins `contacts` for `contact_name` and
   attaches `getAssetGroupSummary`, and `assetResponseSchema` declares both. The
   PRD's drawer Group row was added too.
7. **F089 — AssetForm kept the billing profile across a client change**, so the
   save failed validation instead of moving the device. `handleClientChange`
   now clears it alongside the location and the assignee.
8. **F090 — never implemented** (marked implemented, but no mapping manager had
   a billing-profile select). New shared
   `RmmOrganizationBillingProfileSelect` + `listRmmOrganizationBillingProfiles`,
   wired into all five managers. It renders nothing below two active profiles.
   It lives in `packages/integrations` with its own action because that package
   does not depend on `@alga-psa/assets`.
9. **FR-E5 — an RMM org move lost its `group_removed` entry.**
   `moveRmmOrganizationAssets` deleted the member row and logged only
   `updated`. The group history is inlined there (it runs on the workflow
   worker, below `packages/` in the graph).
10. **NinjaOne auto-assign used `mapping.client_id!`** where shared ingestion
    correctly uses the asset's own client; after a manual move in `auto` mode
    `setAssetAssignee` could throw and abort the device sync. It now reads
    `asset.client_id` from the update's `returning('*')`.
11. **Dead import** `listDeployableStatusSlugs` removed from `assetActions.ts`.
12. **Status rows rendered the raw slug.** New `assetStatusLabelForSlug`
    (registry label → builtin label → humanized slug) behind
    `resolveAssetStatusLabel`, used by the Bento Identity tile, the list column
    and the drawer, so a custom `in_repair` reads "In repair" even mid-load.
13. **F105 — the merge OpenAPI definitions omitted the new fields.**
    `ClientMergeBody.billing_strategy`, `ClientMergeResource.billing_strategy`
    and the preview's `assets` / `billingChoice` blocks are documented and all
    six spec artefacts regenerated.

### tests.json integrity

The previous round flipped all 157 entries to `implemented: true` with roughly
30 having no test. Those blocks now have one; the id appears in the test name so
the mapping is checkable with `grep`:

| block | file |
| --- | --- |
| T084–T088, T132, T135–T137 | `server/src/test/unit/rmmOrganizationMappingUis.contract.test.ts`, `server/src/test/unit/assetSurfacesRemaining.contract.test.ts` |
| T106–T116 | `server/src/test/unit/assetGroupsUi.contract.test.ts` |
| T118–T121, T154–T157 | `packages/authorization/src/portal/visibility.test.ts`, `packages/client-portal/src/actions/client-portal-actions/client-tickets.visibility.test.ts`, `server/src/test/unit/assetSurfacesRemaining.contract.test.ts` |
| T122–T124 | `shared/models/__tests__/assetTicketContactModel.test.ts`, `server/src/test/unit/assetSurfacesRemaining.contract.test.ts` |
| T125–T131 | `shared/models/__tests__/assetBillingProfileModel.test.ts`, `server/src/test/unit/assetBillingProfileTicketFlow.contract.test.ts` |
| T140–T145 | `packages/clients/src/lib/clientMergeEngine.test.ts`, `server/src/test/unit/assetSurfacesRemaining.contract.test.ts`, `server/src/test/unit/assetRestSurface.contract.test.ts` |
| T147–T152 | `server/src/test/unit/assetRestSurface.contract.test.ts`, `server/src/test/unit/assetSurfacesRemaining.contract.test.ts` |
| T089, T117, T146, T153 | `server/src/test/unit/i18n/assetPlanKeyParity.test.ts` |

The earlier groups' tests (asset-fields, asset-status, assignment-core/ui,
rmm-user-match, groups-core) are behaviour-named rather than id-named — e.g.
T092–T097 and T102 are the `addAssetsToGroupRows` / `group people invariants` /
`updateGroupRow` blocks in `packages/assets/src/lib/assetGroups.test.ts`, and
T138–T139 are the ownership cases in
`packages/integrations/src/lib/rmm/sharedAssetIngestionService.test.ts`. Those
were left as they are; only the genuinely-untested blocks above were written.

Several of the new tests are **source-level contract tests**, the convention
already used by `AssetBentoLayout.notes.contract.test.ts` and
`inboundEmailTenantScoped.contract.test.ts`. That choice is deliberate for the
UI entries: the components span five packages with no shared mount harness, and
the failure class these entries guard is structural — an element imported but
never rendered, a column bound to a field nothing fills, a resolver called from
one of four surfaces. Defects 1, 2, 5, 6 and 8 above were all exactly that, and
each now has a test that fails if it recurs.

### Still true / not changed

- `ee/mobile` has no `node_modules` here, so T152/T153 are asserted from
  `server`'s suite by reading the mobile sources and its `en` locale.
- T141–T143 run against the merge engine's in-memory database
  (`clientMergeEngine.test.ts`), not a real one; the DB-level merge assertions
  remain in `server/src/test/integration/clientMerge.integration.test.ts`.

## Round: the status slug on screen (browser check)

The in-browser pass found `in_repair` printed verbatim in the asset list's
Coverage cell and in the contact page's Assets tile, while the Identity tile and
the dedicated Status column read "In repair". Those two surfaces were the only
ones calling neither `resolveAssetStatusLabel` nor `assetStatusLabelForSlug`:
the cell had its own `assetCells.status.*` keys covering three of the five
builtins and falling through to the raw slug, and the tile printed
`row.asset_status` directly.

Both now use `resolveAssetStatusLabel`, and the `assetCells.status` block is
deleted from all eleven locales — one reading of a status slug, not two. Because
the cell renders per row it cannot fetch the registry itself, so
`AssetDashboardClient` and `MspClientAssets` hand it the registry they already
hold; with no registry (mid-load) the builtin label and then the humanized slug
still keep the slug off the screen.

Three more surfaces printed the slug the same way and were swept with it: the
drawer's Asset summary grid (its badge already resolved the label, the grid
beneath it did not), the printable detail header in `AssetDetailView`, and the
read-only portal/mobile badges (`assets.statuses.*` in the portal locales,
a local `humanizeStatus` on the mobile screen, matching
`ProjectTaskDetailScreen`). `packages/client-portal` gained a dependency on
`@alga-psa/assets` for the pure slug helper.

Not changed: `ClientDevicesPage` still shows the portal's binary
Active/Inactive chip, which predates the registry and is not a slug leak.

## Round: the portal showed "Unassigned" for every device

Review found F040/F081 dead on the live portal. `client-assets.ts` read bare
`assets.*` — no `contacts` join, no group summary — while `AssetDetails` bound
to `asset.contact_name` and `asset.group`, so every assigned device read
"Assigned to: Unassigned" and "Shared workspace" could never appear. Worse than
a missing row: wrong information, on the surface the client actually sees.

Fixed at the read: `withAssigneeName` left-joins `contacts` for
`contact_name` on each row read (counts don't need it, which is why it is not in
`scopedAssets`), and `serializeWithGroups` / `getAssetGroupSummary` attach the
group to `listClientAssets`, `getClientAssets` and `getClientAssetById`. Because
`contacts` carries its own `updated_at`, `SORT_FIELDS` and the preview's
`orderBy` are now qualified — unqualified they would be a 42702 on the default
sort. Verified against this card's database: the joined query returns
"Wanda West" for the front-desk laptop and its bundle membership.

The Assigned-to column went onto `ClientDevicesPage`, the component the
`/client-portal/devices` route renders. The old `AssetList.tsx` — dead since the
Nx split, imported by nothing — is deleted along with the seven locale keys only
it used; the contract tests that greped it now grep the live list and the read
action, which is what let the defect pass round 2.

### Review follow-ups in the same round

- **F071** the Group tile counted its siblings and people instead of naming
  them. It now fetches the group under `['asset', assetId, 'group', groupId]`,
  which the drawer's `matchAssetCacheKeys` revalidation already covers, and
  lists five sibling links plus the owner or the workspace users.
- **F071** "Add to group" linked to `?view=groups`, which `MspClientAssets`
  never read; the view now seeds from the URL.
- **F082** the MSP dialog used only `preselect`, so a three-person workspace
  offered nobody. The options render in a Contact select. The portal needs
  nothing: a portal ticket is always filed as the signed-in contact
  (`contact_id: visibility.contactId`). Mobile's `CreateTicketModal` has no
  contact field and no endpoint to feed one, so the resolution happens
  server-side in `TicketService.createFromAsset` — a caller that names nobody
  gets the asset's single person, and several people stay ambiguous.
- **F044** `suggestContactForAsset` resolved the integration with
  `rmm_integrations.where({ provider })`, which picks an arbitrary row when a
  tenant runs two integrations of the same provider — and then reads the other
  mapping's mode. It now finds the organization mapping for the asset's client
  and keeps the one whose integration matches the asset's provider
  (`suggestContactForAsset.test.ts`).
- **F105** the OpenAPI `byRmmOrganization` item omitted `integrationId`, which
  the preview returns; added and the six spec artefacts regenerated.

## Round 4 — browser-check defects

### The client Assets table kept the previous assignee

Changing a bundle's owner in the group drawer reassigns every member, and the
database agreed: a reload showed the new owner. The table did not. The client
Assets tab holds its rows in component state loaded once per
`clientId`/`selectedType`/`currentPage`, so switching back from the Groups view
re-rendered the rows the tab had fetched before the write.

`MspClientAssets` now has a stable `refreshAfterGroupChange` (the `loadData`
that was a bare async function is a `useCallback`, so its identity is stable)
wired to the drawer's `onChanged`, its `onDeleted` and the dialog's `onClose`.
Stability matters: `AssetGroupDrawer` refetches its group whenever the callback
identity changes, so an inline arrow would have the drawer refetching on every
parent render.

The drawer's `apply` no longer calls `onChanged`. It was shared by the initial
read and every write, which would have made opening the drawer reload the list
behind it for nothing; `run` announces the write, and `apply` only takes the
group.
