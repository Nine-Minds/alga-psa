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
- (2026-10-09, assignment-core) `asset_history.changed_by` was NOT NULL, so a sessionless caller (RMM sync without an audit user) got the assignment row and the column update but no history entry. Superseded by review round 3: migration `20261009127000` makes the column nullable and every sessionless write (assignment and RMM organization move) records its history, naming the provider.
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

### The portal device list called every status "Active"

The list's Status column was written when `active` and `inactive` were the only
statuses that mattered: it rendered `devices.status.inactive` for the slug
`inactive` and `devices.status.active` for everything else. F021 gave tenants
their own statuses, so a laptop in `in_repair` read "Active" in the table and
"In repair" one click away in its own details panel.

Both surfaces now read the slug through `portalAssetStatus.ts`: the localized
`assets.statuses.<slug>` when the portal has that key, else the builtin label,
else the humanized slug. The badge tone follows the builtin kind — deployable
reads well, undeployable and archived read spent, pending and anything the MSP
invented read as something to ask about. The portal still never fetches the
status registry.

The details panel wrapped that badge in a `<p>`. `Badge` renders a `div`, and a
div inside a p is invalid markup that React reports as a hydration error on
every open; it is a `<div>` now.

The status *filter* keeps its two options and its "active = not inactive"
meaning: that is what the server-side counts and the `status` parameter mean,
and FR-B5's kind-based metrics are an MSP surface.

## Review round 3 (2026-10-14)

An operator review of the whole diff, plus two verifier rounds and a browser
pass. Everything below is a defect the shipped feature set still carried; no
scope was added.

### The portal was shipping the MSP's commercial columns

`withAssigneeName` selected `assets.*`, so `purchase_cost`,
`purchase_cost_currency`, `vendor_id`, `order_number` and
`billing_profile_id` travelled to every portal browser in `listClientAssets`,
`getClientAssets` and `getClientAssetById` — the procurement fields this very
plan added. Reads go through `PORTAL_ASSET_COLUMNS`, an allow-list, and the
contract test (T059's second half) asserts none of those keys can come back.

### Billing profiles were stored on trust

All five RMM mapping actions wrote whatever `billing_profile_id` arrived, and
the clear-on-client-change branch was skipped whenever the same call also
carried one — so moving a mapping to client B could keep client A's profile.
`shared/rmm/mappingBillingProfile.ts` is now the one rule: a client change
clears the profile whatever else the patch holds, and any chosen profile has
to belong to the client the mapping *lands on* and be active.

`createTicketForAlert` then validated nothing: `mapping.billing_profile_id`
went straight into `tickets.billing_profile_id`, while the ticket's client
comes from the device — and FR-G5 now lets a device be moved by hand. A device
moved to client B was billed to client A's profile. Both candidates (the
mapping's and the asset's) are checked against the ticket's client and fall
back to null, which is the client default, rather than failing the ticket.

### The signed-in-user follow-along reached into other clients

`mapSignedInUserToContact` walked **every** `auto` organization of the
integration. An integration covering several clients will report the same
`CORP\jdoe` on another client's device; `setAssetAssignee` rejects a contact
from another client, the throw rolled back the whole transaction, and the
operator lost both the explicit mapping and the assignment they had clicked —
with no error, because neither the action nor the dialog converted it. It now
follows along only inside the contact's own client, skips a device the
assignment helper refuses, and the action returns a typed error the row
toasts.

While here: `matchContactForRmmUser` loaded every contact of the client once
per synced device. The three match rules are a SQL predicate now (a superset,
so ambiguity stays visible and the precedence decisions are unchanged).

### Statuses could be archived but not brought back

Archiving a custom status left it greyed out with only Rename, and
re-creating it by name answered `duplicate_slug` — a one-way door. There is a
Restore action, and creating a status whose slug matches an archived row
revives that row. The edit form stopped offering archived statuses at all
(the server refuses them anyway) while still showing the one an asset already
sits on, by label. Archive is disabled with the in-use count instead of
promising the status "stays on assets", a refusal closes the dialog, and the
registry's messages are localized by code rather than shown in server English.

Renaming a builtin was invisible: every surface did
`t('…statuses.<slug>', { defaultValue: label })`, and the key existed. The
registry label is the source of truth now; only an untouched builtin is
translated.

### Writes that moved an asset said nothing

Assignment and group mutations changed `contact_name_id`, `location_id` and
membership without publishing `ASSET_UPDATED`, so an automation watching
assets saw an edit-form save and missed a bundle reassigning five machines.
Both paths publish per affected asset after commit; the group actions
snapshot membership either side of the transaction, because the members
before and after a write are not the same set.

`asset_history.changed_by` was NOT NULL, so the one caller without a session —
RMM sync — got its assignment row and no timeline entry at all. The column is
nullable (20261009127000) and the entry carries the provider, so
"Auto-assigned to Jane from levelio" finally appears. Location propagation got
its own change type instead of rendering as "Updated — Group id, Group name".

### FR-E7b admitted readers it then refused

A shared-workspace colleague could open a hot-desk ticket and see the comment
box and the status control; the write paths resolve a ticket *without* the
workspace clause and answered "Ticket not found". `getClientTicketDetails`
returns `can_interact` (same in-memory matcher), the portal disables the
controls and says why, and `TicketConversation` grew a `readOnly` prop that
hides the composer, the reply affordance and the per-comment edit/delete.

### Tactical was offered a People mode it never honoured

Tactical writes assets through its own sync rather than the shared ingestion
service, so `auto` did nothing. Both the bulk sync and the single-agent
refresh now call `applyRmmSignedInUserAssignment` after the extension row,
matching against the client the device is on (FR-G5). Create no longer
hard-codes `active` — an agent already offline arrives `inactive` — and a
**full** sync retires devices Tactical no longer lists. That last one is
guarded twice: an incremental page or an empty agent list retires nothing,
because Tactical has no deletion signal and "I could not see the fleet" must
never read as "the fleet is gone".

### Smaller repairs

- Bulk "Add to group" confirms before a shared workspace unassigns anything,
  creates the group and its members in one call (no orphaned empty group on
  failure) and shows the real error.
- The asset list's Group filter resets when its client leaves scope, instead
  of filtering from a control nobody can see.
- `AssetForm` stops re-submitting a billing profile the client no longer
  offers, which had made such an asset permanently unsaveable.
- Accepting a Live-vitals suggestion invalidates the asset cache, so the
  Identity tile stops contradicting the row above it.
- Money parsing reads the decimal separator from the value ("1.234,56" was
  saved as 123 cents) and clamps negatives to zero.
- The group drawer selects `client_name`, only warns about unassigning when
  something would be unassigned, and the asset page's Group tab steps back
  when the group is deleted.
- REST: groups follow asset `create`/`delete` for those verbs, `not_found` is
  a 404 everywhere, and removing a bundle contact honours the id it was given.
- Merge preview counts only the source client's devices per RMM organization
  (and those matched through the mapping table), so the rows add up again.
- A contact's assigned asset is reported but no longer blocks deleting them;
  blocking it meant FR-C5's cleanup could never run. `blocking: false` is a
  new, general facility on the deletion config.
- `bulkUpdateAssets` accepts the procurement fields (FR-A4); the vendor and
  billing-profile lookups check `asset:read`; three dead exports are gone.
- Migrations: `20261009120000.down()` puts manufacturer and model back into
  `attributes`; `20261009121000` folds a legacy `" Active"` onto the builtin
  instead of creating a second, undeployable one.
- The migration importer checks an imported assignee against the asset's
  client and warns, instead of failing the whole asset import.

### features.json / tests.json

F085 (billing-profile validation on every writer) and T059 (no cost or vendor
fields in the portal payload) were marked implemented while neither was true
of the RMM mapping actions or the portal payload. Both are true now, so the
flags stand as they are; nothing was flipped back.

## Round 4 — test repair (2026-10-14)

Round 3's code was right; three of its tests were not runnable and one
asserted a variable name.

`retireVanishedTacticalAssets` queries with `whereNotIn` and `whereNot`, which
the hand-rolled fake knex in `tacticalDeviceSync.fullSync` and
`…paginationSmoke` did not implement — the sync threw, swallowed it into
`errors`, and every assertion on `success` failed. Both fakes understand the
two clauses now, and the retire path finally has a behavioural test beside its
source contract: with agent `a1` still listed and `a_gone` absent, the vanished
device becomes `retired` / `offline`, its mapping row is flagged deleted, and
the device Tactical still reports keeps its lifecycle status. The existing
"empty listing retires nothing" test is what makes that pair meaningful.

The FR-E7b contract test pinned `extractActiveWatcherContactIds(ticket.attributes)`
while the action reads through its `ticketRow` alias; it matches either name
now, so the contract is about where the watcher ids come from rather than what
the local variable is called.

## Round 5 — the gating suite (2026-10-14)

### A committed test still described the old behaviour

`shared/models/__tests__/assetAssignmentModel.test.ts` asserted that a
sessionless RMM assignment writes *no* `asset_history` row — the rule review
round 3 deliberately removed when it made `changed_by` nullable
(`20261009127000`). `shared/**/*.test.ts` is inside the server suite's
`SERVER_UNIT_INCLUDE`, so `cd server && npm run test:unit` — the command every
commit in this plan runs, and the lane `unit-tests.yml` gates on — was red on
HEAD. The test now asserts what ships: one `assignee_changed` row with
`changed_by: null` carrying `source`, `provider` and the signed-in-user note.
The stale implementation note above says so too.

### Sessionless writes, consistently

`moveRmmOrganizationAssets` still skipped both of its history rows when
`actorUserId` was null, which was the same NOT NULL workaround one file over.
A mapping move triggered without a session now records `updated` and
`group_removed` with `changed_by: null`, with a test for it.

### The group guards no longer swallow real failures

Three lookups tolerated the group tables not existing yet with a bare `catch`,
which inside a transaction also hides an abort. `isMissingAssetGroupTable`
(the `42P01` shape, the convention `assetTypeRegistry` already uses) is the
only error any of them absorbs; everything else is rethrown.

### T147 is behaviour again

The entry promises "returns history and 404 for another tenant's asset" and
was satisfied by a grep for `export const GET`. The 404 path is exercised
now: `server/src/test/unit/api/apiAssetAssignmentsController.test.ts` drives
`ApiAssetController.listAssignments` with a stub service and asserts the
history body for a visible asset and `404 NOT_FOUND` when the tenant-scoped
`getById` finds nothing.

### The merge billing choice met a real database

The gap SCRATCHPAD admitted for T141-T143 is closed: `clientMerge.integration`
gained TM021, which seeds an unprofiled ticket, project, asset and RMM
organization mapping on the absorbed client and merges twice.
`source_profile` stamps all four with the moved default and records
`billing_strategy`; `target_default` leaves all four NULL so the attribution
chain resolves them against the parent, and the rows still move. The preview's
`billingChoice` counts are asserted against the same fixture.

### Still outstanding, for the record

- Group invariants, mapping moves and portal visibility are still covered by
  in-memory-knex unit tests rather than `server/src/test/` integration files
  (the migrations, procurement fields, statuses, assignments and now the merge
  billing choice have those).
- **Operator call-out, with FR-B6/FR-G5:** a Tactical **full** sync now
  retires devices Tactical no longer lists (`retireVanishedTacticalAssets`) —
  deletion detection Tactical never had. Incremental pages and an empty agent
  list retire nothing, but the release note should name it alongside "RMM sync
  no longer overwrites asset status" and "manual client changes persist".

## Round 6 — Settings → Integrations would not compile (2026-10-14)

The browser check found `/msp/settings/integrations` answering HTTP 500 on
navigation *and* on retry, with a runtime `ENOENT` for the route's
`build-manifest.json`. That is what a route whose module graph fails to
resolve looks like in dev, and the cause was ours, not the environment:
`RmmUserContactMappingPanel` is a `'use client'` component and it
*value*-imported `RMM_CONTACT_ASSIGNMENT_MODES` from
`@alga-psa/shared/rmm/userMatching` — the module that needs `@alga-psa/db` to
find a contact. One constant dragged knex → pg → `fs` into the browser graph
and took every RMM, accounting and identity panel on the page down with it.

The three mode names now live in `shared/rmm/contactAssignmentModes.ts`, a
module with no imports at all; `userMatching` re-exports them so the five
server actions that validate the mode are untouched, and the panel reads the
pure module. `shared/tsup.config.ts` gained the entry, so the workflow worker
and the dist consumers get it as its own chunk.

`RmmUserContactMappingPanel.clientSafety.contract.test.ts` pins the rule that
was easy to break by accident: the panel's only `@alga-psa/shared` value
import is the modes module, that module imports nothing, and `userMatching`
still re-exports the pair for its server callers.

Verified headless at `http://localhost:3114/msp/settings/integrations`: HTTP
200, "Integrations | AlgaPSA", the tab strip and the accounting cards render,
and the console carries no module or page error.

## Round 7 — the second half of FR-F3 (2026-10-14)

The browser check reproduced a real billing miss: merge `234567` into `12345`
keeping the source profile, open the moved asset, raise a ticket — the asset
kept `billing_profile_id`, the ticket came out `null`. Twice, on both "Create"
and "Create + View Ticket".

Those two button labels name the culprit. `CreateTicketFromAssetButton` (which
*does* inherit, via `TicketModel.createTicketFromAsset`) is only mounted on the
legacy `AssetDetails` view and the asset drawer. Every other asset surface —
the Bento detail header, the asset list, the service-history tab, the
maintenance command centre and `/msp/tickets/new?assetId=…` — renders
`QuickAddTicket`, which submits `asset_id` to `addTicket`. `addTicket` created
the `asset_associations` row and nothing else: it never looked at the asset's
profile, so FR-F3 held on one MSP dialog out of six.

`addTicket` now resolves the asset profile when the caller picked none, through
a new `resolveAssetBillingProfileIdForClient` in
`shared/models/assetBillingProfileModel.ts`. It is deliberately *not*
`resolveAssetBillingProfileId` passed straight through: QuickAddTicket's client
picker stays editable when the dialog is opened from an asset, so the ticket's
client may no longer be the asset's. The new helper checks the candidate with
`assertBillingProfileForClient` and returns `null` on a mismatch or an archived
profile instead of raising — ticket creation is never blocked by billing
attribution (the same shape as `profileForClient` in the alert-ticket creator).

Covered by four cases in `shared/models/__tests__/assetBillingProfileModel.test.ts`
and a wiring assertion in `assetBillingProfileTicketFlow.contract.test.ts`
(T130, which already owned the "every MSP surface" claim).

The eleven standing operator-feedback items were re-checked against the code
rather than the ledger — group-filter reset (`AssetDashboardClient.tsx:827`),
portal `can_interact`/`readOnly`, REST `asset:create`/`asset:delete` and
`not_found → 404` plus `removeContact` honouring its contact id, merge preview
scoped by `client_id` with the external-mapping union, non-blocking
`assigned_asset` dependency, nullable `changed_by` with the provider in
`changes`, Tactical's `applyRmmSignedInUserAssignment` on both sync paths,
`ASSET_UPDATED` after group and assignment writes, and all three minor bundles
(separator-aware `money.ts`, `client_name` on group details,
`group_location_changed`, the removed dead code, localized status errors,
kebab ids, pluralized workspace counts, drawer `onDeleted`, reversible
`down()`, case-folded custom statuses, SQL-side contact candidates) are all
present. `features.json` (109) and `tests.json` (157) stay fully
`implemented: true`.

## Round 8 — the focus drawer's footer (2026-10-15)

### Two scrollbars and a Save button 700px below the fold

Operator, on `/msp/assets/<id>`: "this drawer should have floating footer with
save and cancel buttons, and double scroll is garbage". Measured headless with
the edit view open, and both halves were real:

- `Drawer` only makes its body (`p-6`) the scroll container when it is given a
  `footer`; without one, `Dialog.Content` itself carries `overflow-y-auto`. The
  focus drawer passed no footer, so the panel reported `scrollHeight` 1440 over
  a 900px client box *and* the content pane inside it scrolled 1560 over 811 —
  scroll the form to its end and the panel kept going into empty space.
- `#form-actions` sat at the foot of a 1496px form: Save and Cancel were at
  y≈1585 in a 900px viewport, reachable only by scrolling the whole edit form.

`FocusView` grew a `footer`, every view supplies one (`asset-bento-focus-done`
closes the read-only views), and the edit view's footer holds
`asset-bento-focus-cancel` and `asset-bento-focus-save`. The save button is
`type="submit" form="asset-edit-form"` — it submits the form from outside it,
so `handleSubmit` and its validation are untouched. `AssetForm` takes
`hideActions` (drop the duplicate row), `onSavingChange` (the footer disables
Save and says "Saving...") and `onCancel` (in a drawer, `router.back()`
navigated the page behind it away). Because the buttons left the form, a save
error now scrolls itself into view.

Giving the drawer a footer is also what removes the second scrollbar: the panel
stops being a scroll container and the content pane is the only one left.

Covered by `AssetForm.drawerActions.test.tsx` (four render cases) and
`AssetBentoLayout.focusDrawer.contract.test.ts` (the footer wiring and the
single scroll region).

### The client picker that would not change clients

The round-7 browser check could not verify the cross-client billing guard: in
Quick Add Ticket opened from an asset, picking another client snapped straight
back. `handleClientChange` returned early whenever `isPrefilledClient` — but
nothing disables the picker, so the dialog silently ignored the choice and
saved the ticket under the original client. A prefilled client is a default,
not a lock: an explicit change now clears the flag (so the effect loads that
client's contacts, which the prefilled branch skips) and clears the location,
which belonged to the client before it. Pre-existing and not ours, but it sits
directly on top of FR-F3's verification path. Test: "honours a client change
when the dialog opened with one prefilled" in `ticket-inline-add-prefill`,
which fails without the fix.

`features.json` (109) and `tests.json` (157) stay fully `implemented: true`;
this round fixed presentation and an adjacent blocker, not plan scope.

## Round 9 — location and billing profile on the grid layout (2026-10-15)

Operator, on `#ticket-details-bento-contact-tile`: "location and billing
profile are not visible on ticket (grid view)". Both were real, and both
mattered to this card: FR-F3 stamps a ticket's billing profile from the asset
it was raised against, and the grid layout — the default one — gave no way to
see or change the result.

- Location was a bare, unlabelled 12px line that only rendered when the ticket
  carried an explicit `location_id`. The list layout has always shown a
  labelled field that falls back to the client's default location marked
  `(Default)`, then to "No location specified". The grid tile now reads the
  same, with a pencil (`ticket-details-bento-location-edit`) opening a select
  (`-location-select`) and Cancel/Save, wired to the `handleLocationChange`
  TicketDetails already owned for the list layout.
- Billing profile was absent from the grid layout entirely — the picker was
  only mounted from `TicketProperties`. The tile now mounts the same
  `BillingProfilePicker` with the same copy, so decision D6 still holds: a
  client with one profile sees nothing at all, which is why the control cannot
  simply be a static row.

`TicketDetails` passes `onChangeLocation` / `onChangeBillingProfile` to the
grid layout as it already did to the list one, so both layouts save through one
pair of handlers and one toast.

The one-line location formatter lived twice (`TicketProperties`,
`QuickAddTicket`); rather than write a third copy for the tile it moved to
`packages/tickets/src/lib/formatTicketLocation.ts`, which `TicketProperties`
now imports. A drifting copy would have made the two ticket layouts disagree
about the same ticket.

Covered by `TicketBentoLayout.locationBilling.test.tsx` (eight cases: explicit
location, default fallback with its suffix, no locations at all, save, clear,
unchanged-is-a-no-op, and the picker's client/value wiring plus its absence
without a handler). The sibling `addTimeEntry` test's
`withDataAutomationId` mock gained `withUIReflectionId`, which `CustomSelect`
pulls in. One headless load of the operator's ticket confirmed the tile now
reads "Location — Main Office … (Default)" and "Billing profile — 234567".

No plan scope moved: `features.json` (109) and `tests.json` (157) stay fully
`implemented: true`, and all eleven standing feedback items were re-verified in
place (portal `can_interact`, REST `asset:create`/`asset:delete` and
`not_found → 404`, merge preview scoped by `client_id`, non-blocking
`assigned_asset`, nullable `asset_history.changed_by`, Tactical's
`applyRmmSignedInUserAssignment` on both sync paths, post-commit
`ASSET_UPDATED`, and the three minor bundles).

Observed and not fixed: pressing Escape while a ticket contact picker is open
raises the unsaved-changes confirmation while leaving the picker open above it.
Neither picker handles Escape, so the fix belongs to the shared
`ContactPicker`/`ClientPicker` in `packages/ui` and would land on every surface
in the product — out of this card's scope.

## Round 10 — drawers both ways, and a dragged status order (2026-10-16)

Two operator notes, both on surfaces this plan built.

**"contact should open in a drawer from asset details page, not go to whole
contact page and break navigation. and vice versa."** The assignee row
(FR-C6) linked to `/msp/contacts/[id]`, which threw away the asset the
operator was reading; the contact page's Assets tile (FR-C6/FR-E12) did the
same in reverse. Neither was laziness — `packages/assets` may not import
`packages/clients`, where the contact quick view lives, and the old comment in
`AssetAssigneeRow` said so.

The way across already existed for clients: `ClientDrawerContext` in
`@alga-psa/ui`, provided by the composition layer. `ContactDrawerContext` is
its twin (`openContactDrawer(contactId, { onChangesSaved })`), implemented by
the new `MspContactDrawerProvider`, which wraps the one hook that already
knows how to load a contact into the drawer
(`useContactQuickViewDrawer`). It is mounted in `MspAssetDetailClient` rather
than in `WorkspaceProviders`: a global mount would pull the contact quick
view tree into every `/msp` route's manifest, which this repo has paid for
before. The context stays optional, so `AssetAssigneeRow` still renders the
link where no provider is mounted — and a rename inside the drawer drops the
asset's SWR keys, so the row's own copy of the name catches up.

The reverse direction needed no context at all: the asset drawer belongs to
`packages/assets`. `useAssetDetailDrawer` holds the four pieces of state
(`AssociatedAssets`, `AssetDashboardClient` and `MspClientAssets` each keep
their own copy with extra list concerns of their own, so this is a fourth
caller, not a refactor of the first three), and `ContactAssetsSection` rows
became buttons that open it.

**"why do we need arrows in asset statuses table? if they are just for show -
remove them. if they govern order in dropdown - replace with drag and drop."**
They governed `display_order`, which `listAssetStatusRows` orders by and every
status select reads — so: drag and drop. Rows are draggable with a
`GripVertical` handle (`asset-status-drag-handle-<id>`), following
`StatusColumnsEditor`'s in-repo pattern; the handle is focusable and answers
ArrowUp/ArrowDown, which keeps the keyboard path the arrow buttons used to be.
Every column is now `sortable: false` on purpose: the order is the data, and a
sorted view would let someone drag rows into an order the server cannot store.

`reorderAssetStatuses` (action) → `reorderAssetStatusRows` (registry) writes
0..n-1 for the whole list in one transaction, because a drag can move a row
any distance and pairwise `display_order` swaps cannot express that. A list
naming a status the tenant does not have is refused as `not_found` instead of
renumbering the rows it recognises. `DataTable` gained an optional
`rowProps(record, index)` — the same shape as `rowClassName`, minus
`className`/`onClick` — so the drag handlers reach each `<tr>` without this
one settings screen hand-rolling its own table. `actions.moveUp`/`moveDown`
are gone from all eleven locales; `actions.reorder` and
`actions.dragToReorder` replace them.

Covered by `AssetStatusesManager.reorder.test.tsx` (handle present, arrows
gone, drag writes the new order, a drag that ends where it started writes
nothing, the keyboard move, and a refusal reloading the server's order),
`AssetContactDrawers.test.tsx` (assignee opens the drawer and stays put,
falls back to the link with no provider, contact page opens the asset
drawer), and a DB case in `assetStatuses.integration.test.ts` for the
reorder/stale-list pair. One headless load confirmed nine draggable rows with
no arrows, and the contact quick view opening over the asset page without
leaving it.

`features.json` (109) and `tests.json` (157) stay fully `implemented: true`:
this round changed how the plan's surfaces behave, not what they cover.

## Round 11 — the groups migration on a real Citus (2026-10-16)

The operator's CI run died on the one thing a plain-Postgres migration check
can never see:

```
SELECT create_distributed_table('asset_groups', 'tenant', colocate_with => 'tenants')
  - referenced table "client_locations" must be a distributed table or a reference table
```

`asset_groups.location_id` carried an inline composite FK to
`client_locations`, and `client_locations` is still a coordinator-local table
(the Citus local-table backlog). Citus refuses to distribute a table that
references one, because the two rows could not be proven to live on the same
node. Reproduced verbatim on `citusdata/citus:12.1` with a six-table skeleton
of the real distribution states, which also confirmed the three pieces of the
fix: the clients FK is fine (`clients` is distributed), the three group tables
distribute once the location FK is out of the way, and a database left
half-applied by the failed run comes forward after the leftover constraint is
dropped.

So the FK now follows the rule the repo had already written five times by hand
for exactly this column — `20250613190110`, `20260415120[0-3]00`,
`20260518120000` (`assets.location_id`) and `20260816010000`: add the
constraint only when both sides agree on distribution, skip it otherwise.
`20260816010000` left a LEVERAGE note asking for the probe to become a shared
helper the next time a migration needed it, so `isFkCompatible` and
`ensureCompositeFk` now live beside `ensureTenantDistribution` in
`server/migrations/utils/citusDistribution.cjs`. `ensureCompositeFk` also
drops an incompatible constraint it finds, which is what lets a half-applied
database distribute on the retry; the migration drops the old inline name
(`asset_groups_tenant_location_id_foreign`, the name knex generated) before
distributing for the same reason.

`20261009125000` got the same treatment: `assets` →
`client_billing_profiles` is a distributed pair, but
`rmm_organization_mappings` is not distributed by any migration in the chain,
and a single-node cluster accepts that FK where a multi-node one would not.
It is skipped rather than guessed, exactly as the ticket and project profile
columns are.

Nothing changes on plain Postgres: a scratch database ran both migrations and
came out with the same constraint names as before
(`asset_groups_tenant_location_id_foreign`,
`assets_tenant_billing_profile_id_foreign`,
`rmm_organization_mappings_tenant_billing_profile_id_foreign`), idempotent on
re-run and clean on `down()`. Where Citus drops the location FK, the invariant
is still enforced by `assertLocationOfClient` in
`packages/assets/src/lib/assetGroups.ts` — the same bargain `assets.location_id`
has lived with since 20260518120000.

Covered by `server/src/test/unit/migrations/assetGroupsCitusFk.test.ts`: six
probe cases (local referenced table, both distributed, no Citus, the add, the
skip, the leftover drop, the no-op) and four source-contract cases pinning the
ordering — no inline `client_locations` FK, the leftover drop before
distribution, `ensureCompositeFk` after it, and both profile FKs routed
through it.

### Round 11b — the arrow keys moved the wrong status

The browser check on round 10 found the keyboard half of the new drag order
eating itself: focus the grip on "In repair", press ArrowDown once and it
moves, press it again and *Inactive* moves instead, undoing the first move.

`DataTable` keys its rows by position (`row.original.id` if the record has
one — an `AssetStatus` has `status_id`), so React reuses the `<tr>` and its
grip when the order changes: the focused button stays at the index it was at
and simply starts describing a different status. The row index the handler
closes over is therefore right, and the focus is on the wrong row.

`moveByKeyboard` now remembers the status it moved and puts focus back on that
status's own handle (`asset-status-drag-handle-<id>`) after the local reorder
and again after the server write, so a run of arrow presses walks one status
down the list the way the operator expects. It only chases focus while focus is
still on a grip, so a reload that lands after the operator has tabbed away does
not snatch it back.

The test mock now keys its rows by position like the real table does —
`AssetStatusesManager.reorder.test.tsx` had hidden the bug with a stable key —
and a new case replays the operator's repro: two ArrowDowns move the same
status two places (and the case fails without the focus restore).

## Round 12 — the red lanes, and a board that needed a reload (2026-10-16)

Three checks were red on PR #3763 (`citus / Combined migrations on single-node
Citus`, `unit / Nx affected unit tests`, and the `Production regression
readiness` gate that only aggregates them). All of it traced back to this card.

### Two Temporal tests carried their own copy of the seed list

The asset-status group added onboarding seed `11_asset_statuses.cjs`, and two
tests hand-maintain the list of what onboarding writes:

- `product-upgrade-operations.integration.test.ts` asserted the nine filenames
  `backfillPsaSeeds` returns; it returns ten now, and `listProductSeedFiles`
  sorts lexicographically so `11_` lands last. The seed was also added to
  `seededTables` (so the idempotence re-run covers it) and to
  `engineCleanupTables`, plus a builtin-slug assertion mirroring the
  `asset_type_registry` one already there.
- `tenant-creation-workflow.e2e.test.ts` clears the tables onboarding fills
  outside the basic rollback. `asset_statuses` was missing, so its FK to
  `tenants` blocked `rollbackTenantInDB` and the tenant row outlived the test —
  the CI postgres log said so verbatim
  (`violates foreign key constraint asset_statuses_tenant_foreign`).

Production `rollbackTenantInDB` was deliberately left alone: by convention it
does not delete onboarding-seeded rows (`asset_type_registry`, `statuses` and
`tax_regions` are equally absent) and the tests compensate with explicit lists.

### The delete dialog threw away the destination the operator picked

`DeleteStatusColumnDialog` reset its destination from an effect keyed on
`moveTargets.length`, so any render that changed the length of the destination
list overwrote a choice already made and the tasks went to the first column.
The pick is now held on its own and cleared only when the dialog opens for a
different column, with a fallback for targets that arrive late or vanish. The
new regression case fails against the old code with the exact CI symptom
(`'m1'` instead of `'m3'`).

### The board only believed the move after a reload

The browser check then found the other half: delete a column with three tasks
in the project edit drawer, pick a destination, Move & Delete, Save and Close —
and the kanban showed the destination column empty while the list view still
filed all three tasks under the column that had just been removed. A reload
fixed it.

`ProjectDetail` re-reads its statuses, its phase fork counts and its tasks
whenever `statusVersion` changes, and an in-board status edit bumps it
(`onStatusesChanged`). The edit drawer lives in `ProjectInfo`, a sibling under
`ProjectPage`, so nothing bumped it there: the status columns came back fresh
from `getProjectMetadata` while the tasks stayed as they were, still pointing
at the deleted mapping.

`ProjectInfo` now reports the drawer's close — on Save *and* on Cancel, because
a deletion inside the drawer is already written by then — `ProjectPage` turns
that into a `statusRefreshKey`, and `ProjectDetail` folds the key into the same
`statusVersion` its own edits bump, so the two sources cannot cancel each other
out. Pinned by `projectStatusRefreshWiring.contract.test.ts`, following the
contract-test convention `ProjectDetail` already uses (it is far too large to
mount).

## Round 13 — the list view kept its own copy (2026-10-16)

Round 12 fixed the kanban half; the browser check confirmed it (the three tasks
appeared under Blocked with no reload) and then found the other half: switching
to **List** still showed the deleted "In Review" holding all three tasks and
Blocked holding none, until a reload. An adjacent probe found the same staleness
from the other direction — a status column added in the drawer was missing from
a task's status picker until a reload.

Both are one cause. The list view does not read the board's per-phase state: it
buckets `allProjectTasks` with `statusesByPhase`, and its row status picker
offers exactly the columns those groups carry
(`TaskListView.tsx`: `statusesByPhase[phase.phase_id] ?? statuses`, then
`phaseGroup.statusGroups.map(sg => sg.status)`). Both come from the one
project-wide fetch in `ProjectDetail` (`getProjectTaskData` +
`getProjectStatusesByPhase`), and that effect was keyed on `project.project_id`
alone — mount only. So the column list and the tasks' mapping ids stayed exactly
as they were loaded, which is precisely what the screenshots show. That fetch now
watches `statusVersion` like the phase-task and fork-count re-reads beside it.

Second gap, found while confirming the first: the status editor writes adds and
deletes immediately (`ProjectTaskStatusSettings`: "Adding or deleting a column
writes immediately" — only the phase scope toggle and the column order are
staged for Save Changes). Round 12 reported the close from the drawer's Save and
Cancel handlers, so dismissing it with Escape or the header X — after a delete
that had already moved tasks — left the board stale again. `ProjectInfo` now
passes the report as the `onClose` argument of `openDrawer`, which
`closeDrawer()` fires for every dismissal, Save and Cancel included (they both
end there), so there is one path instead of two partial ones.

The contract test gained a case for the project-wide re-read (including the
`TaskListView` coupling it depends on) and its drawer case now pins the
`onClose` wiring. packages/projects: 104 files / 567 tests green.

## Round 14 — Save and Close never reported the close (2026-10-16)

Round 13's re-read was right and still did not help, because the report that
feeds it never fired on the path the browser check used. Its own evidence said
so precisely: dismissing the drawer with **Escape** or the header **X** did
refresh (a status added in the editor showed up in the list's row picker
straight away, and deleting an empty column updated the list), while **Save and
Close** left the deleted column sitting in the list with all three tasks under
it until a reload.

`DrawerContext` memoizes `closeDrawer` on the current history entry:

```ts
const closeDrawer = useCallback(() => {
  if (currentEntry?.onClose) currentEntry.onClose();
  dispatch({ type: 'CLOSE_DRAWER' });
}, [currentEntry]);
```

`ProjectInfo.handleEditClick` builds the `onSave`/`onCancel` closures *as it
opens the drawer*, so the `closeDrawer` they capture is the one from the render
before the drawer existed — when `currentEntry` was `null`. Calling it closes
the drawer and skips `onClose` entirely. Escape and the header X are different:
they dismiss through `DrawerOutlet`, which reads `closeDrawer` from the context
on every render and therefore always has the entry. That is the whole split in
the screenshots.

Round 12 had Save and Cancel call `onStatusesChanged` directly, which worked;
Round 13 moved the single report to `onClose` to cover Escape and X, and in
doing so handed the two main paths to a stale closure. Both are needed, so both
are there now: `onClose` for the dismissals that never reach a handler, and an
explicit call in `onSave` and `onCancel` for the ones whose `closeDrawer` cannot
fire it. Each path reports exactly once.

The contract case for the drawer now pins both halves and carries the reason, so
the next round cannot trade one for the other again; it fails against the old
file with `expected 'onSave={(updatedProject) => {…' to contain
'onStatusesChanged?.();'`. The shared `closeDrawer` was left alone on purpose —
making it stale-proof would change when `onClose` fires for every drawer in the
app, which is far outside this card.

### CI

The three red lanes on PR #3763 (`unit`, `citus`, and the readiness aggregator
that only reports them) were all raised against the pushed head `94a11c7f18`,
which predates the fixes. Confirmed from the run's own logs:

- `unit` — one failure, `ProjectTaskStatusSettings.test.tsx > delete flow >
  requires a destination when the column still holds tasks`; fixed by
  `1a937f2865`.
- `citus` — two failures, `tenant-creation-workflow.e2e` (the `asset_statuses`
  FK outliving `rollbackTenantInDB`) and `product-upgrade-operations`
  (`11_asset_statuses.cjs` missing from its hand-kept seed list); both fixed by
  `da94eca92f`.
- The operator's `create_distributed_table('asset_groups', …)` failure is gone:
  this run distributes `asset_groups` and `asset_assignments` and logs
  `asset_groups and client_locations have incompatible distribution - skipping
  foreign key asset_groups_tenant_location_id_foreign`, which is what
  `06b26e3577` set out to do.

So nothing further was needed for CI beyond pushing what is on the branch.

## Round 15 — current with main, and two guard rails (2026-10-16)

### The branch was behind main again

The three red lanes were raised against a head that predates every fix on the
branch, so the one thing standing between the PR and a green run was being
current. `origin/main` had moved on by 13 commits (`3182eecf73`, the
invoice-billing-email gate). Merged: **no conflicts, and not one file touched on
both sides** — `comm -12` over the two diffs against the merge base
`fedefafb07` is empty, so there is no semantic overlap either. Main's side is
invoicing (`exportRecipientEmails`, recurring/template editors) and three new
`packages/ui` pieces; this branch's side is assets, groups and merge.

Checked after merging rather than assumed:

- `server` `tsc --noEmit` — 0 errors (needs `--max-old-space-size=12288` on
  node 25; 8192 now OOMs during bootstrap).
- `packages/assets` and `shared` `tsc --noEmit` — clean.
- `packages/assets` 57 files / 349 tests, `shared/rmm` 6 files / 42 tests — all
  pass.
- No migration-timestamp collision with main: main added none, and the
  `20261009120000` pair (`add_asset_procurement_fields` vs main's older
  `service_prices_display_order`) sorts deterministically by filename and the
  two touch different tables.

### An unseeded tenant could not save an asset at all

`validateAssetStatusSlug` was the one status reader with no builtin fallback —
`listAssetTypes`, `listDeployableStatusSlugs` and the form selects all have one.
A tenant whose `asset_statuses` is empty (the seeding gap that already bites
`standard_statuses` reaches this table through the same door: appliance and
hand-made tenants that never ran the onboarding seed) would have had *every*
asset create and update refused with `unknown_status`, with no way to set a
status that would be accepted. Now an empty registry accepts the five builtin
slugs and nothing else; a seeded registry is unchanged, so this cannot mask a
real typo. `packages/assets/src/lib/assetStatusRegistry.test.ts` pins all six
cases (known slug, unknown slug, archived-only-if-unchanged, the fallback, an
invented slug on an unseeded tenant, empty input); the fallback case fails
against the old file.

### Two bare `catch {}` blocks outlived the decision to stop writing them

Round 5 introduced `isMissingAssetGroupTable` so a pre-groups schema could be
absorbed without hiding anything else, but the workspace-membership lookups in
`shared/rmm/autoAssignFromSignedInUser.ts` and
`shared/rmm/signedInUserMappings.ts` still swallowed every error. Inside a
transaction that is worse than noisy: an aborted transaction surfaces as an
error on the next statement, and swallowing it here reads as "not a workspace
member" — which is exactly the case FR-E4 says must never be auto-assigned.
Both now rethrow anything that is not `42P01` on an `asset_group*` relation.

### Provenance of the changes that are not in features.json

Noting these so they are not read as volunteered scope:

- `packages/projects` (`1a937f2865`, `615a707063`, `3e0e444e92`,
  `db40dc8449`) — `1a937f2865` is the fix for the `unit` lane's only failure.
  The other three answer the pipeline's own browser check, which reported the
  project edit drawer leaving the board and list stale after a status delete.
  Both are pipeline findings against this PR, not product work chosen here.
- `packages/tickets` (`cb226627ee`) — the operator's browser feedback, verbatim:
  "location and billing profile are not visible on ticket (grid view)". The
  billing-profile picker is FR-F5's surface; the location row rides with it
  because the grid layout had neither.
- `retireVanishedTacticalAssets` (`0be22e63cc`) — the standing feedback on
  FR-B6 for Tactical, verbatim: "Tactical create also still hard-codes status
  'active' … and has no tombstone path writing 'retired'". It is deliberately
  full-sync-only and treats an empty agent list as "could not see the fleet",
  so an incremental page or an API hiccup cannot retire a fleet.

Lifting the projects and ticket work into their own PRs is the reviewer's
preference and a fair one, but it needs a push and a second PR, neither of
which is this round's to make.

## Round 16 — the red lanes, verified fix by fix (2026-10-16)

### What is actually red, and why each fix answers it

`gh pr checks 3763` shows four red lanes, all from run `38958408374` against
pushed head `94a11c7f18`. Two of them are gates with nothing of their own to
fix: `Production regression readiness` logs `red lanes: citus:failure,
unit:failure` and `citus / Citus execution complete` is the citus job's own
rollup. So there are two real failures, and both already have a commit:

- **`unit / Nx affected unit tests`** — `Failed tasks: @alga-psa/projects:test`,
  one assertion: `ProjectTaskStatusSettings.test.tsx:171`, "requires a
  destination when the column still holds tasks", received `['m2','m1']` where
  `['m2','m3']` was expected — the destination pick being reset out from under
  the operator. Fixed by `1a937f2865`. Re-ran the whole package here, not just
  that file: **104 files / 567 tests, all pass.**
- **`citus / Combined migrations on single-node Citus`** — two failures in
  `ee/temporal-workflows`, both the asset-status onboarding seed showing up in
  hand-maintained lists:
  - `product-upgrade-operations`: `expected [ '01_roles.cjs', …(9) ] to deeply
    equal [ '01_roles.cjs', …(8) ]`, diff `+ "11_asset_statuses.cjs"`. The fix
    adds that filename last (it sorts after `10_`), which is where
    `backfillPsaSeeds` returns it.
  - `tenant-creation-workflow.e2e`: `expected { …(19) } to be undefined`, from
    `delete from "tenants" … violates foreign key constraint
    "asset_statuses_tenant_foreign"`. The fix adds `asset_statuses` to the list
    the test clears *before* `rollbackTenantInDB`, next to
    `asset_type_registry` which is there for the same reason.

  Both in `da94eca92f`. Checked rather than trusted: the seed is
  `ee/server/seeds/onboarding/psa/11_asset_statuses.cjs`, its five builtin slugs
  are exactly the set the test now asserts (`active`, `in_stock`,
  `maintenance`, `inactive`, `retired`), and the cleanup loop runs before the
  rollback call, not after.

  The migration chain itself is **not** part of this failure — it completed, and
  the job's log shows `asset_statuses`, `asset_assignments` and `asset_groups`
  all `distributed`, with the one composite FK Citus cannot support reported as
  `asset_groups and client_locations have incompatible distribution - skipping
  foreign key asset_groups_tenant_location_id_foreign`. That is the deferred
  `ensureCompositeFk` from round 11 doing its job, and it is the operator's
  original `create_distributed_table` error staying fixed.

Also confirmed no *other* hand-maintained list went stale with the new tables:
`tenant-deletion-activities.ts` already carries `asset_statuses`,
`asset_assignments`, `asset_group_members`, `asset_group_contacts` and
`asset_groups` in the right order, and `Validate Tenant Management Schema` is
green.

### FR-B6: ingestion now writes only the two slugs it owns

The last open note from the review. On create, shared ingestion read
`snapshot.status || (offline ? 'inactive' : 'active')`, and `status` is a loose
`string` on the contract. Every mapper sends `active` or `inactive` today —
Level.io, Tanium, NinjaOne and Tactical were each checked — so nothing changes
in practice, but a provider that invents its own word ("Decommissioned") would
have landed a slug no `asset_statuses` row defines, and the status select would
then show an asset a status it cannot offer. Ingestion now accepts only those
two and otherwise falls back to the connectivity reading.
`sharedAssetIngestionService.test.ts` pins all four combinations; the two
"Decommissioned" cases fail against the old expression (verified by reverting
it and re-running).

### Still outstanding, and whose it is

The branch is **0 behind / 84 ahead** of `origin/main` and `mergeable`;
`mergeStateStatus: BEHIND` is purely the stale remote head. Every fix above is
committed. Pushing is the one remaining step and it is not this round's to
take — the pipeline pushes and watches the run.

Two review notes stay open by choice, both recorded here rather than silently
dropped: the ~30 `tests.json` ids with no test literally carrying the id (the
behaviours are covered by descriptively-titled tests), and lifting the
`packages/projects` / `packages/tickets` work into its own PR. Both are
housekeeping against a PR the operator wants merged now, and the second needs a
push either way.

## Round 17 — proving the unpushed head is CI-clean (2026-10-16)

The review's blocking note was that the newest commits carry no CI run: the
two red-lane fixes are committed, but nothing green has ever been observed on
`f0f3130d9e`. Pushing is still not this round's to take, so instead of
asserting readiness this round *reproduces the lanes locally* and classifies
every residual failure with evidence.

### The lane inventory says only two things were ever broken

`gh pr checks 3763` has 40+ passing lanes against the stale head and four red:
`Production regression readiness` and `citus / Citus execution complete` are
rollups that only echo the other two, so the whole PR rests on `unit / Nx
affected unit tests` and `citus / Combined migrations`. Both fixes re-verified
here rather than trusted:

- The citus seed fix: `ee/server/seeds/onboarding/psa/` really does end at
  `11_asset_statuses.cjs`, and `product-upgrade-operations` now expects exactly
  that list with the new file last. The e2e rollback fix adds `asset_statuses`
  to the pre-`rollbackTenantInDB` delete list beside `asset_type_registry`. The
  other four new tables need no entry there — a freshly created tenant has no
  assets, so no rows exist to block the tenant delete.
- The projects fix was re-run as a whole package (567 tests) last round.

### Every package this branch actually edits, re-run at this HEAD

`nx affected` lists 55 projects, but only 17 are directly edited; the rest are
transitive through `types`/`ui`/`core`. All directly-edited ones now pass at
`f0f3130d9e`: assets 349/349, integrations 1111/1111, ui 735/735, types
138/138, client-portal 393, tickets 1304, billing 1942, msp-composition 39,
plus projects/clients/authorization/core/shared from the previous rounds.
`packages/assets` mattered most — `92f4702372` changed the status registry that
gates every create and update, and the full suite had not been re-run since.

Four residual local failures, each proven environmental rather than branch-made:

- **tickets (3) and client-portal (2)** — `window.localStorage.setItem is not a
  function` at `packages/ui/src/components/DataTable.tsx:453`. That file is in
  the diff, so this needed ruling out properly: the diff touches *zero*
  localStorage lines (it adds `rowProps`), both test files are byte-identical
  to `origin/main`, and giving Node a valid `--localstorage-file` makes all five
  pass. It is the Node 25 native `localStorage` global shadowing jsdom; CI runs
  Node 22, which has no such global.
- **billing (1)** — `QuoteForm.terms` expected `2026-11-15`, got `2026-11-16`.
  The branch does not touch `packages/billing` at all, and the file passes
  7/7 under `TZ=UTC`, which is what the runners use. A local EDT artifact.
- **msp-composition (1 suite, 0 tests)** — a collection error, so it could not
  be dismissed as a Node quirk. It is `Failed to resolve entry for package
  "@alga-psa/workflow-streams"` reached *through* `packages/assets/dist`. Every
  link in that chain predates the branch: `workflow-streams` has an `nx:noop`
  build whose `exports` still point at a `dist/index.mjs` nothing ever writes,
  `assetActions` imports it on `origin/main` too, and `MspRecurringTickets.tsx`
  (untouched here) is what pulls assets in. It only fires because this worktree
  has a gitignored `packages/assets/dist` built per the plan's instructions —
  CI starts clean. The four msp-composition files the branch does edit are
  byte-identical to `94a11c7f18`, the head whose run passed this package.

No branch-caused failure surfaced anywhere. Also confirmed the two migration
filenames that looked duplicated in `git log --name-only`
(`..._billing_strategy`, `..._nullable_actor`) are renames, not a double
migration: only `20261009125100` and `20261009125200` exist on disk.

### T090 now has the database test it claimed

The one review finding that was mine to fix. `tests.json` marked T090
implemented on the strength of `assetGroupsCitusFk.test.ts`, but that file pins
the Citus FK probe — not the constraints T090 describes. New
`server/src/test/integration/assetGroups.integration.test.ts` exercises them
against real Postgres: a second group for an already-grouped asset rejected by
`asset_group_members_tenant_asset_uk` (and the first membership left intact),
the same asset twice in one group, both valid `kind` values accepted with
`workspace` and `''` refused by `asset_groups_kind_check`, `owner`/`user`
accepted with `viewer` refused by `asset_group_contacts_role_check`, and the
`ON DELETE CASCADE` clearing members and contacts. Five tests, green, and green
alongside the other four asset integration files (36 together) so the tenant
fixtures do not collide. `asset_id` and `contact_name_id` use bare UUIDs on
purpose — the migration puts no FK on either, so the subject is the constraint.

### What is still not done, and why

Lifting `packages/projects` and `packages/tickets` into their own PR remains
the reviewer's open preference. It needs a push and a second PR, and both
bodies of work answer standing operator feedback (the ticket grid's missing
location/billing-profile row, verbatim; the project board going stale after a
status delete, from this PR's own browser check), so dropping them here would
regress feedback this card is told to hold. Recorded, not silently skipped.
