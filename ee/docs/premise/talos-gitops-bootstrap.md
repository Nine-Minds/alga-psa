# Talos GitOps Bootstrap (Superseded)

This page is retained as historical Talos reference. The supported appliance path is now the Ubuntu/k3s host setup/status service on port `8080`.

The old script-driven first-boot/redeploy flow has been removed from `ee/appliance`. Current installs and app-channel updates resolve release metadata from OCI artifacts and are driven by the host/control-plane engines:

- `ee/appliance/host-service/setup-engine.mjs`
- `ee/appliance/host-service/update-engine.mjs`
- `ghcr.io/nine-minds/alga-appliance-release:<channel>`

Release publishing is owned by the Argo workflow in:

```text
~/nm-kube-config/alga-psa/workflows/composite/alga-psa-build-migrate-deploy.yaml
```

For stable releases use:

```text
promote-release=true
publish-appliance-release=true
appliance-release-channel=stable
```

The Flux topology notes below still apply conceptually: the appliance uses separate Helm releases for `alga-core`, `pgbouncer`, `temporal`, `workflow-worker`, `email-service`, and `temporal-worker`, with runtime values injected through cluster ConfigMaps and source content supplied by a pinned Flux config bundle.
