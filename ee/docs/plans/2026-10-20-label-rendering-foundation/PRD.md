# PRD: Label rendering foundation and record link resolver (C1 of alga-2026-0002683)

## Provenance
No Design Session plan doc existed for this card. It was implemented from the dossier in
`ee/docs/plans/2026-10-20-physical-work-tags/` (ANALYSIS.md, PLAN.md). Where this PRD differs, this PRD wins.

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

## Security invariants
- Route authenticates (`withAuth`), requires an internal (MSP) user, and providers enforce RBAC + record-level permission
  BEFORE rendering. Missing, unauthorized, cross-tenant and non-internal callers all get the same 404 `Not found.`
- Rendering/printing is read-only: no writes, events, stock ledger, or sellability/reservation change.
- `billing` never imports tickets/assets/inventory, and vice versa; the server route wires them.

## Deferred / stubbed
- RMA, project, project_task: resolver only; no label class or provider.
- Ticket label linked asset tag + serial suffix: C2.
- Batch is all-or-nothing; "skip unreadable records and say so" is C2.
- Tenant-custom label templates: standard templates via `templateCode` only.

## Acceptance
Resolver round-trips + mobile byte-identity; no inline mappings at the four old sites; page-size tests; e2e PDF test decoding QR and
Code 128 to exactly their values with n-up order; typecheck/build of touched packages; bundle isolation test; route invariant tests.
