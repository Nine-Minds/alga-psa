# T009 / latest fix: onboarding Retry after a lost response (production build-1793009958637)

Actor QA, client "CM-REVIEW-20261026-01 Cancel" (cancelled-only history, header offers Enable).
1. Filled client-fixed setup: workspace "DEPLOY-4E5F Retry IT", admin deploy-4e5f-retry@cancel.test, 1 seat, General Support escalation board.
2. Fault: an in-page fetch wrapper let the provisioning server action reach the server (HTTP 200) and then discarded its response (TypeError), i.e. a lost response. Recorded: action 7f969b0906…, status 200, 2026-10-26T11:11:03Z.
3. Server state: exactly one operation 306ec511-9b88-4705-ba99-18422e349db7, pending_acceptance.
4. UI: submit button relabelled "Retry"; hints "The request result could not be confirmed. Retry these same details to recover it." and "This request has already been submitted. Retry to recover its result without creating another workspace." (screenshot t009-retry-offered.png). PASS
5. Retry: view advanced to "Awaiting customer acceptance … Administrator invitation sent" (t009-retry-recovered.png). Still one operation, one live relationship, one reserved seat. PASS
6. Cleanup: Setup progress > Cancel setup > "Delete workspace and cancel": operation cancelled, allocation released, relationship terminated before activation; sponsor allocations back to 4 active. One invitation email to the disposable admin address remains in the local SMTP sink.
