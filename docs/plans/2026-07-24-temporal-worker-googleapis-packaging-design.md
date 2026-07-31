# Temporal Worker googleapis Packaging Design

## Problem

The `temporal-worker-ci-cd` workflow for `main` at `1cab69e` built and pushed its image,
then failed in `deploy-helm`: `helm upgrade --wait` timed out because every new replica
entered `CrashLoopBackOff` on startup with

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'googleapis' imported from
/app/ee/temporal-workflows/dist/shared/services/email/providers/GmailAdapter.js
```

`shared/services/email/unifiedInboundEmailQueueJobProcessor` statically imports
`GmailAdapter`, which imports `googleapis`. `googleapis` is declared by
`shared/package.json`, but the Temporal worker compiles the shared TypeScript sources
into its own `dist/shared/**` tree. Resolution therefore starts from
`ee/temporal-workflows/dist/**` and walks up through `ee/temporal-workflows/node_modules`,
where `googleapis` was never installed. The image's `NODE_PATH=/app/shared/node_modules`
does not close the gap: `NODE_PATH` is ignored by ESM resolution, and the worker runs as
ESM.

## Decision

Declare `googleapis@^152.0.0` as a direct runtime dependency of `ee/temporal-workflows`
and update that workspace's lockfile. The version matches the range already declared by
`shared` and `server`, the packages that own this import.

This is the same narrow fix used for `nodemailer` in
`2026-07-23-temporal-worker-nodemailer-packaging-design.md`, and it uses the final
image's existing module-resolution path.

Do not copy `shared/node_modules` into the final image and do not refactor the shared
email provider exports as part of this deployment fix.

## Validation

A probe pod running the failing image `1cab69e` was used to walk the worker's static
import graph from `dist/ee/temporal-workflows/src/worker.js` (515 modules) and resolve
every bare specifier. `googleapis` was the only genuine `MODULE_NOT_FOUND`. Installing
`googleapis` into `ee/temporal-workflows/node_modules` in that pod let the worker load
its entire module graph and proceed to configuration validation, which is the expected
next step for a pod without env or Vault secrets.

After building this branch:

1. All worker replicas become ready without restarts.
2. `helm upgrade --wait` completes instead of hitting its deadline.

## Follow-up

This is the second deployment blocked by a runtime dependency that `shared` declares and
`ee/temporal-workflows` does not. The resolution walk used above is cheap and fully
static; running it against the built `dist` as a Docker build step would fail the image
build rather than surfacing the gap as a production `CrashLoopBackOff`. Tracked
separately so this fix stays narrow.
