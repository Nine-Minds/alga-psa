# C5 follow-up 2 browser recovery and smoke attempt

Run time: 2026-11-02 17:23–17:32 UTC
Branch: `feature/alga-2026-0002683-c5-follow-up-2-advance-track-v`
Tested commit: `4f74616f97fae2a34a4387a9018acf35aec80a6c`
Required origin: `http://feature-alga-2026-0002683-c5-follow-up-2-advance-track-v.localhost:3536`
Result: **BLOCKED before sign-in by two unresolved issues: the required origin has no listener, and browser rendering recovery is unverified. None of the six feature flows ran.**

## Browser recovery observations

Used `node ~/.alga-xo/bin/cli.mjs` throughout. The Alga Dev host window was `window-1-1793580971518`; board space `77c0c59a-5083-4842-b1cc-f20158ff6c11` belongs to project `3a1d00ee-04c2-4bad-8dfe-4d0458245c41` and is mapped to host `ts:robert-Desktop-AMD-Ryzen-AI-Max-300-Series`.

Created fresh browser pane `376c175b-b142-46db-b907-5be706188acf` using `space-new-tab --projectId=3a1d00ee-04c2-4bad-8dfe-4d0458245c41 --type=browser`. `list-pane-tabs` returned that pane as the active browser tab in the project space, scoped to the expected host. Three navigation attempts used only the required origin and sign-in path. The CLI returned successfully and `browser-get-url` consistently reported the requested URL; DOM inspection showed `chrome-error://chromewebdata/`. Screenshot commands returned file paths, but all five PNGs in this evidence directory are entirely white (one color, RGB 255/255/255). The original four share SHA-256 `1d569a5b0b2ec3824db0fdcb1e639514834c58adf955f523974ac9d89b2f2fa1`; `visible-origin-error.png` has SHA-256 `af7b92cf82c5d29f2bacbd1c0678f6110982eb2a2a57de65116bc6ef455fc929`. None shows Chromium's error UI or establishes usable screenshot/rendering recovery. A real Tab key input returned successfully, and URL/ownership remained associated with the same pane after the interaction.

Repeated navigation and DOM commands on prior failing pane `c8b5a26d-b238-4df9-87f0-4d0b95e3b67d` returned successfully and remained associated with the same card space. Attribute `net::ERR_CONNECTION_REFUSED` to the browser network events in `network.json` and `visible-pane-network.json`; the direct HTTP refusal is recorded in `http-probe.json`; the PNGs do not depict that error. A read-only layout dump (`own-space-layout.json`) showed the card space was inactive and panes had `visible: false`. The raw root activation failure is in `activate-root-failure.json`: `Pane is not inside a tab container`. I then created a per-pane browser tab (`pane-new-tab.json`) and activated it (`activate-browser-tab.json`). The after-layout shows the card tab in `pinned-visible` with the browser child visible, while the user's active space, active tab, and focused pane stayed unchanged (`visibility-before.json`, `visibility-after.json`, `visibility-after-navigation.json`). The required-origin navigation still produced `ERR_CONNECTION_REFUSED` in `visible-pane-network.json`; the visible child screenshot `visible-origin-error.png` is nevertheless all white. Thus the supported visibility path did not restore screenshot rendering; the cause remains unverified. No unrelated space/session or app service was changed. Successful app loading and the earlier `ERR_INSUFFICIENT_RESOURCES` root cause remain unverified.

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
- `http-probe.json`: timestamped curl stderr and exit status for the required origin.
- `http-headers.txt`: empty because curl could not connect. No response body was produced.

## Six-flow results

The scenarios and expected outcomes below are copied from `/tmp/alga-smoke-evidence/alga-2026-0002683-20261102T1715/README.md`. All six are **BLOCKED / NOT RUN**: sign-in was not possible because blocker 1 remains (no listener at the required origin); blocker 2 remains (rendered browser content could not be verified even after the card pane became visible). No login was submitted, no fixture was mutated, and no product behavior is claimed as live-verified in this run.

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

No application server was started. No application code, schema, data, or behavior was changed. No build, typecheck, or test suite was run because this mitigation produced only browser-runtime observations and evidence; the requested live flows were blocked by the unavailable service. The pre-existing `package-lock.json` modification was preserved. No committed implementation plan exists under `docs/plans/` in `main..HEAD`; there are no plan changes in the branch range.

Reviewer should first check whether the board-managed service has been externally restored at port 3536. Then resolve browser rendering evidence in the now-visible own-card pane and rerun this procedure at the required origin. The live vendor-return behavior, all six flow assertions, fixture IDs beyond the overdue RMA, and the original `ERR_INSUFFICIENT_RESOURCES` root cause remain unverified.
