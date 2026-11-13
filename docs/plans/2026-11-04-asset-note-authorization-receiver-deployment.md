# Alga Dev receiver deadline deployment

The receiver expiration gap found during asset note smoke testing was resolved
on both viewers serving `wf.cli.hub`. Updating the Linux viewer alone left
intermittent failures because the Mac viewer also belonged to the shared queue.

The asset note implementation remains at `e54d971436ab3d2548eda4464afa044adbec802f`.
Its specification is [Asset note authorization](2026-11-03-asset-note-authorization.md).
This deployment did not start the PSA app. Port 3143 refused connections at the
end of verification.

## Active viewers

| Host | Local revision | Checkout | Final PID |
| --- | --- | --- | --- |
| Linux desktop | `27618cdeb4b4d700b65de3393c9dcd3f89de5731` | `/home/robert/alga-dev/ghostty-pane-ide-cli-viewer-fix/ghostty-pane-ide` | `2250396` |
| Mac | `ae7a28d74253b27eb14ffcec7f9872ff9c4e867d` | `/Users/roberisaacs/alga-dev-receiver-deadline/ghostty-pane-ide` | `31896` |

The Linux main artifact SHA-256 is
`36d233e814e121c798b0c523a81efc598475e9176d197280e98de412ef4880a7`.
The Mac main artifact SHA-256 is
`7f35ad670d72b6a0e847e9f48b3fe11dfdcec3493fd58b1a7500e77b304084a2`.

The Mac checkout has a newer shared `command-relay.ts` implementation. Its
backport preserves and validates `deadlineAt` there, rejects expired requests
before dispatch, and checks the deadline again after asynchronous hub scope
resolution. The CLI tunnel applies the same expiration rule before dispatch.
Both commits remain unpublished.

## Lifecycle and verification

The Linux single-instance launcher focused the existing viewer. GNOME Mutter's
`RemoteDesktop.Session` API delivered its normal Ctrl+Q accelerator. The
candidate then launched with `npm start` under the user systemd manager. On the
Mac, AppleScript requested the application's normal Quit action, and `open`
launched the built checkout. Persisted tab state survived both handoffs.

Verification after activation covered:

- Real `cli.request` traffic to each viewer: expired reads and mutations were
  rejected with `reason: deadline` and `retryable: false`; valid reads succeeded.
- Twelve expired hub requests during the wire checks, followed by 24 expired
  requests and four valid requests after fixture cleanup and the final restarts.
- The supplied expired-hub reproducer returning a deadline rejection.
- Installed CLI service listing, project-owned browser URL and DOM inspection,
  input with value readback, clicking, screenshots, and recording start/mark/stop.
  The final WebM decoded successfully with FFmpeg.

The temporary host registry entries, cached connection hints, and five fixture
tabs were removed. Cleanup retained unrelated tabs created concurrently.

The Linux candidate's 22 focused behavioral tests and strict receiver typecheck
pass. On the Mac, five regression assertions failed before the fix; all 17
focused tests pass afterward. Its production build and strict receiver
typecheck pass. Full repository typechecks retain baseline workflow, renderer,
and test errors; normalized baseline comparisons found no added diagnostics.

The candidate's nine-second router and no-replay implementation were preserved
and tested. The installed Linux agent remains release
`20261104000126-g692866e297`, whose tunnel timeout is 15 seconds. This receiver
deployment did not change the fleet's global desired host bundle.

## Evidence

Evidence is stored at
`/tmp/alga-smoke-evidence/receiver-expiration-takeover-20261104T0148Z/`:

- `live-wire-results.json`: both viewers' real wire responses.
- `final-hub-results.json` and `final-supplied-expired-hub.json`: expiration and
  valid-request checks after the final restarts.
- `final-linux-runtime.json` and `mac-final-activation.log`: active process,
  checkout, artifact, and fixture cleanup evidence.
- `mac-receiver.patch`, `mac-fix-tests.log`, and `mac-build.log`: the Mac source
  change, failing/passing behavioral tests, build, and typecheck diagnostics.
- `final-installed-cli-checks.json`, `final-browser.png`, and
  `final-browser.webm`: final browser and recording checks.

The existing PSA lockfile change was preserved. Nothing was pushed and no PR
was opened.
