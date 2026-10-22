# PRD: Label rendering foundation and record link resolver (C1 of alga-2026-0002683)

## Provenance
No Design Session plan doc existed for this card. It was implemented from the dossier in
`ee/docs/plans/2026-10-20-physical-work-tags/` (ANALYSIS.md, PLAN.md). Where this PRD differs, this PRD wins.

## Deviation from card
The card's acceptance wording was that BOTH the QR and the Code 128 decode to the record's `recordUrl`. That holds for the QR only.
**Code 128 encodes the short identifier (`code128Value`, e.g. the asset tag), not the URL.**

Module math (Code 128 subset B: 11 modules per character, + 11 start, + 11 check, + 13 stop = 11n + 35 modules; plus the
10-module quiet zone on each side = 11n + 55 modules). Minimum module size is `BARCODE_MIN_MODULE_MM = 0.25`.
- Canonical asset URL `https://<host>/msp/assets/<uuid>`: with a 20-character host, n = 71, so 11*71 + 55 = 836 modules * 0.25 mm = **209 mm**.
  A 4x2in label has about 95.6 mm usable width (101.6 mm minus 3 mm margins); an Avery-style cell is narrower still. It does not fit, at any host length
  (the 36-character UUID plus `/msp/assets/` alone is 48 characters = 583 modules = 146 mm).
- Short asset tag, e.g. `ASSET-00123` (11 chars): 11*11 + 55 = 176 modules * 0.25 mm = **44 mm**, which fits.
Shrinking modules below 0.25 mm would make the code unscannable on typical thermal/laser printers, so the renderer refuses
(clear error) rather than shrink. The scannable URL is the QR. Code 128 exists for handheld laser scanners that read the tag and look it up
by identifier. Tests assert QR == recordUrl and Code 128 == `code128Value`.

## Problem
Any record should be printable as a small label PDF with a scannable QR / Code 128 code. Record-to-URL mappings are
duplicated across search indexers, notification links, Teams links and mobile. This card ships no end-user feature;
C2-C6 build on it.

## Goals
1. One pure, bidirectional record link resolver (`recordPath`, `recordUrl`, `matchRecordPath`) for ticket, asset,
   project, project task, stock unit, RMA; old mappings replaced; mobile gets a byte-identical copy.
2. Custom page sizes (`customPageSize {width,height,unit}`) in print settings, emitted as `width`/`height`/`preferCSSPageSize`
   and a real `@page` rule; designer can set and preview them. Letter/A4/Legal unchanged.
3. `barcode` AST node (`qr` | `code128`), async server prepass to SVG, synchronous shared renderer.
4. One generic `work-tag` document type with one standard template per label class.
5. Batch layout: one label per page, or n-up grid (rows, columns, margins, gutters), order preserved.
6. Composition root: `POST /api/labels/pdf`; `LabelViewModelProvider` in `packages/types`, implemented in tickets, assets, inventory.

## Non-goals
Print buttons in UI (C2), scanning (C3), custody (C4), RMA (C5), project staging (C6), print history, tenant-custom label templates.

## Settled decisions
- **Generic vs per-class (PLAN.md question 3):** ONE generic `work-tag` document type; label classes
  (`ticket-work-tag`, `asset-identity`, `stock-unit-identity`) are standard templates under it, over a single `LabelViewModel` shape.
  Tenants manage one template list.
- **Barcode library (PLAN.md question 5):** bwip-js (Code 128) and qrcode (QR), pure JS, no native build, both behind
  `.server.ts` files loaded by dynamic import; verified absent from client bundles by `clientBundle.test.ts`.
- **Route contradictions (no invented routes):**
  - project task: `/msp/projects/{projectId}?taskId={id}` (ProjectPage reads `?taskId=`). The dossier's `/tasks/{id}` form only
    redirects; `matchRecordPath` still accepts it.
  - stock unit: `/msp/inventory/units?unitId={id}`. The page ignores the parameter today; C3 adds the reader.
  - RMA: `/msp/inventory/rma?rmaId={id}`. The page reads only `?status=`; C3 adds the reader.
- **Code 128 content** is the short identifier (`code128Value`, asset tag), never the URL: a full URL cannot fit at the
  minimum module size. The QR carries the URL.
- **Decorative designer QR block** became the real `barcode` designer type; it exported an `image` node, so no stored data migrates.
- **QR content** is only the canonical `recordUrl` (renderer rejects any `url !== recordUrl(...)`): no tokens, secrets or fragments.
- **Scannability:** quiet zone >= 4 modules (QR) / >= 10 (Code 128), minimum module size, clear error when a value cannot fit.
- **Long identifiers (human review):** a label is a fixed-size cell, so no text may leave it. Every label text node wraps at
  any character (`overflowWrap: anywhere`; RMM-imported tags such as `levelio:Z2lkOi8vbGV2ZWwvRGV2aWNlLzkwMDE` have no break
  opportunities). Identifiers are never clipped; free text (names, titles, reasons) is capped at whole lines (`maxHeight` +
  `overflow: hidden`) so a 39-character tag (three lines at 22 px in the QR-only asset label's 58 mm column) still fits in 44 mm.
  The AST style schema gained `overflow` and `overflowWrap` for this.
- **One margin:** the shared renderer already pads the document root by `printSettings.marginMm` (as the designer preview does),
  so the sheet composer adds no cell padding. It used to pad as well, applying the margin twice (printable area 89.6 x 38.8 mm
  instead of 95.6 x 44.8 mm), which pushed the 95 mm Code 128 row to within 0.7 mm of the page edge.
- **Batch failures (human review):** batches stay all-or-nothing, but every item is tried and the 422 body is
  `{ error, failures: LabelPrintFailure[] }` naming each record that cannot print (position, record id, identifier, template,
  reason) with `suggestedTemplateCode` where another standard template of the same class can print it (Code 128 asset label ->
  QR-only asset label, only for barcode errors). Failures are only reported for records the caller was authorized to read.
- **Designer barcode hint:** the work-tag binding root is `label.*`, so the Value placeholder and hint show `{{label.recordUrl}}`
  (the token the designer itself displays for an imported record-URL binding, and which binds back when typed). Other document
  types get no fake example.

## Security invariants
- Route authenticates (`withAuth`), requires an internal (MSP) user, and providers enforce RBAC + record-level permission
  BEFORE rendering. Missing, unauthorized, cross-tenant and non-internal callers all get the same 404 `Not found.`
- Rendering/printing is read-only: no writes, events, stock ledger, or sellability/reservation change.
- `billing` never imports tickets/assets/inventory, and vice versa; the server route wires them.

## Deferred / stubbed
- RMA, project, project_task: resolver only; no label class or provider.
- Ticket label linked asset tag + serial suffix: C2.
- Batch is all-or-nothing (the 422 lists every failing record); "skip unprintable records and say so" is C2.
- Tenant-custom label templates: standard templates via `templateCode` only.

## Acceptance
Resolver round-trips + mobile byte-identity; no inline mappings at the four old sites; page-size tests; e2e PDF test decoding QR and
Code 128 to exactly their values with n-up order; typecheck/build of touched packages; bundle isolation test; route invariant tests.
