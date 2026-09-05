# Scratchpad — Asset-driven maintenance operations

## Ground truth discovered (2026-08-22, design session)

### Existing foundation
- Tables (migration `server/migrations/20241112031334_create_maintenance_scheduling.cjs`):
  - `asset_maintenance_schedules` (tenant, schedule_id, asset_id, schedule_name, description, maintenance_type, frequency, frequency_interval, schedule_config jsonb, last_maintenance, next_maintenance NOT NULL, is_active, created_by, timestamps). Indexes on (tenant, next_maintenance). RLS tenant policy.
  - `asset_maintenance_history` (schedule_id, asset_id, maintenance_type, description, maintenance_data jsonb, performed_at, performed_by).
  - `asset_maintenance_notifications` (schedule_id, asset_id, notification_type upcoming|due|overdue, notification_date, is_sent, sent_at, notification_data). **Write-only today**: only 'upcoming' rows ever inserted, nothing sets is_sent, no delivery job.
  - `20260728100000_allow_corrective_maintenance_type.cjs` widened the type CHECK to include 'corrective' (Citus-safe NOT VALID + VALIDATE pattern to copy).
- Actions in `packages/assets/src/actions/assetActions.ts`: createMaintenanceSchedule (2014), updateMaintenanceSchedule (2092), deleteMaintenanceSchedule (2182, hard delete w/ cascade), recordMaintenanceHistory (2220), getAssetMaintenanceSchedules (2309), getAssetMaintenanceReport (2352), getClientMaintenanceSummary/Summaries (2435/2862), getAssetLinkedTickets (2414). All `withAuth` + tenant-scoped + `hasPermission(user,'asset',…)` + `createAuthorizedAssetReadContextForUser`.
- **Recurrence calc is SQL CASE in recordMaintenanceHistory (lines 2266-2275)**, anchored on `performed_at` (drifts; that matches the card's chosen default: advance from actual completion). `custom` frequency silently falls back to daily — bug to fix or gate.
- **Compliance rate is a fake proxy**: `min(100, historyCount / SUM(frequency_interval) * 100)` — card requires a real on-time definition.
- **No occurrence table, no tenant-wide due/overdue query exists** — `getClientMaintenanceSummary` counts `next_maintenance < NOW()` per client only.
- Asset↔ticket linkage = `asset_associations` (entity_type 'ticket'); `createAssetAssociation` publishes ASSET_ASSIGNED workflow event; `fetchAssetLinkedTickets` (2571) joins tickets/statuses/priorities.
- Ticket creation surfaces: `QuickAddTicket` reached via `AssetCrossFeatureContext` (`renderQuickAddTicket`, `openTicketDetailsDrawer`, `createTicketFromAsset`) provided by `packages/msp-composition/src/assets/MspAssetCrossFeatureProvider.tsx` — keeps @alga-psa/assets free of a tickets dependency. Reuse this, do not import tickets directly.
- Desktop UI today: `MaintenanceSchedulesTab.tsx` (raw Table in Cards, no completion UI; history shows raw performed_by uuid) + `CreateMaintenanceScheduleDialog.tsx` (name/description/type/frequency/interval/next date/active-on-edit; 'corrective' and 'custom' not offered). Mounts in `AssetDetailTabs.tsx` and `AssetBentoLayout.tsx` (SWR keys `['asset', id, 'maintenance']` shared).
- `/msp/assets/maintenance/page.tsx` = FeaturePlaceholder stub.
- REST API exists: `/api/v1/assets/[id]/maintenance`, `/maintenance/record`, `/api/v1/assets/maintenance/[scheduleId]` via ApiAssetController/AssetService.
- Mobile: `ee/mobile/src/screens/AssetDetailScreen.tsx` + `ee/mobile/src/api/assets.ts` already record completion via the same record endpoint.
- Page-shell conventions to copy: `server/src/app/msp/assets/page.tsx` (enforceServerProductRoute, getSession/getCurrentUser, force-dynamic) → client shell in `packages/assets` composed through `packages/msp-composition`. Toolbar Card + DropdownMenu checkbox filters + active-filter badge pills + SummaryTile strip + `DataTable` (columnLibrary pattern) + drawers via useDrawer + react-hot-toast + `withDataAutomationId` ids on everything.

### Decisions (design session)
- UI direction: **decided 2026-08-22 — "Option C2"**: Command Center backbone (KPI band + master-detail split + Plans/History tabs) with a List | Calendar toggle in the work-queue left pane; both views select into the same detail pane. Reference mockups were built in /tmp/maintenance-option-{a,b,c,c2}.html (not committed).
- Occurrence model: introduce `asset_maintenance_occurrences` table rather than overloading schedule rows — needed for auditable idempotency (one open ticket per occurrence) and skip/cancel audit. (Card explicitly allows/anticipates this; confirm in review.)
- Next-due rule: advance from actual completion date (matches existing SQL and card default); rule shown in completion UI.
- v1 ticket policy: manual create from occurrence, idempotent (unique open ticket per occurrence); no auto-generation.

### Commands
- Dev server: card service on port 3307, compose project alga-psa-local-test, cwd `<worktree>/server`.
- Login: glinda@emeraldcity.oz (password printed in dev-server boot banner; rotates).
- Seeds: `server/seeds/dev/64_asset_maintenance.cjs`.

### Gotchas
- Citus: composite (tenant, …) PKs; new tables must be distributed on tenant like siblings; CHECK changes use NOT VALID + VALIDATE.
- History TS interface has `notes?` but table column is `description` — mismatch to be careful with.
- Delete schedule cascades away history — card requires archival semantics instead.
