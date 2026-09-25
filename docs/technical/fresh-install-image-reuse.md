# Fresh-install image reuse

The production browser lane builds ten Docker images per run. On a typical
product PR the two server images (about 23 minutes each, in parallel) must be
rebuilt, but the emulator, setup, hocuspocus, redis and pgbouncer images are
built from paths the PR never touched. This lane reuses an earlier run's image
when it can prove the inputs were identical, and otherwise builds as before.

## The proof

`scripts/image-inputs.json` states, per image, which repository paths it is
built from (the Dockerfile's `COPY` sources), a global exclude list (docs,
e2e specs, script tests) and an always list (the workflow file, which carries
the build arguments, and the policy itself). `scripts/lib/image-inputs.mjs`
hashes the git tree entries (mode, blob, path) of those inputs at a revision.
Two revisions with the same hash for an image would build the same context.

## The lookup

`scripts/reuse-docker-archive-build.mjs` runs before each build:

1. List completed `production-regression` runs on this branch, then on main,
   newest first, excluding the current run.
2. For each run, require unexpired `fresh-install-build-record-<service>` and
   image artifacts. Download the record and verify it against *that run's*
   identity (its revision, run id and attempt) with the same verifier the gate
   uses. A record that itself reused an older build names the original build's
   revision; the proof is always against the original.
3. Compute the input hash at the original build's revision (fetching the
   commit into the shallow checkout when needed) and compare with the
   candidate's. Only on equality download the image archive, verify its bytes
   against the source record, and re-issue a record for the candidate with a
   `reuse` block: source revision, run and attempt, the artifact's run, and the
   input hash and policy path.
4. Any failure at any step logs why and the job builds normally.

Image artifacts keep their one-day retention; the previous push of the same
branch and the latest merge to main are the usual sources.

## Where the revision label is checked

A reused image is labeled with the revision it was built at, not the
candidate's. Every place that inspects that label derives the expected value
from the verified build record (`scripts/lib/expected-image-revision.mjs`,
which falls back to the candidate revision when no record exists and fails
closed on a malformed or foreign record):

- the browser job's load step (`verifyLoadedDockerImage`)
- the provider topology check (`e2e-tests/harness/check-provider-topology.mjs`)
- the supported-upgrade and Citus-upgrade switches (`scripts/expected-image-revision.mjs`)
- the Microsoft callback stage (`imageBuildRevision` in its runtime binding)

The `UPGRADE_APPLICATION_REVISION` claim stays the candidate revision: the
running application is byte-identical to the candidate's build by the input
proof, and the mounted source is always the candidate checkout.

## What the gate accepts

`verifyBuildRecord` accepts a well-formed `reuse` block; the record's own
revision, run and attempt still identify the candidate. The loaded image's
`org.opencontainers.image.revision` label is checked against the original
build's revision when reused. The browser artifact manifest carries the reuse
block per component, names the reused services, and uses scope
`candidate-verified-archives` instead of `candidate-built-archives-only`.
Nothing else in the fresh-install evidence chain changes.

## Operating it

- `workflow_dispatch` with `no_cache` disables reuse for that run.
- Measured on the merge of #3440 (a product change with migrations): algasim,
  hocuspocus, redis and pgbouncer reusable; server, server-ee, the three
  workers and setup rebuilt. A CI-only change that edits `scripts/` or the
  workflow file rebuilds everything, because both are copied into the server
  context or carry build arguments.
- Widening reuse means narrowing an image's inputs in the policy; every entry
  should trace to a `COPY` line in its Dockerfile.
