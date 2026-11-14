# Viewer routing verification — 2026-11-03 19:57 UTC

At 19:57 UTC, the commands returned success for the then-inventory pane `be074bd7-84b1-4da7-a4bb-f32e23ef33df` and probe pane `b3420e12-68c2-45c3-925b-48a00de8dbad`. Treat this as a historical, time-bound result, not proof of current routing for a reused pane ID. The 23:08 UTC correction is in [routing-verification.json](viewer-routing-verification.json) and the current command capture is in [the later routing diagnosis](../605341a1b06c379b4144e27dbb260beb77fef417-routing-diagnosis/routing-reproduction.txt): the current inventory returns pane `363aee64-8363-4f73-a507-21e87b473299`, where browser commands succeed; old pane `f9b1c96a` is absent and not consistently routable.

At capture time, the target pane showed the review app's MSP sign-in page and was not authenticated. The screenshot records that historical limitation; it is not feature acceptance evidence. The review app then served revision `a29e82f8c9633e6956b746a58ea76f9cd35accb9+da39a3ee5e6b` at port 23835. Port 3835 had no listener. No Alga PSA server was started or restarted.

No fresh authenticated UI checks or timesheet edit were possible. The prior authenticated evidence remains historical. The requested smoke walkthrough triplet was not created.
