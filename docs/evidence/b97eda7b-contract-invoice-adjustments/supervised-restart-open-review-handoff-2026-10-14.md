# Supervised restart and Open Review handoff (2026-10-14)

This is a deployment acceptance procedure, not implementation evidence. Keep
the app servers stopped during code work. The latest application candidate is
`35f4d3bdf2f09b913acbd14b9048ec420d1621ed`; the recorded production listener
was PID `2758219`, build stamp `4571290674fe78f75438e90ec10ae0afc4d6e85a+da39a3ee5e6b`.
The exact supervisor and Open Review implementation are in the separate
`Nine-Minds/alga-dev` repository (`ghostty-pane-ide`), not this PR's source.

## 1. Capture state, restart, and prove replacement

Use the board-owned operation; do not launch the app directly or alter service
use policies. Record the full command output and UTC timestamps:

```sh
alga-dev workflow-list-services --projectId=b97eda7b-0e3f-4b09-be80-6b57f934d8a5 --live=true --health=true
ssh robert-X670E-Pro-RS 'ps -eo pid,ppid,lstart,args | grep "next-server"; ss -ltnp "sport = :23185"'
curl -fsS http://127.0.0.1:23185/api/health
alga-dev workflow-restart-service --projectId=b97eda7b-0e3f-4b09-be80-6b57f934d8a5 --name=review-app --actor='agent:Draft Implementation'
```

The registered command runs `review-app.sh` from the service cwd. Read its
configured build directory (`.next-review` when `next.config.mjs` honors
`NEXT_DIST_DIR`, otherwise `.next`) on the registered host, and capture both
`BUILD_ID` and `.alga-review-revision` before and after restart:

```sh
ssh robert-X670E-Pro-RS 'cd /home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc/server && for d in .next-review .next; do if test -f "$d/.alga-review-revision"; then printf "%s " "$d"; cat "$d/.alga-review-revision"; cat "$d/BUILD_ID"; fi; done'
```

Use the actual registered service cwd and host if they differ from the recorded
values above. Do not infer readiness from service metadata or HTTP 200 alone.
After restart, repeat the process/listener, health, and revision observations.
Require all of the following before proceeding:

- The old registered process and its descendants have exited; the listener is
  owned by the replacement process tree, with new PID and start time.
- The restart operation reports success only after the registered start
  definition has completed its build/start work. A failed build or surviving
  old listener is a failed restart.
- Health succeeds and the serving build marker identifies the requested
  candidate `35f4d3bdf2f09b913acbd14b9048ec420d1621ed` (or a later explicitly
  approved candidate). Record the complete stamp, not a shortened prefix.
- Capture the supervisor result and the post-restart listener/build evidence
  together. Any mismatch remains not ready; do not proceed to acceptance.

## 2. Verify the exact Open Review route and session

From the board's Open Review button (the same user-visible route that failed),
open the card. Also capture the command route result for diagnosis:

```sh
alga-dev workflow-open-review --projectId=b97eda7b-0e3f-4b09-be80-6b57f934d8a5
```

The result must identify the review tab, app pane, execution host, app origin,
and signed-in account. In that app pane, verify the current candidate stamp and
load the same-origin `/api/auth/session`; confirm the session is authenticated
and its account identity matches the current configured review account. Capture
the session response with identity fields only; do not capture cookies,
passwords, tokens, or authorization headers. Confirm navigation lands on the
review entry page and the adjacent guide pane is usable. A fresh browser,
direct login, launcher label, or successful HTTP response by itself does not
pass this check. A missing or disposed pane must be resolved/recreated on the
registered app's remote host, then navigation, sign-in, and session verification
must run against that pane. Any failed authentication handoff is a failed
Open Review result.

In DevTools for the canonical app origins `http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:3185`
and `http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185`,
record the effective cookie **names and non-secret attributes only**: domain,
path, SameSite, Secure, HttpOnly, and expiry/max-age. Never copy cookie values.
Correlate navigation requests with `x-request-id` or `x-correlation-id` and
record available safe rejection reason codes. Do not reset shared credentials,
clear shared sessions, or export browser storage.

## 3. Production acceptance on the verified revision

Use isolated, owned editable fixtures for writes; preserve delivered invoices,
exports, recurring claims, and historical artifacts. In the production review
pane, verify:

1. Invoice adjustment recovery retains pending expanded and collapsed rows,
   removals, and edits across controlled expiry and explicit retry. Confirm
   failed reads do not write and stale concurrent revisions are rejected.
2. Save, reselection, totals, and PDF output agree with persisted invoice data;
   verify the generated PDF contents and totals.
3. Client portal invoice visibility and displayed totals agree with the invoice.
4. Finalized, paid, cancelled, exporting, and exported lifecycle protections
   remain enforced; export locks and historical exports remain intact.

On both canonical origins, correlate the recovery/navigation requests with
request IDs and safe rejection reasons. Distinguish intentional cookie
isolation between ports from controlled expiry recovery. If a session disappears
without controlled expiry, record the sanitized effective cookie configuration,
request IDs, and rejection reasons. Spontaneous invalidation remains
unexplained until correlated evidence establishes a cause; do not attribute it
to cookie isolation or claim it fixed based on controlled signout recovery.

Record each result, exact candidate stamp, fixture IDs, and evidence paths in
the card dossier. Whole-card readiness remains blocked until every gate above
passes on the replacement production process.

## Owner diagnosis from read-only inspection (2026-10-14)

The application and board supervisor have separate owners. Keep supervisor and
Open Review implementation in `Nine-Minds/alga-dev`, in the
`ghostty-pane-ide` project. The invoice candidate remains
`35f4d3bdf2f09b913acbd14b9048ec420d1621ed` on PR #3499.

### Restart acknowledgment does not prove replacement

At 07:23 UTC, `alga-dev workflow-list-services --live=true --health=true`
reported `review-app` as live with `restartedAt=2026-10-14T06:55:27.438Z`
and HTTP 200 on its `/api/health` probe. Read-only process inspection found
PID `2758219`, started October 13 at 21:27:38, still listening on port 23185.
Its cwd is the PR worktree's `server` directory. The active
`server/.next-review/.alga-review-revision` still contains
`4571290674fe78f75438e90ec10ae0afc4d6e85a+da39a3ee5e6b`. This rechecks the
old listener/build observation; it does not establish which process the 06:55
operation attempted to stop.

In Alga Dev, `src/main/workflow/WorkflowCardServiceService.ts`,
`restartService` catches and logs errors from `killAgentSession` or
`killSession`, then continues to `spawnServiceProcess`. It stores
`restartedAt` after `createSession` returns. That path does not await a
successful production build or readiness before returning success. The
registered readiness probe is only an HTTP `/api/health` check, so a response
does not identify the serving PID or build. `src/shared/pty/PtySessionManager.ts`
and `src/agent/pty-service.ts` document and implement a stop operation that
waits for the detached service process group to stop; the gap is that the
workflow restart caller treats a rejected stop as a warning and reports the
later spawn/metadata result as a successful restart.

Alga Dev owner change: make a restart fail and propagate the stop error if the
old service cannot be confirmed stopped. Only report restart success after the
replacement launch definition has completed its required build/start phase and
readiness succeeds. Return or log enough process-generation evidence for the
operator to correlate the registered service, listener PID, and build marker.
Keep a plain health response separate from candidate identity.

Verify the owner change with behavioral coverage for (1) stop failure causes
restart failure and does not launch a replacement, (2) the old process group
has exited before a replacement starts, (3) build/start failure propagates,
(4) readiness failure is not reported as success, and (5) successful restart
reports the replacement generation. Then, in the separately supervised live
step, require the old PID to exit, the new listener PID to belong to the
replacement process, the production build to complete, and the running
`.next-review` marker to match the approved candidate. Check health and
authenticated application navigation after those identity checks.

### Open Review remote pane handoff

The retained smoke files `open-review.json` and `open-review-retry.json` both
contain `Browser pane not found:
review-app-b97eda7b-0e3f-4b09-be80-6b57f934d8a5-ts_robert-X670E-Pro-RS`.
They show the failure text, not which workspace or browser-host stage failed.
The separate Alga Dev worktree
`/home/robert/alga-dev-open-review/ghostty-pane-ide` is on
`fix/open-review-remote-browser-handoff` at `69cb91d` (also its origin branch).
It contains `df8e9c2`, which adds
`src/main/workflow/review-pane-backend.ts` and makes `CardReviewService` wait
for the remote browser backend to register after workspace creation; `69cb91d`
also refreshes activity when it reuses a registered remote pane. The behavioral
tests cover delayed registration, no registration, disappearing backends, and
local pane wake. This source inspection does not prove that either repair is
published to the running IDE or that the exact card pane now authenticates.

Alga Dev owner acceptance: follow the board button through
`CardReviewService.openCardReview` → `openReviewWorkspace` → the renderer's
`useWorkflowOpenReviewHandler` → remote `RemoteBrowserPane` registration →
`resolveReviewPaneBackend` → sign-in and `/api/auth/session` verification.
Instrument the result with the requested pane ID, actual host, actual
registered backend, app origin, and the session result from that same pane.
If the pane is missing, ensure workspace materialization creates it on the
app's execution host before sign-in. Do not substitute a new card browser or a
direct login. Verify with a behavioral delayed-registration test and a live
board-button run that confirms the exact pane remains authenticated after
navigation and that the guide pane is usable.

### Authentication investigation boundary

Spontaneous session invalidation remains unexplained. Controlled signout and
retry evidence proves recovery behavior, not the cause of a spontaneous loss.
The supervised operator should capture effective origin, runtime mode,
effective auth URL, cookie name and non-secret attributes, navigation timing,
and correlated safe rejection reason codes independently on canonical ports
3185 and 23185. Do not capture cookie values, tokens, credentials, or session
payloads. Do not infer runtime configuration from source defaults.

No service was started or restarted during this inspection. The dev-server on
3185 and production review-app on 23185 remain separate registered processes.
