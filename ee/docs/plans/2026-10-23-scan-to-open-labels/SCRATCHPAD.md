# Scratchpad: scan to open labels (C3)

- package-lock.json was modified in the worktree before work started (npm install churn: libc fields dropped, @zxing/library added). Not part of C3; not committed.
- B2 / #3819 was OPEN (unmerged) at start; `InventoryService.lookup` untouched.
- Physical-work-tags docs already tracked at 83ad903ea1.

## Implementation log (web half)
- `rmaCaseQuery(trx, tenant)` lives in `packages/inventory/src/lib/rmaCaseQuery.ts` (not the `'use server'` actions file: Next only allows async exports there). `listRmaCases` and new `getRmaCase` share it; `getRmaCase` has no `FOR UPDATE` (unlike `loadRma`).
- `getRmaCase` DB test (`rmaActions.getRmaCase.db.test.ts`) mocks only auth/db plumbing; ran green against a throwaway clone of a migrated test DB (CREATE DATABASE ... TEMPLATE), clone dropped afterwards. Run via `server/` vitest (the package config excludes `*.db.test`).
- Unit dialog (`UnitHistoryDialog`) gained `unavailable` + Print label; `StockUnitsManager` drives it from `?unitId=` (row "History" sets the param). `RmaManager` drives an RMA dialog from `?rmaId=`. Malformed ids never reach the action.
- Print: `labelPrintClient.ts` (`LEVERAGE: pattern label-print-client`); no C2 helper existed.
- Locale keys added to `en` only; other locales fall back to en.
- Server `tsc` needs `NODE_OPTIONS=--max-old-space-size=12000`.
- Not run: device checks (Android units URL without unitId; store-build dependency for app links).
