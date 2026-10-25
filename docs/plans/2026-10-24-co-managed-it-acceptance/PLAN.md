# Co-Managed IT acceptance plan

Status: **Partial production acceptance; review remains incomplete.**
Recorded application: `e88d530b4c0fadfa40d3c0a77cf7102745187219`, production
`build-1792894631786` (PR #3363). Later source repairs require their own runtime
verification; retain this actual build provenance.

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

Normal board admission now provides the dev-server, production review-app,
compiled workers and guide server. Direct Open Review entered as QA. The
October 25 execution verified a fresh invitation/acceptance journey, multipart
pending rejection, customer account-root/child denial, two-organization note
separation, reversible scope/delegated changes, responsibility/SLA transitions,
customer project/task sharing and revocation, shared/private task files,
separate commercial and operational time, encrypted export and a disposable
departure. See the [bounded runtime results](../../evidence/co-managed-completion/e88d530b4c/lead-acceptance-20261025/result.json).

All fourteen guides have genuine separate recordings with browser-verified
playback and chapter seeking. Their scenarios remain **partial**, and their
metadata retains the recorded build revision. Playable media does not complete
acceptance. Distinct-recipient live delivery, full task/file/disclosure coverage,
customer providers/inbound/directory, real Microsoft sign-in, complete time
approval/billing, isolated restore and paid activation remain unverified or
blocked. The demonstrated legacy file-download tenant-context repair and
after-commit live-comment refresh repair await their new production build.
The live repair has a successful development two-actor check; that does not
replace production verification. GitHub reports the branch CONFLICTING/DIRTY.

Keep the completion gate false, retain unverified census statuses, and continue
through normal board service admission. No unrelated-card stop, credential
replacement, fabricated recording or readiness-rule relaxation is acceptable.

## Completion criteria

Complete only after commandless `workflow-ensure-service --name=dev-server`
starts this checkout at `http://feature-co-managed-it.localhost:3374`, the
registered production review app and compiled workers have verified source/build
provenance, Open Review authenticates directly as `qa@emeraldcity.oz`, runtime
acceptance evidence is reconciled, and all fourteen distinct recordings have
working playback and seekable chapters. Keep unsupported requirements
unverified. Publish scoped repair commits to the existing PR branch only.
