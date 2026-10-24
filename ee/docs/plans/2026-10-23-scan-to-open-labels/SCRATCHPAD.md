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

## Audit round (finishing pass, 2026-10-23)
- Base check vs origin/main (8 commits ahead of the merge base): C1 (#3821, `dd192d4dd4`) is already in this branch and in origin/main; `matchRecordPath(pathnameWithSearch)` takes a path plus query and strips any origin. No file the branch touches changed on main, so no rebase or merge was needed. B2 / #3819 is still OPEN: `InventoryService.lookup` on origin/main still returns asset matches behind `inventory:read` alone. Not touched here. URLs never reach lookup, so C3 does not depend on it. Bare asset tags/serials remain B2's leak until #3819 lands. When it merges, expect only an import-level conflict in ScanView/ScanResultCard.
- Fix: removed the `https://algapsa.com` entry from `linking.ts` `prefixes`. Hosted URLs are folded to `alga://` by `normalizeHostedRecordUrl` before React Navigation sees them, so the prefix did nothing but widen the surface. Added a regression test that the push-notification url shape (`alga://ticket/:id`, as emitted by `expoPushService`) is still accepted when signed in, `TicketDetail` is still `ticket/:ticketId`, and the prefix is gone.
- Deliberate reading of the classifier order: a host mismatch is `foreign-record` only when the path also matches a record (design "Mobile scan routing" and decision 6: scanner changes only for http(s) URLs that match a resolver path). A foreign-host URL that is NOT a record link goes to lookup as an opaque code string, as it does today (e.g. a GS1 digital-link barcode). It is never fetched, and the foreign host is never contacted. A foreign RECORD link is never fetched, never sent to lookup, and logs only its host at warn. If a stricter "any foreign http(s) URL is refused" is wanted, it is a one-line change in `classifyScannedCode`, but it would stop GS1 URL barcodes from reaching lookup.
- Host-mismatch risk, settled: yes. `POST /api/labels/pdf` passes `baseUrl = process.env.NEXTAUTH_URL` into `recordUrl` (server/src/app/api/labels/pdf/route.ts:73, labelViewModelProvider.ts:48). A tenant whose `NEXTAUTH_URL` hostname differs from the server URL entered in the app will see its own labels as "from a different Alga server". Mitigations in place: normalised host compare, host-only warn log. Follow-up (not C3): server-advertised alias list.
- Mobile test runner is vitest (not jest); all commands in the PRD "Verification" below.
- DB test: ran on a clone (`CREATE DATABASE ... TEMPLATE test_schema_tpl_...`, 1190 migrations) via server/ `vitest.workspace-db.config.ts`; clone and temporary roles dropped afterwards.
- Deferred / not run: device checks (Android `/msp/inventory/units` without `unitId`; app links work only in store builds); Playwright label-print smoke (no app server started, per instructions).

## Verification (exact commands)
- `cd ee/mobile && npx vitest run` -> 191 files / 1354 tests pass; `npx tsc --noEmit` clean.
- `cd packages/inventory && npx vitest run` -> 17 files / 121 tests pass; `npx tsc --noEmit` clean.
- `cd server && NODE_OPTIONS=--max-old-space-size=12000 npx tsc --noEmit` clean.
- `cd server && npx vitest run src/test/unit/api/apiAssetReadAuthorization.test.ts src/test/unit/api/assetReadGuardRoutes.test.ts src/test/unit/mobileAppLinks.test.ts src/test/unit/mobileAppLinksRoutes.test.ts src/test/unit/api/inventoryService.test.ts` -> 36 pass.
- `cd server && REQUIRE_DB=1 TEST_DB_NAME=<clone> ... npx vitest run --config vitest.workspace-db.config.ts ../packages/inventory/src/actions/rmaActions.getRmaCase.db.test.ts` -> 4 pass.
