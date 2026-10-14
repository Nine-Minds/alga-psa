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
