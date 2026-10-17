# Scratchpad — Mobile 2.0: Projects, Assets with site audit, Home, Search

- Plan slug: `mobile-2-0-projects-assets-home-search`
- Created: `2026-10-14`

## What This Is

Working memory for the 2.0 mobile release. Short bullets; update earlier notes when a decision changes.

## Decisions

- (2026-10-14) Scope = Projects tab, Assets tab + site audit, Home, Search; offline outbox is a stretch in its own commit groups (`outbox-server`, `outbox-mobile`). Left out on purpose: quotes/invoices, KB, timesheet submit, iOS Live Activity, AI drafting.
- (2026-10-14) Audit is server-backed (`asset_audits` + items), not device-only, so it survives app restarts and shows on the web through `asset_history` rows (change_type `audit`). No automatic status change on missing (Q2).
- (2026-10-14) Audit default scope = statuses whose kind is `deployable` or `pending`; this relies on the status registry from the asset branch, so the Assets group depends on that branch merging.
- (2026-10-14) Mobile stays read-only for groups/assignments/status (asset plan non-goal). Audit writes only audit tables, `asset_history`, and `assets.last_audited_at/last_audit_result`.
- (2026-10-14) Projects: no project/phase create or edit on mobile; "Mine" = project manager filter (`assigned_to`) because the v1 list has no has-my-tasks filter (Q3).
- (2026-10-14) Home is the first drawer route; nav persistence still restores the last screen on relaunch.
- (2026-10-14) Search requests only result types the app can route, driven by capabilities.

## Discoveries / Constraints

- (2026-10-14) **Asset branch** `feature/asset_assignments_bundles_merge` lives in worktree `~/Desktop/projects/alga-psa-mc14` (mission-control card 28d11dc6, slot 14), 38 commits ahead of main, all 109 plan features marked implemented. Adds migrations 20261009120000..126000 (procurement fields, `asset_statuses`, `asset_assignments`, rmm contact assignment mode, `asset_groups`, billing profile, merge billing strategy), REST `/asset-statuses`, `/asset-groups[...]`, `/assets/{id}/assignments`, and touches `ee/mobile/src/{api/assets.ts, screens/AssetDetailScreen.tsx, i18n/locales/en/assets.json}` (read-only fields). Our Assets work edits the same three mobile files: rebase on it, don't fork it.
- (2026-10-14) `asset_statuses.kind` CHECK: deployable | pending | undeployable | archived. Builtins: active, in_stock (deployable), maintenance (pending), inactive (undeployable), retired (archived). `assets.status` holds the slug.
- (2026-10-14) v1 asset list filters already on main: `search` (asset_tag, name, serial_number, location, manufacturer, model), `client_id`, `location_id`, `contact_name_id`, `asset_type`, `status`. No server change needed for the Assets list.
- (2026-10-14) v1 projects: list filters `project_name, client_id, status, assigned_to, contact_name_id, is_inactive, is_closed, has_assignment, dates, client_name, wbs_code`; status enum `planning|active|on_hold|completed|cancelled|in_progress`; `/projects/{id}` returns phases + assigned_user + counts; task create is `POST /projects/{id}/phases/{phaseId}/tasks` and REQUIRES `project_status_mapping_id` (get from `/projects/{id}/task-status-mappings`); `PUT /projects/tasks/{taskId}` takes partial create schema (assigned_to, due_date, priority_id, …). `/projects/{id}/tasks` is GET only. No server change needed for Projects.
- (2026-10-14) Mobile `ProjectTaskDetailScreen` today: StatusPicker, CommentsSection, checklist, WorkItemTimerChip, `updateProjectTask` for status only; shows due_date/estimated_hours read-only. Route param `{ taskId, activity? }`. Deep link `alga://project-task/:taskId` + hosted `/msp/projects/{id}?taskId=` fold in `navigation/linking.ts`.
- (2026-10-14) Mobile `AssetDetailScreen` already does history, maintenance (mark done), software, notes (BlockNote flatten/append), tickets, link/create ticket. Scanning lives in `features/inventory/components/ScanView.tsx` using `lookupInventoryCode` (`/api/v1/inventory/lookup` → product | unit | asset | none) and `RegisterAssetModal` for unknown codes. Reuse both for the audit scanner.
- (2026-10-14) `LocationPickerField` in inventory is for STOCK locations (`listStockLocations`), not client locations. Audit setup must use the client locations call from `src/api/clients.ts` (used by CreateTicket).
- (2026-10-14) Capabilities: `MobileCapabilitiesService.getMyCapabilities` computes crm flags for every product, and inventory/opportunities/projects only when `getTenantProduct(tenant) === 'psa'`. Add `assets` + `assetAudit` in the PSA block. Mobile parser `parseFeatureCapabilities` defaults unknown keys to false (older servers safe).
- (2026-10-14) `productSurfaceRegistry.ts`: `/api/v1/projects` and `/api/v1/assets` are in `api_psa_only`; a new `/api/v1/asset-audits` prefix MUST be added there or `routeRegistryFilesystemInventory` contract test fails (lesson from PR #3404). `/api/v1/search` was not found by grep in the registry; check which group covers it before relying on it from mobile with `x-api-key`.
- (2026-10-14) Drawer has no `initialRouteName` (Tickets is first by order). Gating test: `navigation/DrawerNavigator.gating.test.tsx`.
- (2026-10-14) Mobile ships `en` locale only (`src/i18n/locales/en/*.json`); namespaces per feature. New: `projects.json`, `home.json`, `search.json`; extend `assets.json`.
- (2026-10-14) Mobile has no global search API wrapper and no Home screen today; offline = `network/isOffline.ts` + `useNetworkStatus` + TTL caches (`cache/*.ts`), no write queue.
- (2026-10-14) ECTS 2026-10-09 PDF "AlgaPSA Open Tasks" lists 5 web-side requests (custom fields, vendor contacts, hide projects from portal, custom menu, multiple project contacts). None are mobile; not in this plan.

## Commands / Runbooks

- Mobile: `cd ee/mobile && npm run test` (regenerates editor HTML first), `npm run lint`, `npm run typecheck`. Dev against local server: `EXPO_PUBLIC_ALGA_BASE_URL=http://<mac-ip>:3000 npx expo start`. Local server must be EE (`server/.env.local` edition override to community makes mobile refuse) and migrated from `server/` (`npm run migrate:ee`; root `npm run migrate` has no knexfile).
- Server typecheck: `NODE_OPTIONS=--max-old-space-size=14336` or tsc silently OOMs. Run it UNFILTERED after any merge.
- OpenAPI: from `sdk/`: `npx tsx --tsconfig ../server/tsconfig.json scripts/generate-openapi.ts --edition ce` then `--edition ee`; root `npm run mcp:registry:generate`; nm-store copy via `alga-openapi-sync` skill.
- Mobile lockfile: CI runs npm 10 and needs the top-level `expo-font` peer placeholder; if `npm ci` fails on CI, rebuild the lock from main's (see PR #3593 round 1).
- Asset branch inspection: `git -C ~/Desktop/projects/alga-psa-mc14 log --oneline main..HEAD`.

## Links / References

- Customer ticket: alga-2026-0002627 (ECTS, Jason Flagg) — audit ask on 2026-10-01, confirmation of create/edit on 2026-10-09.
- Asset plan: `ee/plans/2026-10-09-asset-fields-assignment-bundles-merge/` (on the mc14 worktree).
- Theme plan (shipped, pattern for capabilities-driven features): `ee/plans/2026-09-14-mobile-theme-pairs/`.
- Older improvement list: `.ai/mobile-app-improvements.md` (items 10, 11, 13, 15 there are stale; documents, materials and avatars shipped since).
- Key files: `ee/mobile/src/navigation/{DrawerNavigator,RootNavigator,types,linking}.ts(x)`, `ee/mobile/src/api/{capabilities,assets,projectTasks,tickets,schedule,activities,inventory}.ts`, `server/src/lib/api/services/{MobileCapabilitiesService,AssetService,ProjectService}.ts`, `server/src/lib/api/schemas/{asset,project}.ts`, `server/src/lib/productSurfaceRegistry.ts`, `server/src/lib/api/controllers/ApiSearchController.ts`.

## Open Questions

- Q1–Q6 in PRD. Blocking for the Assets group: Q1 (ship order with the asset branch). Everything else has a recommended default and can proceed.
