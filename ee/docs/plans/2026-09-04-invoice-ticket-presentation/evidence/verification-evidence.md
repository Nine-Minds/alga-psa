# Independent mitigation-round verification (2026-09-05, post-closure)

This round changed no product code. Branch state at verification: closure commit `aac6f70597` on top of mitigation `0ce185f5e3`, implementation `dac2827be9`/`5ec3701845`/`d60d83bb96`, and approved design `d42325cf38`. The failed draft review (rendered against baseline `dac2827be9`) claimed ten acceptance cases were unimplemented and that live recurring bucket/cap paths had concrete failures. This round re-executed everything fresh rather than citing inherited logs; every receipt below was regenerated on this pass.

Durable artifact root: `/home/robert/alga-artifacts/invoice-ticket-reverify-2026-09-05/evidence/`. `verification-artifact-manifest.json` beside this document lists every receipt with byte count and SHA-256. An earlier same-day verification pass (artifact root `invoice-ticket-verify-2026-09-05`) reached the same conclusions but was left uncommitted; it is superseded by this round's receipts and is not cited as evidence here.

## Fresh runs

All commands ran from `server/` in this worktree against the wired port-5472 database of the `alga-psa-local-test` stack; the host server was relaunched on port 3967 for the HTTP variant (fixture user `invoice-draft-verifier@example.invalid`).

| Check | Command shape | Result |
| --- | --- | --- |
| Focused regression + reviewer probes | The 21 committed focused suites plus the original lead-review probe file (`/tmp/invoice-ticket-lead-review/invoiceTicketReviewerProbe.test.ts`, copied temporarily into the server test tree and removed after the run) in one vitest invocation | **22 files / 296 tests passed** (`focused-reverify.log`, exit 0) — the committed 293 plus the 3 artifact-backed probes |
| Live production generation | `INVOICE_TICKET_LIVE=1 INVOICE_TICKET_EXTENDED=1 npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts` | **7 passed / 5 opt-in variants skipped** (`production-reverify.log`, exit 0): base immutable scenario plus cap, recurring-cap, bucket, multi-tax-long, task-identities and hour-block, all regenerated (evidence timestamps 2026-09-05T20:52Z, this run) |
| Closure matrix (T015/T016) | `INVOICE_TICKET_CLOSURE=1 INVOICE_TICKET_CLOSURE_TEMPLATE=ccf9a9fb-dff1-46fb-8f3c-99f5ccfec2fa` same file | **Pass** (`closure-reverify.log`, exit 0): visual-detail partial/none/long matrix plus the full 6-fixture × {en, fr, zz-unavailable} × {canvas, preview, PDF} matrix (18 manifest entries regenerated under `production/locale-matrix/`) |
| Authenticated HTTP spot check | `INVOICE_TICKET_AUTH=1` same file, browser pane on the relaunched port-3967 server | **Pass** (`auth-reverify.log`, exit 0): HTTP generate 201, 4 persisted snapshot links, same-tenant read 200, wrong-tenant read **401**, foreign-tenant link excluded from render, no private sentinel in any output |
| Billing package build / typecheck | `npm run build`; `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck` | Exit 0 each (`billing-build.log`, `billing-typecheck.log`) |
| Server typecheck | `NODE_OPTIONS=--max-old-space-size=12288 ../node_modules/.bin/tsc --noEmit --incremental false` | Exit 0 (`server-typecheck.log`) |
| Isolated full server build | `NODE_OPTIONS=--max-old-space-size=16384 NEXT_DIST_DIR=.next-invoice-reverify npm run build` | The first attempt was killed mid-run by session teardown before any exit receipt existed (its partial output is the head of `server-build.log`, above the `===== RESTARTED` marker). Relaunched session-detached and run to completion; see the durable receipt `server-build-result.json` for the verified outcome (log completion marker + `BUILD_ID` presence). Isolated dist removed after the receipt was captured |

## Ten-case verdict table

| Case | Implementing verification this round | Verdict |
| --- | --- | --- |
| T003 | `src/test/unit/billing/invoiceTicketPresentation.test.ts` — 33 actual-calculator presentation tests (overrides, minimums, rounding, zero-rate, mixed evidence) in `focused-reverify.log` | **Pass** |
| T004 | Live base scenario: generate, capture HTML/PDF, edit source ticket/time metadata via SQL (invoiced records are locked), fresh persisted reload, byte-equal semantic output (`production/before-source-edit.*`, `after-source-edit.pdf`, `immutable-pdf.txt`; `production-reverify.log`) | **Pass** |
| T007 | Live history variants `history-{legacy,partial,partial-aggregate}.json`: canonical charges partition exactly, partial contributions never reappear | **Pass** |
| T008 | Live history variants `history-{invalid-version,v1,malformed-amount,malformed-minutes,net-mismatch,duplicate-link,conflicting-link}.json` through the real persisted reader | **Pass** |
| T009 | Extended `task-identities` (same-name distinct tasks, missing labels, mixed services, stable ordering) and `hour-block` (persisted zero informational row, retained service periods) variants regenerated; ticketless fallback via disclosed historical persisted fixtures in the closure matrix (each records `origin: "supported generation followed by disclosed historical snapshot mutation"`) | **Pass** |
| T013 | `TransformsWorkspace.integration.test.tsx` (16) + `TableEditorWidget.integration.test.tsx` (9) + `DesignCanvas.previewMode.test.tsx` (19) re-run green in `focused-reverify.log`; the mitigation round's live filter/group/empty-source UI captures stand as recorded | **Pass** |
| T015 | `ComponentPalette.billedTime.integration.test.tsx` (2, real DesignerShell insertion) re-run green; closure matrix re-run against the designer-saved template `ccf9a9fb-dff1-46fb-8f3c-99f5ccfec2fa`; template AST independently re-probed in the wired DB this round (`ticketGroups` region, `group.entries` nested scope, two six-column tables, `date`-descending sort transform bound to `timeEntries.transformed` — all present) | **Pass** |
| T016 | Closure locale matrix regenerated: fresh French PDFs contain `Tarifs variables`/`Autre temps facturé`; `zz-unavailable` cells fall back to English (`Mixed rates`, `Rate unavailable`, `Other billed time`) through the real localization seam; 18-cell manifest under `production/locale-matrix/` | **Pass** |
| T017 | No automated implementing test exists (live client-portal walkthrough by design). This round: proved **zero drift** in portal code since the recorded walkthrough (`git diff 0ce185f5e3..HEAD` touches no portal/client-portal file) and re-hashed all 9 committed T017 artifacts against the durable mitigation root — 9/9 SHA-256 match. The interactive walkthrough itself was **not** re-run this round | **Pass** (standing live evidence + drift proof; disclosed) |
| T019 | `INVOICE_TICKET_AUTH=1` re-run fresh against the relaunched port-3967 server: authenticated HTTP generation 201, snapshots persisted, foreign-tenant link cannot alter the render, wrong-tenant HTTP read 401, private sentinels absent from links/read/preview/PDF/supporting detail (`production/authenticated/`, `auth-reverify.log`) | **Pass** |

## Re-verified draft-review failure findings

**Recurring bucket path.** Fresh generation persists the bucket invoice: hourly 82500 + usage 5000 + bucket 60000 = **147500 net / 14750 tax / 162250 total** (`production/bucket/generated.json`). The originally-broken period linkage is proven repaired in `production/bucket/recurring-periods.json`: recurring period records reach `lifecycle_state: "billed"` with populated `invoice_id`/`invoice_charge_id`/`invoice_charge_detail_id` and timestamps from this run (2026-09-05T20:52:33Z).

**Contracted recurring project cap.** Fresh generation bills the capped project at **20000 cents with a 32500 write-down** (`production/recurring-cap/cap-usage.json`: `billed_amount: 20000`, `written_down_amount: 32500`, `updated_at` 2026-09-05T20:52:34Z); snapshots retain the pre-cap evidence, the invoice reconciles to **55000 net / 5500 tax**, and the by-ticket table falls back to complete canonical rows rather than claiming a stale uniform rate.

## Limits and disclosures

- Same disclosed harness limits as prior rounds: the opt-in Vitest harness stubs `getSession`/`withAuth`/`getCurrentUser` with the synthetic fixture user's identity; billing, persistence, rendering and localization are real. The HTTP variant's generation request runs from a signed-in browser pane against the real server outside Vitest (API-key authenticated); its temporary key is deactivated and the foreign link deleted in `finally`.
- T009 ticketless coverage remains disclosed historical persisted fixtures — there is still no supported producer of orphan/ticketless source time and none was invented; renderer-only proof remains the ceiling there.
- No live browser designer/portal walkthrough was repeated this round: T015's template was spot-checked through its persisted DB AST and the re-executed matrix; T017 through drift-proof and artifact hashing as described above.
- The host server had to be relaunched for the HTTP check; `next dev` ignores `PORT` from `server/.env.local` (binds 3000) and credential-vault init requires `SECRET_FS_BASE_PATH` pointing at the wirein target's secrets. Both were supplied explicitly; recorded as a workflow fact.
- No product source file changed in this round; nothing required fixing — all ten named cases passed on rerun.
