# Co-managed IT completion and correction

Status: **Draft implementation; human-review readiness blocked.** Updated 2026-09-20.

## Authority and product outcome

This is the current completion authority for PR #3363. It supplements the [foundation plan](../2026-09-06-co-managed-it-plan.md), [client integration PRD](../2026-09-11-co-managed-client-integration/PRD.md), and [ticket-list PRD](../2026-09-11-co-managed-ticket-list-unification/PRD.md). Those documents retain their detailed product contracts. Their dated implementation claims and checked boxes do not establish current acceptance. Every requirement in all three plans must be reconciled through the checklist here; a remaining requirement cannot disappear between assignments.

A Pro MSP sponsors separate customer IT workspaces with a purchased technician pool. Both organizations collaborate on one customer-owned ticket/project history, with explicit sharing, immediate escalation and handback, independent SLAs, organization-owned time, and three content audiences. The customer can operate without commercial PSA configuration and leave with its own records. The MSP retains only its own commercial/private records and permitted participation history.

This correction covers the complete agreed product, including the two UI follow-ons. It adds no new commercial offering, connector family, cross-installation federation, or general workflow-board redesign. It specifies the evidence and readiness checks needed to finish the existing work.

## Current baseline and evidence

Repository and GitHub were read on 2026-09-20. No product tests or browser journeys were rerun for this planning revision.

| Finding | Evidence and consequence |
| --- | --- |
| Candidate | Local HEAD and PR head are `618019c3e3563f729684163c1abd8f5ad312e5dd`. Worktree was clean before these documentation edits. |
| PR | [#3363](https://github.com/Nine-Minds/alga-psa/pull/3363) is OPEN, not a GitHub draft, and currently MERGEABLE. The commissioning snapshot's CONFLICTING value is stale. GitHub draft status is separate from implementation readiness. Recheck mergeability against the current base before review. |
| Mandatory CI | [Run 35492001110](https://github.com/Nine-Minds/alga-psa/actions/runs/35492001110) completed with failure at this exact SHA. Integration shard 1, Integration execution complete, and Production regression readiness failed. Other green jobs do not override them. |
| Requester pause | [Job 106030872598](https://github.com/Nine-Minds/alga-psa/actions/runs/35492001110/job/106030872598) reports `retry` where `defer` is required, then an error-serialization stack overflow. Local success and a matching signature have not explained this. Serialization may be a reporting failure masking the original exception; it is not yet the established cause of the disposition error. |
| Provider UX | The existing review guide reproduces customer Email → Inbound Email → Open Providers reaching a product-excluded page. This blocks an included customer capability. |
| Provider execution | The guide records hardcoded Microsoft public issuers, missing emulator user OIDC discovery, and incomplete customer identity/directory and inbound-mail journeys. HTTP health and SMTP invitation capture do not exercise them. |
| Narrow repairs | Invitation retain/send/acknowledge has exact-HEAD browser/SMTP evidence; portal-author cases passed in the failed CI job; Log time has prior save/reload evidence and current form-open evidence. Preserve these fixes, but revalidate affected behavior at the final candidate. |
| Other incomplete behavior | The review guide records missing shared rows in the classic MSP timesheet grid, unproved full restore/paid upgrade, and incomplete requester portal/browser and revocation journeys. Repeated app service healing also needs diagnosis before a sustained review. |
| Checklist debt | Client integration: 33/33 feature flags true, but T018/T019/T021 false. Ticket list: 18/39 feature flags true and 2/20 test flags true. Unchecked items require reconciliation; they are not all proven code defects. |
| Evidence quality | Prior reset proof lacks raw stdout and one report count disagrees with its screenshot. One assignment fixture was SQL-created after the team picker failed under automation. These establish narrower claims than a full UI pass. |

The external review guide is `/home/robert/card-reviews/co-managed-it-3363/index.html`, with its 2026-09-20 evidence subdirectories. Preserve original artifacts and their dates. Copy sanitized evidence needed for completion into a durable review artifact location; temporary paths alone are insufficient.

## Product requirements retained

| Area | Required behavior |
| --- | --- |
| Topology and provisioning | Same installation; create new customer workspaces linked to an authorized MSP client; one sponsor per customer; no nested sponsorship or existing-tenant attachment. Administrator invitation and customer acceptance complete through normal screens. |
| Licensing | Separate co-managed pool; agreed USD 11.49 monthly technician seat; requester contacts unmetered; MSP visits do not consume customer seats. Allocation, invitations, acceptance, import/reactivation and retries cannot oversubscribe. Hosted and self-hosted modes retain their signed/verified entitlement rules. |
| Capability boundary | Included operational tickets, projects, assets, KB/documents/credentials, scheduling, time, SLAs/workflows and customer email/identity/directory. Commercial billing/sales/accounting and unsupported integration categories remain denied to customer workspaces. Sponsorship never implies delegated administration. |
| Collaboration | One qualified canonical record; Working queue and Customer oversight in the existing ticket list; full client integration; no session-tenant switch for routine collaboration. Native PSA/AlgaDesk behavior and native list state remain usable. |
| Privacy | Requester replies, shared IT notes and organization-private notes retain distinct audience admission across UI, API, search, export, files, notifications, email, realtime and background jobs. Portal provenance joins must preserve requester filtering. |
| Time and SLA | Customer operational effort works without contracts; MSP commercial effort appears in the ordinary timesheet workflow and invoices only MSP effort. Independent customer/MSP clocks observe escalation, handback, qualifying responses, renewal and both SLA backends. |
| Continuity | Revocation closes subsequent live access. Lapse blocks growth immediately and operational writes after the original 30-day deadline. Renewal resumes retained work exactly once. Departure/export/restore/upgrade preserve ownership and never revive old trust or invoice customer operational time. |
| Release boundary | `release-v1-6-feature` is UI-only, including direct browser routes and portals. Backend permissions/lifecycle checks work independently of the flag. No backend flag is introduced to hide a defect. |

Personas are MSP account administrator, scoped relationship manager, technician, customer administrator/technician, requester, and an unrelated tenant/user used to verify denial. Acceptance includes different role scopes, multiple sponsored customers, and duplicate local record identities.

## Correction workstreams

### C1 — Reconcile requirements and preserve evidence

Create a row-level inventory of foundation T01–T22 and every feature/test ID in both follow-on plans. Record implementation source, current regression, browser/provider evidence, owner role, status, and dependency. Distinguish `missing-code`, `implemented-unverified`, `failed`, `blocked-external`, and `verified`. Existing `implemented: true` means code/test exists, not that it passed on the candidate. A skipped test, screenshot-only claim, or successful assignment cannot set `verified`.

The 21 unchecked ticket-list feature IDs are F003, F006, F010, F012, F015, F017, F020–F022, F024–F032, F036, F038 and F039. Reconcile all 18 unchecked tests T002–T019. Complete missing behavior and tests; if code already satisfies a row, attach evidence before updating it. Do not delete or silently waive requirements such as native state return, full export, immutable uncertain handback recovery, denied-read redaction or translated/keyboard behavior.

Client integration T018/T019 contain historical real-provider language. Split their evidence into card-scoped simulator/signed-test-license journeys and the external production prerequisites described below. Preserve the original requirement and record the scope decision; do not mark a real-provider test passed using a simulator.

### C2 — Diagnose and repair requester lifecycle deferral

Entry points: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts` (the separately compiled admission-adapter case), `shared/services/email/inboundEmailCoreProcessor.ts`, `shared/services/email/qualifiedReplyAdmission.ts`, `packages/co-managed/src/inboundRequesterReply.ts`, and `packages/licensing/src/lib/co-managed-lifecycle.ts`.

1. Preserve the failed run's raw log, execution/collection artifacts, command, seed, shard membership/order, Node/package versions, source and built-package hashes, migration inventory, and sanitized DB environment. Compare source/runtime module resolution and worker entry points. A matching signature is only one dimension of parity.
2. Use the documented CE+EE migration overlay and actual CI setup. Preserve the runtime database selection in the bootstrap harness. The reverted startup-time clone-source pin and `ALGA_SCHEMA_SOURCE_DB` must not return. A local source database that CI does not create is not a valid reproduction.
3. Capture bounded primitive diagnostics at admission, transaction rollback, lifecycle classification, and retry/defer return boundaries. Record original error name/code/message and safe cause summaries before assertion serialization. Avoid dumping transactions, query clients, credentials, or recursive objects. Establish whether the intended lifecycle throw is reached or an earlier error causes retry.
4. Reproduce with the original seed `20260610` in the real shard, then isolate the smallest responsible predecessor/environment difference. Inspect mock, process.env, module-cache and transaction ownership contamination only as hypotheses until evidence identifies the cause. If local reproduction remains unavailable, run one instrumented CI candidate and use the first-error artifact to choose the next change. Repeating unchanged local runs is not closure.
5. Repair the established production or harness cause at its owner. Preserve typed lifecycle classification across separately compiled modules. Unknown infrastructure/database failures still retry; authorization/token failures quarantine according to the existing policy. Never turn all errors into `defer`, skip the test, relax the expected disposition, or bypass requester admission.
6. Prove a pause after tentative writes rolls back comments, outbox and effects, preserves the source, refunds the new claim (`attempt_count=0`, inbox `received`), and reports `defer/co_managed_read_only`. Renewal must consume the same retained source once. Cover both production worker compositions and native/non-requester regressions.

Exit requires a causal explanation, a regression that detects its removal (or recorded mutation evidence), focused and original-shard passes, and green mandatory exact-candidate CI. Do not describe the reporter stack overflow as fixed until error reporting is also finite and actionable.

### C3 — Complete customer email, identity and directory setup

Entry points: `server/src/lib/productSurfaceRegistry.ts`, `packages/integrations/src/components/email/EmailProviderConfiguration.tsx`, `MicrosoftProviderForm.tsx`, `GmailProviderForm.tsx`, the settings provider composition/actions, and `packages/auth/src/lib/nextAuthOptions.ts`.

Provide a customer-permitted, narrowly scoped provider configuration route/composition reachable from Email and identity/directory setup. Reuse the existing provider forms and persistence. Correct Microsoft and Gmail links, breadcrumbs, direct URLs and return navigation. Explicitly allow only the customer-owned supported provider capabilities. A broad exemption for `/msp/settings/integrations` would expose excluded integration categories and is unacceptable. Product boundary, RBAC, tenant ownership, secret redaction and server-action guards must all agree.

Use the existing supported application authentication path to complete Microsoft callback/sign-in and customer identity/directory setup. Establish an approved test-authority seam or complete the existing emulator's OIDC discovery/JWKS/token/user-info surface. Public Microsoft authority remains the production default. Any test override is server-controlled and validates issuer, signature, state, nonce, audience and tenant binding; no URL/request-selected issuer or TLS/token-validation bypass. Verify native PSA/AlgaDesk authentication alongside the customer flow.

Drive the real app and workers through configure → OAuth callback → persisted customer provider → inbound subscription/delivery → one customer-owned ticket → requester reply → audience-correct response. Include duplicate deliveries, expired/revoked credentials, cross-tenant callback/provider denial, and pause/renewal without data loss. Exercise the supported directory provisioning/sync flow, seat admission and safe revocation. Calendar/meeting sync and SMTP invitation delivery are distinct contracts and need their own claims. If simulator APIs are used to deliver vendor events, disclose those steps; do not use them to replace the app's setup/callback/persistence flow.

### C4 — Finish the existing client and ticket-list experience

Follow the two existing PRDs without redesigning their accepted interaction contracts. Close unchecked groups in dependency order:

1. Coordinator/native-state snapshots, qualified initial entry and detail-return/history navigation.
2. Shared presentational list composition, native metadata/defaults, qualified identity/columns and client/drawer entries.
3. Authorized filters/search/sort/count/pagination, optional columns and full filtered CSV. Reject stale protected results after scope or authorization changes.
4. Routed MSP ticket creation with correct ownership and an explicit out-of-scope success link.
5. Separate qualified selection, one handback composer, immutable resource/revision/note/operation identity and same-actor reload recovery after an uncertain result. Reconcile per-item success/stale/denied outcomes without duplicate history.
6. Flag transitions, native fallback, translated light/dark/narrow layouts, keyboard/focus and removal of duplicate list ownership only after every entry uses the common composition.

Reproduce the team/agent picker failure in a hydrated app with keyboard and pointer. If it is an application issue, fix it and exercise assignment through the actual picker. If it is automation-only, document the cause and record a real user interaction; SQL insertion proves FK reset behavior, not picker usability.

### C5 — Make shared time visible and preserve billing

Use the existing native-time dispatch boundary (`packages/co-managed/src/nativeTimeDispatch.ts`) and the ordinary scheduling/time readers and grid. Reproduce a new empty MSP sheet → shared-task Log time → save → reload → ordinary timesheet grid/detail → totals/export. Qualified shared entries must be visible with correct work identity and editable under existing authority; totals cannot include hidden rows. Customer operational time must remain service-free and noncommercial, with optional approval policy honored.

Retain the repaired empty-sheet dispatch and on-behalf guards. Exercise native MSP time, customer time, shared MSP time, denied actors, approval and actual invoice generation. The PR body reports pre-existing native timesheet workflow API writes to absent columns: prove whether an agreed co-managed journey reaches those methods. If it does, repair the reachable path and test it; otherwise record concrete reachability evidence and a separate follow-up. A pre-existing label cannot waive a required journey.

### C6 — Complete lifecycle, continuity and deployment-mode evidence

Run the assembled revocation/open-page/search/file/queued-delivery race and composed lapse/renewal with running workers. Cover independent SLA timing and delayed/retried consumer effects. Preserve receipt identity and current authorization after restart/replay.

Complete customer export and source-unavailable restore through native screens in an isolated target, including files, attribution, configuration and encrypted business credentials. Compare permitted record/file manifests; no MSP-private contents, sessions/OAuth secrets, old grants or sponsorship carry over. Verify tamper/wrong-key rejection and recoverable interrupted restore.

Complete hosted upgrade through the approved provider simulator and self-host upgrade with a signed test license through normal controls. Verify confirmed entitlement, one activation/closure/allocation release, preserved customer data, independent seat admission, no duplicated purchase on retry, and usable retained MSP billing/archive after actual customer deletion. Live vendor acceptance remains separate.

Reconcile fresh-install, populated upgrade and relevant migration rollback/reapply evidence on PostgreSQL and Citus. For the 17 migrations that skip trigger installation on distributed tables, enumerate every invariant and production write path, then test application enforcement on Citus. Plain PostgreSQL trigger success or distributed DDL success alone does not prove those guards. Fix any uncovered admission/immutability gap; do not silently change table distribution or relax the invariant. Test storage/file and running Temporal/PG Boss paths used by the accepted flows.

### C7 — Establish a reproducible review environment and regression result

Diagnose the repeated app healing from process exits/logs, memory/resource signals and authenticated readiness, without assuming an OOM or hydration cause. Tie app, workers, package dist, schema, configuration and simulator versions to the candidate. Build from the same source, restart through registered services, and verify actual worker consumption. Run an uninterrupted complete acceptance walkthrough followed by a 30-minute observation with authenticated reads and a queued job; any automatic healing/restart invalidates this stability proof and requires diagnosis.

Use disposable fixtures for destructive scenarios. Capture reset/apply/verify stdout, actual before/after counts, and exit codes. The historical 19/19 → reset → 5/19 → apply → 19/19 cycle must be reproduced against its documented fixture version; added records may require a new documented expectation. Never delete unrelated financial history, revive terminated trust, or discard claimed onboarding evidence just to obtain the old counts. Refresh review time periods when needed. Keep secrets outside served evidence.

Run affected CE/EE types/builds, relevant native PSA/AlgaDesk regressions and mandatory repository CI at the candidate. Preserve existing shard discovery, failure thresholds, migration source behavior and aggregate readiness gates. A lane change requires an independently justified correctness fix and proof of unchanged required collection/execution; moving, filtering, skipping or neutralizing failures is not remediation. Recheck current base/mergeability and resolve integration conflicts only under a separately authorized implementation order; rerun affected checks after resolution.

### C8 — Enforce completion before requesting human review

Implement a small card-specific readiness manifest and read-only verifier in the repository during the correction phase. Reuse the existing evidence conventions and `scripts/lib/production-readiness.mjs` outputs. Do not edit workflow-board templates or state as part of this plan. Proposed artifacts are `docs/evidence/co-managed-completion/<candidate-sha>/manifest.json` and `scripts/verify-co-managed-completion.mjs`.

The manifest must record:

- candidate SHA, base SHA, PR number/head, collection timestamp, app/worker build provenance, migration/config/simulator fingerprints without secrets;
- every required feature/test ID from all three existing plans and this correction, its implementation/evidence status, owner role and acceptance references;
- evidence items with type (`automated`, `browser`, `database`, `simulator`, `external`), execution SHA, command/journey, actual result, raw-log/artifact reference and limitations;
- mandatory CI run/job identity and completed conclusions, review environment stability, unresolved defects, and separately scoped production prerequisites;
- `implementationReady`, `humanReviewReady` and `productionReady` as separate calculated results with explicit blocking reasons.

`implementationReady` requires all in-card required implementation and acceptance rows verified, no open functional/security/data-integrity defects, and the required local/build/browser/simulator evidence. `humanReviewReady` additionally requires candidate == PR head == running app/worker revision, a clean delivered worktree, current MERGEABLE state, every mandatory CI check completed successfully for the candidate, valid evidence artifacts and stable review setup. The readiness-verifier implementation itself must have independent tests; avoid a self-referential checklist dependency by validating its behavior first, then running it as the final gate. Final verifier invocation and packet-delivery receipts are outputs of this gate and are attached afterward; they must not be required as inputs to their own calculation. Independent tests of the verifier remain mandatory inputs. Merging and human approval are later board actions, never prerequisites that an agent fakes to satisfy these predicates.

Fail closed for missing/duplicate IDs, removed required IDs, unknown statuses, false implementation flags on required in-card work, stale SHAs, unavailable artifacts, skipped/cancelled/pending/failed mandatory checks, conflict/unknown mergeability, or unresolved required tests. Fixture assertions, simulator health, a count of green checks, old smoke verdicts, old `verified:*` records, successful prepare-step exits and prose such as “round complete” cannot satisfy these fields. Historical evidence stays historical. A changed candidate invalidates readiness until affected evidence is rerun; reuse of unaffected evidence requires an explicit dependency analysis and fresh runtime/readiness checks, never a silent SHA relabel.

The OOD supplies the verifier output and blocking list to the XO. The XO owns binding that result to Draft Implementation → review eligibility and correcting stale card state. This assignment does not alter board mechanics. While the gate fails, subsequent assignments may succeed at their bounded task, but their report must explicitly preserve `humanReviewReady=false` and identify the next unresolved work. Do not repeatedly run Prepare Human Review against an unchanged known defect. If no new causal evidence is obtainable, send a bounded diagnostic escalation; do not consume recovery attempts with unchanged reruns or advance approval.

Final packet preparation must reconcile PR description, review guide, plan, smoke report and card facts around one candidate. Remove contradictory current claims such as “No release-blocking defect” while keeping original reports as history. Human Review Approval, merge, deployment, parking and template changes remain XO/captain actions.

## Acceptance coverage

All rows below are **pending candidate verification** at this planning revision. Historical proofs are reusable inputs to test selection, not current passes. `CT` IDs refer to tests.json; original `T` IDs refer to the foundation plan.

| Original contract | Correction acceptance |
| --- | --- |
| T01 Product matrix | CT006, CT008, CT009, CT013, CT025: operational paths usable; commercial/unknown surfaces and nested sponsorship denied; native products preserved. |
| T02 Purchase separation | CT018: pool purchase, verified webhook, duplicate/out-of-order/replay, ordinary seats unaffected. External real-price proof tracked separately. |
| T03 Self-host claims | CT019: signed test capacity, wrong audience/expired/missing claims, offline validity and tenant independence. |
| T04 Allocation concurrency | CT007, CT018, CT019: last-seat admission, invitation/acceptance/import/reactivation and failed provisioning retry. |
| T05 Provisioning | CT007: fresh client → reservation → single completed invitation → setup → customer acceptance; topology and cancellation guards. |
| T06 Isolation | CT003, CT006, CT009, CT011, CT015, CT025: qualified cross-tenant/role matrix and revoked/private evidence. |
| T07 Delegation | CT006, CT015: customer-approved scopes, revoked delegation, no privilege/secret escalation. |
| T08 Shared lifecycle | CT011, CT012, CT017: one ticket, escalation/handback/retry/close/reopen, one retained receipt. |
| T09 Audiences | CT003, CT009, CT015, CT020: requester/shared/private through portal, mail, attachments and export. |
| T10 Canonical routing | CT011, CT012: duplicate IDs/numbers, owner-valid board/status/priority and correct detail return. |
| T11 Consolidated views | CT010–CT013: native/client/legacy entry, authorized count/search/sort/export, stale responses and state recovery. |
| T12 Projects | CT014, CT015: shared task assignments/collaboration, unshared denial and revocation. |
| T13 Time/billing | CT014: operational vs commercial entries, ordinary grid, approval, invoice and duplicate prevention. |
| T14 Effort totals | CT014: edit/delete/move, privacy masks, organization-separated totals consistent with visible entries. |
| T15 SLA | CT017: independent calendars/priorities/clocks, qualifying responses and both backends. |
| T16 Revocation race | CT015: live open page/read/download/mutation and queued consumers lose authority at the defined boundary. |
| T17 Lapse/recovery | CT002–CT005, CT016: pause rollback/refund, 30-day deadline, growth guard and once-only resume. |
| T18 Archive/export/restore | CT020, CT021: source-unavailable restored customer data/files, bounded MSP archive and negative guards. |
| T19 Independent upgrade | CT018, CT019, CT021: hosted/self-host flow, one release/activation, independent licensing and recovery. |
| T20 Deletion/migration | CT021, CT022: customer deletion with retained invoice/archive; PostgreSQL/Citus runtime invariants. |
| T21 UI boundary | CT013, CT025: real flag states, direct/legacy/client URLs and portaled UI; native fallback. |
| T22 Backend independence | CT003, CT006, CT025: authorized and denied API/actions/worker behavior with UI flag off. |

Client-integration F001–F033/T001–T021 and ticket-list F001–F039/T001–T020 must also be individually mapped in the completion manifest; this foundation matrix cannot stand in for them. CT001 verifies that mapping is exhaustive. CT026 validates the readiness gate's rejection behavior and final output.

## Sequence, ownership and exit criteria

| Phase | Owner role | Dependencies | Required exit |
| --- | --- | --- | --- |
| P0 Reconciliation | Implementing OOD | This approved correction order | Full ID inventory, evidence ledger and scope split; C1 complete. |
| P1 Defect diagnosis | Email/runtime engineer acting as OOD | P0 baseline | C2 causal fix with focused/shard proof; C3 provider route and authority path functional. Work can be sequenced independently; no delegation is required. |
| P2 Product closure | Implementing OOD | P0, relevant P1 fixes | C3–C6 application flows complete, all follow-on requirements reconciled, no waived required behavior. |
| P3 Candidate verification | Verification OOD | P1/P2 candidate delivered | C7 full regression, migrations/runtime, actual browser/simulator, restored data and stability evidence. Fixes return to the affected workstream and invalidate dependent evidence. |
| P4 Review eligibility | Preparing OOD supplies evidence; XO controls eligibility | P3 and implemented C8 verifier | Verifier passes for PR/app/worker candidate; consistent review packet. Only XO/captain may move the card or request approval. |
| P5 Production readiness | Release operator/captain | Human review/merge order and external prerequisites | Real-provider configuration/acceptance and deployment-specific migration/recovery checks; separate recorded production verdict. |

A documentation update completes P0 planning only. It does not close P0 reconciliation, implement C2–C8, or authorize a forward workflow transition. Reaching the end of an assignment or exhausting a fix budget changes neither the acceptance criteria nor the readiness verdict.

## External prerequisites and rollout

Preserve the scope decision in [provider acceptance scope](../../evidence/co-managed-acceptance-scope.md): live Stripe, live licensing and live Graph acceptance are outside this card. Simulators must exercise the real app, persistence, signing/callback boundaries and consumers inside the card. Emulator control completion is not real Stripe.js payment UX, a hand-inserted capacity row is not signed-license verification, and Graph calendar coverage is not customer OIDC/directory/inbound coverage.

Track these production prerequisites with an owner, artifact and unresolved status in the manifest: real recurring USD 11.49 (1149 cents) monthly licensed price/configuration and a provider test-mode checkout/webhook/invoice; external sponsor-bound and independent-customer license issuance/renewal; real Microsoft application/callback/permission and directory/inbound acceptance; deployed storage and candidate migrations including distributed invariants. Use provider test credentials without collecting real charges for validation. No current real-provider success is claimed.

`productionReady` remains false until those dependencies are accepted by the release owner. They may be transferred to explicitly linked release work under the existing scope decision; that transfer cannot label them passed or waive the in-card simulator journeys. Before enabling purchase/provisioning, validate deployment price/license configuration. The UI-only release flag does not protect backend access, so rollout and recovery must preserve authorization independently.

For a failed rollout, stop new feature exposure through the established UI flag and use an approved application rollback compatible with the schema. Do not reverse destructive/data-preserving migrations blindly, erase billing history or re-enable terminated trust. Preserve recoverable inboxes, provisioning receipts and exports; use the tested migration/recovery procedure.

## Risks and unresolved decisions

The requester failure's first cause, the picker failure's origin, the reason for repeated app healing, and reachability of the native timesheet API defect are diagnostic tasks, not assumed conclusions. The provider route must remain capability-scoped; the test authority must not weaken production identity verification. Distributed trigger omissions require runtime proof. Exact-candidate full-suite work is expensive, so use causal focused checks first and run the broad gate on a consolidated candidate.

Any proposal to remove an agreed requirement or change the live-provider scope needs a recorded captain decision with affected IDs. Implementation choices within these contracts require no extra permission. No such scope reduction is made by this revision.
