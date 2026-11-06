# Invitation authorization verification

Application revision: `ef5f216168bd8bfedeec1834e7e1464829995c71`.
Date: 2026-11-06.

The existing repair checks invitation authority and MSP permission subsets before
persisting invitations. This verification adds no application changes. No approved
task plan was found in `main..HEAD` under `docs/plans/`.

## Results

| Check | Evidence and method | Result |
| --- | --- | --- |
| Actual Users edit-drawer current-user response | Preserved browser evidence from 2026-11-04 at the exact application revision; `preserved-edit-drawer-response-metadata.json` | Identity and roles preserved; populated database password/MFA credentials excluded |
| Current-user response with populated database credentials | Fresh request to the real browser-facing Next server action at `/msp/settings/users`; `current-user-http-response-metadata.json` | Identity and Admin role preserved; password/MFA fields and temporary MFA sentinel absent |
| Allowed invitation | Real authenticated `sendUserInvitation` Next server action; `invitation-send.json` | Project Manager invitation persisted and delivered |
| GreenMail delivery | Parsed the real message returned by the existing stack mailbox API; `greenmail-delivery.json` | One message; actual setup link points to the card origin |
| Invitation acceptance | Requested the emailed setup URL, then invoked the real unauthenticated verification and completion Next server actions with its token; `acceptance.json` | Account created successfully |
| Fresh login and persistence | New HTTP client context, real credentials callback, session endpoint, and PostgreSQL assertions; `fresh-login-database.json` | Session issued; exactly Project Manager assigned; invitation marked used; both email columns canonicalized |

These HTTP checks used the running card app and card database, without mocked
services or fabricated tokens. Acceptance and fresh login were exercised through
HTTP, not through new browser clicks. The inviter was the canonical QA Admin;
the PM escalation-denial and non-Admin subset-grant passes were preserved from
earlier runs rather than repeated.

The earlier edit-drawer screenshot is
`/tmp/alga-smoke-evidence/security-authz-senduserinvitation-20261104T2022Z/02-user-edit-drawer.png`.
Its response metadata records four successful browser action responses on the
exact application revision. The screenshot and metadata were reviewed again.
A temporary populated MFA secret and an existing password hash also backed the
fresh HTTP response check. The original MFA value was restored immediately.

## Runtime and typecheck limitations

The managed app on port 3358 belongs to this worktree and uses the card database
at `127.0.0.1:6472`, database `server`. QA credentials returned a real session.
The supported Alga Dev browser/service commands reported no hub responder, so
browser diagnostics used an isolated Chromium context.

Fresh browser click-through remains unstable. The actual Users route is
`/msp/settings/users`; the builder's earlier diagnostics targeted `/msp/users`.
The correct route also repeatedly reloads. Captured initiator stacks attribute
reloads to Turbopack HMR restart handling. The HMR version metadata reports
installed Next 16.4.2 and expected 16.4.5; that does not establish the cause of the
restart loop. No Next upgrade, hydration bypass, server restart, or authorization
guard change was made. A diagnostic HMR-isolation experiment from the builder
also produced a blank page and was not counted as a validation pass.

The saved server typecheck ran with a 6 GB heap and exited 1 with diagnostics in
nine files. None overlap the branch's changed files: billing profitability
reports, document editors/viewer, ticket mobile editor, UI editor components,
and `sanitizeEmailHtml`. This completed typecheck has unrelated workspace
diagnostics; it is not a passing check. A later rerun of `npm run typecheck`
without a heap override exited 134 from V8 heap exhaustion before diagnostics,
so that rerun is incomplete. Its output is preserved at
`/tmp/send-user-invitation-server-typecheck-rerun.log`. No application code
changed.

## Revision reconciliation

The application tree at `025f46ac5c6ca3c49b638b169b61b8312d3d0da9` is identical
to `ef5f216168bd8bfedeec1834e7e1464829995c71`; `025f46ac5c` adds this verification
record only. Therefore the preserved 2026-11-04 Users edit-drawer click-through
and response metadata apply to the current application revision. That evidence
records four successful browser action responses and populated database
password/MFA fields excluded from the response while identity and Admin role
remain. Fresh click-through was not claimed: the current Users page still loops
through Turbopack HMR reloads. The saved HTTP credential-response and GreenMail
acceptance artifacts also target `ef5f216168bd` and are valid for the unchanged
application tree. The current `ensure-test-login.mjs` invocation exited zero;
the preserved live verification log records a real QA credentials callback and
a fresh browser-context session response identifying the expected QA account.

The managed board service record names this worktree's `server` directory,
`PORT=3358`, and the existing `dev-server:3` process. The card-origin sign-in
probe responds, and the saved process/environment inspection confirms the
service database is `127.0.0.1:6472`, database `server`. No service was started
or recovery duplicated during this verification.

No applicable approved plan was found in `main..HEAD` under `docs/plans/`.

## Cleanup and artifacts

Original tenant SMTP settings and the QA MFA value were restored. The dedicated
invitee was deactivated, its role assignment removed, and its sessions deleted.
The used invitation and delivered GreenMail message remain as test history.
See `cleanup.json`, `acceptance-cleanup.json`, and `final-cleanup.json`.
No tokens, passwords, password hashes, or MFA-secret values are included here.
The pre-existing `package-lock.json` modification was preserved.

Fresh sanitized artifacts are in
`/tmp/alga-smoke-evidence/security-authz-senduserinvitation-takeover-20261106/`.
The builder's full typecheck output and HMR traces are in
`/tmp/alga-smoke-evidence/security-authz-senduserinvitation-20261106T-live/`.
Earlier Admin invitation/Add Role denial and allowed-subset UI evidence remains
in `/tmp/alga-smoke-evidence/security-authz-20261104T1822Z/`; it is historical
rather than a new UI pass on this revision.
