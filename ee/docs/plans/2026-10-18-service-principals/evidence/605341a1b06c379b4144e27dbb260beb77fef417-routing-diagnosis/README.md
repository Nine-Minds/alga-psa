# Card C mitigation recheck

The current project-scoped browser inventory returned pane `363aee64-8363-4f73-a507-21e87b473299`. `browser-get-url`, `list-pane-tabs`, and harmless navigation succeeded through `/tmp/ghostty-pane-ide/agent-cli.sock` with `ALGA_PROJECT_ID=408b0ddd-de45-4ef6-bf35-b88251c8515c`. Pane `f9b1c96a-95c0-46ea-b8af-e0deaa1b6039` is absent from the current inventory; its responses varied between unsupported-method, different-host, and not-found. The previous `space-new-tab` success proved tab creation only. See `routing-reproduction.txt` and `routing-verification.json`.

The intended viewer router is present at Alga Dev checkout revision `f1627486d2440b5b82734a29c0782482630e17eb`; its focused behavioral suites passed 12/12. No Alga Dev source or shared runtime was modified or restarted here.

The review-app/dev-server are unavailable: only `idp-sim` and `review-guide` are live, and ports 3835/23835 refuse connections. The board now records `blocked/access` at project revision 176. No authenticated Settings checks, fixture SQL, QA timesheet edit/reopen, screenshots, or walkthrough triplet were produced. Keep prior production acceptance pinned to product revision `a29e82f8c9633e6956b746a58ea76f9cd35accb9`.

The completed independent review and the still-inconclusive board verifier are distinguished in `draft-review.md`.
