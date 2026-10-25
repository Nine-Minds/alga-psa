# Co-Managed IT acceptance plan

Status: **Partial production acceptance; review remains incomplete.**
Latest recorded candidate: `704fbdca25327d9bfc1b53d37771e05a4de3ca08`,
production `build-1792910542349` on port 23377. Canonical port 23374 still
serves `cd28aa9531f7` / `build-1792904848073`. The later auth repairs are source
changes and have not been deployed. Historical recordings remain separate;
evidence publications never relabel a runtime.

This plan makes the existing approved scope actionable; it does not replace it.
The approved authority is [the foundation plan](../2026-09-06-co-managed-it-plan.md),
[customer integration PRD](../2026-09-11-co-managed-client-integration/PRD.md),
[ticket-list PRD and amendments](../2026-09-11-co-managed-ticket-list-unification/PRD.md),
[whole-card completion plan](../2026-09-20-co-managed-it-completion/PRD.md), and
[native ticket-screen plan](../2026-10-15-co-managed-native-ticket-screen/PRD.md).
The acceptance checklist amendments in `co-managed-audit-t01-t07.md`,
`co-managed-audit-t08-t15.md`, `co-managed-audit-t16-t22.md`,
`co-managed-delegated-administration.md`, and
`co-managed-task-thread-disclosure.md` remain in force.

## Binding route and data-source decision

Apply the October 14 amendment in the ticket-list PRD: native All Tickets remains
`/msp/tickets`; shared Customer Tickets lives at `/msp/tickets/customer`. The
native route keeps its native-only data source, URL state, filters, defaults,
and SSR behavior. Customer Tickets reads shared/customer-owned records through
the qualified shared-ticket source and its authorization checks. Do not combine
native and shared rows or mount two sources on one route. Preserve qualified
identity, tenant and audience scoping, fail-closed authorization, and the
approved native compatibility behavior (D1-D2, A1-A7).

## Acceptance sequence and evidence

Each row is a product-runtime check at the candidate revision. Record identity,
tenant, route, initial state, action, result after reload, and evidence link.
Passing unit tests, source census rows, health checks, and dispatch/fanout alone
do not count as product acceptance.

| Area | Map to approved requirements | Required deployed-product evidence |
| --- | --- | --- |
| Multipart action gate | Foundation plan; auth repair and regression suites | Ordinary mutations denied before acceptance; acceptance permitted; admitted workspace then permits intended writes; ordinary PSA and SSR remain functional. |
| Microsoft OIDC | Customer integration T018/T019; completion C3 | Real application callback and customer sign-in; negative issuer, audience, expiry, nonce, PKCE, and replay cases. Label simulator evidence as simulator; live Microsoft evidence requires the public authority. |
| Product boundary | Foundation capability matrix; completion release-boundary requirements | Co-managed `/msp/account` and child routes denied; authorized PSA account behavior still works. |
| Customer provider and inbound mail | Customer integration PRD and completion C3 | Customer-owned provider configure/persist, inbound processing, requester reply, duplicate delivery/revocation, and cross-tenant denial. |
| Shared tickets and tasks | Foundation collaboration/privacy/time/SLA contracts; ticket-list PRD and October 14 amendment; native ticket-screen PRD | Audience separation, qualified attribution, escalation/handback, assignment, independent SLA, operational versus commercial time, revocation, and retained history. |
| Native regressions | Ticket-list A4/A7 and native ticket-screen PRD | Native ticket, comment, attachment, project, time, and workflow behavior remains functional, including native list state and customer client tab. |
| Full acceptance census | Foundation T01-T22; client integration and ticket-list features/tests; completion plan; delegated administration and task disclosure amendments | Reconcile every requirement row against runtime or focused evidence; retain unverified/blocked status where evidence is unavailable. |
| Review guides | 14 rows in review coverage inventory | Main, collection, and twelve section guides each have an independent current-revision WebM, chapter VTT, recording JSON, embedded playback, and browser-verified chapter seeking. Track each guide separately. |

## Current execution boundary

The takeover continued on the already running 704f candidate with isolated QA
and customer sessions. It exercised fresh provisioning and delivered invitation
claim, ordinary multipart rejection before acceptance (zero forbidden boards),
acceptance and normal setup writes; customer account root/child and accounting
denials with an authorized PSA control; reversible seat allocation, board scope
and delegated edits; ticket handback/re-escalation and separate SLA displays;
task edits and project revocation/restoration; distinct-recipient live shared
notes with both organization-private lanes excluded from the other actor; and
native MSP timesheet Grid/List rows. Reversible settings were restored.

A disposable native ticket triggered a succeeded Temporal workflow with two
persisted comments. The initial recording timed out on an obsolete full comment
label; a continuation verified both comments after reload. The workflow was
restored to Paused. A task-note recording did not confirm publication; that
attempt remains unverified rather than being counted as a product pass.

The current encrypted customer export was inspected and restored by the actual
operator CLI into a new suspended tenant with one inactive administrator, zero
live relationships, two tickets, one project, one task and 26 comments. Retry
returned the original receipt; wrong passphrase and tampering were rejected.
Paid activation and destination native login remain unverified. Read checks of
an earlier terminated disposable customer preserve their earlier closure
provenance and do not count as a new departure.

See [takeover evidence](../../evidence/co-managed-deploy/704f-takeover/README.md).
Fourteen separate recordings now show bounded interactions, outcomes or explicit
provider/recovery limitations, with WebM/VTT/JSON and browser-verified playback
and seeking. Every full guide scenario remains partial. Historical route-only
704f clips and earlier cd28/e88 media remain preserved.

The source cookie issuer/reader naming and JWT salt repairs cover Edge/Express
and public-origin proxy naming. A further source repair prevents an inactive
restored internal account from shadowing an active account with the same email;
multiple matching active tenants still fail closed. This runtime login failure
was independently reproduced; an existing legitimate customer session enabled
multi-actor acceptance without modifying accounts or credentials. Auth tests,
builds and typechecks pass, and the existing dev app, without restart, retains QA through reloads with old
production cookies present. Fresh normal Alice login also selects her original
customer tenant despite inactive restored duplicates. These source fixes are
**undeployed to production**.

The current no-start instruction prevents canonical promotion or starting a
repaired candidate. Do not claim supported QA Open Review on 704f from manual
candidate login. Full Microsoft/provider/inbound/directory, privacy/file
removal/disclosure, financial approval/invoicing and paid recovery matrices
remain unverified or externally dependent. Available checks above are not
blanket external blockers. The 260-ID source census stays fail-closed; no
complete requirement is promoted by partial guide recordings. PR #3363 remains
draft and CONFLICTING.

## Completion criteria

Complete only after commandless `workflow-ensure-service --name=dev-server`
starts this checkout at `http://feature-co-managed-it.localhost:3374`, the
registered production review app and compiled workers have verified source/build
provenance, Open Review authenticates directly as `qa@emeraldcity.oz`, runtime
acceptance evidence is reconciled, and all fourteen distinct recordings have
working playback and seekable chapters. Keep unsupported requirements
unverified. Publish scoped repair commits to the existing PR branch only.
