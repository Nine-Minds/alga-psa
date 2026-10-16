# Co-managed IT completion scratchpad

## 2026-09-20 — Planning baseline

Human order: update the PRD and plan to specify complete mitigation/correction and prevent premature exit from draft implementation. This revision is documentation and checklist work only. No product repair, test execution, board transition, review approval, merge or deployment is claimed.

Read the foundation plan, both follow-on PRDs/checklists/scratchpads, T01–T22 audits, provider acceptance-scope disclosure, latest PR body, current review guide, relevant source entry points and the failed CI job. The existing foundation completion section contained progress history without an enforceable completion predicate. The client follow-on had all features marked implemented while required evidence remained open. The ticket follow-on retained many false entries. The PR body called its narrow smoke free of release blockers while also disclosing the still-failing requester case and provider dead end.

The new PRD is the current completion authority. Original requirements and historical evidence are retained, and all historical checklist rows now carry a separate pending acceptance status. This does not erase implementation credit or claim every unchecked row is a code defect. C1 must reconcile each row to actual code and candidate evidence.

## Observed remote state

- Local/PR head: `618019c3e3563f729684163c1abd8f5ad312e5dd` before planning edits; clean worktree.
- PR #3363 OPEN, GitHub isDraft false, MERGEABLE at this read. This corrects the older commissioning CONFLICTING snapshot only; mergeability must be rechecked later.
- Run `35492001110`: completed/failure, exact same SHA. Failed jobs: `106030872598` Integration shard 1; `106033021926` Integration execution complete; `106038799055` Production regression readiness.
- Raw failed job reports the separately compiled requester admission lifecycle-pause test returning retry instead of defer and an error-serialization stack overflow. The first product/harness exception is not established by that report. Do not conflate error reporting with the disposition's cause.
- The existing guide is blocked, repeats the customer provider-route denial, and distinguishes older UI evidence from exact-HEAD invitation evidence. Service health is not complete customer acceptance.

Commands used for read-only corroboration:

```bash
git status --short
git rev-parse HEAD
gh pr view 3363 --json headRefOid,mergeable,state,isDraft
gh run view 35492001110 --json headSha,status,conclusion,jobs --jq '{headSha,status,conclusion,failedJobs:[.jobs[]|select(.conclusion == "failure")|{name,databaseId,url}]}'
gh run view 35492001110 --job 106030872598 --log
```

Inspection downloads are `/tmp/co-managed-pr3363-body.txt` and `/tmp/co-managed-ci106030872598.log`. These are working copies, not durable completion evidence. The original job remains linked in the PRD. The review guide/evidence resides outside the repository; preserve sanitized artifacts durably during C1/C7, excluding fixture identities, credentials and raw email bodies.

## Scope decisions

- Preserve the existing live-provider exclusion in `docs/evidence/co-managed-acceptance-scope.md`. In-card application journeys using approved simulators/signed test licenses must be completed. Real Stripe/license/Graph acceptance remains owned production work. This resolves conflicting historical checklist wording by splitting evidence obligations, not by marking real-provider tests passed.
- Keep `release-v1-6-feature` UI-only. Product permissions remain enforced in every backend.
- Preserve the reverted runtime clone-source behavior and CI lane coverage. The local migration-overlay fix does not explain the remaining exact-HEAD failure.
- Preserve requester query audience filtering and invitation three-phase delivery. Correct ordinary timesheet visibility without reintroducing inconsistent dispatch scopes.
- The native timesheet absent-column issue requires reachability analysis. A pre-existing defect becomes in-card correction work if the agreed customer/MSP journey uses it.
- No workflow-board mutation is authorized by this planning assignment. C8 specifies a repository verifier and an XO handoff. Binding it to board eligibility, re-pointing to implementation, approval, merge and template changes require the XO/captain. Planning success is not human-review readiness.

## Checklist semantics and dependencies

The correction has 32 feature items and 26 high-impact acceptance scenarios. Every new item starts false; no future code/test has been represented as implemented. `status` and `evidence` describe acceptance separately from implementation existence. `dependsOn` defines feature sequencing; test `featureIds` and feature `prdRefs` bind behavior to scope. All in-card corrections are required. CF032 completes the external-prerequisite inventory, not the real-provider validation itself.

Before review, C1 must map every original foundation T01–T22, client F001–F033/T001–T021 and ticket-list F001–F039/T001–T020 into the actual-candidate manifest. The PRD acceptance matrix covers all foundation IDs. Existing follow-on false flags remain false pending reconciliation. True flags remain historical implementation records with pending current acceptance.

CT026 combines verifier unit acceptance with its final real-candidate execution. First implement/test the verifier; then run it over independent evidence for the candidate. Do not make the manifest require its own final invocation as a prerequisite to executing the verifier. Attach that invocation to the final review packet afterward.

## Environment and implementation gotchas

- Branch upstream has been reported as main; inspect it and never use a bare push. If a later order requires delivery, use an explicit branch ref.
- CI reproduction instructions: `docs/dev/running-integration-tests-locally.md`. Use the CE+EE overlay, original seed `20260610`, actual shard and runtime source selection. Avoid rebuilding a test database from CE migrations alone.
- Load local env with `scripts/dev/load-env-local.sh`; shell-sourcing raw values can execute ampersands. Never copy secrets into evidence.
- Read browser tests via the documented tailnet app address; loopback hydration was historically unreliable. Diagnose current behavior rather than treating every UI failure as automation drift.
- Use the registered app/worker startup commands. Workers and built package exports must match source, not merely respond to health probes.
- Reset signs users out and can encounter nonfixture technicians, project links and protected accounting references. Use isolated disposable data for destructive cases and preserve claimed workspace evidence.
- Fixed time periods age out. Refresh nonoverlapping periods through the permitted fixture procedure before acceptance; do not mistake an expired fixture date for product behavior.

## Next implementation order

Begin C1 inventory and C2 first-error diagnosis, then close C3–C6 required product behavior before C7/C8 final verification. Follow the PRD dependency table. If instrumented CI is pending and there is no independent work, report a still-running result with its exact run/SHA; do not claim readiness. If the same blocker remains without new evidence, supply a causal investigation packet to the XO instead of another unchanged preparation run.

## Documentation validation

Run `python3 scripts/validate_plan.py` on this folder and both follow-on folders. Check unique IDs, acyclic feature dependencies, test-to-feature coverage, PRD anchors, local links and `git diff --check`. Product tests are intentionally not part of this documentation assignment; all acceptance scenarios remain not run.

Validation result: all three plan folders passed the repository validator. Additional checks passed for unique IDs, all 32 correction features covered by tests, acyclic dependencies, PRD anchors/local links, and preservation of all original IDs/implementation flags. `git diff --check` passed. Product/runtime acceptance remains unexecuted.
