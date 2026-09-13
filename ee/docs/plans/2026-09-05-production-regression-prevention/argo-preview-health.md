# Preview HTTP health validation

`argo-preview-health.patch` is applied to the local nm-kube-config checkout only. It requires a successful root response and a 200 JSON health response with status `ok`, verifies TLS, rejects health redirects, bounds each request to 25 seconds, and restricts the target to blue/green. Removed the ignored `/api/version` request: that route does not exist in the application checkout. The existing `/api/health` route is static liveness, not database or business-journey readiness. This change does not close F020/F023.

Nine host behavioral checks execute the actual YAML code and command: success, invalid color, network error, failed root, health503, health redirect, non-JSON body and degraded status. Run:

```sh
node --experimental-vm-modules ee/docs/plans/2026-09-05-production-regression-prevention/validate-preview-health.mjs /path/to/composite/alga-psa-build-migrate-deploy.yaml
```

Strict offline Argo validation requires supplying the composite, app builder, migration and deployment WorkflowTemplate files together. It also exposed two pre-existing schema defects fixed in this patch: an identical duplicate determine-colors template, and template-level imagePullSecrets already correctly declared at workflow level. All four local workflow files pass strict offline lint together after these fixes. Manual approval remains in place.

No real preview endpoint was contacted and nothing was installed in the cluster. Native Node22/container validation, immutable release identity, tenant-scoped business smoke, cleanup, scheduling and notification remain outstanding. Do not treat this liveness result as comprehensive release readiness. Publish and validate the pending exact-source readiness dependency before applying the workflow set.
