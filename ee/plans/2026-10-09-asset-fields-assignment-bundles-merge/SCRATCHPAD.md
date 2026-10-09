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
