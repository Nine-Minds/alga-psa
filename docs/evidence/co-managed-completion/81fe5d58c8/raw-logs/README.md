# Raw logs

Referenced by `manifest.json` evidence records. These exist because an evidence record whose `artifact`
points at the prose asserting the claim proves nothing — the record must point at the output it is a
claim about.

Two transformations are applied and nothing else: ANSI colour codes are stripped (`gh run view --log`
renders them as a literal `^[` pair, so both forms are removed), and the GitHub `job\tstep\ttimestamp`
line prefix is removed. `sha256(source)` is of the untransformed capture, so the transformation itself is
reproducible and checkable.

| file | what it is | lines kept / original | sha256(committed) | sha256(source) |
| --- | --- | --- | --- | --- |
| [`shard-fixed-arm.txt`](shard-fixed-arm.txt) | The faithful 78-file shard WITH the duck-typed predicate (round 2, fixed arm). | 694 / 694 | `fc3a1d72704c49f3…` | `07a8cc6dde962e5b…` |
| [`shard-control-arm.txt`](shard-control-arm.txt) | The SAME shard with isCoManagedSharedWorkError reverted to `instanceof` in source and dist (round 2, control arm). | 701 / 701 | `94f53ecd715cd58c…` | `e2cc8944c81488e2…` |
| [`ci-shard1-fb2e696645.txt`](ci-shard1-fb2e696645.txt) | GitHub Actions run 35522723445, job 106110228049, Integration shard 1 at `fb2e696645` — the first run whose log carries the `[inbound-email-diagnostic]` lines, so the first error is named. | 678 / 4676 | `389279056dfcd665…` | `985023e00307031f…` |
| [`ci-shard1-618019c3e3.txt`](ci-shard1-618019c3e3.txt) | GitHub Actions run 35492001110, job 106030872598, Integration shard 1 at 618019c3e3 — the original failure. | 587 / 4623 | `efe31b35c2067a15…` | `534fc6c86316c4dd…` |
| [`commentreactions-isolated.txt`](commentreactions-isolated.txt) | commentReactions run alone on a private database (TEST_DB_NAME=test_database_cr_branch), showing the Redis AUTH rejection that produced the 8 timeouts. | 445 / 445 | `bc8a34d50efaf88f…` | `6358c4a6ab6cf4fa…` |

## Capture command and trimming rule, per file

### `shard-fixed-arm.txt`

- capture: `local: INTEGRATION_SHARD_TOTAL=4 INDEX=1 TIER1_BASE_SHA="" VITEST_SEED=20260610`
- Complete log. ANSI colour codes and GitHub job/step/timestamp prefixes stripped; nothing else removed.
- sha256 committed: `fc3a1d72704c49f36300e860d4cafdbf3b76fcb89c37719759471ab7008f0514`
- sha256 source: `07a8cc6dde962e5bc4fb0b6884a2d97c642fe56f12aa12c539d6c591da44295f`

### `shard-control-arm.txt`

- capture: `local: identical invocation, predicate reverted`
- Complete log. ANSI colour codes and GitHub job/step/timestamp prefixes stripped; nothing else removed.
- sha256 committed: `94f53ecd715cd58c40a991f319f902569b540917ea369b9d971038cd4e022655`
- sha256 source: `e2cc8944c81488e2a32b330256177d5291d757c2952301f383bc4c1865e3508c`

### `ci-shard1-618019c3e3.txt`

- capture: `gh run view --job 106030872598 --log`
- Trimmed from 4623 lines. Kept: first 120, last 200, and +/-25 lines around every mention of the requester-deferral case, coManagedBootstrap, [inbound-email-diagnostic] or "Maximum call stack". Omissions are marked inline. ANSI codes and GitHub prefixes stripped.
- sha256 committed: `efe31b35c2067a15b8335d18d9906195939d4d5f60803f89afc650ff4d494b71`
- sha256 source: `534fc6c86316c4dd2ac80fe85e75eae86fae478ba6da2ece781baef58cf7c1a9`

### `commentreactions-isolated.txt`

- capture: `local: vitest run src/test/integration/commentReactions.integration.test.ts`
- Complete log. ANSI colour codes and GitHub job/step/timestamp prefixes stripped; nothing else removed.
- sha256 committed: `bc8a34d50efaf88f6b92e1b9a3229d7a3b7bcbf7e117963e189ab46463b577ac`
- sha256 source: `6358c4a6ab6cf4fa21caf34aaf6041943759d65a6b749724954b6f697b7f933c`

### `ci-shard1-fb2e696645.txt`

- capture: `gh api --allow-escape-sequences /repos/Nine-Minds/alga-psa/actions/jobs/106110228049/logs`
  (`gh run view --log` refuses while the parent run is still in progress; the API route does not).
- Trimmed from 4676 lines. Kept: first 120, last 200, and +/-25 lines around every mention of the
  requester-deferral case, coManagedBootstrap, `[inbound-email-diagnostic]`, "Maximum call stack",
  "Failed Tests", "Test Files" or "Runner exited". Omissions are marked inline. ANSI codes and
  GitHub job/step/timestamp prefixes stripped, as for every file here.
- sha256 committed: `389279056dfcd6659485af5f083ee242e90e147083eb84522b8763a12a1d3616`
- sha256 source: `985023e00307031afbaacff5b850c9c939251ac20363f5a9a69e53964ee351e2`
