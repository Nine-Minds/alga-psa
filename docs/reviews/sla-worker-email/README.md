# SLA worker email review walkthrough

This walkthrough records a live review of SLA escalation email routing, audit outcomes, worker failure logging, and in-app notifications.

## Tested revision and environment

- Application and emitted worker revision: `d7a067bb76493aabc6f09f2ac903179b7851c0d6`.
- Repair documentation commit: see the repository history for this guide.
- Worker entrypoint: `node dist/ee/temporal-workflows/src/worker.js`.
- Temporal namespace: `sla-email-repair-20261108` (isolated for this run).
- SLA task queue: `sla-workflows`.
- SMTP emulator: GreenMail, host port `3725`.
- The review procedure did not start or restart the application server. During preflight, the environment manager automatically resumed its saved `dev-server` service at 2026-11-08 16:49:58; the live run then used the existing app and infrastructure services.

The live test used identifiable `SLA-REVIEW-A`, `SLA-REVIEW-B`, and `SLA-REPAIR-FAIL-20261108-E` tickets. Board A and Board B are separate test boards with distinct sender routes. Their provider configuration was not changed during the successful deliveries. For the intentional refusal, the SMTP port was temporarily set to `1` and the original provider configuration was restored in cleanup.

## Recording and chapters

[Play the 14.7 second walkthrough](assets/walkthrough-final.webm) with [chapter captions](assets/walkthrough-final.vtt).

- 00:00 — In-app SLA escalation and failure notifications remain visible.
- 00:05 — Email Logs show the two fresh board-routed escalations.
- 00:09 — Board A sender, SMTP `250 OK`, and provider message ID.
- 00:12 — Board B sender, SMTP `250 OK`, and distinct provider message ID.

The recording focuses on the delivered messages and in-app notifications. The intentional refusal and worker error are documented in the evidence below.

## What was verified

| Check | Result | Evidence |
| --- | --- | --- |
| Board A route | `SLA-REVIEW-A` used `SLA Board A <sla-smoke-a@emeraldcity.oz>` and message ID `<17062377-50e4-3c1a-bf1a-9bf5241a73ca@emeraldcity.oz>`. | [Live delivery record](evidence/live-delivery.json), [Board A SMTP detail](evidence/screenshots/board-a-smtp-detail.png) |
| Board B route | `SLA-REVIEW-B` used `SLA Board B <sla-smoke-b@emeraldcity.oz>` and message ID `<3e45bf18-0a68-b499-8f27-fb2e80b98fe7@emeraldcity.oz>`. | [Live delivery record](evidence/live-delivery.json), [Board B SMTP detail](evidence/screenshots/board-b-smtp-detail.png) |
| Audit and delivery | Both successful escalation audits ended as `sent` with their message IDs. The email log details showed SMTP `250 OK`. The implementation records the commit-time `queued` outcome before the after-commit send updates the result. | [Live delivery record](evidence/live-delivery.json), screenshots above |
| SMTP refusal | The final test ticket recorded email `failed`, retained in-app notification success, and an actionable `ECONNREFUSED 127.0.0.1:1` reason. | [Failure record](evidence/failure-live.json), [worker error log](evidence/worker-failure.log) |
| Worker runtime | The emitted Temporal worker ran the SLA queue and completed the two board-specific SLA escalation workflows. | [Worker run excerpt](evidence/worker-run.log) |
| In-app notifications | Escalation and failure notifications remained visible in the app. | [In-app screenshot](evidence/screenshots/inapp-notifications.png), delivery and failure records |

The worker logs show the required error-level event with both `ticketId` and `auditLogId`. The app’s audit row remains visibly `queued` if persistence of the post-send delivery outcome fails; that failure branch was not induced in this walkthrough.

## Repeat the walkthrough

1. Use the existing running application, database, Temporal service, and GreenMail emulator. Do not start or restart the application server for this review.
2. Confirm the two review boards retain their distinct SMTP sender routes. Check the nested SMTP configuration port; the tenant’s nested port is authoritative for this test environment.
3. Build the Temporal workflow package, then start the emitted worker with an isolated Temporal namespace and the explicit entrypoint shown above. Do not use `node .`; that did not start the worker in the recorded environment.
4. Create identifiable SLA escalation tickets on each board and start their SLA workflows on `sla-workflows`.
5. Confirm each email log reports SMTP `250 OK`, then compare its sender and message ID with the GreenMail receipt and audit row. The audit row should finish as `sent` with the matching ID.
6. For the refusal case, temporarily point the SMTP provider at a closed local port, process one identifiable escalation, and confirm `failed`, the refusal reason, and an error log containing both identifiers. Restore the original provider settings in a `finally` cleanup path, including after test failures.
7. Confirm in-app notifications still appear for both successful delivery and refusal.
8. Stop only the worker created for the test and remove only the schedules, workflows, and test records created for the isolated run. Keep unrelated namespaces and schedules untouched.

## Test evidence and cleanup notes

The live worker used namespace `sla-email-repair-20261108`; its 48 automatically seeded schedules were deleted and its 26 scheduled workflows terminated after the run. The historical namespace `sla-email-smoke-3d5269d8` was left unchanged. The test provider was restored to nested SMTP port `3725`.

Three test-generated messages from earlier failed refusal attempts and the post-restoration resolution breach remain in the local GreenMail inbox. Their corresponding auxiliary app tickets and records were removed. GreenMail’s REST API rejected message deletion, so the messages were left in the local QA mailbox rather than risking deletion of unrelated mail. They are not included in the successful-delivery evidence.

## Review-board status

The captain-facing guide is published at `http://100.109.101.64:43207/` and returned HTTP 200 from the review browser. The running board workflow engine rejects `workflow-open-review` with `Unknown workflow command: workflow-open-review`; therefore no Open Review action or human approval is claimed. This external board action must be made available and run successfully before the review can be marked ready.
