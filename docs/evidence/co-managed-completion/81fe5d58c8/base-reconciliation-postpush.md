# Mergeability re-checked after pushing the base reconciliation

Companion to `base-reconciliation.md`, which records the merge itself.

## Before the merge, at `618019c3e3`

```
$ gh pr view 3363 --json mergeable,mergeStateStatus,headRefOid,baseRefName,state,isDraft
{"baseRefName":"main","headRefOid":"618019c3e3563f729684163c1abd8f5ad312e5dd",
 "isDraft":false,"mergeStateStatus":"BEHIND","mergeable":"MERGEABLE","state":"OPEN"}
```

The card's `CONFLICTING` value was stale. The branch was `MERGEABLE` but 7 commits `BEHIND`.

## After pushing the merge, at `3fe922a550`

```
{"headRefOid":"3fe922a5507bba3a4cb312348c5f4432a05e6457",
 "mergeStateStatus":"BLOCKED","mergeable":"MERGEABLE"}
```

## At the round's final head, `f947340bcd`

```
$ gh pr view 3363 --json mergeable,mergeStateStatus,headRefOid,state,isDraft
{"headRefOid":"f947340bcde8d1647daa3b79efb902668a311a7a","isDraft":false,
 "mergeStateStatus":"BLOCKED","mergeable":"MERGEABLE","state":"OPEN"}
```

## Reading this

`mergeable` stayed `MERGEABLE` throughout. `mergeStateStatus` moved `BEHIND` → `BLOCKED`, which is
the intended outcome of this work: the branch is no longer behind its base. `BLOCKED` here means
required checks have not all completed and the PR has no approving review — it is **not** a merge
conflict, and it is exactly what an unreviewed PR with in-flight CI should report.

The readiness verifier treats `CONFLICTING` and `UNKNOWN` mergeability, and a `DIRTY` or `UNKNOWN`
merge state, as blocking; `BLOCKED` is not by itself a blocking merge state, because the mandatory
check results are evaluated separately and on their own terms.

This records mergeability only. It is not a CI result and not a readiness claim.

## 2026-09-20, mitigation round — re-measured at `b17b7a80b4`

The card's `CONFLICTING` claim is stale twice over. Re-measured live at this round's candidate:

```
$ gh pr view 3363 --json mergeable,mergeStateStatus,state,isDraft,headRefOid,baseRefName
{"baseRefName":"main","headRefOid":"b17b7a80b4d022f0e372e68b744e636bfe069c05",
 "isDraft":false,"mergeStateStatus":"BLOCKED","mergeable":"MERGEABLE","state":"OPEN"}

$ git rev-list --left-right --count origin/main...HEAD
0	373
```

`origin/main` is still `8120314513cb27ea5e61d8c80beccb709e03e437` — the same commit the
`base-reconciliation.md` merge took in. **Main has not moved since that merge**, so this round takes
no merge and the two-part merge discipline (direct-diff every file main touched, plus rerun the
tests main added) has nothing new to apply to. The earlier application of that discipline stands
recorded in `base-reconciliation.md`; it is not re-asserted here for commits that do not exist.

`0` behind is the load-bearing number. A branch that is zero commits behind its base cannot have a
textual merge conflict with it, which is the direct refutation of `CONFLICTING`. `BLOCKED` continues
to mean the review/required-check gate, and the mandatory check results are evaluated separately by
the readiness verifier — reading `BLOCKED` as a conflict is the error this file exists to prevent.

This records mergeability only. It is not a CI result and not a readiness claim.
