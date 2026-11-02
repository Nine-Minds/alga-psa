# C5 follow-up 2 browser recovery and smoke attempt

Current follow-up run: 2026-11-02 17:39–17:46 UTC
Branch: `feature/alga-2026-0002683-c5-follow-up-2-advance-track-v`
Tested commit: `83fdeb1ee11443303c7fdcda537b07de312cf546`
Required origin: `http://feature-alga-2026-0002683-c5-follow-up-2-advance-track-v.localhost:3536`
Result: **Browser operation verified in existing and fresh card-owned panes. The required origin has no listener, so sign-in and all six feature flows are NOT RUN. No product defect was established.**

No committed implementation plan exists in `main..HEAD`; `git log main..HEAD --name-only -- docs/plans/` returned no paths. The flow definitions and expected outcomes below were copied from the earlier smoke evidence README; this run records each as NOT RUN.

## Current follow-up observations (17:39–17:46 UTC)

Before using remembered IDs, the card space `77c0c59a-5083-4842-b1cc-f20158ff6c11` and project `3a1d00ee-04c2-4bad-8dfe-4d0458245c41` were confirmed in the current layout. Existing pane `c8403826-ff91-488f-aa28-8447b4f96c06` and `0bc994e8-aab7-4f56-a707-f94f6742349b` still belong to their card-owned browser tab group. The user active space and active tab were unchanged before and after the checks.

The existing pane and a fresh pane `8a6c720f-69bb-4b23-a299-12030b892f74` each navigated to the labeled local diagnostic [`diagnostic.html`](takeover/diagnostic.html). DOM inspection reported visible elements; screenshot capture succeeded and produced nonblank images; real typing and clicking updated the diagnostic result to the pane-specific entered value. The fresh pane remained owned by the card project. All browser commands returned success without a pane-host mismatch. This verifies browser operation only and makes no product assertion. See [current-validation.json](takeover/current-validation.json), the `current-existing-*` and `current-fresh-*` command results, the two [existing-pane screenshots](takeover/current-existing-after.png) and [fresh-pane screenshot](takeover/current-fresh-after.png), and [current-pane-ownership.json](takeover/current-pane-ownership.json).

The required origin was probed separately at `2026-11-02T17:45:56Z`. Curl resolved the hostname to `::1` and `127.0.0.1`, both connections were refused (exit 7), and `ss` showed no listener on port 3536. This is an unavailable application service, distinct from browser screenshot failure or resource exhaustion. No app server was started. See [current-service-probe.json](takeover/current-service-probe.json).

### Six required flows

All six are **NOT RUN** in this follow-up. The exact-origin service was unavailable before sign-in; no login was submitted and no product state was mutated. The expected results are the scenarios documented by the evidence README:

| Flow | Expected outcome | This run |
| --- | --- | --- |
| 1. Inventory Needs attention | Overdue fixture appears; due-today and seven-days-ahead fixtures appear as approaching; eight-days-ahead is absent; the attention link opens the matching warranty detail. | **NOT RUN** — no attention screen or fixture assertion observed. |
| 2. Effective timezone boundary | With browser, server, and user on different calendar dates, detail and dashboard agree for one `return_by`; stale charge dialog rejects due today and allows yesterday; restore temporary user timezone. | **NOT RUN** — no timezone change or date/charge assertion performed. |
| 3. Vendor non-return charge | On an overdue unshipped advance claim, reject invalid amount/currency; record valid amount, currency, and note; verify one immutable closed event with actor and amount; stale repeat does not duplicate; no invoice/stock change. | **NOT RUN** — no charge submitted or database state changed. |
| 4. Claim before intake | Open/approve advance claim before custody; receive through UI before replacement and verify `custody_id`; repeat intake after replacement; ship with custody control and verify `dead_unit_owed`, outbound time, and custody-event source; stale non-return charge is rejected without mutation. | **NOT RUN** — no claim, intake, shipment, or charge action performed. |
| 5. Legacy association guard | Seed historical unlinked case with pre-claim closed episode and current episode; shipping current episode must not link the older one; with multiple eligible episodes/claims, action refuses atomically. | **NOT RUN** — no historical fixture seeded and no transition attempted. |
| 6. Adjacent regression | Canonical warranty dead-unit shipment and vendor receipt close custody as returned-to-vendor and resolve RMA while preserving replacement serial; standard/stock cases do not gain advance-only vendor-charge actions. | **NOT RUN** — no warranty, stock, or standard-case assertion performed. |

The four package checks all passed on the tested commit: `npm run typecheck` and `npm run build` for `@alga-psa/assets` and `@alga-psa/inventory`. Their current-run logs and outcomes are listed in [current-validation.json](takeover/current-validation.json). No full server build was run. The pre-existing `package-lock.json` modification remains untouched.

The earlier takeover and smoke attempts below are historical evidence from prior commits; they are not newly live-verified in this run. The original `ERR_INSUFFICIENT_RESOURCES` root cause remains unresolved. Full live smoke verification remains blocked until the board-managed service is available at the exact required origin.

## Previous takeover verification (17:34–17:36 UTC)

The existing visible pane `c8403826-ff91-488f-aa28-8447b4f96c06` rendered a labeled local `data:` document with a heading, colored background, input, and button. Alga Dev typing and clicking commands updated the result to `Click received: card-owned-input-verified`. DOM inspection and the nonblank screenshots [before input](takeover/diagnostic-before.png) and [after input](takeover/diagnostic-after.png) agree. The document is [diagnostic.html](takeover/diagnostic.html). It uses no application server or application data and does not simulate any warranty flow.

A newly created browser tab `0bc994e8-aab7-4f56-a707-f94f6742349b` in the same own-card container passed the same check with a different input value. Its [screenshot](takeover/diagnostic-fresh.png) shows `Click received: fresh-card-pane-verified`. Creation and browser operations returned without pane-host mismatches. [runtime-probe.json](takeover/runtime-probe.json) preserves command results; [card-layout.json](takeover/card-layout.json) confirms card ownership, visibility, and unchanged user active space, active tab, and focused pane.

Both panes were then navigated back to the exact required sign-in URL. Their network events report `net::ERR_CONNECTION_REFUSED`; their DOM URLs are `chrome-error://chromewebdata/`. A fresh [service probe](takeover/service-probe.json) records curl exit status 7 and no TCP listener on 3536. No application server was started. No sign-in or product mutation was attempted.

These observations establish that the browser can paint, receive input, and capture content in these panes. The earlier white error-page captures alone did not establish a rendering defect. The original `ERR_INSUFFICIENT_RESOURCES` root cause and successful HTTP application loading remain unverified. The diagnostic is infrastructure evidence only; none of the six product flows below is counted as run.

## Earlier browser observations (17:23–17:32 UTC)

Used `node ~/.alga-xo/bin/cli.mjs` throughout. The Alga Dev host window was `window-1-1793580971518`; board space `77c0c59a-5083-4842-b1cc-f20158ff6c11` belongs to project `3a1d00ee-04c2-4bad-8dfe-4d0458245c41` and is mapped to host `ts:robert-Desktop-AMD-Ryzen-AI-Max-300-Series`.

Created fresh browser pane `376c175b-b142-46db-b907-5be706188acf` using `space-new-tab --projectId=3a1d00ee-04c2-4bad-8dfe-4d0458245c41 --type=browser`. `list-pane-tabs` returned that pane as the active browser tab in the project space, scoped to the expected host. Three navigation attempts used only the required origin and sign-in path. The CLI returned successfully and `browser-get-url` consistently reported the requested URL; DOM inspection showed `chrome-error://chromewebdata/`. Screenshot commands returned file paths, but all five original PNGs at this directory's top level are entirely white (one color, RGB 255/255/255). The original four share SHA-256 `1d569a5b0b2ec3824db0fdcb1e639514834c58adf955f523974ac9d89b2f2fa1`; `visible-origin-error.png` has SHA-256 `af7b92cf82c5d29f2bacbd1c0678f6110982eb2a2a57de65116bc6ef455fc929`. None shows Chromium's error UI or establishes usable screenshot/rendering recovery. A real Tab key input returned successfully, and URL/ownership remained associated with the same pane after the interaction.

Repeated navigation and DOM commands on prior failing pane `c8b5a26d-b238-4df9-87f0-4d0b95e3b67d` returned successfully and remained associated with the same card space. Attribute `net::ERR_CONNECTION_REFUSED` to the browser network events in `network.json` and `visible-pane-network.json`; the direct HTTP refusal is recorded in `http-probe.json`; the PNGs do not depict that error. A read-only layout dump (`own-space-layout.json`) showed the card space was inactive and panes had `visible: false`. The raw root activation failure is in `activate-root-failure.json`: `Pane is not inside a tab container`. I then created a per-pane browser tab (`pane-new-tab.json`) and activated it (`activate-browser-tab.json`). The after-layout shows the card tab in `pinned-visible` with the browser child visible, while the user's active space, active tab, and focused pane stayed unchanged (`visibility-before.json`, `visibility-after.json`, `visibility-after-navigation.json`). The required-origin navigation still produced `ERR_CONNECTION_REFUSED` in `visible-pane-network.json`; the visible child screenshot `visible-origin-error.png` was all white. At that point rendering remained unverified. The later diagnostic above verifies painting and capture independently of this error page. No unrelated space/session or app service was changed. Successful app loading and the earlier `ERR_INSUFFICIENT_RESOURCES` root cause remain unverified.

The project dossier's service history records the board stopping the card service process at 17:22 UTC after the preceding smoke run. A fresh curl probe to the exact origin at 17:32:11 UTC exited 7 with connection-refused stderr (`http-probe.json`); `host-state.txt` separately shows no listener on port 3536. The current pane error is therefore an unavailable destination, not evidence of a vendor-return product defect. No service or application was started. The broad browser inventory call timed out. The matching `host-state.txt` snapshot at 17:27:54 UTC recorded 51 Chromium headless process matches, 56 GiB available memory, and one sampled renderer (PID 148258) with 2,898 open descriptors; swap had about 7.8 GiB of 8 GiB used. These observations do not establish the original resource error's root cause. No shared browser process was restarted or killed, to preserve other cards' sessions.

Evidence files:

- The four original PNGs and `visible-origin-error.png` are retained as raw CLI screenshot outputs. All five are entirely white and are not visual evidence of Chromium's error page or usable rendering.
- `browser-recovery-preflight.webm`, `.vtt`, `.json`: raw 2.19-second preflight recording with burned chapter captions; inspected video frames show a white canvas under the captions, so the recording does not establish browser-page rendering.
- `navigation-*.json`, `pane-url-*.json`, `pane-dom-*.json`, `interaction-1.json`, `network.json`, `screenshot-*.json`: raw CLI outcomes.
- `previous-failed-pane-*.json`: ownership and repeat operation checks on the earlier pane.
- `host-state.txt`: captured window/space ownership, host process/resource snapshot, and port listener check.
- `http-probe.json`: timestamped exact-origin curl stderr and exit status.
- `own-space-layout.json`, `visibility-before.json`, `visibility-after.json`, `visibility-after-navigation.json`: read-only card-space layout before and after the supported activation path. The focused space and pane remain unchanged; the card browser is pinned and marked visible.
- `activate-root-failure.json`, `pane-new-tab.json`, `activate-browser-tab.json`: raw outcomes for the failed root activation and successful per-pane container/child activation.
- `visible-pane-navigation.json`, `visible-pane-url.json`, `visible-pane-dom.json`, `visible-pane-network.json`, `visible-pane-screenshot.json`: latest exact-origin attempt from the activated visible child tab.
- `http-headers.txt`: empty because curl could not connect. No response body was produced.

## Six-flow results

The scenarios and expected outcomes below are copied from `/tmp/alga-smoke-evidence/alga-2026-0002683-20261102T1715/README.md`. All six are **BLOCKED / NOT RUN** because there is no listener at the required origin. The local diagnostic verifies browser operations only. No login was submitted, no fixture was mutated, and no product behavior is claimed as live-verified in this run.

| Flow | Required scenario and expected outcome | Outcome this run |
| --- | --- | --- |
| 1. Inventory Needs attention | Overdue fixture appears; due-today and seven-days-ahead fixtures appear as approaching; eight-days-ahead is absent; the attention link opens the matching warranty detail. | Blocked before sign-in. No attention screen or fixture assertion observed. |
| 2. Effective timezone boundary | With browser, server, and user on different calendar dates, detail and dashboard agree for one `return_by`; stale charge dialog rejects due today and allows yesterday; restore temporary user timezone. | Blocked before sign-in. No timezone change or date/charge assertion performed. |
| 3. Vendor non-return charge | On an overdue unshipped advance claim, reject invalid amount/currency; record valid amount, currency, and note; verify one immutable closed event with actor and amount; stale repeat does not duplicate; no invoice/stock change. | Blocked before sign-in. No charge submitted or database state changed. |
| 4. Claim before intake | Open/approve advance claim before custody; receive through UI before replacement and verify `custody_id`; repeat intake after replacement; ship with custody control and verify `dead_unit_owed`, outbound time, and custody-event source; stale non-return charge is rejected without mutation. | Blocked before sign-in. No claim, intake, shipment, or charge action performed. |
| 5. Legacy association guard | Seed historical unlinked case with pre-claim closed episode and current episode; shipping current episode must not link the older one; with multiple eligible episodes/claims, action refuses atomically. | Blocked before sign-in. No historical fixture seeded and no transition attempted. |
| 6. Adjacent regression | Canonical warranty dead-unit shipment and vendor receipt close custody as returned-to-vendor and resolve RMA while preserving replacement serial; standard/stock cases do not gain advance-only vendor-charge actions. | Blocked before sign-in. No warranty, stock, or standard-case assertion performed. |

Fixture identifiers available from the prior evidence (not modified in this run): overdue RMA `55058b3a-cbff-4b8d-9f12-f1b9ebb17c35` (`RMA-SMOKE2683-OVERDUE`), asset `28cef6e3-f922-4b14-a121-e993c8836fc2`, custody `07b5a1cc-b3dc-45da-bb82-be424fa107b4`; QA user `qa@emeraldcity.oz`, user id `bb3d9c78-6da3-4d77-859e-d014d9709f1e`, timezone `America/New_York`. The other flow fixture IDs are not present in the prior README and were not created.

## Validation and scope

No application server was started. No application code, schema, data, or behavior was changed. The takeover ran `typecheck` and `build` for both `@alga-psa/assets` and `@alga-psa/inventory`; all four commands exited 0. Their logs and outcomes are in [takeover/validation.json](takeover/validation.json). These are package checks, not a full server build. No DB or unit suite was rerun because product code is unchanged. Evidence JSON parsing, image inspection, diagnostic input behavior, and `git diff --check` passed. The pre-existing `package-lock.json` modification was preserved. No committed implementation plan exists under `docs/plans/` in `main..HEAD`; there are no plan changes in the branch range.

Reviewer should first restore the board-managed service at port 3536 in a phase where application startup is allowed. Verify sign-in loading at the exact required origin and rerun all six flows. The live vendor-return behavior, all six flow assertions, fixture IDs beyond the overdue RMA, and the original `ERR_INSUFFICIENT_RESOURCES` root cause remain unverified. The mitigation remains incomplete until that live verification is possible.
