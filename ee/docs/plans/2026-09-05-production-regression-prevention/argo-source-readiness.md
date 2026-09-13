# Exact-source Argo readiness gate

The companion patch applies to `nm-kube-config/alga-psa/workflows/build/alga-psa-ci-cd-workflow.yaml` at infrastructure revision `0efc640af5ad5ae869b877dd1be7c3835a2bb2f1`. It is applied to the local infrastructure checkout, not published or installed in Argo.

The new first DAG task resolves the source ref once, verifies the exact successful published Production regression readiness run, and emits the full SHA only after success. Image lookup and checkout consume that SHA. Both new-build and existing-image paths therefore depend on readiness. The pipeline output also carries the verified full SHA when checkout is skipped. The placeholder run-tests task is removed. Existing manual approval is preserved in the unchanged composite workflow.

The consumer verifier is pinned to application commit `885f4e78824e36b1b0447ff9df987305f46d1abc`, independently of the candidate source. **Publish that commit and establish successful native readiness before deploying this workflow change.** The gate fails closed if that source is unavailable, authentication fails, or readiness is missing/pending/failed. It does not wait for CI to finish; rerun the publisher after CI succeeds. The existing github-token secret must have repository content and Actions read access.

Validate locally without Docker (replace the workflow argument with the infrastructure checkout path):

```sh
argo lint --offline /path/to/alga-psa-ci-cd-workflow.yaml
node --experimental-vm-modules ee/docs/plans/2026-09-05-production-regression-prevention/validate-argo-readiness.mjs /path/to/alga-psa-ci-cd-workflow.yaml
```

The seven behavioral cases execute the actual YAML script using controlled GitHub responses and the real verifier implementation: success, failed readiness, missing readiness, wrong repository, unresolved SHA, and HTTP error, plus actual Argo-style script-file invocation. The shell passes the appended filename as `$0` and reads it into Node module stdin; Node rejects `--input-type=module` with a direct filename argument. They verify failure produces no deployable SHA. Argo lint checks the template and DAG references offline. Neither proves live Argo execution, image provenance, manifest-bound smoke tests, component build readiness, or installed branch protections. Those remain required before F020 is complete.
