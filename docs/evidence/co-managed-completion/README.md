# Co-managed completion evidence

Evidence for PR [#3363](https://github.com/Nine-Minds/alga-psa/pull/3363), collected against the
correction plan in [`docs/plans/2026-09-20-co-managed-it-completion/`](../../plans/2026-09-20-co-managed-it-completion/PRD.md).

Each subdirectory is named for the SHA a round's evidence was anchored at. **A directory name is not
a claim that everything inside it ran at that SHA**: a round produces several commits, so every
document and every evidence record states the exact SHA its commands ran at, and
`inventory.json` carries both the generating `candidate` and a per-record `sha`.

Historical evidence stays historical. A changed candidate invalidates readiness until the affected
evidence is rerun; reusing unaffected evidence requires an explicit dependency analysis, never a
silent SHA relabel.

## `b96b4c2ae0/` — the 2026-09-20 correction round

Anchored at the `origin/main` base-reconciliation merge commit.

| File | What it establishes |
| --- | --- |
| `base-reconciliation.md` | `origin/main` `8120314513` merged in, with the drop audit, a per-file justification of every difference, and main's own tests rerun. |
| `cf002-requester-deferral.md` | CF002–CF004. **Still open.** Two reproductions attempted and both passed; reporting made finite; one structurally confirmed defect repaired; cause not established. |
| `cf005-provider-setup.md` | CF005/CF006. Customer provider setup reachable and capability-scoped, walked in a real browser, with the excluded surfaces still denied. |
| `inventory.md` / `inventory.json` | CF001. All 193 requirement rows across the four plans, each with a status and a justification. Regenerate with `node scripts/build-co-managed-inventory.mjs`. |
| `manifest.json` | CF030. The same rows plus candidate identity, provenance, CI, mergeability, open defects and production prerequisites. Fields nobody has collected yet are explicit `null`, so the gate names them instead of treating an absent field as satisfied. |

## The gate

```bash
node --test scripts/tests/co-managed-completion.test.mjs   # 55 cases; run these first
node scripts/verify-co-managed-completion.mjs --candidate b96b4c2ae0
```

The verifier is read-only and fails closed, exiting non-zero unless
`humanReviewReady` is true. It reads the requirement IDs from the plans, not from
`inventory.json`, so a requirement that disappears from a plan is reported rather
than silently confirmed. Its own behaviour is validated by the `node --test`
suite above — which the `node-tooling` CI lane discovers automatically — because
the PRD forbids a self-referential checklist.

Its invocation record and any packet-delivery receipt are **outputs** of this
gate, never inputs to it. Binding the verdict to review eligibility is the XO's
job; merging and human approval are later board actions.

## Current verdict

`implementationReady`, `humanReviewReady` and `productionReady` are all
**false**. 190 blocking reasons, of which the first is that 189 of the 193
requirement rows have no acceptance record on this candidate, and CF002's
open functional defect is one of the rest.

Note on the candidate field: the manifest records the SHA it was generated at,
which is the commit *before* the commit that adds it. The verifier compares that
against `HEAD` and reports the difference as a blocking reason. That is correct —
a readiness packet is assembled at a frozen candidate and verified at that
candidate, and nothing about this round is ready anyway.
