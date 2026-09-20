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

`humanReviewReady` is **false**. The C8 verifier (CF030) that would compute it does not exist yet.
