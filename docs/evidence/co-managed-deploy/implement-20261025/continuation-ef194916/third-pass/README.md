# Third pass: product fixes and re-recording on one build

Every non-blocked guide was re-recorded on one application build, the canonical review app at `http://feature-co-managed-it.localhost:23374`:

- **Source:** `56e708a31b0c68e2c287863ddbe73adc2422b1e7`
- **Build:** `build-1792957994771` (dist `server/.next-review-final-56e708a31b`)

Its provenance is in `receipts/final-runtime-provenance.json`. Each guide in `../../guide-coverage.json` records the build its evidence came from. A guide counts as covered only for scenarios recorded on that build.

## Result

- **14 required guides:** 11 covered on the current build, 0 partial, 3 blocked-external.
- **Media:** published playback and chapter seek verified for all 14 guides (`recordingReady=true`).
- **Review readiness:** `reviewReady=false`. Guide coverage does not promote requirement rows, and the requirement gate in `../../completion-verdict.json` still reports 258 implemented-unverified and 2 blocked-external rows.

## Product defects fixed in this pass

Each fix has a behavioural regression that fails without the fix, and a recording on the final build:

| Commit | Defect | Recording |
|---|---|---|
| `1c431798ba` | An unconfirmed comment publish closed the composer and lost the draft. It now keeps the draft and staged files, and a retry reuses the same operation. | `07-composer-draft-recovery-56e7` |
| `3e423f3133` | A stored layout preference that loaded late overrode the user's explicit Entry choice, which unmounted an open composer. | `07-grid-parity-and-file-limits-56e7` (failed twice on the earlier build; see `defect-evidence/`) |
| `c31dc3bfad` | Billing client lookups ignored co-managed work references. Catalog time could not be reviewed or invoiced, and unapproved co-managed time did not block its contract line. | `09-catalog-pricing-reconciliation-56e7` |
| `33ae41dcae` | The MSP saw "Not assigned" for a customer-assigned shared ticket. The name is now shown; the identity is still never disclosed. | `00-overview-native-walkthrough-56e7` |
| `91c9b27009` | The client billing dashboard's unresolved-charge review excluded work done today. | `09-catalog-pricing-reconciliation-56e7` |
| `56e708a31b` | An ended customer workspace offered edits that always failed with a generic error, and showed a time panel that could not load. | `10-departure-c-cutoff-56e7` |

## Recordings

Raw scenario directories are in `../runs/56e708a31b0c68e2c287863ddbe73adc2422b1e7/`. Published composites, chapters and playback proofs are in `publication/`.

- **Guide 10:** recorded as three stages on a new disposable relationship (provision, pre-cutoff content, cutoff).
- **Guide 08:** its departure-clock cutoff is asserted in the guide 10 cutoff stage.
- **Overview:** two recordings, the layout boundaries and the native edit walkthrough.

The scenario scripts are in `../scripts/`. Re-runs write to new scenario names chosen through `CM_SCENARIO`, so accepted evidence is never overwritten.

## Blocked-external guides

Guides 02, 11 and 12 were not retried. `blocked-external.json` names, for each one, the missing resource, where it plugs in, and the single action that unblocks it. Their earlier evidence stays labelled with the build it was recorded on.

## Fixtures and environment

- **Operator-seeded fixtures:** isolated technicians, approval teams and some fixture tickets come from operator SQL, as in earlier passes. Each scenario's limitations say so.
- **Unchanged fixtures:** White Rabbit (`1f98df77…`) is unchanged and its review ticket is restored. The accepted fixture `791752cb…` was not used.
- **Disposable relationships:** new ones were created for guides 01/03/08 and guide 10. The guide 10 relationship is ended.
- **Intermediate builds:** the builds of `c1f6d91f1b`, `c31dc3bfad` and `4aac94d6a2` were served while defects were found and fixed. Their receipts remain in `receipts/`. No guide is counted as covered on those builds.

Pre-existing issues seen on `origin/main` and left unchanged are listed under `preExistingIssuesObserved` in the ledger.
