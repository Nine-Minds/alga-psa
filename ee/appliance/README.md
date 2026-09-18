# Appliance Assets (Ubuntu v1)

This directory owns the AlgaPSA self-hosted appliance runtime assets.

Supported customer appliance path for v1 is Ubuntu Server 24.04 LTS with the host setup/status service on port `8080`. The older local release tree and script-driven bootstrap/upgrade process have been removed from this repository.

Remote support behavior and its fail-closed external dependencies are documented in [docs/appliance/remote-support.md](../docs/appliance/remote-support.md).

For user-facing appliance installation and operation guides, start with:

- `ee/docs/appliance/README.md`
- `ee/docs/appliance/quick-start.md`
- `ee/docs/appliance/operators-manual.md`
- `ee/docs/appliance/technical-reference.md`

Current responsibilities:

- Ubuntu appliance ISO workspace under `ubuntu-iso/`
- host setup/status/update service under `host-service/`
- Flux deployment profiles under `flux/`
- storage prerequisites under `manifests/`
- support/repair/reset helpers under `scripts/`

## Release publishing

Appliance release metadata is published as an OCI artifact in `ghcr.io/nine-minds/alga-appliance-release`. It is not stored under `ee/appliance` and is not published by scripts in this repository.

Use the Argo workflow in the Kubernetes config repository:

```text
~/nm-kube-config/alga-psa/workflows/composite/alga-psa-build-migrate-deploy.yaml
```

For stable channel publishing, submit the workflow with:

```text
promote-release=true
publish-appliance-release=true
appliance-release-channel=stable
```

Use `appliance-release-source-ref` / `appliance-release-version` only when intentionally overriding the source commit or release version. The appliance setup and update engines resolve the selected channel from OCI at runtime.

## Setup and updates

- First install is driven by the host service and setup UI on port `8080`.
- Application channel updates are driven by `host-service/update-engine.mjs` and the in-cluster status/update UI.
- Both paths resolve release metadata from the OCI artifact registry, then apply runtime values, the pinned Flux config bundle, and the selected image tags.
- An update suspends the six application HelmReleases first (as the Flux CLI's field manager, since kustomize-controller strips fields owned by plain `kubectl patch`), applies the runtime values and the config bundle, nudges the nested `alga-platform`/`alga-core`/`alga-background` Kustomizations that carry the chart pins, waits until every HelmRelease shows the new chart version, removes any leftover `alga-core-sebastian-bootstrap` bootstrap Job, and only then resumes the releases. Each release therefore runs a single Helm upgrade instead of one per changed input, which is what used to make the second upgrade collide with the first one's bootstrap Job. The update reports complete only after every release is Ready at the new chart version; a release that is still converging is reported as pending, and a failed one blocks the update.
- Recover on the Manage page (`POST /api/recover`) resumes the releases, deletes a leftover bootstrap bootstrap Job, and forces a reset reconcile of `alga-core` (`reconcile.fluxcd.io/resetAt` + `forceAt`), so a release stalled with `RetriesExceeded` recovers without SSH.

## Operator and support helpers

The `ee/appliance/appliance` operator is for status, support bundles, repair helpers, and destructive reset in engineering/support contexts. It no longer exposes bootstrap or upgrade commands.

```bash
ee/appliance/appliance status
ee/appliance/appliance support-bundle --output-dir ./bundles
ee/appliance/appliance repair-release --release-name alga-core
ee/appliance/appliance reset --force
```

Use the destructive reset helper directly when you need to clear persisted appliance data between test runs:

```bash
ee/appliance/scripts/reset-appliance-data.sh \
  --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  --force
```

## Support bundles

Use `ee/appliance/scripts/collect-support-bundle.sh` to export the standard diagnostics package for support. The `--talosconfig` and `--node-ip` flags are optional legacy diagnostics inputs, not required for the supported Ubuntu appliance path.

```bash
ee/appliance/scripts/collect-support-bundle.sh \
  --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  --site-id appliance-single-node
```
