# C3 design of record: scan to open labels

Card: "alga-2026-0002683 (3/6): Scan to open labels: mobile scanner, app links, unit and RMA detail" (f41dd2ca).
Read `ANALYSIS.md` and `PLAN.md` in this folder first. C1 has merged (`dd192d4dd4`); its decisions are in
`ee/docs/plans/2026-10-20-label-rendering-foundation/PRD.md`. Where this design differs from PLAN.md, this design wins
for C3.

Everything below was checked against this worktree at `c5a8b29e4a` (main, 2026-10-23).

## Goal

Scanning any Alga label opens the live record, with permissions applied. A scan the user cannot open shows
"not found or no access" and nothing else.

Done when:
- In the mobile app, scanning a ticket, asset or stock-unit label opens TicketDetail, AssetDetail or StockUnitDetail.
- This works on self-hosted servers, with no universal links.
- An unauthorized, missing or cross-tenant scan shows no record content.

## What exists now (verified)

### Resolver (C1)
- `packages/types/src/lib/recordLinks.ts` exports `recordPath`, `recordUrl` and `matchRecordPath` for six record types: ticket, asset, project, project_task, stock_unit and rma.
- `ee/mobile/src/urls/recordLinks.ts` is a byte-identical copy, and `recordLinks.test.ts` enforces that.
- `matchRecordPath` strips any origin. Checking whether the origin is trusted is the caller's job.
- Canonical forms that matter here:
  - stock unit: `/msp/inventory/units?unitId={id}`
  - RMA: `/msp/inventory/rma?rmaId={id}`

  C1 notes that "C3 adds the reader" for both.

### Labels (C1)
- `POST /api/labels/pdf` (`server/src/app/api/labels/pdf/route.ts`) already has a `stock-unit-identity` class.
- Its provider is `packages/inventory/src/lib/labelViewModelProvider.ts`. It returns null without `inventory:read`. The QR is `recordUrl('stock_unit', id, NEXTAUTH_URL)`.
- Nothing in the web UI calls the route yet. There is no client hook, and C2 (ticket/asset print buttons) has not merged; its branch is still at the pre-C1 base.

### Mobile scanner
- `ee/mobile/src/features/inventory/components/ScanView.tsx` `resolveCode` sends every code to `lookupInventoryCode` (`/api/v1/inventory/lookup`). It parses no URLs.
- So scanning a C1 label today runs an inventory lookup on the full URL, which finds nothing.

### Mobile deep links
- `ee/mobile/src/navigation/linking.ts` handles:
  - `alga://ticket/:uuid` and `alga://project-task/:uuid`
  - `https://algapsa.com` ticket and task URLs, via the hand-written regexes in `normalizeHostedTicketUrl`
- `requiresSession` covers only those two link types.
- `ee/mobile/app.json` claims `applinks:algapsa.com` and an Android intent filter for `pathPrefix /msp/tickets/` only. `appLinks.config.test.ts` pins this.
- Route params (`navigation/types.ts`): `StockUnitDetail { unitId }`, `AssetDetail { assetId, assetName? }`, `TicketDetail`, `ProjectTaskDetail { taskId }`.

### Mobile base URL
- `config/appConfig.ts` resolves the connected server's `baseUrl`; `useInventoryApi` exposes it.
- Self-hosted users enter their own server, so this, not `algapsa.com`, is the trusted origin.

### Server app links
- `server/src/lib/mobileAppLinks.ts` sets `MOBILE_APP_LINK_PATH_PATTERN = '/msp/tickets/*'`. It serves the AASA and `assetlinks.json` only when the app credentials env vars are set.
- Android path claims live in the app binary (`app.json`), not in `assetlinks.json`.

### Mobile detail screens
- `StockUnitDetailScreen` and `AssetDetailScreen` turn every non-cancel error into a generic `ErrorState` with Retry. They don't tell 403/404 apart from a network failure.
- The API client classifies errors as `auth | permission | validation | server | http | timeout | network | canceled` (`api/client.ts`).

### REST read paths a scan lands on
- **Ticket:** `ApiTicketController.assertTicketReadAllowed` returns 404 when the record is missing, then runs the authorization kernel and returns 403 when denied.
- **Stock unit:** `ApiInventoryController.getUnit` runs `execute('read')`, i.e. `inventory:read`, and returns 404 when missing. Stock units have no record-level policy.
- **Asset (defect):** `GET /api/v1/assets/{id}` → `ApiAssetController.getById` → `AssetService.getWithDetails`. It is tenant-scoped, but it checks neither `asset:read` RBAC nor record-level authorization. `requireAllowedContext` only gates by product.
  - So an API key or mobile user without asset access can read any asset in their tenant by id.
  - The sub-resources at lines ~177/192 (history, tickets) do call `requireReadPermissions(['asset'])`, but nothing applies the record-level check.

### Inventory lookup and B2
- `InventoryService.lookup` (`server/src/lib/api/services/InventoryService.ts:303`) still returns asset matches behind `inventory:read` alone.
- Bug card B2 has an open fix: PR #3819, `feature/inventory-scan-lookup-returns-assets-without-ass`, "fix(inventory): authorize asset results in scan lookup".

### Web units page
- `server/src/app/msp/inventory/units/page.tsx` → `StockUnitsManager` (`packages/inventory/src/components`) ignores `unitId`.
- Per-unit history opens `UnitHistoryDialog` through `getUnitDetail` (unit plus ledger).
- There is no detail view and no print action.

### Web RMA page
- `server/src/app/msp/inventory/rma/page.tsx` → `RmaManager` reads only `?status=`.
- There is no single-RMA read action: `listRmaCases` holds the joined select inline, and `loadRma` is a `FOR UPDATE` write helper.

## What changes

### 1. Mobile scan routing (ScanView)

Add a pure module, `ee/mobile/src/features/inventory/scanRouting.ts`, with `classifyScannedCode(code, baseUrl)`. It returns one of:

- `{ kind: 'record', target }`: the code is an absolute http(s) URL, its origin matches the connected server, and `matchRecordPath` gives a record.
  - Origin match: scheme-insensitive host compare, lower-cased, trailing dot dropped, default ports normalised.
  - `target` is the matched record.
- `{ kind: 'foreign-record' }`: an http(s) URL whose path matches a record but whose origin does not match. This is a label from another Alga server, or from another URL of this one.
- `{ kind: 'code', code }`: anything else, including a URL that isn't a record link. Today's lookup runs unchanged.

`ScanView.resolveCode` calls the classifier first. The manual-entry path uses the same entry point, so a pasted URL behaves like a scanned one.

| Record type | In-app action |
|---|---|
| ticket | `navigate('TicketDetail', { ticketId })` |
| asset | `navigate('AssetDetail', { assetId })` |
| stock_unit | `navigate('StockUnitDetail', { unitId })` |
| project_task | `navigate('ProjectTaskDetail', { taskId })` |
| project, rma | No mobile screen. Show an inline result offering "Open in browser" on the connected server, via `Linking.openURL` of `recordUrl(...)` rebuilt from the connected `baseUrl`, never the scanned string. |
| foreign-record | Inline message "This label is from a different Alga server". No request is made and the URL is never sent to `/inventory/lookup`. |

- The navigation happens before any fetch. The destination screen does the authorized read, so the scanner itself never pre-fetches record content.
- Debounce, vibration and the camera pause stay as they are. A routed scan clears scan state so returning to the tab re-arms the camera.

### 2. "Not found or no access" on mobile detail screens

Add a shared `RecordUnavailableState` (`ee/mobile/src/ui/components/`) with one message: "Not found, or you don't have access". It has a Back action and no Retry.

TicketDetail, AssetDetail and StockUnitDetail show it when the primary read fails with `permission` (403) or `http`/404.
- It renders no partial record. AssetDetail must not render its header from the `assetName` route param.
- Network, timeout and server errors keep today's `ErrorState` with Retry.

So a 403 and a 404 look identical. This covers a missing record, a record-level denial, a missing RBAC permission, and a cross-tenant id: the API key's tenant scopes every query, so another tenant's id is a 404.

### 3. Asset read authorization on REST (server)

`ApiAssetController.getById` becomes: product gate → `asset:read` RBAC → load → record-level check → 404.
- The record-level check reuses what web uses (`authorizeRecord` in `packages/assets/src/actions/assetActions.ts` ~2409 / the authorization kernel through `authorizeApiResourceRead` with resource `asset`).
- RBAC denial returns 403, as the rest of the API does, before any load, so it cannot reveal whether a record exists.
- A missing record and a record-level denial both return **404** `Asset not found`, so the record-level check cannot be used to probe ids.

Apply the same record-level check to every asset sub-resource that `AssetDetailScreen` calls: maintenance, history, tickets, software and notes (`ee/mobile/src/api/assets.ts`).

The tickets endpoint is a separate matter. Ticket REST answers a record-level denial with 403 after a 404 for missing. C3 does not change ticket status codes; see the risks section.

### 4. Mobile deep links

`linking.ts`:
- Replace the two hosted regexes with `matchRecordPath`. `normalizeHostedRecordUrl` folds `https://algapsa.com/...` into:
  - `alga://ticket/:id`
  - `alga://project-task/:id`
  - `alga://asset/:id` (new)
  - `alga://stock-unit/:id` (new)
- Add the screens `AssetDetail: 'asset/:assetId'` and `StockUnitDetail: 'stock-unit/:unitId'`.
- Extend `isAllowedPath` (UUID-validated) and `requiresSession` to cover the new paths.
- Keep `normalizeHostedTicketUrl` as an exported alias only if a caller still needs it; otherwise rename it everywhere.

`app.json`:
- Add Android intent-filter data entries `pathPrefix /msp/assets/` and `pathPrefix /msp/inventory/units`. Android cannot match on the query string, so the app's `isAllowedPath` rejects `units` URLs with no `unitId`, and the user falls through to the browser. iOS keeps `applinks:algapsa.com`.
- This only takes effect in a new store build. Record that in the PR.

`server/src/lib/mobileAppLinks.ts`:
- Replace the single pattern with an exported list, `MOBILE_APP_LINK_COMPONENTS`. AASA `components` become:
  - `{ '/': '/msp/tickets/*' }`
  - `{ '/': '/msp/assets/*' }`
  - `{ '/': '/msp/inventory/units', '?': { unitId: '*' } }`
- Project-task URLs are routed by the app but not claimed today. Claiming `/msp/projects/*` would hand project pages the app cannot show to the app, so they stay unclaimed (non-goal).
- A test in `ee/mobile` reads `server/src/lib/mobileAppLinks.ts`'s claimed paths and `app.json`, and asserts they cover the same record types. The cross-package read follows the precedent in `recordLinks.test.ts`.

### 5. Web: unit detail via `?unitId=`

**Decision:** honour `?unitId=` on `/msp/inventory/units`; do not add `/msp/inventory/units/[id]`.
- The canonical stock-unit URL is already C1's `?unitId=` form. Search emits it, and C1's `stock-unit-identity` labels print it into QR codes.
- A new path would either strand printed labels or need a redirect plus a resolver change. Both make the label's identity unstable, for no user gain.

How it works:
- `StockUnitsManager` reads `unitId` with `useSearchParams` and opens a **unit detail dialog**: product, serial, MAC, status, location, linked asset, ledger history and a `Print label` action.
  - It grows out of `UnitHistoryDialog` and keeps that component's ledger rendering.
  - Closing it removes `unitId` from the URL (`router.replace`) and keeps the other params.
  - The row-level "History" action opens the same dialog by setting `unitId`, so there is one detail surface, not two.
- Data comes from `getUnitDetail` (`inventory:read`).
  - `null` (missing, or another tenant's id) and a permission error both render the same inline state in the dialog: "Not found, or you don't have access". No unit fields are shown.
  - The list behind it renders as it does today.
- The server page (`units/page.tsx`) needs no change. It is `force-dynamic`, and the client reads the param.

### 6. Web: RMA detail via `?rmaId=`

**Decision:** honour `?rmaId=` on `/msp/inventory/rma`, for the same reason as units (C1's canonical RMA path).

New read action `getRmaCase(rmaId)` in `packages/inventory/src/actions/rmaActions.ts`:
- It requires `inventory:read`, has no `FOR UPDATE`, and returns `IRmaCase | null`.
- Extract the joined select from `listRmaCases` into one query builder (`rmaCaseQuery(trx, tenant)`) that both use, so the list row and the detail can never disagree.

`RmaManager` reads `rmaId` and opens an **RMA detail dialog**:
- type, status, client, vendor and `rma_reference`
- product, returned unit serial, opened and updated dates, age, reason
- links to the returned unit (`recordPath('stock_unit', ...)`) and asset (`recordPath('asset', ...)`) when present
- the existing status actions for the case's current state, reusing the handlers the table row already uses

Missing or denied ids show the same "not found or no access" state. RMA labels are C5 (see non-goals).

### 7. Stock-unit label printing (web)

The `Print label` action in the unit detail dialog posts `{ labelClass: 'stock-unit-identity', ids: [unitId] }` to `/api/labels/pdf` and opens the returned PDF.
- Use a small client helper in `packages/inventory/src/components` (or `packages/ui` if C2 has merged one by implementation time; check first and reuse it).
- On 404 or 422 it shows the server's message. On 422 with `suggestedTemplateCode` it offers that template once.
- Printing is read-only. The route and provider already guarantee no writes, and C3 adds none.
- Mobile printing is out of scope.

## Order of work

1. **Server authorization first.** Fix asset `getById` and the sub-resource record-level checks (§3), with failing-first API tests. Rebase onto B2 (PR #3819) if it has merged; otherwise leave `InventoryService.lookup` alone.
2. **Pure mobile logic.** `scanRouting.ts` and the `linking.ts` normalisation, with unit tests. No UI yet.
3. **Mobile UI.** Wire ScanView and add `RecordUnavailableState` to the three detail screens.
4. **App-link claims.** `app.json` and `mobileAppLinks.ts`, plus the parity test.
5. **Web RMA read path.** `rmaCaseQuery` / `getRmaCase` with an integration test.
6. **Web dialogs.** The unit detail dialog (`?unitId=`) and the RMA detail dialog (`?rmaId=`).
7. **Print label** from the unit dialog.
8. **Plan artefacts.** The alga-plan PRD/features/tests folder for this card (`ee/docs/plans/2026-10-2x-scan-to-open-labels/`) is written from this design before step 1.

## Decisions later steps must honour

1. **Canonical URLs do not change.**
   - Stock units stay `/msp/inventory/units?unitId=` and RMAs `/msp/inventory/rma?rmaId=`. No `[id]` routes.
   - `recordLinks.ts` is not edited by C3. If it must be, both copies change together and the parity test stays green.
2. **The trusted origin is the connected server's `baseUrl`, not `algapsa.com`.**
   - A record URL on any other origin is never fetched, never sent to inventory lookup, and never opened as-is.
   - In-app "Open in browser" rebuilds the URL from `baseUrl` with `recordUrl`.
3. **The scanner navigates; it does not read.** Authorization happens in the destination screen's REST read, and the scanner shows no record fields.
4. **403 and 404 look identical to the user,** on mobile and on the web dialogs: "Not found, or you don't have access", with no partial content. That includes not echoing route params such as `assetName`.
5. **On the server, a record-level denial on asset reads is a 404,** never a 403 with a body. RBAC denial stays 403, because it says nothing about the record.
6. **Non-URL codes keep today's lookup behaviour exactly.** The scanner changes only for http(s) URLs that match a resolver path.
7. **No side effects.** Scanning, opening and printing write nothing: no stock movement, status, billing, asset history or time entry. Tests assert no new rows in `stock_movements` and `asset_history` for the scan and print paths.
8. **One unit detail surface on the web.** The row "History" action and `?unitId=` open the same dialog.
9. **The `InventoryService.lookup` asset filter belongs to B2.** C3 does not duplicate it. If B2 has not merged when C3 implements, C3 still ships, because URLs never reach lookup. The PR must say that bare asset tags and serials remain B2's leak until #3819 lands.
10. **Edition (PLAN.md question 7):** the web parts (units and RMA dialogs, print action, asset REST fix) ship in the shared packages for both editions, behind the existing product-route guard. The mobile parts are EE (`ee/mobile`). Reason: inventory and the labels route are not EE-gated today, and gating the web half would leave CE labels printing QR codes that open nothing.

## Open product question settled

PLAN.md gives C3 one open product question, #7 (edition). It is settled in decision 10 above.

C3's own scope question was "`?unitId=` reader or `/msp/inventory/units/[id]`". It is settled in §5: the reader, because the canonical URL is already printed on labels.

## Non-goals

- RMA, project or box labels. The RMA tag and return slip are C5.
- Mobile Project, RMA or box screens.
- Printing from mobile, and batch unit printing.
- Changing ticket REST status codes, which today return 403 for a record-level denial (see risks).
- Claiming `/msp/projects/*` app links.
- Universal links on self-hosted domains. The app binary cannot claim arbitrary domains; the in-app scanner is the supported path there.
- Short-link or token URLs. QR content stays the canonical URL, and the URL is not a secret.
- The `InventoryService.lookup` asset filter (B2), and anything in custody or intake (C4).

## Risks

- **Origin mismatch.** Labels encode `NEXTAUTH_URL`; the app compares against the user-entered server URL. If an install exposes several hostnames, valid labels read as "from a different Alga server".
  - Mitigation: compare normalised hosts, and log the mismatch (host only) for support.
  - A server-advertised alias list is a possible follow-up, not in C3.
- **Ticket existence oracle.** Ticket REST returns 404 for missing and 403 for record-level denied, so the status code reveals whether a ticket UUID exists.
  - Labels carry v4 UUIDs, and the holder already has the physical label, so this reveals no content. The app hides the difference.
  - Flag it in the PR as a follow-up for ticket REST consistency; do not widen C3.
- **Fixing asset `getById` can break callers.** Integrations and the MCP self-fetch may currently read assets without `asset:read` or record-level access.
  - This is the intended fix, but call it out in the PR and release notes.
  - Run the existing asset API and contract tests.
- **App-link claims need a store build.** Hosted universal links for assets and units take effect only after the next iOS/Android release. The scanner path works immediately.
- **Android cannot match query strings.** `/msp/inventory/units` without `unitId` would open the app. The `isAllowedPath` rejection must hand it back to the browser: verify on a device that a rejected link doesn't land on a blank app.
- **Conflict with B2 (#3819).** It touches `InventoryService.lookup` and the mobile `ScanResultCard`; C3 touches `ScanView`. Expect a small merge conflict in ScanView imports. Rebase onto whichever lands first.
- **C2 concurrency.** C2 may add a shared client print helper. Check for one before adding the inventory-local helper (§7), so print plumbing isn't duplicated (`LEVERAGE: pattern label-print-client` if both exist).

## Tests (to be expanded in the card's tests.json)

**Mobile unit tests (vitest)**
- `classifyScannedCode`:
  - same-host ticket, asset, unit and task URLs
  - host case and port normalisation
  - foreign host
  - non-record URL
  - plain serial or GTIN
  - malformed percent-encoding
  - `javascript:` / `alga:` input → `code`, never `record`
- `linking.ts`:
  - new `alga://asset` and `alga://stock-unit` paths
  - hosted asset and unit URLs normalised
  - non-UUID rejected
  - `units` without `unitId` rejected
  - signed-out link held and replayed

**Mobile component tests**
- ScanView: a same-host asset URL navigates to AssetDetail without calling `lookupInventoryCode`.
- ScanView: a foreign URL shows the foreign-server message and makes no request.
- The three detail screens on 403 and on 404 render `RecordUnavailableState` with no record fields (including no `assetName`). On a network error they render Retry.

**Server API tests**
- Asset `GET /api/v1/assets/{id}`:
  - no `asset:read` → 403
  - record-level denied → 404, same body as missing
  - another tenant's id → 404
  - allowed → 200
- Asset sub-resources: record-level denied → 404.
- Stock unit `GET /inventory/units/{id}` with another tenant's id → 404.
- AASA lists the three components; `assetlinks` is unchanged.
- Parity test: `app.json` claims ⊇ the server's claimed record types.

**Integration tests**
- `getRmaCase`: returns the same row shape as `listRmaCases`, null for a missing or cross-tenant id, and a permission error without `inventory:read`.
- No-side-effect checks: row counts of `stock_movements`, `asset_history` and `rma_cases.updated_at` are unchanged across scan reads and label print.

**Web component tests**
- `?unitId=` opens the unit dialog.
- An unknown or denied `unitId` shows the unavailable state with no unit fields.
- Closing the dialog removes the param.
- The History row action opens the same dialog.
- `?rmaId=` opens the RMA dialog, with the same denied/missing behaviour.

**Playwright / manual smoke**
- Print a stock-unit label from the unit dialog, decode its QR, and confirm it equals `recordUrl('stock_unit', id, NEXTAUTH_URL)`.
- Opening that URL signed out → sign-in → lands on the unit dialog.
- On a device, scan ticket, asset and unit labels → the right screens. Scan as a user without asset access → unavailable state.
