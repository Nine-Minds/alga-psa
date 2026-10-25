# Co-Managed IT takeover evidence

The recorded production candidate is `704fbdca25327d9bfc1b53d37771e05a4de3ca08`,
`build-1792910542349`, on port 23377. Canonical port 23374 remains the older
`cd28aa9531f7` build. Source repair `2c3f487bad` and the preceding cookie repairs
are **undeployed to production**. No app server was started or promoted during this takeover.

[Coverage](video-coverage.json) maps one separate WebM/VTT/JSON to each of the
main, collection and twelve section guides. These replace route-only clips in
the current review packet while preserving those clips and all earlier media.
The recordings contain actual product interactions and outcomes, rather than
2–3-second route displays. All fourteen **full scenarios remain partial**.
[Playback checks](playback-verification.json) verify actual Chrome playback and
chapter seeking. Media completion is separate from scenario acceptance.

The QA and Alice contexts retain their actual home identities. Alice's existing
legitimate session enabled these checks; normal fresh login on the old runtime
fails because an inactive restored account with the same email shadows her
active account. No credentials, hashes, grants or old fixture state were changed
to work around that failure. The newly invited disposable administrator used the
original delivered invitation and normal setup.

| Area | Current bounded outcome | Remaining scope |
| --- | --- | --- |
| Onboarding | Fresh client/workspace, original SMTP invitation, multipart mutation rejected before acceptance with zero forbidden boards; acceptance and normal setup reload | Cancellation, stale acceptance, lapse and full intake matrix |
| Seats | White Rabbit allocation 1→2→1 saved/reloaded; initial allocation restored | Actual paid pool purchase, all concurrent/lapsed cases |
| Access | Board Collaborate→View→Collaborate saved/reloaded | Teams, all resource/mask/credential matrices |
| Delegation | Existing approved board description edited, reloaded and restored | Approval/revocation and every delegated operation |
| Ticket queue/SLA | Handback and Alice re-escalation persist; separate responsibility clocks pause/resume | Full assignment, bulk/error recovery and SLA policy settings; mapping route resolved client composition, so mapping editing is not claimed |
| Tasks | Task rename saved/reloaded/restored; project scope revoke denies fresh QA access; grant restored | A task-note attempt did not confirm publication and remains unverified; assignments, all histories/files/disclosure |
| Conversations | Distinct Alice recipient sees new QA shared note without reload; both organization-private lanes stay isolated | Requester, files, removal, disclosure and full notification matrix |
| Native/workflow | Native ticket triggers succeeded Temporal run and two comments persist after reload; workflow restored Paused | Other native writers and provider effects; initial selector wait failed, continuation confirms actual comments |
| Time/billing | Grid shows shared work rows; List shows five entries, 4:15 total, including the identified 15-minute commercial entry | Approval, contracts, invoice generation and full financial negatives |
| Departure | Existing terminated disposable customer retains native read; sealed manifest/released seat read; MSP archive surface | No new closure or participated archive/file/invoice acceptance in this recording |
| Portability | Current encrypted export downloaded/hashed, actual operator inspect/restore/retry, wrong-passphrase/tamper rejected | Paid activation, recovered native sign-in and complete source/destination comparison |
| Providers | Separate customer/sponsor settings and customer-owned provider workbench inspected | Provider configure/persist, Microsoft callback, directory, inbound/reply/replay/revocation not verified |

The provisioning clip ends with a read-only instrumentation query using the
wrong column name. A corrected read in [receipts](receipts/) verifies operation
`c4ceacf3-f665-4c7b-a69f-30e6a2d395bc` and activated tenant
`aa2e4150-44e0-4a67-8b69-d8195be3b9a1`; this was not an application failure.
The original invitation is kept private. The SMTP link advertised canonical
23374; the identical delivered token was opened on the already-running 704f
candidate 23377 for this check. No token was regenerated or directly inserted.

The isolated restore destination is `de000220-25a9-4c74-b94d-992ce01c915f`.
It remains `portable_restore_pending_activation`: one inactive user, zero live
relationships, two tickets, one project, one task and 26 comments. Retry returns
the original receipt. Archive bytes, passphrase and session files remain private.
This is source-CLI recovery evidence using the current export; it is not a paid
activation or production native-login pass. The earlier suspended restore remains
untouched.

## Source auth repair and validation

`2c3f487bad` makes unscoped internal sign-in examine all email/type matches,
skip inactive candidates when resolving multiple records, and reject credentials
matching active users in multiple tenants. Tenant-qualified lookup, revocation,
identity and product checks remain in force. The same resolver already protected
unscoped client sign-in. Regressions cover inactive restored duplicates, matching
active tenants, wrong passwords, all-inactive matches and explicit tenant denial.

- Auth package: 56 test files / 285 tests pass; auth package build and typecheck pass.
- Server cookie-boundary regressions: 2/2 pass, including issuer/reader alignment.
- Server `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`: exit 0.
- Previous-source counterfactual: inactive-restore regression fails as expected.
- Guide renderer: 4/4 tooling tests pass; synthetic test media are not acceptance evidence.

The existing development app (no restart) additionally passed two browser
checks: QA retained its session through native/shared navigation and reloads
both with a clean cookie jar and with the old production cookie present; fresh
Alice normal login selected her original customer tenant despite the inactive
restored duplicates and survived reload. See [dev cookie/session receipt](dev-session-check.json)
and [restored-duplicate login receipt](dev-restored-duplicate-login.json).
These do not prove a repaired production deployment or direct card Open Review.

Review readiness stays false. No source-only requirement is promoted to verified
by bounded checks. Microsoft's external authority and destination-owned paid
entitlement remain dependencies; available privacy, financial and provider
checks are still unverified rather than all being labelled externally blocked.
Canonical promotion and supported QA Open Review on 704f require deployment
work prohibited by the current no-start restriction. PR #3363 remains draft and
conflicting; this evidence does not clear CI or merge readiness.
