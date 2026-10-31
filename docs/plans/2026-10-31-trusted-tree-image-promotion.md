# Trusted promotion of `tree-<hash>` images

Card: PSA ticket alga-2026-0002937 · branch `feature/security-authz-in-jobs-build-images`

## Decision summary

| Topic | Decision |
|---|---|
| Who may write `tree-<hash>` | One job, `promote-trusted-images` in `production-regression.yml`, on pushes to `refs/heads/main` only. |
| Pull requests | Always use the artifact transport. A pull-request run never holds a package-writing token. |
| Permission split | `production-regression.yml` calls the browser lane from two jobs: `browser-pr` (`packages: read`) and `browser-trusted` (`packages: write`). A third job, `browser`, aggregates them so readiness keeps one name to read. |
| Consumer check | An attestation on the image digest, signed for `refs/heads/main` by this repository, plus the `com.nineminds.source-tree` label. `scripts/verify-trusted-tree-image.mjs` implements it. |
| Regression test | `scripts/tests/workflow-trusted-image-publication.test.mjs` models the caller-to-callee permission flow. |

## The finding

A collaborator who can push a branch can plant an image under a tree hash that trusted `main` will later produce.

- `.github/workflows/production-regression.yml:4` triggers on `pull_request`. Its `browser` job (lines 61-70) calls `e2e-fresh-install-tests.yaml` with `packages: write`.
- `e2e-fresh-install-tests.yaml:54-68`: the `changes` job picks `image_transport=registry` for every same-repository, non-Dependabot pull request.
- `e2e-fresh-install-tests.yaml:110-112`: `build-images` declares `packages: write`. Lines 222-228 log in to GHCR.
- The job then runs pull-request-controlled install and build code.
- `e2e-fresh-install-tests.yaml:359-368` writes the mutable tag `$REGISTRY_REFERENCE:tree-$TREE` before any browser gate runs.
- Argo (`nm-kube-config`, check-image-exists) resolves `tree-<tree of the commit being deployed>` and copies that image.

The attacker computes the tree hash that a later `main` commit will have, builds a malicious image under it, and Argo deploys it.

## Why the obvious fix is not enough

Removing `packages: write` from the pull-request caller stops the attack only while the pull request leaves `production-regression.yml` alone. Workflows triggered by `pull_request` run from the pull request's own merge commit, so the author can restore the grant. Every package linked to the repository is then writable by that token. A control that lives in the workflow cannot hold against the author of the workflow.

What holds is a property the author cannot forge: a signed attestation whose certificate records the ref that ran the signing job. A pull-request run has ref `refs/pull/N/merge`. A branch push has `refs/heads/<branch>`. Neither satisfies "source ref is `refs/heads/main`".

## Design

### Transport and permissions

- `changes` selects `registry` only when `github.event_name != 'pull_request'` and the actor is not Dependabot. Every pull request uses the artifact transport, which already carries the build record and digest.
- Job-level `permissions:` cannot be conditional, and a called workflow cannot request more than its caller grants. A job that requests more fails the whole run at startup, whether or not its `if` skips it. So the event-dependent grant moves to the caller:
  - `browser-pr`: `if: github.event_name == 'pull_request'`, `contents: read`, `packages: read`.
  - `browser-trusted`: `if: github.event_name != 'pull_request'`, `contents: read`, `packages: write`.
  - `browser`: `if: always()`, needs both, and fails unless the one caller that ran succeeded. `scripts/lib/production-readiness.mjs` and `.github/workflows/production-regression.yml` (`inventory`, `readiness`) read `needs.browser.result`, and they stay unchanged.
- In the called workflow, `build-images` declares no `permissions:` and the workflow-level block is gone. A job with no declaration inherits the caller's grant, so it holds `packages: write` for `browser-trusted` and `packages: read` for `browser-pr`. Every other job declares `contents: read` itself (`production-browser` keeps `packages: read`), so nothing else inherits the package grant.
- The called workflow never holds `id-token`. Only the promotion job does.

### Promotion

`promote-trusted-images` lives in `production-regression.yml` itself, not in the called workflow. A job in the called workflow cannot ask for `id-token: write` and `attestations: write`, because `browser-pr` cannot grant them.

- `needs: browser-trusted`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.browser-trusted.result == 'success'`.
- Permissions: `contents: read`, `packages: write`, `id-token: write`, `attestations: write`. No other job has `id-token`.
- It recomputes `TREE` with `git rev-parse 'HEAD^{tree}'` from its own checkout of `github.sha`.
- It downloads `fresh-install-build-record-server` and `fresh-install-build-record-server-ee` and reads `registry.manifestDigest` and `registry.reference` from each.
- It checks the config of each digest with `docker buildx imagetools inspect`: `com.nineminds.source-tree` must equal the recomputed `TREE` and `org.opencontainers.image.revision` must equal `github.sha`. It fails closed.
- Only then does it run `docker buildx imagetools create --tag …:tree-$TREE …@digest`.
- It attests each digest with `actions/attest-build-provenance` and `push-to-registry: true`.
- The build job no longer writes any `tree-` tag. The label step stays, because the label is what the promotion and the consumer check.

### Consumer verification

`scripts/verify-trusted-tree-image.mjs <reference> <tree>`:

1. Resolves `<reference>:tree-<tree>` to a digest.
2. Runs `gh attestation verify oci://<reference>@<digest> --repo <owner/repo> --signer-workflow <owner/repo>/.github/workflows/production-regression.yml --source-ref refs/heads/main`.
3. Requires the image's `com.nineminds.source-tree` label to equal `<tree>`.

`provenance: false` on the build stays. The candidate is a single plain manifest and the attestation is a separate referrer, so the manifest does not change.

The repository is public (`gh repo view` reports `PUBLIC`), so attestations use the public Sigstore instance and need no plan upgrade.

## Tradeoffs

- **Pull requests lose registry transport.** The workflow comment cites about 14 minutes added to the enterprise browser lane. Pull-request browser lanes are slower.
- **Reusing a pull request's build after squash-merge is gone.** That was the purpose of #3975. It is incompatible with trust: the pull request controls the bytes, so promotion from `main` cannot vouch for them. Argo can now reuse only an image built by the `main` push run itself, and only if that run has promoted it (after `browser-trusted` passes) before Argo looks the tag up. Otherwise Argo builds.
- **Promotion waits for the browser lane.** The promotion job cannot depend on `build-images` directly (it is inside the called workflow), so it waits for the lane. Only browser-tested images get a trusted tag. Argo may build more often than before.
- **Direct dispatch of `e2e-fresh-install-tests.yaml`.** With the workflow-level `permissions:` removed, `build-images` takes the repository's default token permissions. Only writers can dispatch it, and it never writes `tree-` tags.
- **Follow-up outside this repository.** `nm-kube-config` (check-image-exists) must verify the attestation before it copies a `tree-<hash>` image. That change is a human follow-up: run `scripts/verify-trusted-tree-image.mjs` (or the `gh attestation verify` call above) after resolving the tag, and treat a failure as a cache miss, not an error. This card does not edit that repository.
- **Cleanup.** `candidate-image-cleanup.yml` deletes package versions older than 72 hours, tagged or not. A promoted `tree-` tag shares the version of the candidate pushed by that run, so it expires 72 hours after the build. Attestation referrers are separate versions and can expire on their own schedule. A consumer that finds the tag but no attestation must build. No change is made here.

## Test

`scripts/tests/workflow-trusted-image-publication.test.mjs` (`node:test`, `js-yaml`) parses both workflows and asserts:

- No job reachable from a `pull_request` trigger is granted `packages: write`, directly or through the caller grant it inherits. Every called job's declared permissions are within its caller's grant.
- Transport selection never yields `registry` for `pull_request`.
- Exactly one job contains a `tree-` tag write. It is gated on a push to `refs/heads/main`, recomputes the tree from its own checkout, verifies the labels before tagging, and attests.
- Only that job holds `id-token: write`.

The test must fail against origin/main's workflow files and pass after the change. `scripts/tests/runtime-image.test.mjs` keeps its label and tree coverage and points at the promotion job.
