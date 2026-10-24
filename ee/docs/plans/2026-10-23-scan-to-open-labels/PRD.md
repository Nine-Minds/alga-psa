# PRD: Scan to open labels (C3 of alga-2026-0002683)

Source of truth: `ee/docs/plans/2026-10-20-physical-work-tags/design-C3-scan-to-open-labels.md` (design of record). This PRD summarises it; where they differ, the design wins. Context: `ANALYSIS.md`, `PLAN.md` in that folder and C1's `ee/docs/plans/2026-10-20-label-rendering-foundation/PRD.md`.

## Problem
Alga labels (C1) carry QR codes with canonical record URLs, but the mobile scanner sends every code to inventory lookup, hosted deep links only cover tickets/tasks, and the web has no stock-unit or RMA detail view. Asset REST reads skip `asset:read` and record-level checks.

## Goals
1. Mobile scan of a ticket / asset / stock-unit label opens TicketDetail / AssetDetail / StockUnitDetail, including on self-hosted servers (in-app scanner, no universal links needed).
2. A scan the user cannot open (403, 404, cross-tenant) shows "Not found, or you don't have access" and no record content.
3. Asset REST reads enforce product gate -> `asset:read` (403) -> load -> record-level check (404 identical to missing).
4. Deep links and app-link claims for assets and stock units.
5. Web: unit detail dialog via `?unitId=`, RMA detail dialog via `?rmaId=`, Print label from the unit dialog.

## Non-goals
RMA/project/box labels (C5/C6), mobile Project/RMA screens, mobile printing, batch printing, ticket/asset print buttons (C2), changing ticket REST status codes, claiming `/msp/projects/*`, universal links on self-hosted domains, `InventoryService.lookup` asset filter (B2 / #3819), `[id]` routes.

## Design decisions
- Classifier `ee/mobile/src/features/inventory/scanRouting.ts` `classifyScannedCode(code, baseUrl)` -> `record | foreign-record | code`; uses `matchRecordPath` only; trusted origin = the API client's `baseUrl`.
- Scanner navigates only; destination screen's REST read authorizes.
- Foreign-origin record URLs are never fetched, looked up or opened; "Open in browser" rebuilds with `recordUrl(..., baseUrl)`. Mismatch logs host only at warn.
- Asset record-level denial = 404 `Asset not found`, same body as missing; RBAC denial = 403.
- Scan/open/print have no side effects (no stock_movements, asset_history, rma_cases.updated_at changes).
- Canonical URLs unchanged: `/msp/inventory/units?unitId=`, `/msp/inventory/rma?rmaId=`.
- Shared packages ship web parts for both editions; mobile is EE.

## Risks
Origin mismatch with multi-hostname installs; ticket REST 403/404 existence oracle (follow-up); asset getById hardening may break integrations lacking `asset:read`; app-link claims need a store build; Android cannot match query strings; B2 merge conflict in ScanView.

## Acceptance
Design "Tests" section passes; typecheck/build clean for server, packages/inventory, packages/assets, packages/types, ee/mobile; existing asset API/contract tests pass.
