# Co-Managed IT acceptance plan

Status: **Partial production acceptance; review remains incomplete.**
Source revision under review: `c04a67fff5b553d2c2a1f55a14194f829343adae`.
Guide publication is the evidence commit containing this plan; the current
recordings identify runtime source c04 separately from publication. Historical
publication `2f02f03c4b` retains its original 704f recordings.
The isolated repaired production distribution is `.next-review-c04a67-production`,
`BUILD_ID build-1792926045353`, with revision stamp
`c04a67fff5b553d2c2a1f55a14194f829343adae+da39a3ee5e6b`. It is served by
canonical port 23374 and candidate port 23378. Runtime receipts distinguish this
source SHA and build ID from publication commits and separately record worker
process provenance. Alice's original-tenant selection/session persistence and
QA navigation were verified on fresh production sessions; supported Open Review
was verified on the promoted canonical service. These bounded checks do not
complete the remaining acceptance matrices or guide scenarios. Historical
704f, cd28, and e88 evidence remains attached to its original runtime and status.

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

The 2026-10-25 production repair is recorded in
[the c04 deployment receipt](../../evidence/co-managed-deploy/c04a67fff5/runtime-provenance.json),
[the runtime acceptance receipt](../../evidence/co-managed-deploy/c04a67fff5/runtime-acceptance.json),
and [worker provenance](../../evidence/co-managed-deploy/c04a67fff5/worker-provenance.json).
The isolated production build completed server typecheck and Next production
build, its source fingerprint/stamp and `BUILD_ID` were checked, and HTTP
readiness was checked on candidate and canonical ports. Fresh Alice selected
original customer tenant `1f98df77-cd15-44c2-8f4d-42ff52d01e84`; the populated
session survived native All Tickets, Customer Tickets and hard reloads. Fresh
QA navigated the same route boundary and a qualified shared-ticket detail with
session persistence. Supported QA Open Review then entered directly on the
promoted canonical runtime. The private sanitized browser receipt is referenced
by the runtime acceptance artifact; it contains no credentials or cookie values.

The server-configured canonical `coManagedBootstrap.integration.test.ts` also
passed 1,461 tests on this source revision (see [validation receipt](../../evidence/co-managed-deploy/c04a67fff5/validation.json)). This integration suite supplements source/runtime checks but does not substitute for deployed product acceptance in the remaining rows.

The subsequent lead takeover executed bounded checks across sixteen areas.
See [the runtime matrix](../../evidence/co-managed-deploy/c04a67fff5/runtime-matrix.json)
for actual actions, results, corrected instrumentation and unfinished cases. New
provisioning cancellation, original invitation claim, multipart denial before
acceptance, activation, account restrictions, scoped editing, ticket handoffs,
private conversations, task-file disclosure/removal, operational effort, shared
timesheet visibility, native file authority, matched Temporal business effects,
disposable departure and isolated restore now have current-production evidence.

Fourteen separate main/collection/section recordings now exist on c04, each with
WebM, VTT, JSON and browser-verified playback/seeking/HTTP Range. All fourteen
**full scenarios remain partial**, with explicit per-guide limitations. See
[coverage](../../evidence/co-managed-deploy/c04a67fff5/walkthroughs/video-coverage.json).
Do not confuse media completeness with acceptance. Historical 704f, cd28 and e88
media were preserved and were not relabeled or used as current-build recordings.

The remaining provider/OIDC/inbound/directory, requester/team/privacy, concurrent
retry/lapse, SLA configuration/notification, financial approval/invoicing,
participated departure/archive and paid activation/native recovery checks remain
unverified or explicitly externally blocked. The 260-ID census remains
fail-closed; bounded checks do not establish every obligation of a requirement.

The historical 704f takeover evidence remains at
[takeover evidence](../../evidence/co-managed-deploy/704f-takeover/README.md).
The October 14 route amendment remains binding: `/msp/tickets` is native-only;
`/msp/tickets/customer` is shared-only. Release flags remain UI gates and never
replace backend authorization.

## Completion criteria

Complete only after the remaining runtime matrices are executed and reconciled, the registered production review app and compiled workers retain verified source/build provenance, Open Review continues to authenticate directly as `qa@emeraldcity.oz`, and all fourteen distinct current-build recordings have complete scenarios, working playback, HTTP Range delivery and browser-verified seekable chapters. The present c04 deployment/login/Open Review evidence satisfies only those named checks. Keep unsupported requirements
unverified. Publish scoped repair commits to the existing PR branch only.
