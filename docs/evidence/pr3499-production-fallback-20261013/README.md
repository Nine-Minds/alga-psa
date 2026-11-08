# PR #3499 production fallback verification

**Readiness: BLOCKED.** This is a local Chrome/Playwright fallback against the already registered production app. It is not an IDE browser-pane result and does not satisfy signed-in Open Review.

- **Production source:** application revision `4571290674fe78f75438e90ec10ae0afc4d6e85a`; production stamp `4571290674fe78f75438e90ec10ae0afc4d6e85a+da39a3ee5e6b`; `/api/health` returned HTTP 200, `status=ok`, `version=1.0.0`.
- **MSP fallback identity:** `qa@emeraldcity.oz`, `user_type=internal`. This identity naming is not an Open Review requirement; the browser session itself remains fallback evidence.
- **Portal identity/role:** `smoke281.portal@emeraldcity.oz`, `user_type=client`, contact `164ec170-b852-41a0-b160-e7835a94d17c`, `contacts.is_client_admin=true`, client `5ba78228-ace1-4990-b42f-30739458299a`.
- **Production walkthrough:** invoice preview, contract template, client-contract Lines, and Accounting Exports deep links loaded in the authenticated MSP session. The already-delivered export batch `f4296b3c-5dec-4452-837d-17e4fecdbd53` was inspected without replay.
- **Editable owned fixture:** `REVIEW-3499-EXPANDED` was read-only audited at $3,900/revision 8, three generated charges, zero manual rows, zero payments, and not finalized. A $1.00 non-taxable Asset Tracking manual charge saved as one row; reload and a repeated save kept one row and $3,901. Preview and downloaded PDF both showed $3,901 subtotal/total and $0 tax. Remove + save restored $3,900/revision 11, three generated rows, zero manual rows. The existing `REVIEW-CONTRACT-3499` fixture was not mutated: its legacy unmapped manual charge rejected a save and its baseline remained unchanged.
- **Portal role and output:** the client-admin session opened Billing. `SMOKE457-INCREASE` listed issue date October 13, 2026; invoice details and downloaded PDF showed issue date 10/13/2026, due date 11/12/2026, and A$455.96 total. The signed Cabling true-up included the service, covered dates, 19/31 proration calculation, and A$73.55 amount.
- **Finalized protection/history:** the finalized app view had no adjustment editor; visible lifecycle actions were left untouched. Read-only production DB values remain `SMOKE457-INCREASE=45596`, `SMOKE457-CREDIT=32205`, `INV-000063=28230` minor units, each `status=sent`; batch `f4296b3c-5dec-4452-837d-17e4fecdbd53` remains Delivered. No delivered invoice or batch was changed.
- **Guide:** its stale QA-only Open Review assertion and plaintext password were removed. It now distinguishes fallback browser evidence from Open Review and remains BLOCKED. Four expandable sections remain; all 18 relative evidence links return 200.

## Outstanding access confirmation

At 2026-10-14T02:07:41Z, fresh `space-new-tab --type=browser` failed immediately: `No hub command responder is available for space-new-tab: no responders: 'wf.cli.hub'`. At 02:07:42Z, `workflow-open-review` returned the same missing `wf.cli.hub` responder error. `alga-dev ping` returned `pong`; Tailscale reports the registered viewer peer `100.70.145.1` offline (last seen 01:40:00.1Z). No `signedInAs` was returned and no actual Open Review session was confirmed. Restoring the IDE hub/viewer outside this repository is required before readiness can change.

`results.json` contains the timestamped structured handoff. PNG/PDF files capture the corresponding screens and invoice outputs. No application source was changed and no application test/build was run; this commit records operational verification only.

## Viewer restoration follow-up

On 2026-10-14 at 02:13:44Z, a fresh `space-new-tab --type=browser` attempt timed out; `workflow-open-review` timed out at 02:13:54Z. Host ping still returned `pong` at 02:14:05Z. Production health remained HTTP 200. The local NATS monitor at 02:14:15Z showed four connected Alga Dev clients and no subscription to `wf.cli.hub`; Tailscale still reported the registered MacBook viewer `100.70.145.1` offline. The X670 host has its service supervisor but no Electron IDE process. Source inspection confirms the Electron main process starts the `wf.cli.hub` responder from `src/main/cli/socket-server.ts`.

This locates the blocker before browser creation and authentication. The MacBook owner must wake/power on the workstation, restore Tailscale, and open or restart Ghostty Pane IDE with its shared Alga Dev/NATS connection. Confirm the IDE log says `[CLI Server] Shared hub command responder active` and the client subscribes to `wf.cli.hub`; then rerun both commands and verify `signedInAs` and `/api/auth/session` in the returned browser. No production service was restarted and no production data was changed. Readiness remains BLOCKED. See [`access-restoration-20261014.json`](access-restoration-20261014.json) for exact command results and timestamps.

## Takeover verification

The takeover independently checked the responder source, NATS subscriptions, viewer peer, and production health. Fresh browser creation and Open Review still timed out; no identity was returned. See [takeover-access-check.json](takeover-access-check.json). The application source is unchanged from the deployed `4571290674` revision; all subsequent changes are evidence only. No application build or typecheck was rerun for these documentation changes.

The owner has been asked to reconnect the viewer workstation. The preparation agent retains responsibility for the final browser and session checks once that external prerequisite is restored. Do not restart the production app to repair the absent IDE responder, and do not rerun the completed financial walkthrough. Readiness remains BLOCKED.
