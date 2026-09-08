# Closure of the final three acceptance cases (T009, T015, T016)

Continues from mitigation commit `0ce185f5e3` ([mitigation-evidence.md](mitigation-evidence.md)); the seven cases closed there are untouched. This round closes the remaining three. Approved scope stays `d42325cf38`; no design decision was reopened.

Durable artifact root: `/home/robert/alga-artifacts/invoice-ticket-closure-2026-09-05/evidence/`. Paths below are relative to it. `closure-artifact-manifest.json` beside this document lists every artifact with its SHA-256.

## T009 — DB-backed fallback variants

Two new opt-in production variants generate real invoices through `generateInvoice` / `generateInvoiceForSelectionInputs` against the wired local database, then read them back through the frozen persisted reader:

- **`task-identities`** (`production/task-identities/`): three project tasks under one phase — two sharing the public name "Same public task name", one with an empty name and null description. One task bills two different services. Assertions: three distinct identity groups keyed by `workItemId` (two with identical labels), the unnamed task renders through the `time.task` document key with no fabricated ticket fields, the mixed-service task is `rateKind: mixed` with a null uniform rate and exact 33000 total, subtotal 150500 reconciles per charge, group/entry order is stable when the charge list is reversed, and editing the source task names after generation does not change a fresh persisted read.
- **`hour-block`** (`production/hour-block/`): a granted 180-minute prepaid block consumed by the real FIFO allocator across two entries, generated through supported client-cadence selection inputs. The fully-consumed block persists exactly one zero-amount informational `hour_block` charge ("3.0 hrs consumed, 0.0 hrs remaining") that appears once in the primary presentation rows and in preview HTML. `invoice_charge_details` service periods retain their existing inclusive August 1–31 text/data; prepaid information has no contract-configuration-backed detail and none is invented.

**Ticketless / orphan disclosure (read this before reviewing the fallback matrix).** There is **no supported producer of orphan/ticketless source time**: `BillingEngine.loadTimeBasedObligation` resolves client ownership only through a ticket or project-task join, and this card does not authorize new ownership rules. The ticketless fallback path is therefore covered with **explicitly disclosed historical persisted fixtures**: the closure test first generates a fully supported invoice, then mutates the persisted `invoice_time_entries.work_item_snapshot` rows in place to the legacy shapes (`ad_hoc` with null work item → "Other billed time", `project_task` with an unknown id and null optional labels, null ticket fields, version-1 snapshots, and null/missing snapshots for the partial/none coverage variants). Each fixture records its origin (`origin: "disclosed persisted historical fixture"`) and before/after rows in `production/locale-matrix/historical-*-fixture.json`. These mutations are not a backfill, do not demonstrate a generation path, and renderer-only proof is the ceiling here. Through the real reader/renderer the matrix shows: ticketless and unknown-task time rendering through the canonical-charge fallback **exactly once per owning charge** (single null-entry contribution equal to the full charge net), correct per-charge reconciliation, and normal ticketed rows beside them on the same invoice.

## T015 — visual nested-detail creation and partial-detail matrix

Two invoice-only palette presets were added (`billedTimePresets.ts`): **Billed-time entry detail** (flat entry table in a section) and **Billed-time detail by ticket** (repeating per-group container with a scoped `group.entries` table). Both author ordinary editable nodes — section roots satisfy the designer's page/root compatibility rule discovered last round, and `ComponentPalette.billedTime.integration.test.tsx` exercises the real `DesignerShell` insertion handler, save/reopen AST roundtrip, canvas row resolution, evaluation and render, and asserts authoritative totals are unchanged by the added detail.

Live from-scratch session on port 3967 (fresh copy, **not** the previously saved template): "Standard Invoice By Ticket" → *Edit as Copy* → template `ccf9a9fb-dff1-46fb-8f3c-99f5ccfec2fa` ("Acceptance visual detail closure T015"). Through the UI only: inserted both presets from the palette, added the sixth (Description) column to each table via the inspector column presets, created a Transforms sort (`date` descending) on Billed Time Entries, rebound the flat table to `timeEntries.transformed`, saved, reopened, and verified canvas, full preview and DB-persisted AST agree (region `ticketGroups`/`group`, nested `group.entries`, both tables six columns, sort persisted). Screenshots: `designer/t015-authored-canvas.png`, `t015-reopened-canvas.png`, `t015-preview-sample.png`, `t015-preview-existing-inv121.png` (+ `.txt` DOM text) — the last renders the real `task-identities` invoice through the saved layout in the designer's authoritative preview.

The partial-detail matrix runs in the closure test with this exact UI-saved template: `historical-partial` (detail present for some charges, absent for others → `time.detailPartial` notice), `historical-none` (no snapshots → `time.detailUnavailable` notice), and `multi-tax-long` (74 entries including the mixed-rate 37500 overtime entry; PDF spans >2 pages with repeated table headers and long wrapped titles). Every variant asserts per-charge contribution reconciliation (nothing duplicated, nothing lost) and byte-identical view models before/after rendering.

## T016 — locale matrix

`production/locale-matrix/` holds the full matrix: **6 fixtures × {en, fr, zz-unavailable} × {canvas, full preview, PDF}** (18 manifest entries in `locale-matrix/manifest.json`). For each cell the closure test verifies, all through the real seams:

- `localizeTemplateAstForLocale` resolves the document dictionary; `zz-unavailable` falls back to English (`effectiveLocale: en`) through the real seam, not a test shim.
- Mixed (`Tarifs variables`/`Mixed rates`), rate-unknown v1 (`Tarif indisponible`/`Rate unavailable`), ticketless (`Autre temps facturé`/`Other billed time`), task fallback (`Tâche de projet`/`Project task`), coverage notes and the new partial/unavailable detail notices all appear in the extracted PDF text **and** the authoritative full-preview HTML.
- Canvas resolves the same rows (flat transform output and nested group scope) via `resolveCanvasCollection`/`resolveCanvasRowScope`, and canvas labels flow through the same server document dictionary via the preview action's `presentationLabels` walk — live French canvas screenshot `designer/t016-canvas-fr.png` shows localized headers (HEURES/TARIF/MONTANT) over real invoice rows; `designer/t016-preview-existing-fr.png` is the matching full preview.
- Money and dates format per effective locale (`150,00 $US`, `16/08/2026`); persisted snapshots, stored links, charges and the serialized view model are byte-identical across every locale render; private sentinels never appear.
- `PDFGenerationService.resolveRenderLocale` honors the client's `defaultLocale` for all three locales.

All new strings live in the document localization namespace (`server/public/locales/{en,fr}/documents.json`: `labels.detailPartial`, `labels.detailUnavailable`; preset names in `msp/invoicing.json`). No new path hardcodes English.

## Defects found and fixed this round

- `timePresentationLabels` required a translator, so an unsupported locale (undefined `t` from the fallback path) made `runAuthoritativeInvoiceTemplatePreview` throw and report "Template evaluation failed unexpectedly." It now defaults to the authored English labels, matching the render seam's fallback contract (`timePresentationLocalization.ts`).
- Test-only: PDF label containment initially used `pdftotext -layout`, which interleaves wrapped table columns and split "Tarifs variables" across lines in the 74-entry French PDF. Containment assertions now run against reading-order extraction; `-layout` output is kept as the human-readable artifact. This was an extraction artifact — the label is present and visually correct in the PDF.

## Commands

From `server/` in this worktree (port-5472 wired database, fixture user `invoice-draft-verifier@example.invalid`):

```bash
INVOICE_TICKET_EXTENDED=1 INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-closure-run/production \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
# author the layout through the UI, then with its saved template id:
INVOICE_TICKET_CLOSURE=1 INVOICE_TICKET_CLOSURE_TEMPLATE=ccf9a9fb-dff1-46fb-8f3c-99f5ccfec2fa \
INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-closure-run/production \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
```

| Receipt | Result |
| --- | --- |
| `extended-production.log` / `.exit` | Exit 0; all six production variants (cap, recurring-cap, bucket, multi-tax-long, task-identities, hour-block) generate, persist and render. |
| `closure-matrix.log` / `.exit` | Exit 0; visual-detail + locale-matrix closure test, 18-cell matrix. |
| `focused-final.log` / `.exit` | Exit 0; 21 suites / 293 tests (the prior 291 plus the two preset-insertion tests). |
| `billing-build.log`, `billing-typecheck.log` / `.exit` | Exit 0 each. |
| `server-typecheck.log` / `.exit` | Exit 0 (`NODE_OPTIONS=--max-old-space-size=12288`). |
| `server-build.log` / `.exit` | Exit 0; isolated `NEXT_DIST_DIR` build with 16 GB heap. |

## Mocks, shortcuts and limits

- The opt-in Vitest harness stubs `getSession`/`withAuth`/`getCurrentUser` with the synthetic fixture user's identity — the accepted precedent; billing, persistence, rendering and localization behavior are real. The live designer session used the existing authenticated browser login.
- Source records are SQL fixtures; historical snapshot mutations are deliberate persisted writes disclosed above and are the only non-generated billing state. Acceptance invoices are retained for inspection.
- Browser control used real input events plus DOM-event dispatch for Radix listbox options; no store injection, no seeded ASTs — the T015 template exists only through designer save.
- Earlier failed closure-test iterations (before the two fixes above) generated extra synthetic acceptance clients/invoices in the local database; they are inert fixture data of the same disclosed shape.
